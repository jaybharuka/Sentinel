import { Redis } from "@upstash/redis";
import crypto from "crypto";

// Real distributed lock, keyed by merchantId, via Upstash's REST-based Redis
// (no persistent TCP connection needed, so it works cleanly from Vercel's
// serverless functions - the previous version of this file was an
// in-process Map, which silently stopped providing any real guarantee the
// moment two concurrent requests landed on separate function instances,
// each with its own independent Map. This is the fix for that gap (see
// docs/PROJECT_REVIEW.md's "what would need to change" list).
//
// SET key value NX PX <ttl> is the standard Redis lock-acquire primitive:
// it only succeeds if the key doesn't already exist, atomically setting
// both the value and an expiry in one round trip. The value is a random
// token per acquisition, checked-then-deleted via a small Lua script on
// release (atomic compare-and-delete) so a request can never release a
// lock it doesn't actually hold - e.g. one whose own TTL already expired
// and was re-acquired by someone else in the meantime.
const redis = Redis.fromEnv();

// Long enough to comfortably cover the real critical section (one
// aggregate query + one policy decision + one row create against Neon,
// typically well under a second, but generous for real-world network
// variance) - short enough that if a function instance crashes or times
// out while holding the lock, the next merchant's request isn't stuck
// waiting on a lock nobody will ever release.
const LOCK_TTL_MS = 10_000;
const POLL_INTERVAL_MS = 50;
// If the lock can't be acquired in this window, fail loudly rather than
// hang the request forever. Sized to comfortably drain a real burst of
// concurrent requests for one merchant (each waiter serialized behind the
// last, at up to LOCK_TTL_MS apiece in the worst case) rather than just
// the single-request critical-section time - a 10-way concurrent burst
// was observed timing out well before completion at a shorter value
// during testing, well before actually hitting a stuck/dead lock.
const MAX_WAIT_MS = 20_000;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Thrown only for failures during acquisition (Redis unreachable, or
// genuine contention timeout) - never for an error thrown by fn() itself
// while the lock is held. Callers that want a safe degraded fallback
// specifically for "we couldn't get the lock" (see
// lib/ingestTransaction.js) need to be able to tell that apart from an
// unrelated failure inside their own critical section, so they don't
// silently reinterpret a real bug as a lock outage and re-run fn() a
// second time against whatever partial state it already left behind.
export class LockAcquisitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockAcquisitionError";
  }
}

export async function withMerchantLock(merchantId, fn) {
  const key = `merchant-lock:${merchantId}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + MAX_WAIT_MS;

  let acquired = false;
  try {
    while (Date.now() < deadline) {
      const result = await redis.set(key, token, { nx: true, px: LOCK_TTL_MS });
      if (result === "OK") {
        acquired = true;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } catch (err) {
    throw new LockAcquisitionError(`Redis error while acquiring merchant lock for ${merchantId}: ${err.message || err}`);
  }

  if (!acquired) {
    throw new LockAcquisitionError(`Could not acquire merchant lock for ${merchantId} within ${MAX_WAIT_MS}ms`);
  }

  try {
    return await fn();
  } finally {
    // Best-effort: if this fails, the lock still self-expires via its TTL
    // within LOCK_TTL_MS - a slightly delayed release, never a permanent
    // deadlock, so a Redis hiccup on release can't take the merchant down.
    try {
      await redis.eval(RELEASE_SCRIPT, [key], [token]);
    } catch (err) {
      console.error(`Failed to release merchant lock for ${merchantId}:`, err);
    }
  }
}
