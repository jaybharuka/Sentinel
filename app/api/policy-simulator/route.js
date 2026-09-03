import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { getMerchantSettings } from "@/lib/merchantSettings";
import { applyPolicy } from "@/lib/policyGate";
import { validatePolicyBounds } from "@/lib/validatePolicyBounds";

// Recovers the AI/fallback's original recommendation from the audit trail
// text - ingestTransaction.js always appends "AI recommended: X" or
// "Fallback recommended: X" to every row's reasons, so this is fully
// recoverable for every synthetic row (not best-effort backfill; every row
// scored through the real pipeline has this line by construction). We need
// the raw recommendation, not the already-gated policyDecision that's
// stored on the row, because a candidate threshold can only change the
// outcome correctly if applyPolicy() sees what the scorer actually
// recommended - not what the ORIGINAL bounds already downgraded it to.
function extractRecommendedAction(reasons) {
  const line = (reasons || []).find((r) => /^(AI|Fallback) recommended: /.test(r));
  const match = line && line.match(/recommended: (allow|hold_for_review|auto_refund)$/);
  return match ? match[1] : null;
}

function computeMetrics(rows, decisionOf) {
  let truePositives = 0,
    falsePositives = 0,
    falseNegatives = 0,
    trueNegatives = 0,
    falsePositiveCost = 0;
  const decisionCounts = { allow: 0, hold_for_review: 0, auto_refund: 0 };

  for (const row of rows) {
    const decision = decisionOf(row);
    decisionCounts[decision] = (decisionCounts[decision] || 0) + 1;
    const flagged = decision === "hold_for_review" || decision === "auto_refund";
    if (flagged && row.isLabeledFraud) truePositives++;
    else if (flagged && !row.isLabeledFraud) {
      falsePositives++;
      falsePositiveCost += row.amount;
    } else if (!flagged && row.isLabeledFraud) falseNegatives++;
    else trueNegatives++;
  }

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    totalLabeled: rows.length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision,
    recall,
    f1,
    falsePositiveCost,
    decisionCounts,
  };
}

export async function POST(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const { errors, values: candidateBounds } = validatePolicyBounds(body);
  if (errors.length > 0) {
    return Response.json({ error: errors.join("; ") }, { status: 400 });
  }

  const rows = await prisma.transaction.findMany({
    where: { merchantId: merchant.id, source: "synthetic", isLabeledFraud: { not: null } },
  });

  const parsed = rows
    .map((row) => ({ row, recommendedAction: extractRecommendedAction(row.reasons) }))
    .filter((r) => r.recommendedAction !== null);
  const unparseable = rows.length - parsed.length;

  // Each row is simulated independently against a fresh (zero) daily
  // budget, matching how these rows were actually scored in production:
  // the real daily-refund-budget aggregate only ever sums same-day
  // source: "razorpay_live" rows (see lib/ingestTransaction.js), so
  // synthetic rows never accumulated against each other or against a
  // shared running total when they were originally seeded either. A
  // candidate dailyRefundCap is still meaningfully tested here - it's
  // checked against each transaction's own amount - just not as a
  // compounding total across all 400 rows treated as one simulated day,
  // which wouldn't reflect how the system actually behaves.
  const recommendedActionById = new Map(parsed.map((r) => [r.row.id, r.recommendedAction]));
  const simulated = computeMetrics(parsed.map((r) => r.row), (row) => {
    const result = applyPolicy(
      { recommended_action: recommendedActionById.get(row.id), risk_score: row.riskScore, confidence: row.confidence },
      row.amount,
      0,
      candidateBounds
    );
    return result.decision;
  });

  const current = computeMetrics(rows, (row) => row.actionTaken);

  const liveSettings = await getMerchantSettings(merchant.id);

  return Response.json({
    scope: "synthetic",
    totalRows: rows.length,
    unparseable,
    currentBounds: {
      autoRefundMaxAmount: liveSettings.autoRefundMaxAmount,
      dailyRefundCap: liveSettings.dailyRefundCap,
      autoRefundMinRiskScore: liveSettings.autoRefundMinRiskScore,
      autoRefundMinConfidence: liveSettings.autoRefundMinConfidence,
      holdForReviewMinRiskScore: liveSettings.holdForReviewMinRiskScore,
    },
    candidateBounds,
    current,
    simulated,
  });
}
