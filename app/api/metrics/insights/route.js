import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { SIGNAL_DEFS } from "@/components/dashboard/riskSignals";

const DEFAULT_DAYS = 30;
const ALLOWED_DAYS = [7, 30, 90];

// Top risk signals + policy effectiveness for the Insights tab - both are
// range summaries, not time series (that's /api/metrics/trend), so they
// live in their own endpoint rather than bloating that one with data most
// of its callers (Overview, Policy & Signals) don't need.
export async function GET(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedDays = parseInt(searchParams.get("days") || "", 10);
  const days = ALLOWED_DAYS.includes(requestedDays) ? requestedDays : DEFAULT_DAYS;

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  // Top risk signals: reuses the exact same SIGNAL_DEFS.contributed()
  // predicates the Transactions tab's per-row signal grid and "N/12
  // flagged" badge already use against each row's stored `features` JSON -
  // one definition of "did this signal look risky," not a second one
  // reimplemented by parsing the free-text `reasons` array.
  const flaggedRows = await prisma.transaction.findMany({
    where: {
      merchantId: merchant.id,
      timestamp: { gte: since },
      policyDecision: { in: ["hold_for_review", "auto_refund"] },
    },
    select: { features: true, policyDecision: true, humanOverride: true, reviewedAt: true },
  });

  const signalCounts = new Map(SIGNAL_DEFS.map((def) => [def.key, 0]));
  for (const row of flaggedRows) {
    if (!row.features) continue;
    for (const def of SIGNAL_DEFS) {
      if (def.contributed(row.features)) {
        signalCounts.set(def.key, signalCounts.get(def.key) + 1);
      }
    }
  }

  const totalFlagged = flaggedRows.length;
  const topSignals = SIGNAL_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    count: signalCounts.get(def.key),
    pct: totalFlagged > 0 ? signalCounts.get(def.key) / totalFlagged : 0,
  }))
    .sort((a, b) => b.count - a.count)
    .filter((s) => s.count > 0);

  // Policy effectiveness: among flagged transactions, how many were
  // actually looked at and reversed (humanOverride) vs. looked at and
  // confirmed (reviewedAt, no reversal) vs. never acted on yet (still in
  // the Review Queue). A high override share suggests the policy bounds
  // are too aggressive for this merchant's real traffic; a high
  // reviewed-kept share suggests they're well-tuned.
  let overridden = 0;
  let reviewedKept = 0;
  let pending = 0;
  for (const row of flaggedRows) {
    if (row.humanOverride) overridden += 1;
    else if (row.reviewedAt) reviewedKept += 1;
    else pending += 1;
  }
  const resolved = overridden + reviewedKept;

  return Response.json({
    days,
    topSignals,
    totalFlagged,
    policyEffectiveness: {
      totalFlagged,
      overridden,
      reviewedKept,
      pending,
      // Percentages are of *resolved* flagged transactions (excludes
      // still-pending ones) - a queue full of untouched items shouldn't
      // dilute "is the policy well-tuned" toward looking artificially good
      // just because nobody has reviewed them yet.
      overriddenPct: resolved > 0 ? overridden / resolved : null,
      reviewedKeptPct: resolved > 0 ? reviewedKept / resolved : null,
      resolvedCount: resolved,
    },
  });
}
