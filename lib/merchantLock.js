// In-process per-merchant async mutex, keyed by merchantId. Chosen over a
// DB-level transaction/isolation-level approach because this app is a
// single Node process talking to an embedded SQLite file (the rate
// limiter in lib/rateLimiter.js already documents the same single-process
// assumption) - SQLite + Prisma's interactive-transaction isolation
// guarantees under concurrent writers are murky and version-dependent,
// while a plain in-memory promise-chain mutex is simple, exactly correct
// for this deployment shape, and doesn't block other merchants' requests
// against each other. A real multi-instance deployment would need this
// moved to a real lock (e.g. a DB row lock or Redis), same caveat as the
// rate limiter.
const tails = new Map();

export function withMerchantLock(merchantId, fn) {
  const prevTail = tails.get(merchantId) || Promise.resolve();
  const result = prevTail.then(fn, fn);
  // The stored tail must never itself reject, or every later caller for
  // this merchant would immediately fail too - only the promise returned
  // to *this* caller should carry a rejection.
  tails.set(merchantId, result.then(() => undefined, () => undefined));
  return result;
}
