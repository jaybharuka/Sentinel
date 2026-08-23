/**
 * Generates a synthetic, labeled dataset of mock Razorpay-style payment
 * events for held-out evaluation of the risk pipeline. Run with:
 *   node scripts/generateDataset.js
 */
const fs = require("fs");
const path = require("path");

const TOTAL_COUNT = 400;
const FRAUD_RATIO = 0.25;
const OUTPUT_PATH = path.join(__dirname, "..", "data", "syntheticTransactions.json");

const NORMAL_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "rediffmail.com",
  "protonmail.com",
  "live.com",
];

const DISPOSABLE_EMAIL_DOMAINS = [
  "mailinator.com",
  "tempmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "throwaway.email",
  "yopmail.com",
  "sharklasers.com",
  "getnada.com",
];

// Countries the "home" customer profiles are drawn from, plus a few
// higher-risk mismatch targets used when constructing fraud patterns.
const COUNTRIES = ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "FR"];
const MISMATCH_COUNTRIES = ["NG", "RU", "UA", "VN", "ID", "BR", "PK"];

const FIRST_NAMES = [
  "amit", "priya", "rahul", "sneha", "vikram", "anita", "rohan", "kavya",
  "arjun", "meera", "sanjay", "divya", "karan", "pooja", "nikhil", "ishita",
  "aditya", "neha", "vivek", "shreya", "manish", "ritu", "gaurav", "swati",
];

const CARD_BIN_PREFIXES = ["411111", "424242", "510510", "555555", "601111", "652150", "370000", "340000"];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 2) {
  const value = Math.random() * (max - min) + min;
  return Number(value.toFixed(decimals));
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function randomEmailFor(customerIndex, domain) {
  const name = pick(FIRST_NAMES);
  const suffix = randInt(1, 999);
  return `${name}${suffix}.${customerIndex}@${domain}`;
}

function randomTimestampWithinDays(daysAgo) {
  const now = Date.now();
  const past = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(randInt(past, now));
}

function oddHourTimestamp(daysAgo) {
  const ts = randomTimestampWithinDays(daysAgo);
  ts.setHours(randInt(1, 4), randInt(0, 59), randInt(0, 59), 0);
  return ts;
}

function normalHourTimestamp(daysAgo) {
  const ts = randomTimestampWithinDays(daysAgo);
  let hour = randInt(0, 23);
  if (hour >= 1 && hour < 5) hour += 5; // nudge out of the odd-hour window
  ts.setHours(hour % 24, randInt(0, 59), randInt(0, 59), 0);
  return ts;
}

// Pool of recurring customer profiles so repeat customerIds/emails show up
// across the dataset, which is what makes velocity and history features
// meaningful once this data is replayed through the pipeline.
function buildCustomerProfiles(count) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const customerId = `cust_${String(i + 1).padStart(4, "0")}`;
    const country = pick(COUNTRIES);
    const domain = pick(NORMAL_EMAIL_DOMAINS);
    profiles.push({
      customerId,
      country,
      email: randomEmailFor(i, domain),
      typicalAmount: randFloat(300, 15000),
    });
  }
  return profiles;
}

let txnCounter = 0;
function nextTxnId() {
  txnCounter += 1;
  return `txn_${String(txnCounter).padStart(5, "0")}`;
}

function baseEvent({
  amount,
  email,
  ipCountry,
  billingCountry,
  customerId,
  timestamp,
  isNewCustomer,
  previousChargebacks,
}) {
  return {
    txnId: nextTxnId(),
    amount,
    currency: "INR",
    email,
    ipCountry,
    billingCountry,
    customerId,
    timestamp: timestamp.toISOString(),
    cardBin: pick(CARD_BIN_PREFIXES),
    isNewCustomer,
    previousChargebacks,
  };
}

// --- Clean transaction generators -----------------------------------------

function generateCleanNormal(profiles) {
  const profile = pick(profiles);
  const isNewCustomer = Math.random() < 0.2;
  const event = baseEvent({
    amount: randFloat(profile.typicalAmount * 0.5, profile.typicalAmount * 1.5),
    email: profile.email,
    ipCountry: profile.country,
    billingCountry: profile.country,
    customerId: isNewCustomer ? `cust_new_${randInt(10000, 99999)}` : profile.customerId,
    timestamp: normalHourTimestamp(30),
    isNewCustomer,
    previousChargebacks: 0,
  });
  return { ...event, isLabeledFraud: false };
}

// A clean transaction carrying exactly one weak signal (odd hour, a new
// customer, or a single legitimate-looking country mismatch) but nothing
// else suspicious - keeps precision/recall from being trivially separable.
function generateCleanWithWeakSignal(profiles) {
  const profile = pick(profiles);
  const weakSignal = pick(["oddHour", "newCustomer", "travel"]);

  let timestamp = normalHourTimestamp(30);
  let ipCountry = profile.country;
  let isNewCustomer = false;

  if (weakSignal === "oddHour") {
    timestamp = oddHourTimestamp(30);
  } else if (weakSignal === "newCustomer") {
    isNewCustomer = true;
  } else if (weakSignal === "travel") {
    // Legitimate traveller: IP differs from billing country, nothing else off.
    ipCountry = pick(COUNTRIES.filter((c) => c !== profile.country));
  }

  const event = baseEvent({
    amount: randFloat(profile.typicalAmount * 0.6, profile.typicalAmount * 1.4),
    email: profile.email,
    ipCountry,
    billingCountry: profile.country,
    customerId: isNewCustomer ? `cust_new_${randInt(10000, 99999)}` : profile.customerId,
    timestamp,
    isNewCustomer,
    previousChargebacks: 0,
  });
  return { ...event, isLabeledFraud: false };
}

// --- Fraud transaction generators -----------------------------------------

// Disposable email + IP/billing country mismatch.
function generateFraudDisposableAndMismatch() {
  const domain = pick(DISPOSABLE_EMAIL_DOMAINS);
  const billingCountry = pick(COUNTRIES);
  const event = baseEvent({
    amount: randFloat(200, 4000),
    email: randomEmailFor(randInt(1000, 9999), domain),
    ipCountry: pick(MISMATCH_COUNTRIES),
    billingCountry,
    customerId: `cust_new_${randInt(10000, 99999)}`,
    timestamp: normalHourTimestamp(20),
    isNewCustomer: true,
    previousChargebacks: 0,
  });
  return { ...event, isLabeledFraud: true };
}

// Disposable email + odd hour, small "test the card" style amount.
function generateFraudDisposableAndOddHour() {
  const domain = pick(DISPOSABLE_EMAIL_DOMAINS);
  const country = pick(COUNTRIES);
  const event = baseEvent({
    amount: randFloat(50, 1500),
    email: randomEmailFor(randInt(1000, 9999), domain),
    ipCountry: country,
    billingCountry: country,
    customerId: `cust_new_${randInt(10000, 99999)}`,
    timestamp: oddHourTimestamp(20),
    isNewCustomer: true,
    previousChargebacks: 0,
  });
  return { ...event, isLabeledFraud: true };
}

// Country mismatch + prior chargeback history (repeat offender).
function generateFraudRepeatOffender(profiles) {
  const profile = pick(profiles);
  const event = baseEvent({
    amount: randFloat(1000, 20000),
    email: profile.email,
    ipCountry: pick(MISMATCH_COUNTRIES),
    billingCountry: profile.country,
    customerId: profile.customerId,
    timestamp: normalHourTimestamp(20),
    isNewCustomer: false,
    previousChargebacks: randInt(1, 4),
  });
  return { ...event, isLabeledFraud: true };
}

// New customer, odd hour, prior chargeback flag already on file (e.g. a
// synthetic-identity account that was already burned once), plus a
// country mismatch — three combined signals.
function generateFraudTripleSignal() {
  const domain = Math.random() < 0.5 ? pick(DISPOSABLE_EMAIL_DOMAINS) : pick(NORMAL_EMAIL_DOMAINS);
  const event = baseEvent({
    amount: randFloat(500, 8000),
    email: randomEmailFor(randInt(1000, 9999), domain),
    ipCountry: pick(MISMATCH_COUNTRIES),
    billingCountry: pick(COUNTRIES),
    customerId: `cust_new_${randInt(10000, 99999)}`,
    timestamp: oddHourTimestamp(20),
    isNewCustomer: true,
    previousChargebacks: randInt(1, 2),
  });
  return { ...event, isLabeledFraud: true };
}

// Velocity burst: 3-4 transactions from the same customer within a tight
// window, at least one carrying a disposable email - a card-testing /
// account-takeover style pattern.
function generateFraudVelocityBurst() {
  const burstSize = randInt(3, 4);
  const country = pick(COUNTRIES);
  const customerId = `cust_burst_${randInt(10000, 99999)}`;
  const anchor = oddHourTimestamp(20).getTime();
  const events = [];

  for (let i = 0; i < burstSize; i++) {
    const offsetMs = randInt(0, 8 * 60 * 1000);
    const useDisposable = i === burstSize - 1 || Math.random() < 0.5;
    const domain = useDisposable ? pick(DISPOSABLE_EMAIL_DOMAINS) : pick(NORMAL_EMAIL_DOMAINS);
    const event = baseEvent({
      amount: randFloat(100, 2500),
      email: randomEmailFor(randInt(1000, 9999), domain),
      ipCountry: Math.random() < 0.4 ? pick(MISMATCH_COUNTRIES) : country,
      billingCountry: country,
      customerId,
      timestamp: new Date(anchor + offsetMs),
      isNewCustomer: i === 0,
      previousChargebacks: 0,
    });
    events.push({ ...event, isLabeledFraud: true });
  }
  return events;
}

function generateDataset() {
  const profiles = buildCustomerProfiles(150);
  const fraudTarget = Math.round(TOTAL_COUNT * FRAUD_RATIO);
  const cleanTarget = TOTAL_COUNT - fraudTarget;

  const transactions = [];

  // Fraud transactions: mix of archetypes, including multi-row velocity bursts.
  const fraudSingleGenerators = [
    () => generateFraudDisposableAndMismatch(),
    () => generateFraudDisposableAndOddHour(),
    () => generateFraudRepeatOffender(profiles),
    () => generateFraudTripleSignal(),
  ];

  while (transactions.filter((t) => t.isLabeledFraud).length < fraudTarget) {
    const remaining = fraudTarget - transactions.filter((t) => t.isLabeledFraud).length;
    if (remaining >= 3 && Math.random() < 0.3) {
      const burst = generateFraudVelocityBurst();
      transactions.push(...burst.slice(0, remaining));
    } else {
      transactions.push(pick(fraudSingleGenerators)());
    }
  }

  // Clean transactions: mostly normal, ~15% with a single weak signal.
  for (let i = 0; i < cleanTarget; i++) {
    const generator = Math.random() < 0.15 ? generateCleanWithWeakSignal : generateCleanNormal;
    transactions.push(generator(profiles));
  }

  // Shuffle so fraud/clean and bursts aren't grouped in file order.
  for (let i = transactions.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [transactions[i], transactions[j]] = [transactions[j], transactions[i]];
  }

  // Timestamps must be non-decreasing-ish in real traffic terms, but for a
  // held-out test set we only need each event internally consistent - sort
  // chronologically so a replay-through-the-pipeline script can insert them
  // in order and have velocity/history features compute correctly.
  transactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return transactions;
}

function main() {
  const dataset = generateDataset();

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));

  const fraudCount = dataset.filter((t) => t.isLabeledFraud).length;
  console.log(`Generated ${dataset.length} transactions -> ${OUTPUT_PATH}`);
  console.log(`  fraud: ${fraudCount} (${((fraudCount / dataset.length) * 100).toFixed(1)}%)`);
  console.log(`  clean: ${dataset.length - fraudCount}`);
}

main();
