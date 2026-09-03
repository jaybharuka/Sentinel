import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const scoreWithGeminiMock = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function OpenAIMock() {
    this.chat = { completions: { create: createMock } };
  }),
}));

vi.mock("./geminiScoring", () => ({
  scoreWithGemini: scoreWithGeminiMock,
}));

const features = { amount: 500, oddHour: false };

function chatResponse(body) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

const validScore = {
  risk_score: 0.2,
  confidence: 0.8,
  reasons: ["low risk"],
  recommended_action: "allow",
};

function rateLimitError() {
  return Object.assign(new Error("rate limit exceeded"), { status: 429 });
}

function timeoutError() {
  return new Error("simulated timed out failure");
}

beforeEach(() => {
  vi.resetModules();
  createMock.mockReset();
  scoreWithGeminiMock.mockReset();
  process.env.GROQ_API_KEY = "groq-primary-key";
  process.env.GROQ_API_KEY_SECONDARY = "groq-secondary-key";
  process.env.GEMINI_API_KEY = "gemini-key";
});

describe("scoreTransaction - primary success short-circuits", () => {
  it("returns the primary Groq result without calling secondary or Gemini", async () => {
    createMock.mockResolvedValue(chatResponse(validScore));
    const { scoreTransaction } = await import("./aiScoring");

    const result = await scoreTransaction(features);

    expect(result).toMatchObject({ ...validScore, provider: "groq-primary" });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(scoreWithGeminiMock).not.toHaveBeenCalled();
  });
});

describe("scoreTransaction - quota failover chain", () => {
  it("falls to the secondary Groq key when the primary hits a rate limit", async () => {
    createMock
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce(chatResponse(validScore));
    const { scoreTransaction } = await import("./aiScoring");

    const result = await scoreTransaction(features);

    expect(result).toMatchObject({ ...validScore, provider: "groq-secondary" });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(scoreWithGeminiMock).not.toHaveBeenCalled();
  });

  it("falls to Gemini when both Groq keys are rate limited", async () => {
    createMock.mockRejectedValue(rateLimitError());
    scoreWithGeminiMock.mockResolvedValue({ ...validScore, provider: "gemini" });
    const { scoreTransaction } = await import("./aiScoring");

    const result = await scoreTransaction(features);

    expect(result).toMatchObject({ ...validScore, provider: "gemini" });
    expect(scoreWithGeminiMock).toHaveBeenCalledTimes(1);
  });

  it("falls through to the caller (for the rule-based heuristic) when Groq and Gemini all fail on quota", async () => {
    createMock.mockRejectedValue(rateLimitError());
    scoreWithGeminiMock.mockRejectedValue(Object.assign(new Error("gemini quota exceeded"), { errorType: "rate_limit" }));
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow(/gemini quota exceeded/);
  });

  it("skips Gemini entirely when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    createMock.mockRejectedValue(rateLimitError());
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow();
    expect(scoreWithGeminiMock).not.toHaveBeenCalled();
  });
});

describe("scoreTransaction - non-quota failures do not cascade across tiers", () => {
  it("a primary timeout retries once on the same key, then throws without trying secondary or Gemini", async () => {
    createMock.mockRejectedValue(timeoutError());
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    // One initial attempt + one retry on the primary key only.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(scoreWithGeminiMock).not.toHaveBeenCalled();
  });

  it("a primary timeout that succeeds on retry returns the primary result", async () => {
    createMock
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(chatResponse(validScore));
    const { scoreTransaction } = await import("./aiScoring");

    const result = await scoreTransaction(features, { timeoutMs: 50 });

    expect(result).toMatchObject({ ...validScore, provider: "groq-primary" });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("a malformed JSON response is treated as a non-quota failure and does not cascade to secondary", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow(/malformed JSON/);
    // One initial attempt + one retry, both against the primary key.
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a response with no message content", async () => {
    createMock.mockResolvedValue({ choices: [{ message: {} }] });
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow(/had no content/);
  });

  it("rejects a response that fails shape validation (e.g. an invalid recommended_action)", async () => {
    createMock.mockResolvedValue(chatResponse({ ...validScore, recommended_action: "not_a_real_action" }));
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow(/failed shape validation/);
  });
});

describe("scoreTransaction - configuration", () => {
  it("throws immediately if GROQ_API_KEY is not set", async () => {
    delete process.env.GROQ_API_KEY;
    const { scoreTransaction } = await import("./aiScoring");

    await expect(scoreTransaction(features)).rejects.toThrow(/GROQ_API_KEY is not set/);
    expect(createMock).not.toHaveBeenCalled();
  });
});
