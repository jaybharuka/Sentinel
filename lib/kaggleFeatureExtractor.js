const ONE_DAY_SECONDS = 24 * 60 * 60;

// This dataset's "Time" column is seconds elapsed since the first
// transaction in the recorded window, not a wall-clock timestamp - the
// window's real-world start-of-day offset isn't published. Taking Time
// modulo one day is the standard approach for approximating time-of-day on
// this dataset, but it genuinely is an approximation, not a real clock
// read - unlike the main pipeline's oddHour, which comes from an actual
// transaction timestamp.
function approximateOddHour(timeSeconds) {
  const secondsIntoDay = timeSeconds % ONE_DAY_SECONDS;
  const hour = Math.floor(secondsIntoDay / 3600);
  return hour >= 1 && hour < 5;
}

/**
 * Reduced feature extractor for the Kaggle "Credit Card Fraud Detection"
 * benchmark (see scripts/sampleKaggleDataset.js). That dataset has no
 * customer ID, email, merchant, or history to compute 10 of our 12 signals
 * from - it has Time, Amount, and 28 PCA-anonymized columns intentionally
 * not used (see that script's header comment for why). Only amount and an
 * approximate odd-hour signal have an honest equivalent here.
 *
 * The other 10 signals are omitted entirely rather than defaulted to a
 * neutral/fake value (e.g. previousChargebacks: 0, disposableEmail: false)
 * that would misleadingly look like a real "clean" signal instead of
 * "unknown" - lib/aiScoring.js's prompt is told explicitly, via the
 * reducedSignalSet option, that this is a reduced feature set so it
 * doesn't fabricate reasoning about signals that were never provided.
 */
export function extractKaggleFeatures({ time, amount }) {
  return {
    amount,
    oddHour: approximateOddHour(time),
  };
}
