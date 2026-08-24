import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimiter";

const VALID_DECISIONS = ["allow", "hold_for_review", "auto_refund"];

// External API contract: authenticated via "Authorization: Bearer <apiKey>"
// against MerchantSettings.apiKey. Read-only by design - no write access is
// exposed here, keeping the external attack surface minimal for a
// hackathon timeline.
function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function GET(request) {
  const apiKey = getBearerToken(request);
  if (!apiKey) {
    return Response.json(
      { error: "Missing API key. Pass it as: Authorization: Bearer <apiKey>" },
      { status: 401 }
    );
  }

  const settings = await prisma.merchantSettings.findUnique({ where: { apiKey } });
  if (!settings) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(apiKey);
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
