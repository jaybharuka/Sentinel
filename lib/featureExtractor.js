import { prisma } from "@/lib/prisma";

const TEN_MINUTES_MS = 10 * 60 * 1000;

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
  } = event;

  const txnTime = new Date(timestamp);
  const windowStart = new Date(txnTime.getTime() - TEN_MINUTES_MS);

  const priorTxns = await prisma.transaction.findMany({
    where: {
      txnId: { not: txnId },
      timestamp: { lt: txnTime },
    },
    select: { amount: true, email: true, timestamp: true, features: true },
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

  return {
    disposableEmail: isDisposableEmail(email),
    countryMismatch: ipCountry !== billingCountry,
    velocityLast10Min,
    amountVsHistoryRatio,
    isNewCustomer: Boolean(isNewCustomer),
    previousChargebacks: previousChargebacks ?? 0,
    oddHour: isOddHour(timestamp),
  };
}
