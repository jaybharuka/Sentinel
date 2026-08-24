import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// gemini-2.0-flash was retired by Google. gemini-2.5-flash's free tier caps
// at 20 requests/day. gemini-3.5-flash-lite's free tier caps at 15
// requests/MINUTE instead (confirmed via the real 429 body: quotaId
// GenerateRequestsPerMinutePerProjectPerModel-FreeTier) - fine for isolated
// real-time calls, but a burst (seeding, several demo clicks close
// together) blows through it fast. This is a genuine free-tier ceiling,
// not a bug - see the retry/classification logic below and the billing
// note in docs/PROJECT_REVIEW.md.
const MODEL_NAME = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = 500;

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    risk_score: {
      type: SchemaType.NUMBER,
      description: "Fraud risk score between 0 (no risk) and 1 (certain fraud).",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence in this assessment between 0 and 1.",
    },
    reasons: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "Plain-English reasons citing the actual signal values provided, not generic statements.",
    },
    recommended_action: {
      type: SchemaType.STRING,
      enum: ["allow", "hold_for_review", "auto_refund"],
      description: "The recommended next action for this transaction.",
    },
  },
  required: ["risk_score", "confidence", "reasons", "recommended_action"],
};

function buildPrompt(features) {
  return `You are a fraud risk analyst reviewing e-commerce transaction signals for a payments platform.

You are given the following deterministically computed signals for one transaction:
${JSON.stringify(features, null, 2)}

Assess the fraud risk of this transaction. Your "reasons" must be specific and must
reference the actual values given above (e.g. cite the exact velocity count, the
exact chargeback count, the exact amount-vs-history ratio) — do not write generic
statements like "this transaction looks suspicious" without tying it to a signal
value from the input. If a signal is absent or benign (e.g. disposableEmail is
false), do not fabricate a reason for it.

Respond with strict JSON matching the required schema only.`;
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Gemini call timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// Distinguishes "will definitely fail again immediately" (quota - the
// per-minute counter isn't going to reset in 500ms) from "might well
// succeed on a second try" (a transient overload or a slow response that
// tripped our own timeout). Retrying a quota error is pointless and just
// adds latency before the inevitable fallback.
function classifyGeminiError(err) {
  const status = err?.status;
  const message = String(err?.message || err);
  if (status === 429 || /quota exceeded/i.test(message)) return "quota";
  if (/timed out/i.test(message)) return "timeout";
  if (status === 503 || /overloaded|unavailable/i.test(message)) return "overloaded";
  return "other";
}

async function callGemini(features, timeoutMs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const result = await withTimeout(model.generateContent(buildPrompt(features)), timeoutMs);

  const rawText = result.response.text();
  const cleanedText = stripCodeFences(rawText);

  let parsed;
  try {
    parsed = JSON.parse(cleanedText);
  } catch {
    throw new Error(`Gemini returned malformed JSON: ${rawText}`);
  }

  const { risk_score, confidence, reasons, recommended_action } = parsed;

  const validActions = ["allow", "hold_for_review", "auto_refund"];
  if (
    typeof risk_score !== "number" ||
    typeof confidence !== "number" ||
    !Array.isArray(reasons) ||
    !validActions.includes(recommended_action)
  ) {
    throw new Error(`Gemini response failed shape validation: ${cleanedText}`);
  }

  return { risk_score, confidence, reasons, recommended_action };
}

/**
 * Calls Gemini with the deterministic feature set for one transaction and
 * returns its structured risk assessment. Throws on timeout, API failure,
 * or a malformed response so the caller can fall back to the rule-based
 * heuristic scorer.
 *
 * A transient-looking failure (timeout, 503/overloaded) gets one retry
 * after a short backoff before giving up - a quota error does not, since
 * the per-minute counter won't have reset in 500ms and retrying just adds
 * latency before the same inevitable failure.
 *
 * options.timeoutMs is a testability hook only (see the retry test in
 * app/api/transactions/[id]/retry-gemini/route.js) - no real caller passes
 * it, so real behavior is unchanged.
 */
export async function scoreTransaction(features, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  try {
    return await callGemini(features, timeoutMs);
  } catch (err) {
    const errorType = classifyGeminiError(err);

    if (errorType === "quota") {
      console.warn(`Gemini call failed (quota) - not retrying, falling back: ${err.message}`);
      throw err;
    }

    console.warn(`Gemini call failed (${errorType}) - retrying once after ${RETRY_BACKOFF_MS}ms: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));

    try {
      return await callGemini(features, timeoutMs);
    } catch (err2) {
      console.warn(`Gemini retry also failed (${classifyGeminiError(err2)}) - falling back: ${err2.message}`);
      throw err2;
    }
  }
}
