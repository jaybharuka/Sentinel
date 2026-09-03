import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Scoped to razorpay_live + synthetic combined, not razorpay_live alone -
// real traffic is currently a handful of rows (see the Live Accuracy panel),
// nowhere near enough to say anything about provider mix or latency on its
// own. Kaggle-benchmark and demo_simulated rows are excluded: Kaggle uses a
// different, reduced-signal prompt (not representative of real scoring
// latency), and demo_simulated rows never make a real scoring call at all
// (see lib/ingestTransaction.js's forceFallback path).
function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await prisma.transaction.findMany({
    where: { merchantId: merchant.id, source: { in: ["razorpay_live", "synthetic"] } },
    select: { source: true, provider: true, scoringLatencyMs: true },
  });

  const liveCount = rows.filter((r) => r.source === "razorpay_live").length;
  const syntheticCount = rows.filter((r) => r.source === "synthetic").length;

  // "Instrumented" rows are the ones with a real provider tag - this field
  // didn't exist before this pass, so any row scored before it shipped is
  // real data but has nothing to report here. Reported explicitly rather
  // than silently excluded, so the gap between totalInScope and
  // instrumented is visible, not hidden.
  const instrumented = rows.filter((r) => r.provider != null);
  const providerCounts = {};
  for (const row of instrumented) {
    providerCounts[row.provider] = (providerCounts[row.provider] || 0) + 1;
  }

  const latencies = rows
    .map((r) => r.scoringLatencyMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);

  return Response.json({
    scope: "razorpay_live + synthetic",
    totalInScope: rows.length,
    liveCount,
    syntheticCount,
    instrumented: instrumented.length,
    providerCounts,
    latency: {
      sampleSize: latencies.length,
      medianMs: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
  });
}
