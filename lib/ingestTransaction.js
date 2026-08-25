import { extractFeatures } from "@/lib/featureExtractor";
import { scoreTransaction } from "@/lib/aiScoring";
import { fallbackScore } from "@/lib/fallbackHeuristic";
import { applyPolicy } from "@/lib/policyGate";
import { executeRefund } from "@/lib/refundExecutor";
import { getMerchantSettings, DEFAULT_MERCHANT_ID } from "@/lib/merchantSettings";
import { sendAlert } from "@/lib/alerting";
import { withMerchantLock } from "@/lib/merchantLock";
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
 * extraction, AI scoring (with rule-based fallback on any failure), the
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
  let scoringError = null;
  if (forceFallback) {
    // Demo-only path (see /api/demo/simulate-outage): skips the real AI
    // scoring call entirely rather than making a live request and
    // discarding it, so the demo never touches GROQ_API_KEY or rate limits.
    // forcedScoringOutput is test-only (see scripts/testAutoRefund.js): the
    // fallback heuristic itself never recommends "auto_refund" (it caps at
    // "hold_for_review"), so exercising that path without a live scoring
    // call requires injecting a specific score directly. No real request
    // path ever sets this field.
    usedFallback = true;
    scoringError = "Simulated AI scoring outage (demo)";
    scoringOutput = forcedScoringOutput || fallbackScore(features);
  } else {
    try {
      scoringOutput = await scoreTransaction(features);
    } catch (err) {
      usedFallback = true;
      scoringError = String(err.message || err);
      scoringOutput = fallbackScore(features);
    }
  }

  const txnDate = new Date(timestamp);
  const resolvedSource = source || "synthetic";

  // Critical section: read today's authorized total, decide, and persist
  // that decision, all under a per-merchant lock - otherwise two
  // concurrent requests could both read the same stale total and both get
  // approved past the daily cap. See lib/merchantLock.js for why an
  // in-process mutex rather than a DB-level transaction/isolation-level
  // approach (this app is a single Node process against embedded SQLite).
  const { saved, policyResult, settings } = await withMerchantLock(merchantId, async () => {
    // Daily refund budget tracks the calendar day the transaction itself
    // occurred on, so replaying/seeding historical data enforces the cap
    // per simulated day rather than against the real wall-clock date.
    // Scoped to source: razorpay_live only - it's a real-money budget, so
    // synthetic seed data and demo-button clicks (including the
    // auto_refund demo scenario) must never count against it or gate a
    // real refund.
    //
    // This counts approved auto_refund *decisions* (actionTaken), not
    // confirmed successful Razorpay refunds (refundExecuted) - a failed
    // real refund still consumes budget. That's intentional: it prevents
    // retrying a failed refund from opening up budget for an immediate
    // second attempt that pushes the day's total past the merchant's cap.
    const dailyAgg = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        merchantId,
        actionTaken: "auto_refund",
        source: "razorpay_live",
        timestamp: { gte: startOfDay(txnDate), lte: endOfDay(txnDate) },
      },
    });
    const dailyAuthorizedTotal = dailyAgg._sum.amount || 0;

    const settings = await getMerchantSettings(merchantId);
    const policyResult = applyPolicy(scoringOutput, amount, dailyAuthorizedTotal, settings);

    // The schema has no dedicated column for the AI's raw recommendation or
    // the policy gate's justification, so both are folded into the stored
    // `reasons` array - keeps the full audit trail (including any override)
    // readable straight from the DB without a schema change. The refund
    // outcome line (if any) is appended later, once it's actually known.
    const auditReasons = [
      ...scoringOutput.reasons,
      `${usedFallback ? "Fallback" : "AI"} recommended: ${scoringOutput.recommended_action}`,
      `Policy: ${policyResult.reason}`,
    ];

    const willAttemptRefund = policyResult.decision === "auto_refund" && resolvedSource === "razorpay_live";

    // The row is created here, before Razorpay is ever called, with
    // actionTaken already set to "auto_refund" if that's the decision -
    // this is what the budget aggregate above counts, and it's also the
    // safety property from the refund-ordering fix: a crash between the
    // decision and the Razorpay call still leaves a discoverable row
    // (refundExecuted: null) showing "we intended to refund this and don't
    // know if it succeeded", rather than nothing at all.
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
        refundExecuted: willAttemptRefund ? null : false,
        refundId: null,
        refundError: null,
      },
    });

    return { saved, policyResult, settings };
  });

  // Outside the lock: the real Razorpay call (and updating this row with
  // its outcome) doesn't change what the next request's budget read will
  // see - the row already exists with actionTaken: "auto_refund" - so
  // there's no reason to hold other requests for this merchant hostage to
  // Razorpay's latency.
  let finalSaved = saved;
  if (policyResult.decision === "auto_refund" && resolvedSource === "razorpay_live") {
    const refundResult = await executeRefund(txnId, Math.round(amount * 100));
    const refundExecuted = refundResult.success;
    const refundId = refundResult.refundId || null;
    const refundError = refundResult.success ? null : refundResult.error;

    const updatedReasons = [
      ...saved.reasons,
      refundExecuted
        ? `Refund executed: Razorpay refund ${refundId}`
        : `Refund NOT executed: ${refundError}`,
    ];

    finalSaved = await prisma.transaction.update({
      where: { id: saved.id },
      data: { refundExecuted, refundId, refundError, reasons: updatedReasons },
    });
  }

  // No alertEmail check here - every merchant has a real registered email
  // by definition of having signed up, and sendAlert() falls back to it
  // when settings.alertEmail isn't explicitly set.
  const needsAlert =
    (policyResult.decision === "hold_for_review" || policyResult.decision === "auto_refund") &&
    resolvedSource === "razorpay_live";
  if (needsAlert) {
    await sendAlert(finalSaved, settings);
  }

  return { saved: finalSaved, usedFallback, scoringError };
}
