// In-memory per-process token bucket, keyed by API key. Good enough for a
// single-instance hackathon demo - resets on restart and doesn't share
// state across processes. A real deployment would move this to Redis or
// similar so limits hold across restarts/instances.
const BUCKET_CAPACITY = 20;
const REFILL_PER_SECOND = 2;

const buckets = new Map();

export function checkRateLimit(key) {
  const now = Date.now();
  const bucket = buckets.get(key) || { tokens: BUCKET_CAPACITY, lastRefill: now };

  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSeconds * REFILL_PER_SECOND);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / REFILL_PER_SECOND) };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { allowed: true };
}
