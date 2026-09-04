import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimiter";
import { hashApiKey } from "@/lib/merchantSettings";

const VALID_DECISIONS = ["allow", "hold_for_review", "auto_refund"];
const API_KEY_PREFIX_LENGTH = 16;

// External API contract: authenticated via "Authorization: Bearer <apiKey>",
// checked against MerchantSettings.apiKeyHash - the raw key is never
// stored, only its SHA-256 hash. Read-only by design - no write access is
// exposed here, keeping the external attack surface minimal for a
// hackathon timeline.
function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Same discipline as the webhook signature check (app/api/webhooks/
// razorpay/route.js): don't let the presented key's comparison leak
// timing information, even though what's actually being compared here is
// already a one-way hash rather than a raw secret. Both inputs are fixed-
// length 64-char SHA-256 hex digests, so a length mismatch can't happen in
// practice, but it's checked explicitly rather than assumed.
function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function GET(request) {
  const apiKey = getBearerToken(request);
  if (!apiKey) {
    return Response.json(
      { error: "Missing API key. Pass it as: Authorization: Bearer <apiKey>" },
      { status: 401 }
    );
  }

  // Narrow by the stored prefix first (fast, indexed-in-spirit lookup),
  // then do the actual auth decision via constant-time hash comparison -
  // the prefix alone is never sufficient to authenticate, only to find
  // candidates worth comparing against.
  const prefix = apiKey.slice(0, API_KEY_PREFIX_LENGTH);
  const presentedHash = hashApiKey(apiKey);
  const candidates = await prisma.merchantSettings.findMany({ where: { apiKeyPrefix: prefix } });
  const settings = candidates.find(
    (c) => c.apiKeyHash && timingSafeEqualHex(c.apiKeyHash, presentedHash)
  );
  if (!settings) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(settings.apiKeyHash);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
  const decision = searchParams.get("decision");
  const source = searchParams.get("source") || "razorpay_live";

  // Scoped to the merchant that owns this API key - resolved from the key
  // itself, not a hard-coded constant, since this is the one route that
  // already identifies "which merchant" via a real (if lightweight) auth
  // check.
  const where = { merchantId: settings.merchantId, source };
  if (VALID_DECISIONS.includes(decision)) {
    where.policyDecision = decision;
  }

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return Response.json({
    data: rows.map((row) => ({
      transactionId: row.txnId,
      amount: row.amount,
      riskScore: row.riskScore,
      confidence: row.confidence,
      policyDecision: row.policyDecision,
      actionTaken: row.actionTaken,
      reasons: row.reasons,
      refundExecuted: row.refundExecuted,
      refundId: row.refundId,
      timestamp: row.timestamp,
    })),
  });
}
