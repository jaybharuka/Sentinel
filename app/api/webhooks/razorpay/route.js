import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ingestTransaction } from "@/lib/ingestTransaction";
import { DEFAULT_MERCHANT_ID } from "@/lib/merchantSettings";

// Known scope boundary, not a bug: this webhook has no way to identify
// which merchant a payment belongs to beyond "whichever merchant's
// RAZORPAY_KEY_ID/RAZORPAY_WEBHOOK_SECRET are configured in this
// deployment's .env" - there's no per-merchant Razorpay OAuth/Connect
// integration yet, so every webhook-originated transaction is hard-coded
// to DEFAULT_MERCHANT_ID regardless of who's logged into the dashboard.
// A real multi-tenant build would look up the merchant by which
// RAZORPAY_KEY_ID/webhook secret the request matches (one per merchant,
// stored on their MerchantSettings row) instead of a single shared .env.

// Razorpay requires a 2xx response within 5 seconds or it treats the
// delivery as failed and retries. Gemini scoring alone has been observed
// taking 3-6s, so payment events are acked immediately after signature
// verification and scored asynchronously - the audit row lands a few
// seconds after the ack, same as it would from a slow /api/ingest call.
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
  const email = payment.email || "unknown@unknown";
  const customerId = payment.contact || payment.customer_id || null;
  const { ipCountry, billingCountry } = deriveCountries(payment.card);

  // Prisma's JSON path filtering isn't reliable on SQLite, so - matching
  // lib/featureExtractor.js - fetch prior rows and match in JS instead.
  // Scoped to this merchant so one merchant's dispute/customer history
  // never leaks into another's isNewCustomer/previousChargebacks signals.
  const allTxns = await prisma.transaction.findMany({
    where: { merchantId: DEFAULT_MERCHANT_ID },
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
  };
}

async function markDisputed(paymentId) {
  const txn = await prisma.transaction.findUnique({ where: { txnId: paymentId } });
  if (!txn) {
    console.warn(`Dispute received for unknown payment ${paymentId} - no matching transaction`);
    return;
  }
  await prisma.transaction.update({
    where: { txnId: paymentId },
    data: { disputedAt: new Date() },
  });
}

export async function POST(request) {
  console.log("Razorpay webhook: request received", {
    url: request.url,
    hasSignatureHeader: request.headers.has("x-razorpay-signature"),
  });

  const rawBody = await request.text();
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
