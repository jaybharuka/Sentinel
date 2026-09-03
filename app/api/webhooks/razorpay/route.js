import crypto from "crypto";
import Razorpay from "razorpay";
import { prisma } from "@/lib/prisma";
import { ingestTransaction } from "@/lib/ingestTransaction";
import { DEFAULT_MERCHANT_ID } from "@/lib/merchantSettings";

// Merchant attribution: our own in-app checkout (see
// app/api/checkout/create-order/route.js) stashes the logged-in merchant's
// ID in the Razorpay Order's `notes` at creation time. This webhook fetches
// the order back by payment.order_id and reads that note to attribute the
// transaction to the right merchant, instead of hard-coding
// DEFAULT_MERCHANT_ID for everything. Falls back to DEFAULT_MERCHANT_ID for
// anything that didn't originate from our checkout flow - a Payment Link
// or QR code created directly in Razorpay's own dashboard, for example,
// carries no such note and has no order at all in some cases - or if the
// noted merchant no longer exists. There is still no true multi-tenant
// Razorpay integration (one shared RAZORPAY_KEY_ID/WEBHOOK_SECRET for every
// merchant in this deployment's .env - a real one would need per-merchant
// Razorpay Connect/OAuth), but attribution *within* that shared account is
// now correct for the flow this app actually drives payments through.
let razorpayInstance = null;
function getRazorpayClient() {
  if (razorpayInstance) return razorpayInstance;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET is not configured");
  }
  razorpayInstance = new Razorpay({ key_id, key_secret });
  return razorpayInstance;
}

async function resolveMerchantId(payment) {
  if (!payment.order_id) return DEFAULT_MERCHANT_ID;

  try {
    const client = getRazorpayClient();
    const order = await client.orders.fetch(payment.order_id);
    const merchantId = order?.notes?.merchantId;
    if (!merchantId) return DEFAULT_MERCHANT_ID;

    const exists = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    return exists ? merchantId : DEFAULT_MERCHANT_ID;
  } catch (err) {
    console.warn(
      `Could not resolve merchant for order ${payment.order_id}, falling back to default: ${err.message || err}`
    );
    return DEFAULT_MERCHANT_ID;
  }
}

// Razorpay requires a 2xx response within 5 seconds or it treats the
// delivery as failed and retries. AI scoring (lib/aiScoring.js's
// Groq/Gemini provider chain) can take several seconds, especially if it
// has to fail over through multiple tiers, so payment events are acked
// immediately after signature verification and scored asynchronously - the
// audit row lands a few seconds after the ack, same as it would from a
// slow /api/ingest call.
function verifySignature(rawBody, signature, secret) {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signature, "utf-8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function deriveCountries(card) {
  if (!card) return { ipCountry: "unknown", billingCountry: "unknown" };
  const billingCountry = card.country ? card.country.toUpperCase() : "unknown";
  const ipCountry = card.international ? "unknown" : billingCountry;
  return { ipCountry, billingCountry };
}

async function mapPaymentEvent(payment) {
  const merchantId = await resolveMerchantId(payment);
  const email = payment.email || "unknown@unknown";
  const customerId = payment.contact || payment.customer_id || null;
  const { ipCountry, billingCountry } = deriveCountries(payment.card);

  // Prisma's JSON path filtering isn't reliable on SQLite, so - matching
  // lib/featureExtractor.js - fetch prior rows and match in JS instead.
  // Scoped to the resolved merchant so one merchant's dispute/customer
  // history never leaks into another's isNewCustomer/previousChargebacks
  // signals.
  const allTxns = await prisma.transaction.findMany({
    where: { merchantId },
    select: { email: true, features: true, disputedAt: true },
  });
  const priorTxns = allTxns.filter(
    (t) => t.email === email || (customerId && t.features?.customerId === customerId)
  );

  return {
    txnId: payment.id,
    amount: payment.amount / 100,
    currency: payment.currency,
    email,
    ipCountry,
    billingCountry,
    customerId,
    timestamp: new Date(payment.created_at * 1000),
    cardBin: payment.card?.iin || null,
    isNewCustomer: priorTxns.length === 0,
    previousChargebacks: priorTxns.filter((t) => t.disputedAt).length,
    source: "razorpay_live",
    merchantId,
  };
}

async function markDisputed(paymentId) {
  const txn = await prisma.transaction.findUnique({ where: { txnId: paymentId } });
  if (!txn) {
    console.warn(`Dispute received for unknown payment ${paymentId} - no matching transaction`);
    return;
  }
  // A real dispute is genuine fraud ground-truth - retroactively labels the
  // original transaction the same way synthetic seed data is pre-labeled,
  // so it feeds into precision/recall the same way (see
  // app/api/metrics/live). Scoped to source: razorpay_live defensively,
  // same as the daily-refund-budget/refund-execution/alert checks
  // elsewhere in this pipeline - a real Razorpay dispute could only ever
  // reference a real payment ID in practice, but this keeps the invariant
  // explicit rather than relying on txnId formats never colliding.
  if (txn.source !== "razorpay_live") {
    console.warn(`Dispute received for non-live transaction ${paymentId} (source: ${txn.source}) - ignoring`);
    return;
  }
  await prisma.transaction.update({
    where: { txnId: paymentId },
    data: { disputedAt: new Date(), isLabeledFraud: true },
  });
}

export async function POST(request) {
  console.log("Razorpay webhook: request received", {
    url: request.url,
    hasSignatureHeader: request.headers.has("x-razorpay-signature"),
  });

  const rawBody = await request.text();
  try {
    const parsedForDebug = JSON.parse(rawBody);
    console.log("TEMP DEBUG top-level keys:", Object.keys(parsedForDebug));
    console.log("TEMP DEBUG id/event_id/account_id:", parsedForDebug.id, parsedForDebug.event_id, parsedForDebug.account_id);
  } catch {}
  console.log("TEMP DEBUG x-razorpay-event-id header:", request.headers.get("x-razorpay-event-id"));
  const signature = request.headers.get("x-razorpay-signature");
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!verifySignature(rawBody, signature, secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = body.event;

  if (eventType === "payment.captured" || eventType === "payment.failed") {
    const payment = body.payload?.payment?.entity;
    if (!payment) {
      return Response.json({ error: "Missing payment entity" }, { status: 400 });
    }
    // Fire-and-forget: ack Razorpay now, run the full scoring pipeline after.
    mapPaymentEvent(payment)
      .then((event) => ingestTransaction(event))
      .catch((err) => console.error(`Failed to process ${eventType} for ${payment.id}:`, err));
    return Response.json({ received: true });
  }

  if (eventType === "payment.dispute.created") {
    const paymentId = body.payload?.dispute?.entity?.payment_id;
    console.log(`Dispute created for payment ${paymentId}`);
    if (paymentId) {
      await markDisputed(paymentId);
    }
    return Response.json({ received: true });
  }

  console.log(`Ignoring unhandled Razorpay event: ${eventType}`);
  return Response.json({ received: true });
}
