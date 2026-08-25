// One-time data-prep script: derives data/kaggleCreditCardSample.json from
// the raw Kaggle "Credit Card Fraud Detection" CSV (mlg-ulb/creditcardfraud
// on Kaggle - real, anonymized European cardholder transactions, genuine
// fraud labels). The raw CSV (~150MB, 284,807 rows) is never committed -
// only this derived subset is. Re-run with:
//   node scripts/sampleKaggleDataset.js <path-to-creditcard.csv>
//
// Only Time, Amount, and Class are used. The V1-V28 columns are PCA
// components of the original bank's raw fields, published specifically so
// no one (including us) can recover what they represent - there is no
// honest way to map them onto our 12 signals (no customer ID, no email, no
// merchant history exists in this dataset), so they're intentionally
// dropped rather than faked. See lib/kaggleFeatureExtractor.js for how the
// reduced signal set derived from what's left (amount, an approximate
// time-of-day signal) is used at scoring time.
const fs = require("fs");
const readline = require("readline");
const path = require("path");

const TARGET_LEGIT_SAMPLE = 1750;

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node scripts/sampleKaggleDataset.js <path-to-creditcard.csv>");
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity,
  });

  let header = null;
  let timeIdx, amountIdx, classIdx;
  const fraudRows = [];
  const legitReservoir = [];
  let legitSeen = 0;

  for await (const line of rl) {
    if (!header) {
      header = line.split(",").map((h) => h.replace(/"/g, ""));
      timeIdx = header.indexOf("Time");
      amountIdx = header.indexOf("Amount");
      classIdx = header.indexOf("Class");
      continue;
    }
    if (!line.trim()) continue;

    // Every field in this CSV is quote-wrapped (e.g. "1", "149.62"), unlike
    // the unquoted header - strip quotes before parsing, or Number() and
    // the "1" comparison both silently fail (Number('"1"') is NaN).
    const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
    const time = Number(cols[timeIdx]);
    const amount = Number(cols[amountIdx]);
    const isFraud = cols[classIdx] === "1";

    if (isFraud) {
      fraudRows.push({ time, amount });
    } else {
      legitSeen++;
      // Reservoir sampling (Algorithm R) - gives every legit row an equal
      // chance of ending up in the sample without needing to know the
      // total legit count (284,315) in advance.
      if (legitReservoir.length < TARGET_LEGIT_SAMPLE) {
        legitReservoir.push({ time, amount });
      } else {
        const j = Math.floor(Math.random() * legitSeen);
        if (j < TARGET_LEGIT_SAMPLE) {
          legitReservoir[j] = { time, amount };
        }
      }
    }
  }

  const rows = [
    ...fraudRows.map((r, i) => ({
      kaggleId: `kaggle_fraud_${i}`,
      time: r.time,
      amount: r.amount,
      isLabeledFraud: true,
    })),
    ...legitReservoir.map((r, i) => ({
      kaggleId: `kaggle_legit_${i}`,
      time: r.time,
      amount: r.amount,
      isLabeledFraud: false,
    })),
  ];

  // Shuffled (Fisher-Yates) so fraud and legit rows are interleaved - any
  // contiguous slice (e.g. app/api/seed/kaggle-benchmark's offset/limit)
  // stays representative of the ~22% fraud ratio in this sample, instead of
  // a small early batch accidentally landing entirely inside the fraud
  // block (which is exactly what happened in the first test run of this
  // pipeline - see conversation/commit history).
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const outPath = path.join(__dirname, "..", "data", "kaggleCreditCardSample.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));

  console.log(
    `Wrote ${rows.length} rows (${fraudRows.length} fraud + ${legitReservoir.length} legit, ` +
      `sampled from ${legitSeen} total legit rows seen) to ${outPath}`
  );
}

main();
