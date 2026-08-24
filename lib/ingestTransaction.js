import { extractFeatures } from "@/lib/featureExtractor";
import { scoreTransaction } from "@/lib/gemini";
import { fallbackScore } from "@/lib/fallbackHeuristic";
import { applyPolicy } from "@/lib/policyGate";
import { executeRefund } from "@/lib/refundExecutor";
import { getMerchantSettings, DEFAULT_MERCHANT_ID } from "@/lib/merchantSettings";
import { sendAlert } from "@/lib/alerting";
import { prisma } from "@/lib/prisma";

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Runs one raw mock payment event through the full pipeline - feature
 * extraction, Gemini (with rule-based fallback on any failure), the
 * configurable policy gate (see lib/merchantSettings.js) - and persists the
 * result as one audit-trail row.
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
    source,
    forceFallback,
    forcedScoringOutput,
  } = event;

  // Caller resolves which merchant this belongs to (session for
  // dashboard-triggered calls, hard-coded for the webhook - see
  // app/api/webhooks/razorpay/route.js). Falls back to the original
  // default merchant so /api/ingest and other tooling keep working
  // without threading a merchantId through explicitly.
  const merchantId = event.merchantId || DEFAULT_MERCHANT_ID;
  const scopedEvent = { ...event, merchantId };

  const features = await extractFeatures(scopedEvent);

  let scoringOutput;
  let usedFallback = false;
  let geminiError = null;
  if (forceFallback) {
    // Demo-only path (see /api/demo/simulate-outage): skips the real Gemini
    // call entirely rather than making a live request and discarding it, so
    // the demo never touches GEMINI_API_KEY or quota. forcedScoringOutput is
    // test-only (see scripts/testAutoRefund.js): the fallback heuristic itself
    // never recommends "auto_refund" (it caps at "hold_for_review"), so
    // exercising that path without a live Gemini call requires injecting a
    // specific score directly. No real request path ever sets this field.
    usedFallback = true;
    geminiError = "Simulated Gemini outage (demo)";
    scoringOutput = forcedScoringOutput || fallbackScore(features);
  } else {
    try {
      scoringOutput = await scoreTransaction(features);
    } catch (err) {
      usedFallback = true;
      geminiError = String(err.message || err);
      scoringOutput = fallbackScore(features);
    }
  }

  const txnDate = new Date(timestamp);

  // Daily refund budget tracks the calendar day the transaction itself
  // occurred on, so replaying/seeding historical data enforces the cap
  // per simulated day rather than against the real wall-clock date. Scoped
  // to source: razorpay_live only - it's a real-money budget, so synthetic
  // seed data and demo-button clicks (including the auto_refund demo
  // scenario) must never count against it or gate a real refund.
  const dailyAgg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      merchantId,
      actionTaken: "auto_refund",
      source: "razorpay_live",
      timestamp: { gte: startOfDay(txnDate), lte: endOfDay(txnDate) },
    },
  });
  const dailyRefundedTotal = dailyAgg._sum.amount || 0;

  const settings = await getMerchantSettings(merchantId);
  const policyResult = applyPolicy(scoringOutput, amount, dailyRefundedTotal, settings);
  const resolvedSource = source || "synthetic";

  // Real money only moves for real Razorpay-originated payments. Synthetic,
  // demo, and seeded transactions never have a real Razorpay payment ID
  // behind their txnId, so a refund call against them would either hit a
  // real unrelated payment or fail - never attempt it.
  let refundExecuted = false;
  let refundId = null;
  let refundError = null;
  if (policyResult.decision === "auto_refund" && resolvedSource === "razorpay_live") {
    const refundResult = await executeRefund(txnId, Math.round(amount * 100));
    refundExecuted = refundResult.success;
    refundId = refundResult.refundId || null;
    refundError = refundResult.success ? null : refundResult.error;
  }

  // The schema has no dedicated column for Gemini's raw recommendation or
  // the policy gate's justification, so both are folded into the stored
  // `reasons` array - keeps the full audit trail (including any override)
  // readable straight from the DB without a schema change.
  const auditReasons = [
    ...scoringOutput.reasons,
    `${usedFallback ? "Fallback" : "Gemini"} recommended: ${scoringOutput.recommended_action}`,
    `Policy: ${policyResult.reason}`,
  ];
  if (policyResult.decision === "auto_refund" && resolvedSource === "razorpay_live") {
    auditReasons.push(
      refundExecuted
        ? `Refund executed: Razorpay refund ${refundId}`
        : `Refund NOT executed: ${refundError}`
    );
  }

  const saved = await prisma.transaction.create({
    data: {
      merchantId,
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
      source: resolvedSource,
      refundExecuted,
      refundId,
      refundError,
    },
  });

  // No alertEmail check here - every merchant has a real registered email
  // by definition of having signed up, and sendAlert() falls back to it
  // when settings.alertEmail isn't explicitly set.
  const needsAlert =
    (policyResult.decision === "hold_for_review" || policyResult.decision === "auto_refund") &&
    resolvedSource === "razorpay_live";
  if (needsAlert) {
    await sendAlert(saved, settings);
  }

  return { saved, usedFallback, geminiError };
}
