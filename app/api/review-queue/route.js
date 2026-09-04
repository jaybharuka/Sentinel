import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const BOILERPLATE_PREFIXES = [
  "⚠️",
  "AI recommended:",
  "Fallback recommended:",
  "Policy:",
  "Human override",
  "Reviewed at",
  "Refund executed:",
  "Refund NOT executed:",
];

// Same "skip the generic lines" idea as TransactionsTable's
// plainEnglishReason, but keeps up to 3 instead of just the first one - a
// queue row needs enough context to act without expanding into the full
// Transactions tab detail view.
function topReasons(reasons, limit = 2) {
  return (reasons || [])
    .filter((r) => !BOILERPLATE_PREFIXES.some((p) => r.startsWith(p)))
    .slice(0, limit);
}

export async function GET(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sort = searchParams.get("sort") === "oldest" ? "oldest" : "risk";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = 20;

  // The active queue: flagged, and not yet acted on either way (reversed
  // or explicitly kept) - see the reviewedAt/humanOverride comment on the
  // Transaction model for why both are checked.
  const queueWhere = {
    merchantId: merchant.id,
    policyDecision: { in: ["hold_for_review", "auto_refund"] },
    humanOverride: false,
    reviewedAt: null,
  };

  // Paginated, not a single unbounded fetch - a merchant with a real
  // backlog (a seed-data account can easily have hundreds of untouched
  // rows) would otherwise render every row in one multi-thousand-pixel
  // scroll. totalCount drives the "waiting" summary stat separately from
  // items.length, which is just this page's size.
  const [totalCount, rows] = await Promise.all([
    prisma.transaction.count({ where: queueWhere }),
    prisma.transaction.findMany({
      where: queueWhere,
      orderBy:
        sort === "oldest"
          ? { createdAt: "asc" }
          : [{ riskScore: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    txnId: row.txnId,
    amount: row.amount,
    riskScore: row.riskScore,
    confidence: row.confidence,
    policyDecision: row.policyDecision,
    actionTaken: row.actionTaken,
    refundExecuted: row.refundExecuted,
    refundId: row.refundId,
    refundError: row.refundError,
    createdAt: row.createdAt,
    topReasons: topReasons(row.reasons),
  }));

  // Resolution-time stat: only meaningful across transactions that have
  // actually been resolved one way or the other (overridden or kept) -
  // bounded to a reasonable recent sample rather than the merchant's whole
  // history, since a fraud analyst cares about current pace, not an
  // all-time average that a single old backlog-clearing session would skew.
  const resolved = await prisma.transaction.findMany({
    where: {
      merchantId: merchant.id,
      policyDecision: { in: ["hold_for_review", "auto_refund"] },
      OR: [{ humanOverride: true }, { reviewedAt: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { createdAt: true, overriddenAt: true, reviewedAt: true },
  });

  const resolutionTimesMs = resolved
    .map((r) => {
      const resolvedAt = r.overriddenAt || r.reviewedAt;
      return resolvedAt ? resolvedAt.getTime() - r.createdAt.getTime() : null;
    })
    .filter((ms) => ms !== null && ms >= 0);

  const avgResolutionMs =
    resolutionTimesMs.length > 0
      ? resolutionTimesMs.reduce((sum, ms) => sum + ms, 0) / resolutionTimesMs.length
      : null;

  // The true oldest item in the whole queue, not just this page - under
  // "highest risk first" sort, the oldest row usually isn't on page 1, so
  // this can't be derived from `rows` above.
  const oldestItem =
    totalCount > 0
      ? await prisma.transaction.findFirst({
          where: queueWhere,
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null;
  const oldestWaitMs = oldestItem ? Date.now() - oldestItem.createdAt.getTime() : null;

  return Response.json({
    items,
    sort,
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    summary: {
      count: totalCount,
      oldestWaitMs,
      avgResolutionMs,
      resolvedSampleSize: resolutionTimesMs.length,
    },
  });
}
