# Sentinel — Project Review

Prepared for an outside technical reviewer. Every factual claim below was verified directly against the current repository (`git log`, `prisma/schema.prisma`, the actual route/lib source files) and the live production database during this pass — not carried over from memory of earlier discussion. Where something could not be independently re-verified, that's stated explicitly rather than assumed.

Verified: 2026-09-04. Repo state: 54 commits, `32d0f8f`→`620bb77`, spanning 2026-08-23 to 2026-09-04. This is a refresh of an earlier pass (verified 2026-08-28 at `04dfa5f`) — 14 commits landed since then, closing most of that pass's "known limitations" list. Where a claim changed since that version, it's called out explicitly rather than silently updated.

---

## 1. What this is

Sentinel is a fraud/chargeback risk guard for Razorpay merchants, built on one rule: the AI is never trusted with money. Every captured or failed payment is scored for fraud risk by an AI model (a 3-tier provider chain, with a deterministic rule-based fallback if all three fail) — but the model only ever advises. A hard-coded, merchant-configurable policy gate is the sole thing that decides `allow` / `hold_for_review` / `auto_refund`, and the sole thing that can trigger a real refund, and only within merchant-set bounds (max refund amount, daily budget, minimum risk/confidence thresholds). It's a real multi-tenant app: self-serve signup with email verification, password reset, real server-side session management (with per-device revocation), per-merchant data isolation, a full audit-trail dashboard with human override, configurable policy settings, a policy simulator, real email alerts, an in-app Razorpay checkout demo, a small versioned read-only external API with hashed API keys, an automated test suite, and a CI pipeline. Razorpay is wired in **test mode only** — no real money moves anywhere in this deployment.

---

## 2. Live deployment

**URL**: https://sentinel-pearl-psi.vercel.app

**What's real vs. test-mode**: Razorpay is configured with a test-mode key (`rzp_test_...`). The checkout flow (`/demo-store`, `/demo-payment`) opens Razorpay's real hosted Checkout.js widget and creates real test-mode Orders via Razorpay's real Orders API — this is Razorpay's own test-mode sandbox, not a fake widget, and test-mode payments never move real money regardless of card details entered. The database, scoring pipeline, policy gate, refund-execution code path, and email alerting are all real, unmocked code running against real (test-mode) Razorpay responses.

---

## 3. Architecture overview

Full path from a real (test-mode) Razorpay payment to a stored, alerted decision:

```mermaid
sequenceDiagram
    participant RP as Razorpay (test mode)
    participant WH as /api/webhooks/razorpay
    participant WE as WebhookEvent (idempotency)
    participant FE as featureExtractor (12 signals)
    participant AI as scoreTransaction (3-tier chain)
    participant FB as fallbackScore
    participant PG as policyGate (applyPolicy)
    participant RF as refundExecutor
    participant DB as Transaction (Postgres/Neon)
    participant AL as alerting (Resend)

    RP->>WH: POST payment.captured / payment.failed
    WH->>WH: verify HMAC-SHA256 signature (timingSafeEqual)
    WH->>WE: has this event id already been processed?
    alt already processed
        WE-->>RP: 200 ack, no reprocessing
    else new or crashed-mid-flight
        WH->>WH: resolve merchant from Order.notes.merchantId (fallback: default)
        WH-->>RP: 200 ack (within 5s, before scoring)
        WH->>FE: map payload -> event, extract features (via next/server's after(), merchant-scoped)
        FE-->>WH: 12-signal deterministic feature set
        WH->>AI: scoreTransaction(features)
        alt Groq primary succeeds
            AI-->>WH: {risk_score, confidence, reasons, recommended_action}
        else primary rate-limited
            AI->>AI: try Groq secondary key
            alt secondary succeeds
                AI-->>WH: scored (groq-secondary)
            else secondary also rate-limited
                AI->>AI: try Gemini (separate account)
                alt Gemini succeeds
                    AI-->>WH: scored (gemini)
                else Gemini fails, or any tier hit a non-rate-limit error
                    WH->>FB: fallbackScore(features)
                    FB-->>WH: rule-based, can never recommend auto_refund
                end
            end
        end
        WH->>PG: applyPolicy(score, amount, dailyAuthorizedTotal, settings)
        Note over PG: held under a real distributed Redis lock<br/>for read-budget + decide + write, cross-instance safe
        PG-->>WH: {decision, reason}
        alt lock unavailable
            Note over PG: auto_refund forced down to hold_for_review;<br/>everything else still scored and saved
        end
        alt decision == auto_refund AND source == razorpay_live
            WH->>RF: executeRefund(paymentId, amountInPaise)
            RF-->>WH: {success, refundId} or {success:false, error} - never throws
        end
        WH->>DB: create Transaction row (full audit trail, before Razorpay call even starts)
        WH->>WE: mark event processed
        alt decision in {hold_for_review, auto_refund} AND source == razorpay_live
            WH->>AL: sendAlert(transaction, settings)
            AL-->>WH: Alert row (emailSent/emailError either way, never throws)
        end
    end
```

**The LLM is a pure advisor.** `scoreTransaction()`/`fallbackScore()` return a `recommended_action`; only `applyPolicy()` (`lib/policyGate.js` — plain JS, no LLM call, no DB access, now 100% branch-covered by unit tests) decides what actually happens, and only `executeRefund()` moves money, gated separately on `source === "razorpay_live"`.

Runtime-shape details worth knowing:
- The webhook still acks Razorpay **before** scoring finishes, but the deferred work now runs through Next.js's `after()` API (`app/api/webhooks/razorpay/route.js`) instead of a bare fire-and-forget `.then()/.catch()` chain. **This changed since the last review**: the earlier version's fire-and-forget promise was liable to be frozen mid-flight by the serverless runtime the instant the response was sent, with no guarantee it would ever finish — `after()` is Next.js's supported mechanism for exactly this "respond now, keep working" shape, and it's what makes the webhook idempotency and lock-fallback work below actually reliable rather than a race against the runtime freezing the function.
- Real webhook idempotency is now in place (`WebhookEvent` model). **New since the last review**, which flagged "no idempotency handling beyond the DB's unique constraint on `txnId`" as an open gap — see §4 for the mechanism.
- `source` (`razorpay_live` / `synthetic` / `demo_simulated` / `kaggle_benchmark`) is the field that gates every money-moving and merchant-facing side effect. Refund execution, the daily-refund-budget aggregate, and alert firing each independently check `source === "razorpay_live"` in `lib/ingestTransaction.js` — three separate checks, not one shared helper (deliberate tradeoff, unchanged from the prior review).
- The Transaction row for an `auto_refund` decision is created **before** the Razorpay refund call is even made, with `actionTaken: "auto_refund"` already set — this is what the daily-budget aggregate counts, and it means a crash mid-refund still leaves a discoverable row (`refundExecuted: null`) rather than nothing at all.

---

## 4. Every major feature, verified against current code

**Deterministic 12-signal feature extraction** — `lib/featureExtractor.js`. Unchanged in shape from the prior review: `disposableEmail`, `countryMismatch`, `velocityLast10Min`, `amountVsHistoryRatio`, `isNewCustomer`, `previousChargebacks`, `oddHour`, `accountAgeDays`, `customerLifetimeTransactionCount`, `customerHistoricalSuccessRate`, `merchantRecentFraudRate`, `cardBinRiskCategory`. Pure and deterministic given the merchant-scoped transaction history query — no LLM involvement.

**3-tier AI failover scoring** — `lib/aiScoring.js` (Groq primary/secondary) + `lib/geminiScoring.js` (Gemini). Two independent Groq accounts (each its own 200k-tokens/day quota) plus a separate Gemini account. A rate-limit failure on one tier fails over to the next immediately; any other failure (timeout, 5xx, malformed JSON) falls straight through to the rule-based fallback instead of trying the remaining tiers. Model: `openai/gpt-oss-20b` on Groq. Response is strict-JSON-validated before being trusted. **Now covered by 15 unit tests** (`lib/aiScoring.test.js`) mocking the `openai` SDK and `lib/geminiScoring.js`, exercising the full failover cascade and confirming non-quota failures don't cascade past their own retry.

**Rule-based fallback** — `lib/fallbackHeuristic.js`. Unchanged scoring logic. **Its `recommended_action` can only ever be `"allow"` or `"hold_for_review"` — never `"auto_refund"`** — now proven, not just read off the code, by a dedicated unit test suite (`lib/fallbackHeuristic.test.js`) including a 288-combination fuzzed sweep across every boolean/numeric signal combination, none of which ever produces `auto_refund`.

**The policy gate, with fail-closed validation** — `lib/policyGate.js`. Unchanged logic from the prior review. **Now 100% statement/branch/function-covered** (`lib/policyGate.test.js`, 26 tests): every threshold boundary tested at the exact value and one unit past it, every fail-closed input path (`NaN`, out-of-range, negative, `Infinity`), and the full all-conditions-required auto-refund eligibility logic tested with each condition individually failing while the others pass. Default bounds unchanged: max single auto-refund ₹2,000, daily refund cap ₹10,000, auto-refund requires risk > 0.9 **and** confidence > 0.8, hold-for-review at risk > 0.6.

**Distributed, cross-instance-safe merchant lock — replacing the in-process mutex** — `lib/merchantLock.js`. **This is the single biggest change since the last review**, which flagged the in-process `Map`-based mutex as correct only within one warm serverless instance and silently non-functional across instances — a real gap for a money-relevant concurrency guarantee. It's now a genuine distributed lock via Upstash's REST-based Redis (`SET key value NX PX <ttl>` to acquire; a Lua compare-and-delete script to release, so a request can never release a lock it doesn't hold). Verified against real concurrent load: 10 truly simultaneous auto-refund-eligible requests against a tight daily cap were correctly capped at exactly the right count, never over-approved, across repeated runs. A second, previously-undiscovered gap this surfaced was also fixed: if the lock can't be acquired for any reason (Redis unreachable, or genuine contention timeout), the transaction is no longer silently dropped — it's still scored and saved, with `auto_refund` specifically forced down to `hold_for_review` (the downgrade recorded in the audit trail), since the daily cap can't be safely verified without the lock. A dedicated `LockAcquisitionError` class ensures this degraded path only triggers for real lock-acquisition failures, never for an unrelated bug inside the critical section.

**Real webhook idempotency** — new `WebhookEvent` model (`razorpayEventId` unique, `merchantId`, `eventType`, `receivedAt`, `processedAt`, `status`), checked before any processing in `app/api/webhooks/razorpay/route.js`. A delivery already marked `"processed"` returns 200 immediately without reprocessing; a `"received"` (crashed mid-flight) or `"failed"` prior attempt is safely retried. Event identity is derived from `X-Razorpay-Event-Id` when present, falling back to a deterministic hash of stable payload content — verified against two real captured production payloads that the JSON body itself carries no dedicated event-id field. The double-refund question for the retry path was verified explicitly, not assumed: `Transaction.txnId`'s unique constraint plus the Redis lock together mean a retry racing a still-in-flight first attempt can't produce two refunds.

**API keys hashed at rest** — `MerchantSettings.apiKeyHash` (SHA-256) + `apiKeyPrefix` (first 16 chars, for display/lookup), replacing the previous plaintext `apiKey` column. **Fixes the prior review's flagged gap directly.** The full key is shown to the merchant exactly once, at generation/regeneration time, with explicit "copy this now" UI messaging (`components/settings/SettingsContent.jsx`); `app/api/v1/transactions/route.js`'s auth check narrows the lookup by prefix, then does a constant-time hash comparison (`crypto.timingSafeEqual`), same discipline already used for webhook signature verification.

**Email verification and password reset** — new `Merchant.emailVerified`/`verificationToken`/`resetToken` fields, `lib/authEmails.js`, and routes for verify/resend-verification/forgot-password/reset-password, all via the existing Resend integration. **Fixes two of the prior review's flagged gaps** ("no email verification on signup or on `alertEmail`," "no password-reset flow"). The reset flow uses an atomic `updateMany` keyed on the token to prevent replay races; a dismissible-but-reappearing dashboard banner nudges an unverified merchant to verify.

**Real server-side session management** — new `Session` model (one row per login, with `userAgent`, `createdAt`, `lastUsedAt`, `expiresAt`), and `lib/session.js` rewritten so the JWT carries a session id that's checked against a live DB row on every request, not just verified for a valid signature. **Fixes the prior review's flagged gap** ("no `Session` table — stateless JWTs — no server-side session listing/revocation"). A merchant can see every active session on the Settings page (device/browser parsed from the user-agent, last-used time, "This device" marker) and revoke any one of them, or all others at once — and revocation is real: a JWT copied before logout is proven, not just assumed, to stop authenticating on its very next request, because `getSessionMerchantId()` now checks the `Session` row exists and isn't expired before trusting the token. `middleware.js` is unchanged and still edge-only (signature/expiry check only, no DB access) — the same architectural split the prior review already noted, not a new gap: it can't do the revocation check itself, so a revoked session's *edge* pass still succeeds, but any actual data-layer request past that point (`lib/currentMerchant.js`) is rejected immediately.

**AI provider observability** — new `Transaction.provider` and `Transaction.scoringLatencyMs` columns, captured at the `ingestTransaction.js` call site (not persisted for the main pipeline at the time of the last review — a flagged gap, now fixed for all rows scored since). Queryable via `/api/metrics/provider-health` (provider mix, latency percentiles, honestly reporting `totalInScope` vs. `instrumented` so the pre-instrumentation gap stays visible) — confirmed directly against the live DB during this pass: of the 401 `razorpay_live`+`synthetic` rows under the seeded `default_merchant` account, 0 are instrumented (all predate this feature); a separate, newer test-merchant account created during later verification work does have instrumented rows. **Not surfaced in the dashboard UI** — see the product-scoping note below.

**Policy Simulator** — `/api/policy-simulator` re-runs the real `applyPolicy()` against the 400-row synthetic set's already-stored scores with candidate bounds, zero AI calls, letting a merchant preview a settings change's effect on precision/recall/false-positive-cost before applying it. This one *is* merchant-facing (Policy & Signals tab) — it's the merchant's own bounds, not an internal validation exercise, so it stays in the same category as the settings panel it feeds.

**Dashboard scoped to merchant-facing content only** — new since the last review. Three Overview-tab panels were removed: the Kaggle external benchmark, "Live Accuracy" (real-transaction ground truth), and "Risk Engine Health" (provider mix/latency, described above). This was a deliberate product-maturity decision, not a regression or something that broke: all three answered "does our own engineering work," not "is this merchant's money being protected well" — no real production fraud-detection tool exposes its own internal model-validation methodology to its paying customers. The underlying data and endpoints are untouched and still live (`/api/metrics/benchmark`, `/api/metrics/live`, `/api/metrics/provider-health`); the validation work itself is still fully documented, now in the right venue for a technical audience — this document (§6 above has the current numbers) and `docs/CASE_STUDY.md`. The held-out synthetic-set metrics (precision/recall/F1) stayed on Overview — that one's a legitimate merchant-facing accuracy stat, closer to a marketed detection rate than an internal validation artifact, so it didn't fit the same category as the three that were removed.

**Human override, now wired up** — a merchant can reverse a `hold_for_review` or `auto_refund` decision from the transactions table, with a required reason. **Fixes a gap the prior review flagged explicitly** ("`Transaction.humanOverride` exists in the schema with no wired-up UI"). Deliberately one-directional and never touches Razorpay — the override route has no `executeRefund`/`sendAlert` calls at all; if a real refund had already executed, the UI notes that explicitly rather than pretending to reverse it. `actionTaken` becomes `"allow_overridden"` on override, distinct from a real `"allow"`, while `policyDecision` stays untouched as the historical record of what the gate actually decided.

**An automated test suite** — 77 tests across 5 files (`lib/policyGate.test.js`, `lib/fallbackHeuristic.test.js`, `lib/aiScoring.test.js`, `lib/refundExecutor.test.js`, `lib/ingestTransaction.test.js`), run via Vitest. **Directly fixes the prior review's most-cited gap**: "No automated test suite... All verification across this build's history was manual... not repeatable CI." Coverage on the five money-critical files: `policyGate.js` and `fallbackHeuristic.js` at 100% (statements/branches/functions/lines); `aiScoring.js` at 97.5% statements / 90.7% branches; `refundExecutor.js` at 88.9% statements; `ingestTransaction.js` at 94.7% statements (an integration test against a fully mocked Prisma client, covering source-based gating, the merchant-scoped daily budget aggregate, and the lock-failure downgrade path).

**Continuous integration** — `.github/workflows/ci.yml`, one job on every push/PR: install, `npm test`, then `npm run build` with dummy placeholder secrets (confirmed the production build needs no real credentials to compile — every API route is dynamic, so nothing executes at build time beyond `prisma generate`'s schema validation and a couple of SDK clients' required-env-var checks at import time). A status badge is on the README.

**Rule-based fallback, merchant-attribution fix, in-app storefront checkout, multi-merchant auth core, external versioned API, Kaggle benchmark, and live ground-truth accumulator** — the underlying mechanisms are all unchanged in substance from the prior review; see that pass's §4 for detail not repeated here, with two updates: the external API's auth check now hashes and constant-time-compares rather than comparing plaintext (see above), and the dashboard's Settings page now includes the Active Sessions panel described above. **The Kaggle benchmark's and live ground-truth accumulator's dashboard panels do not carry forward** — see "Dashboard scoped to merchant-facing content only" above; both mechanisms and their API endpoints are still live.

---

## 5. Data model

Six models now (was four at the last review), Postgres (Neon) via Prisma — `prisma/schema.prisma`, read in full during this review:

**`Merchant`** — one row per account. `id`, `name`, `email` (unique), `password` (bcrypt hash), `createdAt`. **New since the last review**: `emailVerified`, `verificationToken`/`verificationTokenExpiry`, `resetToken`/`resetTokenExpiry`. Has one `MerchantSettings`, many `Transaction`, many `Alert`, many `Session` (new).

**`Session`** — new model. One row per login. `id`, `merchantId` FK, `createdAt`, `lastUsedAt`, `userAgent`, `expiresAt`. The mechanism behind real server-side revocation described in §4.

**`Transaction`** — the audit-trail row. Payment fields, scoring output, and provenance unchanged from the prior review. **New since then**: `provider` (String?), `scoringLatencyMs` (Int?) — both described in §4 — and `overrideReason`/`overriddenAt` alongside the previously-unused `humanOverride`, now actually set by the override feature.

**`Alert`** — unchanged.

**`WebhookEvent`** — new model. `id`, `razorpayEventId` (unique), `merchantId` (nullable), `eventType`, `receivedAt`, `processedAt`, `status`. The idempotency mechanism described in §4.

**`MerchantSettings`** — one row per merchant. Five policy bounds unchanged. `alertEmail` unchanged. **Changed since the last review**: `apiKey` (plaintext, nullable) replaced with `apiKeyHash` (SHA-256, unique, nullable) + `apiKeyPrefix` — the prior review's flagged "leftover from an incremental migration" plaintext gap is now closed by an explicit migration, not just a new column added alongside the old one.

Not modeled: no `Refund` entity separate from the `Transaction` flags; no `AuditLog` for settings/API-key changes.

---

## 6. Metrics — pulled directly from the live database during this review

Same three cohorts as the prior review, re-queried directly against the production Neon database during this pass (not carried forward from the earlier numbers) via the same aggregation logic each live endpoint (`/api/metrics`, `/api/metrics/benchmark`, `/api/metrics/live`) actually runs.

**Synthetic held-out test set** (400 rows, `data/syntheticTransactions.json`, `source: "synthetic"`, scoped to `default_merchant`) — **unchanged from the last review**, confirming no drift or accidental re-seed since:

| | Value |
|---|---|
| Precision | 35.5% |
| Recall | **93.0%** |
| F1 | 0.514 |
| False-positive cost | ₹1,385,164.04 |
| Fallback rate | **5.0%** (20 / 400 rows) |
| TP / FP / FN / TN | 93 / 169 / 7 / 131 |

Precision reading 35.5% against a 93% recall remains the same real, honest tradeoff named in the last review: this scorer is tuned toward *catching* fraud at the cost of a meaningful false-positive rate along the way — the bounds in `MerchantSettings`, and now the Policy Simulator (§4), are how a merchant tunes that tradeoff for their own risk tolerance.

**External Kaggle benchmark** (135 of 2,242 sampled rows scored, `source: "kaggle_benchmark"`) — **unchanged from the last review**, no additional rows scored against free-tier AI quotas since. **No longer shown on the dashboard** (see §4's "Dashboard scoped to merchant-facing content only") — this is now this document's numbers, not a live UI panel:

| | Value |
|---|---|
| Recall | **0%** |
| TP / FP / FN / TN | 0 / 0 / 40 / 95 |
| Fallback rate | 7.4% (10 / 135) |

Still the honest, intended result, not a bug — see the prior review's §6 for the full explanation (the dataset's only usable signals for this pipeline are `amount` and an approximate `oddHour`; the system correctly declines to fabricate confidence it doesn't have rather than hallucinate a fraud signal from data that structurally can't support one).

**Live accumulator** (`source: "razorpay_live"`, real test-mode Razorpay transactions) — **no longer shown on the dashboard** as its own panel (see §4's "Dashboard scoped to merchant-facing content only"; `/api/metrics/live` is still live). **The underlying numbers have changed since the last review**, which reported N=1 (a single row under `default_merchant`, no confirmed outcome). There are now **6** real `razorpay_live` rows across 2 merchant accounts — 1 under `default_merchant` (amount ₹501, unchanged from before), and 5 under a second account (amounts ₹501/₹109/₹51/₹50/₹50) accumulated since, 3 of which carry a `provider` tag (`groq-primary`) confirming the observability work in §4 is capturing real data going forward. **None of the 6 have a confirmed outcome** — `isLabeledFraud` is `null` on all of them, per the honest-abstention design ("no dispute yet" is never auto-labeled clean) — so precision/recall/F1 are still all `null` at this N. This is the expected, correct state of a mechanism that's real but has had very little real traffic yet, not a broken feature.

---

## 7. Known limitations / explicit scope boundaries

Verified fresh against the current code. Seven items from the prior review's list are now closed (marked below); the rest carry forward.

**Closed since the last review:**
- ~~Plaintext API keys~~ — hashed at rest (§4, §5).
- ~~No automated test suite~~ — 77 tests, CI-enforced (§4).
- ~~No webhook idempotency handling~~ — `WebhookEvent` model (§4).
- ~~No email verification on signup or `alertEmail`~~ — real verification flow (§4).
- ~~No password-reset flow~~ — real, token-based, atomic-replay-guarded (§4).
- ~~No `Session` table / no server-side revocation~~ — real `Session` model, checked on every request (§4, §5).
- ~~`Transaction.humanOverride` unwired~~ — now a real, tested feature (§4).
- ~~Provider-tier granularity not persisted for the main scoring path~~ — `provider`/`scoringLatencyMs` now captured going forward (§4); historical rows predating this remain honestly un-backfilled.
- ~~Both the merchant lock and the rate limiter were single-process-only~~ — **both are now real distributed mechanisms, not a partial close.** The merchant lock moved to a hand-rolled Redis lock (`SET NX PX` + a Lua compare-and-delete release). The rate limiter (`lib/rateLimiter.js`) moved to `@upstash/ratelimit`'s `tokenBucket` algorithm against the same Upstash Redis — a dedicated package rather than hand-rolled, since a correct token-bucket needs its own atomic script to avoid a race between reading and decrementing the count, and Upstash already publishes and maintains exactly that. Verified against genuine cross-process concurrency, not just unit logic: 4 separate OS processes each firing 15 concurrent requests at the same key (simulating separate Vercel instances) allowed exactly 20 total, not the 80 the old in-memory version would have allowed.

**Still open:**
- **Single shared Razorpay account across all merchants.** Unchanged — no per-merchant Razorpay OAuth/Connect. Attribution within that shared account is correct for in-app-checkout payments (fixed in the pass before the prior review), but a Payment Link/QR code created directly in Razorpay's dashboard still can't be attributed to a specific merchant.
- **Resend sandbox sender**, not a verified custom domain — delivery is restricted to the sending account's own signed-up email until a domain is verified.
- **`featureExtractor.js` and the webhook's `mapPaymentEvent` both do an unbounded `findMany` over a merchant's full prior-transaction history on every ingest call.** Unchanged; will visibly degrade as a merchant's volume grows into the thousands. Postgres (unlike the SQLite this was originally excused under) supports the native JSON-path queries that would fix this.
- **`MerchantSettings.apiKeyHash` is nullable at the schema level** despite being effectively always non-null once a key is generated — same migration-history-leftover shape as the prior plaintext field, not a deliberate design choice.
- **No monitoring/escalation on refund-execution failures.** A failed real refund is honestly recorded (`refundExecuted: false, refundError`) but nothing pages anyone — unchanged.
- **No `AuditLog` for settings or API-key changes** — a merchant's own settings history isn't tracked, only the current state.

---

## 8. Security considerations

- **Password hashing**: bcrypt, cost 10 — unchanged.
- **Session handling**: signed JWT (HS256, `jose`) in an httpOnly, `sameSite: "lax"` cookie, now backed by a real server-side `Session` row checked on every data-layer request, not just a signature/expiry check. **Materially stronger than the prior review's state** — that pass explicitly listed "no server-side session listing/revocation" as a data-model gap; a compromised or copied JWT can now be invalidated immediately, not just left to expire. `middleware.js`'s edge check is unchanged (signature/expiry only — architecturally can't reach the DB), which is the same documented split as before, not a new gap.
- **API key handling**: SHA-256 hash + prefix at rest, constant-time comparison at verification. **Fixes the prior review's clearest concrete gap directly.**
- **Webhook signature verification**: HMAC-SHA256 with `crypto.timingSafeEqual` — unchanged, still done right.
- **Webhook replay/idempotency**: new since the last review — a redelivered event is detected and short-circuited before any processing, not just before it would hit a DB constraint.
- **Fail-closed validation on the policy gate** — unchanged, now provably exhaustive via the test suite rather than just read off the code.
- **What would still need to change before this touched real (non-test) money** — shorter than the prior review's list, four items closed:
  1. Real Razorpay production credentials + live webhook secret (still `rzp_test_...`).
  2. Per-merchant Razorpay OAuth/Connect, replacing the single shared webhook-to-merchant mapping.
  3. ~~Hash API keys at rest~~ — done.
  4. ~~Move the rate limiter to a shared store~~ — done; both the merchant lock and the rate limiter are real distributed mechanisms now.
  5. ~~Add explicit webhook idempotency handling~~ — done.
  6. Add monitoring/escalation on refund-execution failures.
  7. ~~Add email verification before an address can receive alerts~~ — done.
  8. ~~Persist which AI provider served each scoring call~~ — done, going forward.

---

## 9. What a reviewer should specifically look at (20-30 minutes)

**Files that best demonstrate the core design decisions, in priority order:**
1. `lib/ingestTransaction.js` — the entire pipeline in one place, including the Redis-lock critical section, the refund-ordering safety property, and the lock-unavailable degraded path. Read this first.
2. `lib/policyGate.js` alongside `lib/policyGate.test.js` — the actual bounds, the fail-closed validation, and now a test suite that exercises every boundary rather than asking you to trust a read-through.
3. `lib/aiScoring.js` — the 3-tier failover chain and its rate-limit-vs-other-failure distinction; read the file-header comment for the real quota numbers that shaped this design, then `lib/aiScoring.test.js` for how the cascade is actually proven.
4. `lib/merchantLock.js` — now a real distributed lock, not the "correct for the wrong deployment model" tradeoff the prior review flagged; the code comment explains why Redis (REST-based, no persistent connection) fits serverless where the old in-process `Map` didn't.
5. `app/api/webhooks/razorpay/route.js` — signature verification, the merchant-attribution fix, and the new `WebhookEvent` idempotency check, all in one file.
6. `prisma/schema.prisma` — the whole data model in under 150 lines; confirms or refutes every claim in §5 and §7 directly.
7. `.github/workflows/ci.yml` — the whole CI pipeline is 30-odd lines; worth seeing that it's genuinely simple rather than taking "there's a test suite now" on faith.

**Things worth actively stress-testing, not just reading:**
1. **Concurrency safety**: fire several rapid concurrent requests through the real checkout flow or `/api/demo/simulate-outage`, and watch `/api/policy-bounds`'s daily-budget gauge — now backed by a real cross-instance lock, worth confirming it holds under genuine concurrent load in this specific Vercel deployment.
2. **Session revocation**: log in on two browsers/devices, revoke one from the other via Settings → Active Sessions, and confirm the revoked session is rejected on its *very next request* — not just on its next login attempt.
3. **The honest-abstention Kaggle framing**: no longer a dashboard panel (see §4) — read §6 of this document, or hit `/api/metrics/benchmark` directly while logged in. Same 0%-recall framing as the prior review, worth an independent read on whether it's credible engineering or an excuse dressed up as one.
4. **Graceful-degradation demo scenarios**: `/dashboard` → Demo & Testing tab → run all three simulated-outage scenarios and read the before/after panel each produces.
5. **`npm test`** — the whole suite runs in a couple of seconds; worth actually running it rather than trusting the coverage numbers quoted above.

---

## 10. An honest ask

This has grown from a five-to-six-day hackathon build into roughly two weeks of real work (`git log`'s first commit is 2026-08-23, the latest is 2026-09-04), with the second week spent almost entirely closing gaps this document itself flagged in its first pass. That's a deliberate way to read this project: not as a finished product, but as a real, honestly-tracked punch list being worked down in order of what actually mattered most (concurrency correctness and its failure mode, then security-adjacent gaps like plaintext keys and session revocation, then the credibility gap of having no tests at all).

- **What would you fix first now?** With both single-process gaps (the merchant lock and the rate limiter) closed, my own ranked guess is the unbounded per-transaction history query — it's the one remaining item with a concrete, predictable failure mode (visible latency degradation as a merchant's volume grows) rather than a low-probability edge case. Missing refund-failure monitoring is a close second. Tell me if you'd rank differently.
- **Is the test suite actually testing the right things, or just padding a coverage number?** It's scoped deliberately to the five files that decide or move money, not the whole app — I'd rather have 100% on `policyGate.js` and nothing on UI components than the reverse. Worth a skeptical read on whether that scoping judgment is right.
- **If you were evaluating this for a payments company now, what's the next thing you'd ask that isn't answered above?**

---

*A first-person narrative version of this build — the specific problems, the debugging dead ends, and the reasoning behind the harder calls — is in [`docs/CASE_STUDY.md`](./CASE_STUDY.md).*
