// Hard-coded, plain-JS policy bounds. These are the numbers that gate every
// money-moving action — Gemini only reasons and recommends, it never
// decides. Keep these named and visible for the demo.
export const AUTO_REFUND_MAX_AMOUNT = 2000;
export const DAILY_REFUND_CAP = 10000;
export const AUTO_REFUND_MIN_RISK_SCORE = 0.9;
export const AUTO_REFUND_MIN_CONFIDENCE = 0.8;
export const HOLD_FOR_REVIEW_MIN_RISK_SCORE = 0.6;

/**
 * Pure policy gate: decides the allowed action from a scoring output
 * (Gemini's or the fallback heuristic's) plus the deterministic bounds
 * above. No side effects, no LLM calls, no DB access.
 */
export function applyPolicy(scoringOutput, transactionAmount, dailyRefundedTotal) {
  const { recommended_action, risk_score, confidence } = scoringOutput;

  const eligibleForAutoRefund =
    recommended_action === "auto_refund" &&
    transactionAmount <= AUTO_REFUND_MAX_AMOUNT &&
    risk_score > AUTO_REFUND_MIN_RISK_SCORE &&
    confidence > AUTO_REFUND_MIN_CONFIDENCE &&
    dailyRefundedTotal + transactionAmount <= DAILY_REFUND_CAP;

  if (eligibleForAutoRefund) {
    return {
      decision: "auto_refund",
      reason: `risk_score ${risk_score.toFixed(2)} and confidence ${confidence.toFixed(2)} cleared auto-refund thresholds, amount ₹${transactionAmount} within ₹${AUTO_REFUND_MAX_AMOUNT} cap and daily budget`,
    };
  }

  if (risk_score > HOLD_FOR_REVIEW_MIN_RISK_SCORE) {
    if (recommended_action === "auto_refund" && dailyRefundedTotal + transactionAmount > DAILY_REFUND_CAP) {
      return {
        decision: "hold_for_review",
        reason: `capped: daily refund budget would be exceeded (₹${dailyRefundedTotal} + ₹${transactionAmount} > ₹${DAILY_REFUND_CAP}), downgraded to hold_for_review`,
      };
    }
    if (recommended_action === "auto_refund" && transactionAmount > AUTO_REFUND_MAX_AMOUNT) {
      return {
        decision: "hold_for_review",
        reason: `capped: amount ₹${transactionAmount} exceeds auto-refund cap of ₹${AUTO_REFUND_MAX_AMOUNT}, downgraded to hold_for_review`,
      };
    }
    return {
      decision: "hold_for_review",
      reason: `held: risk_score ${risk_score.toFixed(2)} above hold threshold of ${HOLD_FOR_REVIEW_MIN_RISK_SCORE}`,
    };
  }

  return {
    decision: "allow",
    reason: `allowed: risk_score ${risk_score.toFixed(2)} below hold threshold of ${HOLD_FOR_REVIEW_MIN_RISK_SCORE}`,
  };
}
