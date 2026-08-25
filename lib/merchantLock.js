// In-process per-merchant async mutex, keyed by merchantId. Chosen over a
// DB-level transaction/isolation-level approach because this was built
// assuming a single Node process (originally against an embedded SQLite
// file, now Postgres/Neon - the single-process assumption is what matters
// here, not which database; see lib/rateLimiter.js for the same caveat).
// A plain in-memory promise-chain mutex is simple and exactly correct for
// a single process, and doesn't block other merchants' requests against
// each other.
//
// IMPORTANT on Vercel: serverless functions are NOT guaranteed to be a
// single process - concurrent requests can be routed to separate function
// instances, each with its own independent `tails` map, which silently
// defeats this mutex (two instances can both read the same stale daily-
// budget total and both approve past the cap). Low/sequential traffic in
// practice tends to hit a single warm instance, but this is not a
// guarantee. A real multi-instance deployment needs this moved to a real
// cross-process lock (e.g. a DB row lock or Redis) - same caveat as the
// rate limiter.
//
// tails[merchantId] is always a promise that resolves (never rejects) the
// moment the current holder's turn ends - success or failure - so a
// caller whose fn() throws can never leave the next caller stuck waiting
// on a promise that never settles.
const tails = new Map();

export async function withMerchantLock(merchantId, fn) {
  const prevTail = tails.get(merchantId) || Promise.resolve();

  let releaseNext;
  const myTail = new Promise((resolve) => {
    releaseNext = resolve;
  });
  tails.set(merchantId, myTail);

  await prevTail;

  try {
    return await fn();
  } finally {
    releaseNext();
  }
}
