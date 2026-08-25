import {
  History,
  ListOrdered,
  BadgeCheck,
  Gauge,
  TrendingUp,
  MoonStar,
  UserPlus,
  MailWarning,
  MapPinOff,
  CreditCard,
  Building2,
  AlertTriangle,
} from "lucide-react";

// The 12 signals lib/featureExtractor.js computes, grouped for display.
// This is the single source of truth for how they're presented across the
// dashboard: the static "Risk Signals" reference panel, the per-row
// "N flagged" badge in the transactions table, and the expanded row's
// labeled signal grid all read from this file.
export const SIGNAL_CATEGORIES = [
  { key: "customer_history", label: "Customer History", Icon: History },
  { key: "transaction_pattern", label: "Transaction Pattern", Icon: Gauge },
  { key: "identity_location", label: "Identity & Location", Icon: MapPinOff },
  { key: "payment_method", label: "Payment Method", Icon: CreditCard },
  { key: "merchant_context", label: "Merchant Context", Icon: Building2 },
  { key: "prior_disputes", label: "Prior Disputes", Icon: AlertTriangle },
];

// `contributed` is a display-only heuristic answering "did this raw signal
// look risky on this transaction" - it's independent of what the real
// scorer actually weighted. The AI model's own attribution isn't exposed as
// structured per-signal weights, and lib/fallbackHeuristic.js's weights only
// cover a subset of these 12 - so this is a separate, honest approximation
// for the UI, roughly mirroring the fallback heuristic's thresholds where
// one exists.
export const SIGNAL_DEFS = [
  {
    key: "accountAgeDays",
    category: "customer_history",
    label: "Account age",
    Icon: History,
    blurb: "Days since this customer's first-ever transaction with this merchant.",
    describe: (v) => (v == null ? "first-ever transaction" : `${v} day${v === 1 ? "" : "s"} old`),
    contributed: (f) => f.accountAgeDays === 0,
  },
  {
    key: "customerLifetimeTransactionCount",
    category: "customer_history",
    label: "Lifetime transactions",
    Icon: ListOrdered,
    blurb: "Total prior transactions from this customer.",
    describe: (v) => `${v ?? 0} prior transaction${v === 1 ? "" : "s"}`,
    contributed: (f) => f.customerLifetimeTransactionCount === 0,
  },
  {
    key: "customerHistoricalSuccessRate",
    category: "customer_history",
    label: "Historical success rate",
    Icon: BadgeCheck,
    blurb: "Share of this customer's past transactions that were cleanly allowed.",
    describe: (v) => (v == null ? "no history" : `${(v * 100).toFixed(0)}% clean`),
    contributed: (f) =>
      f.customerHistoricalSuccessRate != null && f.customerHistoricalSuccessRate < 0.5,
  },
  {
    key: "velocityLast10Min",
    category: "transaction_pattern",
    label: "Velocity (10 min)",
    Icon: Gauge,
    blurb: "Transactions from this same customer in the last 10 minutes.",
    describe: (v) => `${v ?? 0} txn${v === 1 ? "" : "s"} in last 10 min`,
    contributed: (f) => (f.velocityLast10Min ?? 0) > 2,
  },
  {
    key: "amountVsHistoryRatio",
    category: "transaction_pattern",
    label: "Amount vs. history",
    Icon: TrendingUp,
    blurb: "This transaction's amount vs. this customer's historical average.",
    describe: (v) => (v == null ? "no history to compare" : `${v.toFixed(1)}x average`),
    contributed: (f) => f.amountVsHistoryRatio != null && f.amountVsHistoryRatio > 3,
  },
  {
    key: "oddHour",
    category: "transaction_pattern",
    label: "Odd-hour timing",
    Icon: MoonStar,
    blurb: "Whether the transaction occurred between 1am and 5am.",
    describe: (v) => (v ? "1am–5am" : "normal hours"),
    contributed: (f) => Boolean(f.oddHour),
  },
  {
    key: "isNewCustomer",
    category: "transaction_pattern",
    label: "New customer flag",
    Icon: UserPlus,
    blurb: "Whether the merchant reports this as a first-time customer.",
    describe: (v) => (v ? "self-reported new" : "returning"),
    contributed: (f) => Boolean(f.isNewCustomer),
  },
  {
    key: "disposableEmail",
    category: "identity_location",
    label: "Disposable email",
    Icon: MailWarning,
    blurb: "Whether the email domain is a known disposable/throwaway provider.",
    describe: (v) => (v ? "disposable domain" : "standard domain"),
    contributed: (f) => Boolean(f.disposableEmail),
  },
  {
    key: "countryMismatch",
    category: "identity_location",
    label: "Country mismatch",
    Icon: MapPinOff,
    blurb: "Whether the IP country differs from the billing country.",
    describe: (v) => (v ? "IP ≠ billing country" : "IP matches billing"),
    contributed: (f) => Boolean(f.countryMismatch),
  },
  {
    key: "cardBinRiskCategory",
    category: "payment_method",
    label: "Card BIN",
    Icon: CreditCard,
    blurb: "Whether a card BIN was captured at all (presence check only - no live issuer risk database in this build).",
    describe: (v) => (v === "unknown" ? "not captured" : "captured"),
    contributed: (f) => f.cardBinRiskCategory === "unknown",
  },
  {
    key: "merchantRecentFraudRate",
    category: "merchant_context",
    label: "Merchant 24h fraud rate",
    Icon: Building2,
    blurb: "Share of this merchant's transactions, across all customers, in the last 24h that were flagged or refunded.",
    describe: (v) => (v == null ? "no recent volume" : `${(v * 100).toFixed(0)}% flagged`),
    contributed: (f) => f.merchantRecentFraudRate != null && f.merchantRecentFraudRate > 0.3,
  },
  {
    key: "previousChargebacks",
    category: "prior_disputes",
    label: "Prior chargebacks",
    Icon: AlertTriangle,
    blurb: "Chargebacks already on record for this customer.",
    describe: (v) => `${v ?? 0} on record`,
    contributed: (f) => (f.previousChargebacks ?? 0) > 0,
  },
];

export function countContributedSignals(features) {
  if (!features) return 0;
  return SIGNAL_DEFS.filter((def) => def.contributed(features)).length;
}
