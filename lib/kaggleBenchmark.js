import { extractKaggleFeatures } from "@/lib/kaggleFeatureExtractor";
import { scoreTransaction } from "@/lib/aiScoring";
import { fallbackScore } from "@/lib/fallbackHeuristic";
import { applyPolicy } from "@/lib/policyGate";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MERCHANT_ID, getMerchantSettings } from "@/lib/merchantSettings";

// This dataset's transactions are real and from September 2013 (the
// well-documented origin of the Kaggle "Credit Card Fraud Detection"
// dataset); "time" is seconds elapsed from that window's start. Used only
// to give each row a real-ish, orderable timestamp for display in the
// audit trail - never fed into scoring as a feature (see
// lib/kaggleFeatureExtractor.js, which derives oddHour from the same raw
// "time" value independently).
const DATASET_EPOCH = new Date("2013-09-01T00:00:00.000Z").getTime();

/**
 * Scores and stores one row from data/kaggleCreditCardSample.json through
 * the real scoring pipeline (Groq, with rule-based fallback on failure) and
 * the real, unmodified policy gate - source: "kaggle_benchmark" keeps it
 * fully separate from real money/refund logic: the daily-refund-budget
 * aggregate, refund execution, and merchant alerts in
 * lib/ingestTransaction.js are all explicitly scoped to source:
 * "razorpay_live" only, so a kaggle_benchmark row can never trigger any of
 * them even if its policy decision comes back "auto_refund" - it's a
 * scoring-accuracy classification only, not a real disbursement decision.
 * That's also why this bypasses ingestTransaction.js entirely rather than
 * reusing it: the merchant-lock/refund-execution machinery there exists
 * for real money and has nothing to do with scoring a stateless external
 * benchmark row.
 */
export async function scoreKaggleRow(row) {
  const features = extractKaggleFeatures(row);

  let scoringOutput;
  let usedFallback = false;
  let provider = "fallback";
  try {
    scoringOutput = await scoreTransaction(features, { reducedSignalSet: true });
    provider = scoringOutput.provider; // "groq-primary" | "groq-secondary" | "gemini"
  } catch {
    usedFallback = true;
    scoringOutput = fallbackScore(features);
  }

  const settings = await getMerchantSettings(DEFAULT_MERCHANT_ID);
  const policyResult = applyPolicy(scoringOutput, row.amount, 0, settings);

  const reasons = [
    ...scoringOutput.reasons,
    `${usedFallback ? "Fallback" : "AI"} recommended: ${scoringOutput.recommended_action}`,
    `Scored by: ${provider}`,
    `Policy: ${policyResult.reason}`,
  ];

  const saved = await prisma.transaction.create({
    data: {
      merchantId: DEFAULT_MERCHANT_ID,
      txnId: row.kaggleId,
      amount: row.amount,
      // No email/ipCountry/billingCountry exist in this dataset - these
      // schema fields are required for storage but are never read by
      // lib/kaggleFeatureExtractor.js, so they can't leak into scoring.
      email: "not-available@kaggle-benchmark.invalid",
      ipCountry: "XX",
      billingCountry: "XX",
      timestamp: new Date(DATASET_EPOCH + row.time * 1000),
      features,
      riskScore: scoringOutput.risk_score,
      confidence: scoringOutput.confidence,
      reasons,
      usedFallback,
      provider,
      policyDecision: policyResult.decision,
      actionTaken: policyResult.decision,
      humanOverride: false,
      isLabeledFraud: row.isLabeledFraud,
      source: "kaggle_benchmark",
      refundExecuted: false,
      refundId: null,
      refundError: null,
    },
  });

  return { saved, usedFallback, provider };
}
