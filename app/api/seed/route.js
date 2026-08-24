import fs from "fs";
import path from "path";
import { ingestTransaction } from "@/lib/ingestTransaction";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Dev-only convenience endpoint: replays the synthetic labeled dataset
// through the real ingest pipeline (Gemini + fallback + policy gate) so
// the DB fills up with a held-out test set. Not for production use.
const DELAY_MS = 300;

export async function POST() {
  // Scoped to whichever merchant is logged in when this is called, so
  // each new signup can seed their own test data. Falls back to the
  // original default merchant (ingestTransaction's own default) when
  // called without a session, e.g. via curl during testing.
  const merchant = await getCurrentMerchant();

  const datasetPath = path.join(process.cwd(), "data", "syntheticTransactions.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));

  let processed = 0;
  let fallbackCount = 0;
  let errors = 0;
  const errorSamples = [];

  for (let i = 0; i < dataset.length; i++) {
    const event = merchant ? { ...dataset[i], merchantId: merchant.id } : dataset[i];
    try {
      const { usedFallback } = await ingestTransaction(event);
      processed++;
      if (usedFallback) fallbackCount++;
    } catch (err) {
      errors++;
      if (errorSamples.length < 10) {
        errorSamples.push({ txnId: event.txnId, error: String(err.message || err) });
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`${i + 1}/${dataset.length} processed`);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  const summary = {
    total: dataset.length,
    processed,
    fallbackUsed: fallbackCount,
    errors,
    errorSamples,
  };

  console.log("Seed complete:", summary);
  return Response.json(summary);
}
