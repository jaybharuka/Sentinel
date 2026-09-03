// Shared between /api/settings (persisting real bounds) and
// /api/policy-simulator (testing candidate bounds against historical data) -
// a candidate the simulator would accept must be exactly what /api/settings
// would later accept when the merchant applies it, or "Apply this policy"
// could simulate one thing and save another.
export function validatePolicyBounds(input) {
  const errors = [];

  const autoRefundMaxAmount = Number(input.autoRefundMaxAmount);
  const dailyRefundCap = Number(input.dailyRefundCap);
  const autoRefundMinRiskScore = Number(input.autoRefundMinRiskScore);
  const autoRefundMinConfidence = Number(input.autoRefundMinConfidence);
  const holdForReviewMinRiskScore = Number(input.holdForReviewMinRiskScore);

  if (!Number.isFinite(autoRefundMaxAmount) || autoRefundMaxAmount < 0) {
    errors.push("autoRefundMaxAmount must be a non-negative number");
  }
  if (!Number.isFinite(dailyRefundCap) || dailyRefundCap < 0) {
    errors.push("dailyRefundCap must be a non-negative number");
  }
  if (
    Number.isFinite(autoRefundMaxAmount) &&
    Number.isFinite(dailyRefundCap) &&
    dailyRefundCap < autoRefundMaxAmount
  ) {
    errors.push("dailyRefundCap must be >= autoRefundMaxAmount");
  }
  for (const [key, value] of [
    ["autoRefundMinRiskScore", autoRefundMinRiskScore],
    ["autoRefundMinConfidence", autoRefundMinConfidence],
    ["holdForReviewMinRiskScore", holdForReviewMinRiskScore],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${key} must be a number between 0 and 1`);
    }
  }

  return {
    errors,
    values: {
      autoRefundMaxAmount,
      dailyRefundCap,
      autoRefundMinRiskScore,
      autoRefundMinConfidence,
      holdForReviewMinRiskScore,
    },
  };
}
