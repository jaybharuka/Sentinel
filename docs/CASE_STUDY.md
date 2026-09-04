# Building Sentinel: an AI fraud guard that isn't allowed to trust itself

Sentinel is a fraud/chargeback risk guard for Razorpay merchants. It scores every payment with an LLM, but the LLM never touches money — a plain, deterministic function decides that, within bounds a merchant sets themselves. This is the story of building it: why that separation exists, the real problems I hit turning it into working software, and what I'd do next.

Live: [sentinel-pearl-psi.vercel.app](https://sentinel-pearl-psi.vercel.app). Source, commit history, and the technical audit this case study draws from are in the repo — [`docs/PROJECT_REVIEW.md`](./PROJECT_REVIEW.md) is the line-by-line version of everything summarized here.

---

## 1. The problem, and why it's genuinely hard

A payments platform has to decide, in real time, what to do about a transaction that *might* be fraud. There are exactly two ways to be wrong, and they don't cost the same thing:

- **False positive** — you block or refund a legitimate customer. You've just told a real paying customer they look like a criminal. That's lost revenue, a support ticket, and reputational damage, and it happens *now*, at the moment of the decision.
- **False negative** — you let real fraud through. That costs you later, as a chargeback, and chargebacks come with their own fees and — past a threshold — the risk of your merchant account itself getting shut down by the payment network.

Neither error is free, and you can't tune a scorer to zero out both at once — pushing down false negatives (catch more fraud) mechanically pushes up false positives (flag more legitimate traffic) for any model that isn't perfect, and no fraud model is perfect. So the *real* engineering problem isn't "build a model that detects fraud" — a base level of that is achievable with an off-the-shelf LLM and a decent prompt. The real problem is: **who gets to decide where that tradeoff sits, and how do you stop an AI model — which can be wrong, can hallucinate a confident-sounding "reasons" list for a transaction it doesn't understand, and has no accountability for being wrong — from being the thing that actually spends the merchant's money?**

That's the question Sentinel is actually answering. Everything else — the signal extraction, the failover chain, the dashboard — is in service of that one architectural decision.

---

## 2. The core decision: the AI advises, the code decides

The slogan version is "AI never touches money." The real mechanism is [`lib/policyGate.js`](../lib/policyGate.js) — about 70 lines of plain JavaScript, no LLM call, no database access, and (as of the test suite added for this build) 100% branch-covered by unit tests.

Here's what actually happens on every transaction:

1. `scoreTransaction()` (or, if every AI tier fails, `fallbackScore()`) returns a `{ risk_score, confidence, reasons, recommended_action }` object. `recommended_action` can say `"auto_refund"`. That's it — that's as far as the AI's opinion goes. It's a suggestion, stored in the audit trail, nothing more.
2. `applyPolicy(scoringOutput, transactionAmount, dailyAuthorizedTotal, settings)` is the only function that produces an actual `decision`. It's pure — same inputs always produce the same output, no side effects — which is exactly why it was the first thing I unit-tested exhaustively rather than the AI scoring code: a function this central to whether real money moves needs to be provably boring.
3. For `auto_refund` to actually happen, **every one of these has to be true simultaneously**, not just the AI's say-so:
   - the AI recommended it
   - the amount is under the merchant's configured per-refund cap
   - `risk_score` clears the merchant's minimum threshold
   - `confidence` clears the merchant's minimum threshold
   - today's already-authorized refund total, plus this one, stays under the merchant's daily budget
4. Before any of those comparisons run, the function validates its own inputs: if `risk_score` or `confidence` come back `NaN`, out of `[0,1]`, or the amount is negative or non-finite, it returns `hold_for_review` immediately, with the reason `"invalid scoring or transaction input; fail-closed"`. That check exists because of a genuinely easy trap: in JavaScript, `NaN > 0.9` is `false`, and `NaN < 0.9` is also `false` — every comparison involving a bad number evaluates false, which without an explicit guard falls straight through every `if` in the function to the default branch at the bottom, which is `allow`. A malformed input silently becoming an *approval* is exactly backwards, and it's the kind of bug that only shows up the first time a provider sends back something odd — which, as tier three of a three-provider failover chain, was going to happen eventually.

The `refundExecutor.js` function that actually calls Razorpay's API is gated separately again, on `source === "razorpay_live"` — so a demo click, a synthetic seed row, or a Kaggle benchmark row can never trigger a real refund even if the policy gate says `auto_refund`, because the code path that would call Razorpay simply never gets reached for those sources.

Concretely: the AI gets one vote, phrased as a suggestion. The merchant's own configured numbers, checked by code that has to prove it's correct rather than seem intelligent, get the deciding vote.

---

## 3. Five real problems, and how I actually solved them

### The quota wall nobody warns you about

The first version used a single Gemini API key. It worked, right up until it didn't — Google's `gemini-2.0-flash` had been retired since my training data, so the very first model name I reached for was already dead. I moved to `gemini-2.5-flash`, whose free tier caps at 20 requests *per day* — enough to demo, not enough to seed a test set. `gemini-3.5-flash-lite` looked like the fix until I read the actual 429 response body and found `quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier` — 15 requests *per minute*, a real ceiling, confirmed from the provider's own error payload, not a guess.

That pushed me to Groq, which exposes an OpenAI-compatible API (so the official `openai` SDK works unmodified against it) and advertises much higher free-tier limits. I picked `openai/gpt-oss-120b` first, as the strongest reasoning model available — and burned through its ~200k-tokens/day bucket in a few hundred requests during a 400-row seed run. I know the exact number because I read the response header: `x-ratelimit-reset-requests` reported a 6-plus-hour reset once the bucket drained. Switching to `openai/gpt-oss-20b` — smaller, but its bucket resets in under two minutes at the same request volume, confirmed the same way — is what actually made a real seed run possible.

The design that came out of hitting these walls three separate times is `lib/aiScoring.js`'s failover chain: two independent Groq accounts (each its own 200k-token pool — real redundancy, not one account split in half) with Gemini as a third, genuinely separate tier behind them. The chain only fails over on a *quota* signal (HTTP 429, or a rate-limit message) — a timeout or a malformed response gets one retry on the *same* key and then falls straight to the rule-based heuristic, deliberately not cascading through the other two providers, because a timeout or a 500 is likely to recur on the next provider too, and cascading through three slow failures before falling back is strictly worse for the merchant waiting on a decision than failing fast once.

### The race condition an external reviewer found, and what "worked" actually meant afterward

Partway through the build, I had a reviewer do a line-by-line audit of `policyGate.js` and `ingestTransaction.js`. They flagged something I'd missed: the flow of "read today's authorized refund total → decide → write the decision" had no lock around it. Two concurrent requests could both read the same stale total, both independently conclude they were under budget, and both get approved — silently blowing through the merchant's configured daily cap.

The first fix was a per-merchant in-process mutex — a promise chain keyed by merchant ID, wrapping that whole read-decide-write sequence. I verified it with a two-request `Promise.all` test against a merchant sitting at 9,000 of a 10,000 daily budget: exactly one of two concurrent ₹1,000-eligible requests got approved, the other correctly downgraded with a reason citing the amount the winning request had just written.

That fix was real, and also quietly wrong for where the app actually runs. Vercel's serverless functions aren't one process — an in-process `Map`-based mutex only holds within a single warm instance; two concurrent requests landing on two separate instances each get their own independent lock that never sees the other. I replaced it with a real distributed lock via Upstash's REST-based Redis (`SET key value NX PX <ttl>` to acquire, a Lua compare-and-delete script to release, so a request can never release a lock it doesn't actually hold), and this time tested it properly: ten genuinely simultaneous auto-refund-eligible requests fired at once against a merchant with a ₹1,000 daily cap and roughly ₹350-eligible transactions apiece. Exactly 3 of the 10 were approved — the ones that fit under the cap — and the other 7 were correctly downgraded to `hold_for_review`, across repeated runs, never over-approved once. That number is the actual proof the lock does what the mutex only pretended to: it's not "the logic looks right," it's "I fired ten real concurrent requests at real infrastructure and got the exact right count back, every time."

### The failure mode that only shows up when the safety mechanism itself fails

Adding the Redis lock surfaced a second, worse bug — not in the lock, but in what happened when the lock was unavailable. If `withMerchantLock()` couldn't acquire the lock for *any* reason — Redis unreachable, or a legitimate contention timeout — the original code let the whole request fail. For the webhook path specifically, which fires the ingest pipeline fire-and-forget after already returning `200 OK` to Razorpay, that meant a transaction could vanish with nothing but a `console.error` line nobody was watching. Not a wrong decision — no decision, no row, no trace it had ever happened.

The fix distinguishes *why* the lock failed. A dedicated `LockAcquisitionError` class is thrown only for acquisition failures — Redis down, or a genuine timeout — never for an unrelated bug inside the code the lock was protecting, so the two can't get confused and silently retried against corrupted state. When that specific error surfaces, the transaction still gets scored and saved to the audit trail — normal reads, normal writes — except `auto_refund`, the one decision that spends shared budget, gets forced down to `hold_for_review`, with the downgrade itself written into the stored reason. I verified this by pointing the app at a genuinely unreachable Redis host and sending an auto-refund-eligible transaction through: it landed correctly as `hold_for_review`, no crash, no dropped row, no refund attempted — then confirmed normal operation resumed cleanly the moment real credentials came back. The lesson that stuck with me: a safety mechanism's own failure mode needs exactly as much design attention as its happy path, because "the lock is down" is precisely the moment you can least afford the system to fail open.

### The SDK that lies about success

`lib/alerting.js` sends a real email via Resend for every `hold_for_review` or `auto_refund` decision. I wrote the first version the way you'd write any `await`-based network call — call it, and treat a successful `await` as a successful send. It looked fine in testing, because in testing the send usually *was* successful.

The bug was structural, not a typo: Resend's SDK doesn't throw on API failures. It resolves with `{ data, error }` either way — a bad API key, a rate limit, a sandbox-mode recipient restriction all come back as a *resolved* promise with an `error` field set, not a rejected one. Code that only wraps the call in `try/catch` and assumes success on anything that doesn't throw will silently record `emailSent: true` on a merchant-facing "you were alerted" audit row for an alert that never actually left the building. I only caught it because I went looking at what `result` actually contained rather than trusting the `await` to mean what it usually means — and the fix is now a comment directly above the call in `lib/alerting.js`, spelling out that both a thrown exception *and* a resolved `.error` field have to be treated as failure, because the next person reading that code (including future me) will reach for `try/catch` first and be just as wrong.

### The webhook idempotency bug that logging couldn't help me debug

Razorpay redelivers webhooks — a slow response, a transient 5xx, anything — and the original app had no real idempotency handling beyond an accidental side effect: `Transaction.txnId` has a unique constraint, so a redelivery hit a Prisma constraint error inside a fire-and-forget `.catch(console.error)`. Logged, not corrupting anything, but not handled either — and worse, I didn't actually know what a real Razorpay webhook event ID looked like, because the JSON body's documented shape and its *actual* shape aren't guaranteed to match what I'd assumed from memory.

My first move was the obvious one: add a `console.log` of the raw webhook body and headers, trigger a real delivery, and go read it in Vercel's log stream. It didn't show up usably — the payload was large enough, and the log stream lossy enough under a fire-and-forget async path, that I couldn't get a clean read. I narrowed it twice more — first down to just the candidate ID fields and the event-id header, then down to a single combined JSON log line, hoping a smaller, denser payload would survive the stream intact. All three attempts are still visible in the commit history as their own small `temp:` commits, because I didn't want to pretend the working version arrived fully formed.

What actually worked was giving up on trusting the log stream as the source of truth and writing the captured payload directly to Postgres instead — a real table I could just query afterward, with none of a log pipeline's buffering or truncation between me and the data. Two real captured production payloads later, the answer was concrete: the JSON body's only top-level keys are `entity`, `account_id`, `event`, `contains`, `payload`, `created_at` — there's no dedicated event-id field in the body at all, for this account/plan. `app/api/webhooks/razorpay/route.js`'s `extractEntityId()` now prefers the `X-Razorpay-Event-Id` header when present and falls back to a deterministic hash of stable payload content (event type, entity ID, created-at) when it isn't — so a redelivery of the same logical event collides on the same key either way, verified against a self-signed synthetic payload in both the clean-duplicate case and the racier case of a replay landing while the first attempt is still genuinely in flight.

### The merchant-attribution bug that made a merchant's own dashboard lie to them

This one I found by making a real payment. The in-app checkout already stashed the logged-in merchant's ID in the Razorpay Order's `notes` at creation time — the plumbing looked complete. But the webhook handler never read that note back; every real payment landed under `DEFAULT_MERCHANT_ID` regardless of who'd actually paid. I caught it because I made a real test-mode payment (`pay_TTzvs20Q3JMxHQ` — I still have the ID) while logged in as a specific merchant account, watched it score and save correctly, and then went to that merchant's own dashboard and saw zero matching transactions. The pipeline was completely correct and completely useless, because it was correct for the wrong account.

The fix, `resolveMerchantId()`, fetches the Order back by `payment.order_id`, reads `order.notes.merchantId`, and verifies that merchant still exists before trusting it — falling back to the default only if the note is missing (a Payment Link created directly in Razorpay's own dashboard, bypassing this app's checkout entirely, genuinely has nowhere to carry that ID) or the referenced merchant was deleted since. I also scoped the customer-history query inside feature extraction to the *resolved* merchant rather than a hard-coded one — otherwise `isNewCustomer` and `previousChargebacks` would have kept computing against the wrong merchant's history even after the attribution itself was fixed, which is the kind of half-fix that's worse than not fixing it, because it looks done.

---

## 4. What I'd build next — deliberately not built yet

Two things are missing on purpose, not because I didn't think of them:

**A Risk Policy DSL.** Right now a merchant's entire risk posture is five numeric fields in `MerchantSettings` — max refund amount, daily cap, two thresholds, a hold-review threshold. That's honest and it's auditable, but it's not expressive: a real merchant might want "auto-refund only if risk is high AND the customer has zero prior chargebacks AND the amount is under ₹500," and five flat numbers can't say that. A small declarative rule language — a JSON-based condition tree that `applyPolicy()` evaluates instead of (or alongside) the current flat thresholds — is the natural next step, and I scoped it out deliberately rather than building it now, because getting the *fail-closed, single-source-of-truth* guarantee right for five numbers was already the hard part; extending that same guarantee to an arbitrary condition tree without reopening the NaN-falls-through-to-allow class of bug is real design work, not an afternoon.

**An outcome-learning engine.** The system currently has real ground truth — `markDisputed()` retroactively labels a transaction `isLabeledFraud: true` when a real Razorpay dispute comes in — but nothing consumes it. There's no loop that looks at confirmed outcomes and adjusts anything. That's a deliberate scope cut, not an oversight: closing that loop safely means answering hard questions the current build correctly refuses to guess at — how much labeled data is enough to trust an adjustment, how you stop the loop from overfitting to one merchant's short-term dispute pattern, and, most importantly, whether an automated adjustment to the *policy gate itself* is a decision that should ever happen without a human confirming it, given everything the rest of this document argues about not trusting automated systems with unilateral authority over money. I'd rather ship the honest, static version than a learning loop I can't yet prove is safe.

---

## 5. Final architecture and where the numbers actually stand

**The pipeline, source to decision**: a real (or synthetic) payment event → `featureExtractor.js` computes 12 deterministic signals from transaction and merchant-scoped history (no LLM involved) → `aiScoring.js`'s 3-tier failover (Groq primary → Groq secondary → Gemini) or, if every tier fails, `fallbackHeuristic.js`'s rule-based scorer, which is structurally incapable of ever recommending `auto_refund` → `policyGate.js`'s pure, fail-closed, fully bounds-checked decision, computed inside a Redis-backed per-merchant lock so the daily budget check is safe under real concurrency → `refundExecutor.js`, gated separately on `source === "razorpay_live"`, which never throws — a failed refund call is data on the audit trail, not an unhandled exception → a `Transaction` row, written *before* the refund call even starts, so a crash mid-call still leaves a discoverable "we intended to refund this" record rather than nothing → an email alert via Resend for any `hold_for_review` or `auto_refund` outcome, with both of the SDK's failure shapes (thrown, and silently resolved-with-error) handled explicitly.

**Verified, not asserted, on the money-critical paths**: 77 automated tests (`lib/policyGate.test.js`, `lib/fallbackHeuristic.test.js`, `lib/aiScoring.test.js`, `lib/refundExecutor.test.js`, `lib/ingestTransaction.test.js`) covering boundary conditions at every threshold, fail-closed validation on malformed input, a fuzzed sweep proving the fallback heuristic can never recommend `auto_refund`, the full 3-tier provider failover including the non-cascading behavior on non-quota errors, and an integration test of the ingest pipeline's source-gating, merchant-scoped budget aggregate, and lock-failure downgrade — running on every push via GitHub Actions.

**On the held-out 400-row synthetic set**: 93.0% recall, 35.5% precision, a 5.0% fallback rate (20 of 400 rows fell through to the rule-based scorer rather than a real AI response). That precision number is a deliberate, named tradeoff, not a weakness I'm hiding — this scorer is tuned to catch fraud aggressively, which costs false positives on legitimate transactions along the way, and the five numbers in `MerchantSettings` are exactly the mechanism by which a real merchant would tune that tradeoff for their own actual risk tolerance rather than mine.

That last point is, in miniature, the whole thesis of this project: the AI's job is to have an opinion. Whose job it is to decide what that opinion is worth in real money was never up for negotiation — it belongs to code that has to prove itself, and ultimately to the merchant whose money it is.
