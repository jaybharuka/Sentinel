/**
 * Pure policy gate: decides the allowed action from a scoring output
 * (Gemini's or the fallback heuristic's) plus the merchant's configured
 * bounds (see lib/merchantSettings.js). No side effects, no LLM calls, no
 * DB access - the caller fetches settings and passes them in.
 */
export function applyPolicy(scoringOutput, transactionAmount, dailyRefundedTotal, settings) {
  const { recommended_action, risk_score, confidence } = scoringOutput;
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
    dailyRefundedTotal + transactionAmount <= dailyRefundCap;

  if (eligibleForAutoRefund) {
    return {
      decision: "auto_refund",
      reason: `risk_score ${risk_score.toFixed(2)} and confidence ${confidence.toFixed(2)} cleared auto-refund thresholds, amount ₹${transactionAmount} within ₹${autoRefundMaxAmount} cap and daily budget`,
    };
  }

  if (risk_score > holdForReviewMinRiskScore) {
    if (recommended_action === "auto_refund" && dailyRefundedTotal + transactionAmount > dailyRefundCap) {
      return {
        decision: "hold_for_review",
        reason: `capped: daily refund budget would be exceeded (₹${dailyRefundedTotal} + ₹${transactionAmount} > ₹${dailyRefundCap}), downgraded to hold_for_review`,
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
