import { extractFeatures } from "@/lib/featureExtractor";
import { scoreTransaction } from "@/lib/gemini";
import { fallbackScore } from "@/lib/fallbackHeuristic";
import { applyPolicy } from "@/lib/policyGate";
import { prisma } from "@/lib/prisma";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Runs one raw mock payment event through the full pipeline - feature
 * extraction, Gemini (with rule-based fallback on any failure), the
 * hard-coded policy gate - and persists the result as one audit-trail row.
 * Shared by /api/ingest and /api/seed so both go through identical logic.
 */
export async function ingestTransaction(event) {
  const {
    txnId,
    amount,
    currency,
    email,
    ipCountry,
    billingCountry,
    customerId,
    timestamp,
    cardBin,
    isLabeledFraud,
  } = event;

  const features = await extractFeatures(event);

  let scoringOutput;
  let usedFallback = false;
  try {
    scoringOutput = await scoreTransaction(features);
  } catch (err) {
    usedFallback = true;
    scoringOutput = fallbackScore(features);
  }

  const txnDate = new Date(timestamp);

  // Daily refund budget tracks the calendar day the transaction itself
  // occurred on, so replaying/seeding historical data enforces the cap
  // per simulated day rather than against the real wall-clock date.
  const dailyAgg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      actionTaken: "auto_refund",
      timestamp: { gte: startOfDay(txnDate), lte: endOfDay(txnDate) },
    },
  });
  const dailyRefundedTotal = dailyAgg._sum.amount || 0;

  const policyResult = applyPolicy(scoringOutput, amount, dailyRefundedTotal);

  // The schema has no dedicated column for Gemini's raw recommendation or
  // the policy gate's justification, so both are folded into the stored
  // `reasons` array - keeps the full audit trail (including any override)
  // readable straight from the DB without a schema change.
  const auditReasons = [
    ...scoringOutput.reasons,
    `${usedFallback ? "Fallback" : "Gemini"} recommended: ${scoringOutput.recommended_action}`,
    `Policy: ${policyResult.reason}`,
  ];

  const saved = await prisma.transaction.create({
    data: {
      txnId,
      amount,
      email,
      ipCountry,
      billingCountry,
      timestamp: txnDate,
      features: { customerId, cardBin, currency, ...features },
      riskScore: scoringOutput.risk_score,
      confidence: scoringOutput.confidence,
      reasons: auditReasons,
      usedFallback,
      policyDecision: policyResult.decision,
      actionTaken: policyResult.decision,
      humanOverride: false,
      isLabeledFraud: typeof isLabeledFraud === "boolean" ? isLabeledFraud : null,
    },
  });

  return { saved, usedFallback };
}
