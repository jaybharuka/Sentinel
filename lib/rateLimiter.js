import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Distributed rate limiter, keyed by API key hash - replaces the previous
// in-process token bucket, which only ever provided a real ceiling within a
// single warm Vercel instance. Under concurrent traffic across multiple
// instances, an in-memory bucket's effective limit becomes (nominal limit x
// concurrent instance count), not a hard ceiling - same category of bug
// lib/merchantLock.js had before it moved to a real Redis lock.
//
// Uses @upstash/ratelimit rather than hand-rolling with raw Redis commands
// (the way lib/merchantLock.js hand-rolls its lock): a correct sliding-
// window/token-bucket limiter needs its own atomic Lua script to avoid a
// races between the read and the decrement, and Upstash - the same vendor
// already backing the distributed lock - publishes and maintains exactly
// that script in this package. Hand-rolling the lock made sense because a
// mutual-exclusion primitive (SET NX PX + a compare-and-delete release) is
// a few lines with no subtle counting logic; a correct rate limiter is not.
//
// tokenBucket keeps the same semantics as the old in-memory bucket: a
// bucket of maxTokens, refilling at refillRate per interval, one token
// spent per request - same shape, now real across instances.
const BUCKET_CAPACITY = 20;
const REFILL_PER_SECOND = 2;

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.tokenBucket(REFILL_PER_SECOND, "1 s", BUCKET_CAPACITY),
  prefix: "sentinel-ratelimit",
});

export async function checkRateLimit(key) {
  const result = await ratelimit.limit(key);
  if (result.success) {
    return { allowed: true };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
  };
}
