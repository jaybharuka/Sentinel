const FALLBACK_CONFIDENCE = 0.5;
const HOLD_THRESHOLD = 0.7;

/**
 * Rule-based scorer used when the AI scoring call fails or times out. Same
 * output shape as scoreTransaction() so callers can treat both sources
 * identically before the policy gate runs.
 */
export function fallbackScore(features) {
  const {
    disposableEmail,
    countryMismatch,
    velocityLast10Min,
    previousChargebacks,
    oddHour,
    amountVsHistoryRatio,
    accountAgeDays,
    merchantRecentFraudRate,
  } = features;

  let riskScore = 0;
  const reasons = ["⚠️ AI scoring unavailable, used rule-based fallback"];

  if (disposableEmail) {
    riskScore += 0.35;
    reasons.push("Disposable email domain detected");
  }

  if (countryMismatch) {
    riskScore += 0.25;
    reasons.push("IP country does not match billing country");
  }

  if (velocityLast10Min > 2) {
    riskScore += 0.25;
    reasons.push(`${velocityLast10Min} transactions from this customer in the last 10 minutes`);
  }

  if (previousChargebacks > 0) {
    riskScore += 0.3;
    reasons.push(`${previousChargebacks} prior chargeback(s) on record`);
  }

  if (oddHour) {
    riskScore += 0.1;
    reasons.push("Transaction occurred during an odd hour (1am-5am)");
  }

  if (amountVsHistoryRatio !== null && amountVsHistoryRatio > 3) {
    riskScore += 0.2;
    reasons.push(
      `Amount is ${amountVsHistoryRatio.toFixed(1)}x this customer's historical average`
    );
  }

  if (accountAgeDays !== null && accountAgeDays === 0) {
    riskScore += 0.15;
    reasons.push("Customer's transaction history began today (accountAgeDays: 0)");
  }

  if (merchantRecentFraudRate !== null && merchantRecentFraudRate > 0.3) {
    riskScore += 0.2;
    reasons.push(
      `${(merchantRecentFraudRate * 100).toFixed(0)}% of this merchant's transactions in the last 24h were flagged`
    );
  }

  riskScore = Math.min(riskScore, 1);

  if (reasons.length === 1) {
    reasons.push("No individual risk signals fired");
  }

  return {
    risk_score: Number(riskScore.toFixed(2)),
    confidence: FALLBACK_CONFIDENCE,
    reasons,
    recommended_action: riskScore > HOLD_THRESHOLD ? "hold_for_review" : "allow",
  };
}
