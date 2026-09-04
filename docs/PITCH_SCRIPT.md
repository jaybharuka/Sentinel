# Sentinel — pitch video script

~2.5 minutes. Written to be read aloud, not read from — say it in your own words if it flows better out loud. `[SCREEN]` cues are what should be on screen while you're talking; swap in whatever's actually fastest to record live at [sentinel-pearl-psi.vercel.app](https://sentinel-pearl-psi.vercel.app).

---

### 0:00–0:20 — The hook

**[SCREEN: dashboard Overview tab, a `hold_for_review` transaction expanded]**

"Every payments platform eventually has to answer the same question: a transaction looks risky — do you block it, or let it through? Get it wrong one way, you've refunded a real customer for nothing. Get it wrong the other way, you eat a chargeback. AI can score that risk pretty well now. The problem is: would you actually let an AI model decide, on its own, when to move your money?

That's Sentinel. It's a fraud guard for Razorpay merchants, and it's built on exactly one rule: **the AI is never trusted with money.**"

### 0:20–0:50 — The mechanism

**[SCREEN: Policy & Signals tab — the bounds panel, then briefly the Policy Simulator]**

"Every payment gets scored by an AI model — risk score, confidence, a recommended action. But that's all it is: a recommendation, written to the audit trail. The actual decision comes from a separate, plain function — no AI call, no network call, just deterministic code — and it only approves an auto-refund when *every one* of the merchant's own bounds clears at once: the AI's risk score, its confidence, the refund amount, and today's already-spent budget. Change any one of those bounds here —" *(point at the simulator)* "— and you can see exactly how it reshapes the tradeoff, before you touch a live setting."

### 0:50–1:20 — Prove it's real, not a slide

**[SCREEN: Demo & Testing tab → run the "simulated AI outage" scenario live]**

"This isn't a mockup. Watch what happens if I take away the AI entirely —" *(click "Run simulated outage")* "— every one of the three AI providers just failed. The system falls back to a rule-based scorer automatically, and that fallback is structurally incapable of ever approving a refund on its own — it can only flag for review, never auto-approve. That's not a setting I configured for this demo. It's how the code is written, and it's enforced by an actual unit test that fuzzes hundreds of input combinations checking that exact guarantee."

**[SCREEN: switch to the transactions table, point at a real audit row]**

"Every decision — AI or fallback, approved or held — lands here with a full, readable reason. Nothing happens silently."

### 1:20–1:50 — The engineering, briefly

**[SCREEN: quick cut to the GitHub repo — commit history or the CI badge]**

"Under the hood: a three-provider AI failover chain, because free-tier quotas run out faster than you'd expect. A real distributed lock, because two concurrent requests can't be allowed to both read the same budget and both get approved past it — I load-tested that with ten simultaneous requests against a tight cap and got exactly the right number approved, every time. Real session revocation, hashed API keys, webhook idempotency, and — because none of that matters if it's not provable — 77 automated tests on every push, gating the build in CI."

### 1:50–2:15 — Why this framing matters

**[SCREEN: back to the dashboard Overview, the metrics panel]**

"This scorer catches 93% of real fraud in testing. It also flags real legitimate transactions along the way — that's a tradeoff, not a flaw, and it's the merchant's tradeoff to set, not mine or the AI's. That's the actual point of Sentinel: not 'AI that catches fraud' — you can get a version of that from a prompt in an afternoon. The point is a system honest enough to admit an AI shouldn't get the final word on someone's money, and engineered so that it structurally can't."

### 2:15–2:30 — Close

**[SCREEN: the live URL]**

"It's live, it's real Razorpay test-mode infrastructure end to end, and the code and a full technical writeup are both linked below. Thanks for watching."

---

## Recording notes

- Record the `[SCREEN]` segments as real screen capture against the live deployment, not slides — the "prove it's real" section especially loses most of its point as a static screenshot.
- If cutting for time: 0:50–1:20 (the live outage demo) and 1:20–1:50 (the engineering rundown) are the two segments to trim first; the hook and the closing framing (0:00–0:20, 1:50–2:30) carry the actual pitch.
- Have a merchant account already logged in and the outage-demo scenario ready to click before recording — don't record the signup flow live inside the pitch.
