/**
 * Pure policy gate: decides the allowed action from a scoring output
 * (Gemini's or the fallback heuristic's) plus the merchant's configured
 * bounds (see lib/merchantSettings.js). No side effects, no LLM calls, no
 * DB access - the caller fetches settings and passes them in.
 *
 * dailyAuthorizedTotal is the sum of *decisions* to auto-refund today, not
 * confirmed successful Razorpay refunds - see the comment at its call site
 * in lib/ingestTransaction.js for why that's the intentional, safer choice.
 */
export function applyPolicy(scoringOutput, transactionAmount, dailyAuthorizedTotal, settings) {
  const { recommended_action, risk_score, confidence } = scoringOutput;

  // Fail-closed: malformed or out-of-range model/input values must never
  // silently coerce into a threshold comparison that could produce allow
  // or auto_refund. NaN/undefined comparisons in JS are all false, which
  // would otherwise fall through to the default "allow" at the bottom of
  // this function - the opposite of what a bad input should produce.
  if (
    !Number.isFinite(risk_score) || risk_score < 0 || risk_score > 1 ||
    !Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
    !Number.isFinite(transactionAmount) || transactionAmount < 0 ||
    !Number.isFinite(dailyAuthorizedTotal)
  ) {
    return { decision: "hold_for_review", reason: "invalid scoring or transaction input; fail-closed" };
  }

  const {
    autoRefundMaxAmount,
    dailyRefundCap,
    autoRefundMinRiskScore,
    autoRefundMinConfidence,
    holdForReviewMinRiskScore,
  } = settings;

  const eligibleForAutoRefund =
    recommended_action === "auto_refund" &&
    transactionAmount <= autoRefundMaxAmount &&
    risk_score > autoRefundMinRiskScore &&
    confidence > autoRefundMinConfidence &&
    dailyAuthorizedTotal + transactionAmount <= dailyRefundCap;

  if (eligibleForAutoRefund) {
    return {
      decision: "auto_refund",
      reason: `risk_score ${risk_score.toFixed(2)} and confidence ${confidence.toFixed(2)} cleared auto-refund thresholds, amount ₹${transactionAmount} within ₹${autoRefundMaxAmount} cap and daily budget`,
    };
  }

  if (risk_score > holdForReviewMinRiskScore) {
    if (recommended_action === "auto_refund" && dailyAuthorizedTotal + transactionAmount > dailyRefundCap) {
      return {
        decision: "hold_for_review",
        reason: `capped: daily refund budget would be exceeded (₹${dailyAuthorizedTotal} + ₹${transactionAmount} > ₹${dailyRefundCap}), downgraded to hold_for_review`,
      };
    }
    if (recommended_action === "auto_refund" && transactionAmount > autoRefundMaxAmount) {
      return {
        decision: "hold_for_review",
        reason: `capped: amount ₹${transactionAmount} exceeds auto-refund cap of ₹${autoRefundMaxAmount}, downgraded to hold_for_review`,
      };
    }
    return {
      decision: "hold_for_review",
      reason: `held: risk_score ${risk_score.toFixed(2)} above hold threshold of ${holdForReviewMinRiskScore}`,
    };
  }

  return {
    decision: "allow",
    reason: `allowed: risk_score ${risk_score.toFixed(2)} below hold threshold of ${holdForReviewMinRiskScore}`,
  };
}
