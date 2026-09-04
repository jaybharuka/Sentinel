import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const DAYS = 30;
const BUCKET_COUNT = 10;

function dayKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// Read-only aggregation for the Overview trend chart and the Policy &
// Signals risk-distribution histogram - same shape as the app's other
// /api/metrics/* endpoints (session-gated, merchant-scoped, computed from
// already-stored Transaction rows). Doesn't touch scoring, the policy
// gate, or any decision path - purely reads what ingestTransaction.js
// already wrote.
export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const since = new Date();
  since.setDate(since.getDate() - (DAYS - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.transaction.findMany({
    where: { merchantId: merchant.id, timestamp: { gte: since } },
    select: { timestamp: true, policyDecision: true, riskScore: true },
  });

  // Pre-seed every day in the window so the chart shows real zero-volume
  // days rather than skipping them (a gap that would otherwise read as
  // missing data, not "nothing happened that day").
  const byDay = new Map();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(dayKey(d), { date: dayKey(d), allow: 0, hold_for_review: 0, auto_refund: 0 });
  }

  const histogramBuckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    bucket: `${(i / BUCKET_COUNT).toFixed(1)}-${((i + 1) / BUCKET_COUNT).toFixed(1)}`,
    count: 0,
  }));

  for (const row of rows) {
    const key = dayKey(row.timestamp);
    const bucket = byDay.get(key);
    if (bucket && (row.policyDecision === "allow" || row.policyDecision === "hold_for_review" || row.policyDecision === "auto_refund")) {
      bucket[row.policyDecision] += 1;
    }

    if (typeof row.riskScore === "number" && Number.isFinite(row.riskScore)) {
      const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(row.riskScore * BUCKET_COUNT)));
      histogramBuckets[idx].count += 1;
    }
  }

  return Response.json({
    daily: Array.from(byDay.values()),
    riskHistogram: histogramBuckets,
    totalInWindow: rows.length,
  });
}
