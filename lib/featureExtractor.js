import { prisma } from "@/lib/prisma";

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.biz",
  "10minutemail.com",
  "10minutemail.net",
  "throwaway.email",
  "throwawaymail.com",
  "yopmail.com",
  "getnada.com",
  "trashmail.com",
  "fakeinbox.com",
  "sharklasers.com",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
]);

function isDisposableEmail(email) {
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}

function isOddHour(timestamp) {
  const hour = new Date(timestamp).getHours();
  return hour >= 1 && hour < 5;
}

function belongsToSameCustomer(pastTxn, { email, customerId }) {
  const pastCustomerId = pastTxn.features?.customerId;
  if (customerId && pastCustomerId && pastCustomerId === customerId) return true;
  return pastTxn.email === email;
}

/**
 * Computes deterministic risk features for a mock payment event by
 * combining the event's own fields with prior-transaction history
 * pulled from the audit-trail database.
 */
export async function extractFeatures(event) {
  const {
    txnId,
    amount,
    email,
    ipCountry,
    billingCountry,
    customerId,
    timestamp,
    isNewCustomer,
    previousChargebacks,
    merchantId,
    cardBin,
  } = event;

  const txnTime = new Date(timestamp);
  const windowStart = new Date(txnTime.getTime() - TEN_MINUTES_MS);
  const dayStart = new Date(txnTime.getTime() - ONE_DAY_MS);

  // Scoped to this merchant - one merchant's fraud signals must never be
  // computed from another merchant's customer history.
  const priorTxns = await prisma.transaction.findMany({
    where: {
      merchantId,
      txnId: { not: txnId },
      timestamp: { lt: txnTime },
    },
    select: { amount: true, email: true, timestamp: true, features: true, policyDecision: true },
  });

  const sameCustomerTxns = priorTxns.filter((t) =>
    belongsToSameCustomer(t, { email, customerId })
  );

  const velocityLast10Min = sameCustomerTxns.filter(
    (t) => t.timestamp >= windowStart && t.timestamp < txnTime
  ).length;

  const customerHistory = customerId
    ? priorTxns.filter((t) => t.features?.customerId === customerId)
    : [];

  const amountVsHistoryRatio =
    customerHistory.length > 0
      ? amount /
        (customerHistory.reduce((sum, t) => sum + t.amount, 0) /
          customerHistory.length)
      : null;

  // Vulcan-style customer-trust signals - same merchant-scoped sameCustomerTxns
  // set velocityLast10Min already uses (customerId match, or email match when
  // customerId is absent, e.g. real Razorpay payments without a linked contact).
  const accountAgeDays =
    sameCustomerTxns.length > 0
      ? Math.floor(
          (txnTime.getTime() - Math.min(...sameCustomerTxns.map((t) => t.timestamp.getTime()))) /
            ONE_DAY_MS
        )
      : null;

  const customerLifetimeTransactionCount = sameCustomerTxns.length;

  const customerHistoricalSuccessRate =
    sameCustomerTxns.length > 0
      ? Number(
          (
            sameCustomerTxns.filter((t) => t.policyDecision === "allow").length /
            sameCustomerTxns.length
          ).toFixed(2)
        )
      : null;

  // Merchant-wide signal (not customer-scoped) - is this merchant currently
  // seeing an unusually flagged-heavy day across all its customers.
  const recentMerchantTxns = await prisma.transaction.findMany({
    where: { merchantId, txnId: { not: txnId }, timestamp: { gte: dayStart, lt: txnTime } },
    select: { policyDecision: true },
  });
  const merchantRecentFraudRate =
    recentMerchantTxns.length > 0
      ? Number(
          (
            recentMerchantTxns.filter(
              (t) => t.policyDecision === "hold_for_review" || t.policyDecision === "auto_refund"
            ).length / recentMerchantTxns.length
          ).toFixed(2)
        )
      : null;

  // No real BIN database in this timeframe - kept honest rather than faking
  // a lookup: a real deployment would categorize by actual issuer/network
  // risk tier, this only flags whether a BIN was captured at all.
  const cardBinRiskCategory = cardBin ? "provided" : "unknown";

  return {
    disposableEmail: isDisposableEmail(email),
    countryMismatch: ipCountry !== billingCountry,
    velocityLast10Min,
    amountVsHistoryRatio,
    isNewCustomer: Boolean(isNewCustomer),
    previousChargebacks: previousChargebacks ?? 0,
    oddHour: isOddHour(timestamp),
    accountAgeDays,
    customerLifetimeTransactionCount,
    customerHistoricalSuccessRate,
    merchantRecentFraudRate,
    cardBinRiskCategory,
  };
}
