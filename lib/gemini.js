import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// gemini-2.0-flash was retired by Google. gemini-2.5-flash is current but
// the free tier caps it at 20 requests/day, which a demo blows through in
// minutes. gemini-3.5-flash-lite has no such quota wall on the same key and
// is fast in practice (sub-second to a few seconds for the large majority
// of calls, with an occasional slow-tail request that legitimately exceeds
// the timeout below and exercises the fallback path).
const MODEL_NAME = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 8000;

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

/**
 * Calls Gemini with the deterministic feature set for one transaction and
 * returns its structured risk assessment. Throws on timeout, API failure,
 * or a malformed response so the caller can fall back to the rule-based
 * heuristic scorer.
 */
export async function scoreTransaction(features) {
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

  const result = await withTimeout(
    model.generateContent(buildPrompt(features)),
    TIMEOUT_MS
  );

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
