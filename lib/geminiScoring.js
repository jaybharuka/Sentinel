import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

// Third failover tier, behind Groq primary and Groq secondary (see
// lib/aiScoring.js) - a genuinely separate account/quota pool from before
// the Groq migration, not a duplicate of either Groq key. gemini-2.0-flash
// was retired by Google; gemini-2.5-flash's free tier caps at 20
// requests/day; gemini-3.5-flash-lite's free tier caps at 15
// requests/MINUTE instead (confirmed via the real 429 body: quotaId
// GenerateRequestsPerMinutePerProjectPerModel-FreeTier) - a real ceiling,
// not a bug, same as documented in the pre-migration history of this file
// (see lib/gemini.js in git history before the Groq switch).
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

// Same prompt content/shape as lib/aiScoring.js's buildPrompt (kept as a
// separate copy rather than a shared import since Gemini and Groq use
// different response-format mechanisms - Gemini's structured schema vs
// Groq's json_object mode - so the two call sites were always going to
// diverge below the prompt text anyway). Update both together if the
// signal set or its glossary changes again.
function buildPrompt(features, promptOptions = {}) {
  const reducedNote = promptOptions.reducedSignalSet
    ? `\nIMPORTANT CONTEXT: this transaction has a reduced feature set - only "amount" and a time-derived "oddHour" signal are available. This is a real, independently-labeled public benchmark dataset (not our production system), so the other signals genuinely don't exist for it - there is no customer, email, or merchant history to compute them from. Do not comment on which signals are missing or treat their absence as suspicious; just assess risk from what's actually provided.\n`
    : "";

  const signalGlossary = promptOptions.reducedSignalSet
    ? ""
    : `
Some signals are less self-explanatory than others:
- accountAgeDays: days since this customer's first transaction we've ever seen, null if this is their first
- customerLifetimeTransactionCount: how many prior transactions this customer has with us
- customerHistoricalSuccessRate: fraction of this customer's past transactions that were cleanly allowed (0-1), null if no history
- merchantRecentFraudRate: fraction of this MERCHANT's transactions (across all customers) in the last 24h that were flagged for review or refunded (0-1), null if no recent volume - a merchant-wide signal, not specific to this customer
- cardBinRiskCategory: "provided" or "unknown" - whether a card BIN was captured at all (no real BIN risk database is integrated, so this is only a presence check, not an issuer risk score)
`;

  return `You are a fraud risk analyst reviewing e-commerce transaction signals for a payments platform.
${reducedNote}
You are given the following deterministically computed signals for one transaction:
${JSON.stringify(features, null, 2)}
${signalGlossary}
Assess the fraud risk of this transaction. Your "reasons" must be specific and must
reference the actual values given above (e.g. cite the exact velocity count, the
exact chargeback count, the exact amount-vs-history ratio) — do not write generic
statements like "this transaction looks suspicious" without tying it to a signal
value from the input. If a signal is absent or benign (e.g. disposableEmail is
false, or a signal is null due to no history), do not fabricate a reason for it.

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

// Same classification categories as lib/aiScoring.js's classifyScoringError
// (rate_limit/timeout/overloaded/other), so the caller's failover decision
// logic can treat both providers identically - "quota" here is renamed to
// "rate_limit" to match that shared vocabulary.
function classifyGeminiError(err) {
  const status = err?.status;
  const message = String(err?.message || err);
  if (status === 429 || /quota exceeded/i.test(message)) return "rate_limit";
  if (/timed out/i.test(message)) return "timeout";
  if (status === 503 || /overloaded|unavailable/i.test(message)) return "overloaded";
  return "other";
}

async function callGemini(features, timeoutMs, promptOptions) {
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
    model.generateContent(buildPrompt(features, promptOptions)),
    timeoutMs
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

/**
 * Calls Gemini with the deterministic feature set for one transaction and
 * returns its structured risk assessment. Throws (tagged with .errorType)
 * on timeout, API failure, or a malformed response, so lib/aiScoring.js's
 * scoreTransaction() can fall through to the next tier.
 *
 * A transient-looking failure (timeout, 503/overloaded) gets one retry
 * after a short backoff before giving up - a rate-limit/quota error does
 * not, since Gemini's per-minute counter won't have reset in 500ms and
 * retrying just adds latency before the same inevitable failure. Same
 * one-retry-per-provider shape as Groq's scoreWithKey in lib/aiScoring.js.
 */
export async function scoreWithGemini(features, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const promptOptions = { reducedSignalSet: Boolean(options.reducedSignalSet) };

  try {
    const result = await callGemini(features, timeoutMs, promptOptions);
    console.warn("AI scoring call succeeded (key=gemini)");
    return { ...result, provider: "gemini" };
  } catch (err) {
    const errorType = classifyGeminiError(err);

    if (errorType === "rate_limit") {
      console.warn(`AI scoring call failed (rate limit, key=gemini) - not retrying same key: ${err.message}`);
      throw Object.assign(err, { errorType });
    }

    console.warn(`AI scoring call failed (${errorType}, key=gemini) - retrying once after ${RETRY_BACKOFF_MS}ms: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));

    try {
      const result = await callGemini(features, timeoutMs, promptOptions);
      console.warn("AI scoring retry succeeded (key=gemini)");
      return { ...result, provider: "gemini" };
    } catch (err2) {
      const errorType2 = classifyGeminiError(err2);
      console.warn(`AI scoring retry also failed (${errorType2}, key=gemini): ${err2.message}`);
      throw Object.assign(err2, { errorType: errorType2 });
    }
  }
}
