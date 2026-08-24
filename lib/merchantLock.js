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
