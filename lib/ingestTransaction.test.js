import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const updateMock = vi.fn();
const aggregateMock = vi.fn();
const extractFeaturesMock = vi.fn();
const scoreTransactionMock = vi.fn();
const executeRefundMock = vi.fn();
const sendAlertMock = vi.fn();
const getMerchantSettingsMock = vi.fn();
const withMerchantLockMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      create: createMock,
      update: updateMock,
      aggregate: aggregateMock,
    },
  },
}));

vi.mock("@/lib/featureExtractor", () => ({
  extractFeatures: extractFeaturesMock,
}));

vi.mock("@/lib/aiScoring", () => ({
  scoreTransaction: scoreTransactionMock,
}));

vi.mock("@/lib/refundExecutor", () => ({
  executeRefund: executeRefundMock,
}));

vi.mock("@/lib/alerting", () => ({
  sendAlert: sendAlertMock,
}));

vi.mock("@/lib/merchantSettings", () => ({
  getMerchantSettings: getMerchantSettingsMock,
  DEFAULT_MERCHANT_ID: "default_merchant",
}));

// Real class definition (not a bare mock fn) so `instanceof` checks inside
// ingestTransaction.js work correctly against errors thrown from the mocked
// withMerchantLock implementation.
class LockAcquisitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockAcquisitionError";
  }
}

vi.mock("@/lib/merchantLock", () => ({
  withMerchantLock: withMerchantLockMock,
  LockAcquisitionError,
}));

const SETTINGS = {
  autoRefundMaxAmount: 2000,
  dailyRefundCap: 10000,
  autoRefundMinRiskScore: 0.9,
  autoRefundMinConfidence: 0.85,
  holdForReviewMinRiskScore: 0.6,
};

const AUTO_REFUND_SCORE = {
  risk_score: 0.95,
  confidence: 0.9,
  reasons: ["high risk"],
  recommended_action: "auto_refund",
  provider: "groq-primary",
};

function baseEvent(overrides = {}) {
  return {
    txnId: "txn_1",
    amount: 500,
    currency: "INR",
    email: "buyer@example.com",
    ipCountry: "IN",
    billingCountry: "IN",
    customerId: "cust_1",
    timestamp: new Date("2026-06-01T10:00:00Z").toISOString(),
    cardBin: "411111",
    source: "razorpay_live",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  createMock.mockReset();
  updateMock.mockReset();
  aggregateMock.mockReset();
  extractFeaturesMock.mockReset();
  scoreTransactionMock.mockReset();
  executeRefundMock.mockReset();
  sendAlertMock.mockReset();
  getMerchantSettingsMock.mockReset();
  withMerchantLockMock.mockReset();

  extractFeaturesMock.mockResolvedValue({ disposableEmail: false });
  getMerchantSettingsMock.mockResolvedValue(SETTINGS);
  aggregateMock.mockResolvedValue({ _sum: { amount: 0 } });
  createMock.mockImplementation(async ({ data }) => ({ id: "row_1", ...data }));
  updateMock.mockImplementation(async ({ data }) => ({ id: "row_1", ...data }));
  scoreTransactionMock.mockResolvedValue(AUTO_REFUND_SCORE);
  executeRefundMock.mockResolvedValue({ success: true, refundId: "rfnd_1", status: "processed" });
  sendAlertMock.mockResolvedValue(undefined);
  // Default: run the critical section under the "lock" with no contention.
  withMerchantLockMock.mockImplementation(async (merchantId, fn) => fn());
});

describe("ingestTransaction - source-based gating", () => {
  it.each(["demo_simulated", "synthetic"])(
    "never triggers a real refund or alert for source=%s, even when policy decides auto_refund",
    async (source) => {
      const { ingestTransaction } = await import("./ingestTransaction");

      await ingestTransaction(baseEvent({ source }));

      expect(executeRefundMock).not.toHaveBeenCalled();
      expect(sendAlertMock).not.toHaveBeenCalled();
    }
  );

  it("does execute a real refund and send an alert for source=razorpay_live with an auto_refund decision", async () => {
    const { ingestTransaction } = await import("./ingestTransaction");

    await ingestTransaction(baseEvent({ source: "razorpay_live" }));

    expect(executeRefundMock).toHaveBeenCalledWith("txn_1", 50000);
    expect(sendAlertMock).toHaveBeenCalledTimes(1);
  });

  it("does not alert for a razorpay_live 'allow' decision", async () => {
    scoreTransactionMock.mockResolvedValue({
      risk_score: 0.1,
      confidence: 0.9,
      reasons: ["fine"],
      recommended_action: "allow",
      provider: "groq-primary",
    });
    const { ingestTransaction } = await import("./ingestTransaction");

    await ingestTransaction(baseEvent({ source: "razorpay_live" }));

    expect(executeRefundMock).not.toHaveBeenCalled();
    expect(sendAlertMock).not.toHaveBeenCalled();
  });
});

describe("ingestTransaction - merchant-scoped daily budget aggregate", () => {
  it("aggregates only this merchant's razorpay_live auto_refund decisions for the transaction's own day", async () => {
    const event = baseEvent({ merchantId: "merchant_A", source: "razorpay_live" });
    const { ingestTransaction, startOfDay, endOfDay } = await import("./ingestTransaction");

    await ingestTransaction(event);

    expect(aggregateMock).toHaveBeenCalledTimes(1);
    const call = aggregateMock.mock.calls[0][0];
    expect(call.where.merchantId).toBe("merchant_A");
    expect(call.where.actionTaken).toBe("auto_refund");
    expect(call.where.source).toBe("razorpay_live");
    expect(call.where.timestamp.gte).toEqual(startOfDay(event.timestamp));
    expect(call.where.timestamp.lte).toEqual(endOfDay(event.timestamp));
  });

  it("downgrades to hold_for_review when the daily total plus this amount would exceed the cap", async () => {
    aggregateMock.mockResolvedValue({ _sum: { amount: SETTINGS.dailyRefundCap - 100 } });
    const { ingestTransaction } = await import("./ingestTransaction");

    const { saved } = await ingestTransaction(baseEvent({ amount: 500, source: "razorpay_live" }));

    expect(saved.policyDecision).toBe("hold_for_review");
    expect(executeRefundMock).not.toHaveBeenCalled();
  });
});

describe("ingestTransaction - distributed lock", () => {
  it("wraps the daily-total read and the decision/create under withMerchantLock", async () => {
    const { ingestTransaction } = await import("./ingestTransaction");

    await ingestTransaction(baseEvent({ merchantId: "merchant_B" }));

    expect(withMerchantLockMock).toHaveBeenCalledTimes(1);
    expect(withMerchantLockMock.mock.calls[0][0]).toBe("merchant_B");
    // The lock's callback is what actually performs the aggregate + create -
    // both must have run as a result of withMerchantLock invoking it.
    expect(aggregateMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("downgrades an auto_refund decision to hold_for_review, without a real refund, when the lock cannot be acquired", async () => {
    withMerchantLockMock.mockRejectedValue(new LockAcquisitionError("Redis unreachable"));
    const { ingestTransaction } = await import("./ingestTransaction");

    const { saved } = await ingestTransaction(baseEvent({ source: "razorpay_live" }));

    expect(saved.policyDecision).toBe("hold_for_review");
    expect(saved.reasons.some((r) => r.includes("downgraded from auto_refund"))).toBe(true);
    expect(executeRefundMock).not.toHaveBeenCalled();
    // The daily-budget aggregate is skipped entirely on the degraded path -
    // there's no safe read to act on without the lock.
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  it("propagates a non-lock error from inside the critical section instead of silently retrying", async () => {
    withMerchantLockMock.mockImplementation(async () => {
      throw new Error("unexpected database error");
    });
    const { ingestTransaction } = await import("./ingestTransaction");

    await expect(ingestTransaction(baseEvent())).rejects.toThrow("unexpected database error");
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("ingestTransaction - AI scoring failure falls back to the rule-based heuristic", () => {
  it("uses fallbackScore and records the error when scoreTransaction throws", async () => {
    scoreTransactionMock.mockRejectedValue(new Error("all providers exhausted"));
    const { ingestTransaction } = await import("./ingestTransaction");

    const result = await ingestTransaction(baseEvent({ source: "razorpay_live" }));

    expect(result.usedFallback).toBe(true);
    expect(result.scoringError).toBe("all providers exhausted");
    expect(result.saved.provider).toBe("fallback");
    // The fallback heuristic can never recommend auto_refund - see
    // lib/fallbackHeuristic.test.js - so no real refund should fire here.
    expect(executeRefundMock).not.toHaveBeenCalled();
  });
});
