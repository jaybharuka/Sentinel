// In-memory per-merchant cooldown, not a token bucket - "resend
// verification email" needs a flat minimum gap between sends, not a
// burst-then-refill allowance like lib/rateLimiter.js's external-API
// limiter. Same single-process caveat as every other in-memory limiter in
// this app (lib/rateLimiter.js, lib/merchantLock.js's predecessor): resets
// on restart, doesn't share state across Vercel instances.
const COOLDOWN_MS = 60 * 1000;

const lastSentAt = new Map();

export function checkResendCooldown(merchantId) {
  const now = Date.now();
  const last = lastSentAt.get(merchantId);
  if (last && now - last < COOLDOWN_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) };
  }
  lastSentAt.set(merchantId, now);
  return { allowed: true };
}
