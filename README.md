[![CI](https://github.com/jaybharuka/Sentinel/actions/workflows/ci.yml/badge.svg?branch=claude/sentinel-fraud-risk-guard-p6nd37)](https://github.com/jaybharuka/Sentinel/actions/workflows/ci.yml)

# Sentinel

A fraud/chargeback risk guard for Razorpay merchants, built on one rule: **the AI is never trusted with money.**

Every payment is scored for fraud risk by a 3-tier LLM provider chain (with a deterministic rule-based fallback if all three fail) — but the model only ever *advises*. A plain, deterministic, unit-tested function is the sole thing that decides `allow` / `hold_for_review` / `auto_refund`, and the sole thing that can trigger a real refund, and only within bounds a merchant configures themselves.

**Live**: [sentinel-pearl-psi.vercel.app](https://sentinel-pearl-psi.vercel.app) (Razorpay test mode — no real money moves anywhere in this deployment)

---

## Read this first

- **[docs/CASE_STUDY.md](docs/CASE_STUDY.md)** — a first-person narrative of building this: the core architectural decision explained through the real code, and five of the hardest problems solved along the way (quota walls, a real concurrency race and its load-test proof, a silent-failure mode in the safety mechanism itself, an SDK that lies about success, and a debugging story). Written for a hiring manager or interviewer.
- **[docs/PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md)** — the line-by-line technical audit: every feature verified against current code, the full data model, metrics pulled directly from the live database, and an honest, currently-open list of what's not done yet.

## What it does

- Scores every captured/failed Razorpay payment against 12 deterministic risk signals (velocity, disposable email, country mismatch, customer history, and more)
- Runs that through a 3-tier AI failover chain (two independent Groq accounts, then Gemini), falling back to a rule-based heuristic — which can structurally never recommend an auto-refund — if every tier fails
- Decides the actual outcome with a pure, fail-closed policy gate, gated by merchant-configured bounds (max refund amount, daily budget, minimum risk/confidence thresholds)
- Executes real refunds through Razorpay's API only when every bound clears, and only for real (non-demo, non-synthetic) transactions
- Keeps a full audit trail per merchant, with human override, email alerts, a policy simulator, and provider/latency observability
- Ships with self-serve signup (email verification, password reset), real server-side session management with per-device revocation, and a small versioned external API authenticated with hashed API keys

## Stack

Next.js (App Router, JS) · Prisma / Postgres (Neon) · Tailwind v4 · Upstash Redis (distributed locking) · Groq + Gemini (scoring) · Razorpay (payments) · Resend (email) · Vitest (tests) · Vercel (hosting)

## Getting started

```bash
npm install
cp .env.example .env   # fill in real values - see below
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up for a new account to get an isolated dashboard, or seed synthetic data from the Demo & Testing tab once logged in.

### Environment variables

See [`.env.example`](.env.example) for the full list. `DATABASE_URL`/`DIRECT_URL` (Neon Postgres), `GROQ_API_KEY` are required; `GROQ_API_KEY_SECONDARY`/`GEMINI_API_KEY` are optional failover tiers (falls back to the rule-based heuristic if unset); `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` are required for the real checkout/webhook flow; `SESSION_SECRET`, `RESEND_API_KEY`, and `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` round out sessions, email, and the distributed lock.

### Tests

```bash
npm test              # run the suite once
npm run test:watch    # watch mode
npm run test:coverage # scoped coverage on the money-critical files
```

77 tests across the pipeline's five money-critical files (`lib/policyGate.js`, `lib/fallbackHeuristic.js`, `lib/aiScoring.js`, `lib/refundExecutor.js`, `lib/ingestTransaction.js`) — see `docs/PROJECT_REVIEW.md` §4 for coverage figures. Runs on every push/PR via GitHub Actions.

### Build

```bash
npm run build   # prisma generate && next build
```
