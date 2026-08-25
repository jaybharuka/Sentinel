import OpenAI from "openai";

// Groq's free tier: no billing/card required, and rate limits are far
// higher than Gemini's 15 requests/minute free-tier ceiling (see the old
// lib/gemini.js history in git for that saga). Groq exposes an
// OpenAI-compatible API, so the official `openai` SDK works unmodified
// pointed at Groq's base URL - no Groq-specific SDK needed.
//
// Model list verified directly against Groq's live /v1/models endpoint at
// migration time (llama-3.3-70b-versatile, which older docs/training data
// may reference, was not present). openai/gpt-oss-120b was tried first as
// the strongest general-purpose reasoning model on the free tier, but its
// free-tier bucket is a ~200k-tokens/day cap that a few hundred requests
// exhausts (confirmed via a live 400-row seed run and the model's
// x-ratelimit-reset-requests header, which reported a 6+ hour reset once
// drained). openai/gpt-oss-20b's bucket resets in under two minutes at the
// same request volume (checked the same way), so it's used instead - still
// a real reasoning model, just without the daily wall.
const MODEL_NAME = "openai/gpt-oss-20b";
const TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = 500;

function buildPrompt(features) {
  return `You are a fraud risk analyst reviewing e-commerce transaction signals for a payments platform.

You are given the following deterministically computed signals for one transaction:
${JSON.stringify(features, null, 2)}

Some signals are less self-explanatory than others:
- accountAgeDays: days since this customer's first transaction we've ever seen, null if this is their first
- customerLifetimeTransactionCount: how many prior transactions this customer has with us
- customerHistoricalSuccessRate: fraction of this customer's past transactions that were cleanly allowed (0-1), null if no history
- merchantRecentFraudRate: fraction of this MERCHANT's transactions (across all customers) in the last 24h that were flagged for review or refunded (0-1), null if no recent volume - a merchant-wide signal, not specific to this customer
- cardBinRiskCategory: "provided" or "unknown" - whether a card BIN was captured at all (no real BIN risk database is integrated, so this is only a presence check, not an issuer risk score)

Assess the fraud risk of this transaction. Your "reasons" must be specific and must
reference the actual values given above (e.g. cite the exact velocity count, the
exact chargeback count, the exact amount-vs-history ratio) — do not write generic
statements like "this transaction looks suspicious" without tying it to a signal
value from the input. If a signal is absent or benign (e.g. disposableEmail is
false, or a signal is null due to no history), do not fabricate a reason for it.

Respond with strict JSON only, matching exactly this shape:
{
  "risk_score": <number 0-1, fraud risk, 0 = no risk, 1 = certain fraud>,
  "confidence": <number 0-1, confidence in this assessment>,
  "reasons": [<string>, ...],
  "recommended_action": <"allow" | "hold_for_review" | "auto_refund">
}`;
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`AI scoring call timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  return client;
}

// Distinguishes "will definitely fail again immediately" (rate limit - the
// window isn't going to reset in 500ms) from "might well succeed on a
// second try" (a transient overload/5xx or a slow response that tripped
// our own timeout). Retrying a rate-limit error is pointless and just adds
// latency before the inevitable fallback. The openai SDK surfaces HTTP
// status on thrown errors as `.status`, same convention across providers
// that implement the OpenAI API shape.
function classifyScoringError(err) {
  const status = err?.status;
  const message = String(err?.message || err);
  if (status === 429 || /rate limit/i.test(message)) return "rate_limit";
  if (/timed out/i.test(message)) return "timeout";
  if (status === 503 || status >= 500 || /overloaded|unavailable/i.test(message)) return "overloaded";
  return "other";
}

async function callModel(features, timeoutMs) {
  const openai = getClient();

  const completion = await withTimeout(
    openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: buildPrompt(features) }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    timeoutMs
  );

  const rawText = completion.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error("AI scoring response had no content");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`AI scoring returned malformed JSON: ${rawText}`);
  }

  const { risk_score, confidence, reasons, recommended_action } = parsed;

  const validActions = ["allow", "hold_for_review", "auto_refund"];
  if (
    typeof risk_score !== "number" ||
    typeof confidence !== "number" ||
    !Array.isArray(reasons) ||
    !validActions.includes(recommended_action)
  ) {
    throw new Error(`AI scoring response failed shape validation: ${rawText}`);
  }

  return { risk_score, confidence, reasons, recommended_action };
}

/**
 * Calls the AI scoring provider (Groq, openai/gpt-oss-120b) with the
 * deterministic feature set for one transaction and returns its structured
 * risk assessment. Throws on timeout, API failure, or a malformed response
 * so the caller can fall back to the rule-based heuristic scorer.
 *
 * A transient-looking failure (timeout, 5xx/overloaded) gets one retry
 * after a short backoff before giving up - a rate-limit error does not,
 * since the window won't have reset in 500ms and retrying just adds
 * latency before the same inevitable failure.
 *
 * options.timeoutMs is a testability hook only (see the retry test in
 * app/api/transactions/[id]/retry-gemini/route.js) - no real caller passes
 * it, so real behavior is unchanged.
 *
 * Same export name/signature/behavior contract as the Gemini version this
 * replaced, so ingestTransaction.js and everything downstream (fallback
 * logic, the manual retry endpoint) needed only an import-path change.
 */
export async function scoreTransaction(features, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  try {
    return await callModel(features, timeoutMs);
  } catch (err) {
    const errorType = classifyScoringError(err);

    if (errorType === "rate_limit") {
      console.warn(`AI scoring call failed (rate limit) - not retrying, falling back: ${err.message}`);
      throw err;
    }

    console.warn(`AI scoring call failed (${errorType}) - retrying once after ${RETRY_BACKOFF_MS}ms: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));

    try {
      return await callModel(features, timeoutMs);
    } catch (err2) {
      console.warn(`AI scoring retry also failed (${classifyScoringError(err2)}) - falling back: ${err2.message}`);
      throw err2;
    }
  }
}
