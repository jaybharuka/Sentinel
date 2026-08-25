import fs from "fs";
import path from "path";
import { scoreKaggleRow } from "@/lib/kaggleBenchmark";

// Dev-only convenience endpoint: replays a slice of
// data/kaggleCreditCardSample.json (see scripts/sampleKaggleDataset.js)
// through the real scoring pipeline. Same Groq-quota pacing as
// app/api/seed/route.js (8,000 tokens/minute cap, confirmed via live
// x-ratelimit-* headers - see that file's comment). No auth gate, same as
// app/api/seed/route.js - this stores under DEFAULT_MERCHANT_ID regardless
// of caller, it's not per-tenant data (see app/api/metrics/benchmark).
const DELAY_MS = 7000;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const limit = Math.min(2242, Math.max(1, parseInt(body.limit, 10) || 100));
  const offset = Math.max(0, parseInt(body.offset, 10) || 0);

  const datasetPath = path.join(process.cwd(), "data", "kaggleCreditCardSample.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const slice = dataset.slice(offset, offset + limit);

  let processed = 0;
  let fallbackCount = 0;
  let errors = 0;
  const errorSamples = [];
  const providerCounts = { "groq-primary": 0, "groq-secondary": 0, gemini: 0, fallback: 0 };

  for (let i = 0; i < slice.length; i++) {
    try {
      const { usedFallback, provider } = await scoreKaggleRow(slice[i]);
      processed++;
      if (usedFallback) fallbackCount++;
      providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
    } catch (err) {
      errors++;
      if (errorSamples.length < 10) {
        errorSamples.push({ kaggleId: slice[i].kaggleId, error: String(err.message || err) });
      }
    }

    if ((i + 1) % 25 === 0) {
      console.log(`kaggle benchmark: ${i + 1}/${slice.length} processed`);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  const summary = {
    requested: slice.length,
    processed,
    fallbackUsed: fallbackCount,
    providerCounts,
    errors,
    errorSamples,
  };

  console.log("Kaggle benchmark batch complete:", summary);
  return Response.json(summary);
}
