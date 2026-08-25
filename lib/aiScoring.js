import OpenAI from "openai";
import { scoreWithGemini } from "@/lib/geminiScoring";

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

// Two separate Groq accounts, each with its own independent 200k-tokens/day
// budget - real key redundancy, not a workaround for a single account's
// limit. Clients are cached per API key so both can be held warm at once.
const clients = new Map();
function getClient(apiKey) {
  if (clients.has(apiKey)) return clients.get(apiKey);
  const client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  clients.set(apiKey, client);
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

async function callModel(features, timeoutMs, apiKey, promptOptions) {
  const openai = getClient(apiKey);

  const completion = await withTimeout(
    openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: buildPrompt(features, promptOptions) }],
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

// Runs one key to exhaustion: one attempt, and - only for a transient-looking
// failure (timeout, 5xx/overloaded) - one retry after a short backoff. A
// rate-limit response never gets retried on the same key: the window won't
// reset in 500ms, so retrying just adds latency before the same inevitable
// failure. Throws the last error, tagged with .errorType so the caller can
// decide whether it's worth trying the other key.
async function scoreWithKey(features, timeoutMs, apiKey, keyLabel, promptOptions) {
  try {
    const result = await callModel(features, timeoutMs, apiKey, promptOptions);
    console.warn(`AI scoring call succeeded (key=${keyLabel})`);
    return { ...result, provider: `groq-${keyLabel}` };
  } catch (err) {
    const errorType = classifyScoringError(err);

    if (errorType === "rate_limit") {
      console.warn(`AI scoring call failed (rate limit, key=${keyLabel}) - not retrying same key: ${err.message}`);
      throw Object.assign(err, { errorType });
    }

    console.warn(`AI scoring call failed (${errorType}, key=${keyLabel}) - retrying once after ${RETRY_BACKOFF_MS}ms: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));

    try {
      const result = await callModel(features, timeoutMs, apiKey, promptOptions);
      console.warn(`AI scoring retry succeeded (key=${keyLabel})`);
      return { ...result, provider: `groq-${keyLabel}` };
    } catch (err2) {
      const errorType2 = classifyScoringError(err2);
      console.warn(`AI scoring retry also failed (${errorType2}, key=${keyLabel}): ${err2.message}`);
      throw Object.assign(err2, { errorType: errorType2 });
    }
  }
}

/**
 * Calls the AI scoring provider chain - Groq primary, Groq secondary,
 * Gemini - with the deterministic feature set for one transaction and
 * returns its structured risk assessment. Throws only once every tier has
 * failed, so the caller can fall back to the rule-based heuristic scorer.
 *
 * Three genuinely independent accounts/quota pools give real redundancy,
 * not a workaround for one account's limit: two Groq accounts
 * (GROQ_API_KEY, GROQ_API_KEY_SECONDARY) plus Gemini (GEMINI_API_KEY, see
 * lib/geminiScoring.js - the pre-Groq-migration provider, still a live,
 * separate account). A quota/rate-limit failure on one tier fails over to
 * the next immediately (no point retrying the same exhausted account). Any
 * other failure (timeout, 5xx/overloaded, malformed response) does not
 * fail over - it's not a quota problem, so the other tiers would likely
 * hit the same transient issue - and falls through to the rule-based
 * heuristic instead. GROQ_API_KEY_SECONDARY and GEMINI_API_KEY are both
 * optional - if either is unset, that tier is skipped.
 *
 * options.timeoutMs is a testability hook only (see the retry test in
 * app/api/transactions/[id]/retry-scoring/route.js) - no real caller passes
 * it, so real behavior is unchanged.
 *
 * options.reducedSignalSet tells the prompt builder this is the Kaggle
 * benchmark's reduced feature set (see lib/kaggleFeatureExtractor.js)
 * rather than the main 12-signal set, swapping in a short explanatory note
 * instead of the normal signal glossary - both lib/aiScoring.js's and
 * lib/geminiScoring.js's prompts honor it identically. Defaults to false,
 * so every existing caller's prompt is byte-for-byte unchanged.
 *
 * Same export name/signature/behavior contract this has had since the
 * Gemini->Groq migration, so ingestTransaction.js and everything downstream
 * (fallback logic, the manual retry endpoint) need no changes here.
 */
export async function scoreTransaction(features, options = {}) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const promptOptions = { reducedSignalSet: Boolean(options.reducedSignalSet) };
  const primaryKey = process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_SECONDARY;
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);

  if (!primaryKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  async function tryGemini(previousErr) {
    if (previousErr.errorType !== "rate_limit" || !hasGemini) {
      console.warn(`AI scoring unavailable (${previousErr.errorType}) - falling back to rule-based heuristic`);
      throw previousErr;
    }
    console.warn("Groq exhausted (quota/rate limit) - failing over to Gemini");
    try {
      return await scoreWithGemini(features, { timeoutMs, reducedSignalSet: promptOptions.reducedSignalSet });
    } catch (geminiErr) {
      console.warn(`Gemini also failed (${geminiErr.errorType}) - falling back to rule-based heuristic`);
      throw geminiErr;
    }
  }

  try {
    return await scoreWithKey(features, timeoutMs, primaryKey, "primary", promptOptions);
  } catch (err) {
    if (err.errorType === "rate_limit" && secondaryKey) {
      console.warn("Primary Groq key exhausted (quota/rate limit) - failing over to secondary key");
      try {
        return await scoreWithKey(features, timeoutMs, secondaryKey, "secondary", promptOptions);
      } catch (err2) {
        return await tryGemini(err2);
      }
    }
    return await tryGemini(err);
  }
}
