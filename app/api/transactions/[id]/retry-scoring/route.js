import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { scoreTransaction } from "@/lib/aiScoring";
import { applyPolicy } from "@/lib/policyGate";
import { getMerchantSettings } from "@/lib/merchantSettings";
import { startOfDay, endOfDay } from "@/lib/ingestTransaction";

// Manually re-scores one already-stored transaction with a fresh live AI
// scoring call, using its already-computed (deterministic) features -
// operational/demo convenience for "this one used the fallback, retry it
// to see real AI reasoning." Re-runs the policy gate against the new
// score so the decision shown is honest, but deliberately never calls
// executeRefund() or sendAlert() regardless of the new decision - a manual
// retry must never be able to trigger a second real refund or alert as a
// side effect.
export async function POST(request, { params }) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const txnId = Number(id);
  if (!Number.isInteger(txnId)) {
    return Response.json({ error: "Invalid transaction id" }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({ where: { id: txnId } });
  if (!existing || existing.merchantId !== merchant.id) {
    return Response.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (!existing.usedFallback) {
    return Response.json({ error: "This transaction was already scored by the AI" }, { status: 400 });
  }

  let scoringOutput;
  try {
    scoringOutput = await scoreTransaction(existing.features);
  } catch (err) {
    return Response.json(
      { error: `AI scoring still unavailable: ${String(err.message || err)}` },
      { status: 502 }
    );
  }

  const txnDate = new Date(existing.timestamp);
  const dailyAgg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      merchantId: merchant.id,
      actionTaken: "auto_refund",
      source: "razorpay_live",
      timestamp: { gte: startOfDay(txnDate), lte: endOfDay(txnDate) },
    },
  });
  const dailyAuthorizedTotal = dailyAgg._sum.amount || 0;

  const settings = await getMerchantSettings(merchant.id);
  const policyResult = applyPolicy(scoringOutput, existing.amount, dailyAuthorizedTotal, settings);

  const updatedReasons = [
    ...scoringOutput.reasons,
    `AI recommended: ${scoringOutput.recommended_action}`,
    `Policy: ${policyResult.reason}`,
    `Manually retried with live AI scoring at ${new Date().toISOString()} (originally used fallback). Decision re-evaluated above, but no refund or alert was re-triggered as a result of this retry.`,
  ];

  const updated = await prisma.transaction.update({
    where: { id: txnId },
    data: {
      riskScore: scoringOutput.risk_score,
      confidence: scoringOutput.confidence,
      reasons: updatedReasons,
      usedFallback: false,
      policyDecision: policyResult.decision,
      actionTaken: policyResult.decision,
    },
  });

  return Response.json(updated);
}
