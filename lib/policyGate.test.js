import { describe, it, expect } from "vitest";
import { applyPolicy } from "./policyGate";

const settings = {
  autoRefundMaxAmount: 2000,
  dailyRefundCap: 10000,
  autoRefundMinRiskScore: 0.9,
  autoRefundMinConfidence: 0.85,
  holdForReviewMinRiskScore: 0.6,
};

function scoring(overrides = {}) {
  return {
    recommended_action: "auto_refund",
    risk_score: 0.95,
    confidence: 0.9,
    ...overrides,
  };
}

describe("applyPolicy - fail-closed validation", () => {
  it("holds for review on NaN risk_score", () => {
    const result = applyPolicy(scoring({ risk_score: NaN }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
    expect(result.reason).toMatch(/fail-closed/);
  });

  it("holds for review on out-of-range risk_score (> 1)", () => {
    const result = applyPolicy(scoring({ risk_score: 1.5 }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on negative risk_score", () => {
    const result = applyPolicy(scoring({ risk_score: -0.1 }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on NaN confidence", () => {
    const result = applyPolicy(scoring({ confidence: NaN }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on out-of-range confidence (> 1)", () => {
    const result = applyPolicy(scoring({ confidence: 1.2 }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on negative transactionAmount", () => {
    const result = applyPolicy(scoring(), -50, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on non-finite transactionAmount", () => {
    const result = applyPolicy(scoring(), Infinity, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on non-finite dailyAuthorizedTotal", () => {
    const result = applyPolicy(scoring(), 100, NaN, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("holds for review on undefined risk_score/confidence rather than falling through to allow", () => {
    const result = applyPolicy(scoring({ risk_score: undefined, confidence: undefined }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });
});

describe("applyPolicy - boundary conditions", () => {
  it("does NOT auto-refund when risk_score is exactly at the min threshold (strict >)", () => {
    const result = applyPolicy(scoring({ risk_score: 0.9 }), 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("auto-refunds when risk_score is just above the min threshold", () => {
    const result = applyPolicy(scoring({ risk_score: 0.9001 }), 100, 0, settings);
    expect(result.decision).toBe("auto_refund");
  });

  it("does NOT auto-refund when confidence is exactly at the min threshold (strict >)", () => {
    const result = applyPolicy(scoring({ confidence: 0.85 }), 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("auto-refunds when confidence is just above the min threshold", () => {
    const result = applyPolicy(scoring({ confidence: 0.8501 }), 100, 0, settings);
    expect(result.decision).toBe("auto_refund");
  });

  it("holds for review when risk_score is exactly at the hold threshold (strict >, so equal falls through to allow)", () => {
    const result = applyPolicy(scoring({ recommended_action: "allow", risk_score: 0.6, confidence: 0.5 }), 100, 0, settings);
    expect(result.decision).toBe("allow");
  });

  it("holds for review when risk_score is just above the hold threshold", () => {
    const result = applyPolicy(scoring({ recommended_action: "allow", risk_score: 0.6001, confidence: 0.5 }), 100, 0, settings);
    expect(result.decision).toBe("hold_for_review");
  });

  it("allows when risk_score is well below the hold threshold", () => {
    const result = applyPolicy(scoring({ recommended_action: "allow", risk_score: 0.1, confidence: 0.5 }), 100, 0, settings);
    expect(result.decision).toBe("allow");
  });

  it("auto-refunds when transactionAmount is exactly at the cap", () => {
    const result = applyPolicy(scoring(), settings.autoRefundMaxAmount, 0, settings);
    expect(result.decision).toBe("auto_refund");
  });

  it("downgrades to hold_for_review when transactionAmount exceeds the cap", () => {
    const result = applyPolicy(scoring(), settings.autoRefundMaxAmount + 1, 0, settings);
    expect(result.decision).toBe("hold_for_review");
    expect(result.reason).toMatch(/exceeds auto-refund cap/);
  });

  it("auto-refunds when the daily total lands exactly at the cap", () => {
    const dailyAuthorizedTotal = settings.dailyRefundCap - 500;
    const result = applyPolicy(scoring(), 500, dailyAuthorizedTotal, settings);
    expect(result.decision).toBe("auto_refund");
  });

  it("downgrades to hold_for_review when the daily budget would be exceeded", () => {
    const dailyAuthorizedTotal = settings.dailyRefundCap - 500;
    const result = applyPolicy(scoring(), 501, dailyAuthorizedTotal, settings);
    expect(result.decision).toBe("hold_for_review");
    expect(result.reason).toMatch(/daily refund budget would be exceeded/);
  });
});

describe("applyPolicy - auto-refund eligibility requires ALL conditions", () => {
  it("requires recommended_action to be auto_refund even if every threshold clears", () => {
    const result = applyPolicy(scoring({ recommended_action: "hold_for_review" }), 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("is eligible when every condition passes", () => {
    const result = applyPolicy(scoring(), 100, 0, settings);
    expect(result.decision).toBe("auto_refund");
  });

  it("fails when only risk_score condition fails, all else passing", () => {
    const result = applyPolicy(scoring({ risk_score: 0.5 }), 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("fails when only confidence condition fails, all else passing", () => {
    const result = applyPolicy(scoring({ confidence: 0.1 }), 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("fails when only amount condition fails, all else passing", () => {
    const result = applyPolicy(scoring(), settings.autoRefundMaxAmount + 100, 0, settings);
    expect(result.decision).not.toBe("auto_refund");
  });

  it("fails when only the daily budget condition fails, all else passing", () => {
    const result = applyPolicy(scoring(), 100, settings.dailyRefundCap, settings);
    expect(result.decision).not.toBe("auto_refund");
  });
});

describe("applyPolicy - purity / no side effects", () => {
  it("does not mutate its inputs", () => {
    const input = scoring();
    const inputCopy = { ...input };
    const settingsCopy = { ...settings };
    applyPolicy(input, 100, 0, settings);
    expect(input).toEqual(inputCopy);
    expect(settings).toEqual(settingsCopy);
  });

  it("is deterministic - same inputs produce the same output", () => {
    const a = applyPolicy(scoring(), 100, 0, settings);
    const b = applyPolicy(scoring(), 100, 0, settings);
    expect(a).toEqual(b);
  });
});
