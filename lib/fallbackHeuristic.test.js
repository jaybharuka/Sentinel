import { describe, it, expect } from "vitest";
import { fallbackScore } from "./fallbackHeuristic";

const cleanFeatures = {
  disposableEmail: false,
  countryMismatch: false,
  velocityLast10Min: 0,
  previousChargebacks: 0,
  oddHour: false,
  amountVsHistoryRatio: null,
  accountAgeDays: null,
  merchantRecentFraudRate: null,
};

describe("fallbackScore - safety invariant", () => {
  it("never returns recommended_action: auto_refund, even with every risk signal maxed out", () => {
    const worstCase = {
      disposableEmail: true,
      countryMismatch: true,
      velocityLast10Min: 999,
      previousChargebacks: 999,
      oddHour: true,
      amountVsHistoryRatio: 9999,
      accountAgeDays: 0,
      merchantRecentFraudRate: 1,
    };
    const result = fallbackScore(worstCase);
    expect(result.recommended_action).not.toBe("auto_refund");
    expect(["allow", "hold_for_review"]).toContain(result.recommended_action);
  });

  it("never returns auto_refund across a fuzzed sweep of feature combinations", () => {
    const bools = [true, false];
    const numericOptions = [0, 1, 3, 5, 10, 1000];
    for (const disposableEmail of bools) {
      for (const countryMismatch of bools) {
        for (const oddHour of bools) {
          for (const velocityLast10Min of numericOptions) {
            for (const previousChargebacks of numericOptions) {
              const result = fallbackScore({
                disposableEmail,
                countryMismatch,
                oddHour,
                velocityLast10Min,
                previousChargebacks,
                amountVsHistoryRatio: numericOptions[Math.floor(Math.random() * numericOptions.length)],
                accountAgeDays: 0,
                merchantRecentFraudRate: 1,
              });
              expect(result.recommended_action).not.toBe("auto_refund");
            }
          }
        }
      }
    }
  });

  it("risk_score is always clamped to a maximum of 1", () => {
    const result = fallbackScore({
      disposableEmail: true,
      countryMismatch: true,
      velocityLast10Min: 999,
      previousChargebacks: 999,
      oddHour: true,
      amountVsHistoryRatio: 9999,
      accountAgeDays: 0,
      merchantRecentFraudRate: 1,
    });
    expect(result.risk_score).toBeLessThanOrEqual(1);
  });
});

describe("fallbackScore - weighted scoring correctness", () => {
  it("scores a fully clean transaction as 0 risk and allow", () => {
    const result = fallbackScore(cleanFeatures);
    expect(result.risk_score).toBe(0);
    expect(result.recommended_action).toBe("allow");
    expect(result.confidence).toBe(0.5);
  });

  it("adds 0.35 for a disposable email", () => {
    const result = fallbackScore({ ...cleanFeatures, disposableEmail: true });
    expect(result.risk_score).toBe(0.35);
    expect(result.reasons).toContain("Disposable email domain detected");
  });

  it("adds 0.25 for a country mismatch", () => {
    const result = fallbackScore({ ...cleanFeatures, countryMismatch: true });
    expect(result.risk_score).toBe(0.25);
  });

  it("adds 0.25 for velocity > 2 in the last 10 minutes", () => {
    const result = fallbackScore({ ...cleanFeatures, velocityLast10Min: 3 });
    expect(result.risk_score).toBe(0.25);
  });

  it("does not add velocity risk at exactly 2 (strict >)", () => {
    const result = fallbackScore({ ...cleanFeatures, velocityLast10Min: 2 });
    expect(result.risk_score).toBe(0);
  });

  it("adds 0.3 for a prior chargeback", () => {
    const result = fallbackScore({ ...cleanFeatures, previousChargebacks: 1 });
    expect(result.risk_score).toBe(0.3);
  });

  it("adds 0.1 for an odd hour", () => {
    const result = fallbackScore({ ...cleanFeatures, oddHour: true });
    expect(result.risk_score).toBe(0.1);
  });

  it("adds 0.2 for amountVsHistoryRatio > 3", () => {
    const result = fallbackScore({ ...cleanFeatures, amountVsHistoryRatio: 3.5 });
    expect(result.risk_score).toBe(0.2);
  });

  it("does not add ratio risk at exactly 3 (strict >)", () => {
    const result = fallbackScore({ ...cleanFeatures, amountVsHistoryRatio: 3 });
    expect(result.risk_score).toBe(0);
  });

  it("ignores a null amountVsHistoryRatio", () => {
    const result = fallbackScore({ ...cleanFeatures, amountVsHistoryRatio: null });
    expect(result.risk_score).toBe(0);
  });

  it("adds 0.15 when accountAgeDays is exactly 0", () => {
    const result = fallbackScore({ ...cleanFeatures, accountAgeDays: 0 });
    expect(result.risk_score).toBe(0.15);
  });

  it("does not add account-age risk when accountAgeDays is null (no history)", () => {
    const result = fallbackScore({ ...cleanFeatures, accountAgeDays: null });
    expect(result.risk_score).toBe(0);
  });

  it("does not add account-age risk for an established account", () => {
    const result = fallbackScore({ ...cleanFeatures, accountAgeDays: 30 });
    expect(result.risk_score).toBe(0);
  });

  it("adds 0.2 for merchantRecentFraudRate > 0.3", () => {
    const result = fallbackScore({ ...cleanFeatures, merchantRecentFraudRate: 0.5 });
    expect(result.risk_score).toBe(0.2);
  });

  it("stacks multiple signals additively", () => {
    const result = fallbackScore({
      ...cleanFeatures,
      disposableEmail: true,
      countryMismatch: true,
      oddHour: true,
    });
    expect(result.risk_score).toBeCloseTo(0.35 + 0.25 + 0.1, 5);
  });

  it("recommends hold_for_review once risk_score exceeds 0.7", () => {
    const result = fallbackScore({
      ...cleanFeatures,
      disposableEmail: true,
      countryMismatch: true,
      previousChargebacks: 1,
    });
    expect(result.risk_score).toBeCloseTo(0.9, 5);
    expect(result.recommended_action).toBe("hold_for_review");
  });

  it("recommends allow at exactly 0.7 risk_score (strict >)", () => {
    const result = fallbackScore({
      ...cleanFeatures,
      disposableEmail: true,
      velocityLast10Min: 3,
      oddHour: true,
    });
    expect(result.risk_score).toBeCloseTo(0.7, 5);
    expect(result.recommended_action).toBe("allow");
  });

  it("always includes the fallback-used disclaimer as the first reason", () => {
    const result = fallbackScore(cleanFeatures);
    expect(result.reasons[0]).toMatch(/AI scoring unavailable/);
  });

  it("notes when no individual risk signals fired", () => {
    const result = fallbackScore(cleanFeatures);
    expect(result.reasons).toContain("No individual risk signals fired");
  });
});
