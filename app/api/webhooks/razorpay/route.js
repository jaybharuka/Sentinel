import crypto from "crypto";
import Razorpay from "razorpay";
import { after } from "next/server";
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
    return null;
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
    return txn.merchantId;
  }
  await prisma.transaction.update({
    where: { txnId: paymentId },
    data: { disputedAt: new Date(), isLabeledFraud: true },
  });
  return txn.merchantId;
}

// Real captured production payloads (both a payment.captured and this
// dispute-adjacent flow) confirmed the JSON body's only top-level keys are
// entity/account_id/event/contains/payload/created_at - no dedicated event
// id field, in either the body or (per the same capture) a distinguishing
// header value beyond what's checked below. Prefer X-Razorpay-Event-Id if
// a future Razorpay account/plan does send one; otherwise fall back to a
// deterministic hash of stable payload content, so redeliveries of the
// same logical event still collide on the same key even without one.
function extractEntityId(eventType, body) {
  if (eventType === "payment.captured" || eventType === "payment.failed") {
    return body.payload?.payment?.entity?.id || null;
  }
  if (eventType === "payment.dispute.created") {
    return body.payload?.dispute?.entity?.id || null;
  }
  return null;
}

function computeEventId(request, body, eventType) {
  const header = request.headers.get("x-razorpay-event-id");
  if (header) return header;
  const entityId = extractEntityId(eventType, body);
  const raw = `${eventType}:${entityId}:${body.created_at}`;
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

// markFailed uses updateMany with a status guard rather than update, so a
// failure that resolves *after* a concurrent successful attempt already
// marked this event "processed" can never downgrade it back to "failed" -
// see the concurrent-retry note in POST() below for when that race is
// actually possible.
async function markProcessed(razorpayEventId) {
  await prisma.webhookEvent
    .update({ where: { razorpayEventId }, data: { status: "processed", processedAt: new Date() } })
    .catch((err) => console.error(`Failed to mark webhook event ${razorpayEventId} processed:`, err));
}

async function markFailed(razorpayEventId, eventType, err) {
  console.error(`Webhook processing failed for ${razorpayEventId} (${eventType}):`, err);
  await prisma.webhookEvent
    .updateMany({ where: { razorpayEventId, status: { not: "processed" } }, data: { status: "failed" } })
    .catch(() => {});
}

async function recordMerchantId(razorpayEventId, merchantId) {
  if (!merchantId) return;
  await prisma.webhookEvent.update({ where: { razorpayEventId }, data: { merchantId } }).catch(() => {});
}

export async function POST(request) {
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
  const razorpayEventId = computeEventId(request, body, eventType);

  // Idempotency check. Real, structured (WebhookEvent table), not the
  // accidental safety net Transaction.txnId's unique constraint used to be
  // - that constraint only ever stopped a duplicate delivery from creating
  // a second row; it did nothing to short-circuit re-running scoring/AI
  // calls before hitting it, and gave no visibility into how often
  // Razorpay actually redelivers.
  const existing = await prisma.webhookEvent.findUnique({ where: { razorpayEventId } });

  if (existing?.status === "processed") {
    console.log(`Duplicate webhook delivery for ${razorpayEventId} (${eventType}) - already processed, skipping`);
    return Response.json({ received: true, duplicate: true });
  }

  // status "received" (a previous attempt started but never finished - e.g.
  // the function instance died mid-flight) or "failed": safe to reprocess.
  // Reasoning through the double-refund question explicitly, since this is
  // exactly the kind of retry that could be dangerous if handled naively:
  // if the earlier attempt actually got far enough to create the
  // Transaction row before dying, ingestTransaction()'s create() call
  // (which happens BEFORE executeRefund() - see lib/ingestTransaction.js)
  // hits Transaction.txnId's unique constraint on this retry and throws,
  // caught below by markFailed(), never reaching a second refund call. If
  // the earlier attempt hadn't reached that far yet, no row exists and this
  // retry is just a normal first attempt. And if the earlier attempt is
  // not actually dead but just slow, and this "retry" runs concurrently
  // with it, the per-merchant Redis lock (lib/merchantLock.js) plus that
  // same txnId uniqueness still prevent two successful creates/refunds for
  // the same payment - only one of the two ever wins the create() call.
  if (existing) {
    console.log(
      `Retrying previously incomplete webhook delivery for ${razorpayEventId} (${eventType}, was "${existing.status}")`
    );
    await prisma.webhookEvent.update({ where: { razorpayEventId }, data: { status: "received" } });
  } else {
    await prisma.webhookEvent.create({ data: { razorpayEventId, eventType, status: "received" } });
  }

  if (eventType === "payment.captured" || eventType === "payment.failed") {
    const payment = body.payload?.payment?.entity;
    if (!payment) {
      await markFailed(razorpayEventId, eventType, new Error("Missing payment entity"));
      return Response.json({ error: "Missing payment entity" }, { status: 400 });
    }
    // Ack Razorpay now, run the full scoring pipeline after - via
    // next/server's after(), not a bare unawaited promise chain. Confirmed
    // live during this feature's own testing that a bare fire-and-forget
    // chain is genuinely unsafe on Vercel: a real webhook's Transaction row
    // was created successfully, but the trailing markProcessed() call
    // chained after it never completed - the function instance was
    // reclaimed once the HTTP response went out, before that last async
    // step finished. after() tells the platform to keep this invocation
    // alive until the callback settles, without blocking the response
    // itself - this was a real, latent risk for the whole pipeline
    // (including ingestTransaction() itself), not just the new
    // markProcessed() call.
    after(async () => {
      try {
        const event = await mapPaymentEvent(payment);
        await recordMerchantId(razorpayEventId, event.merchantId);
        await ingestTransaction(event);
        await markProcessed(razorpayEventId);
      } catch (err) {
        await markFailed(razorpayEventId, eventType, err);
      }
    });
    return Response.json({ received: true });
  }

  if (eventType === "payment.dispute.created") {
    const paymentId = body.payload?.dispute?.entity?.payment_id;
    console.log(`Dispute created for payment ${paymentId}`);
    if (paymentId) {
      try {
        const merchantId = await markDisputed(paymentId);
        await recordMerchantId(razorpayEventId, merchantId);
        await markProcessed(razorpayEventId);
      } catch (err) {
        await markFailed(razorpayEventId, eventType, err);
      }
    } else {
      await markProcessed(razorpayEventId);
    }
    return Response.json({ received: true });
  }

  console.log(`Ignoring unhandled Razorpay event: ${eventType}`);
  await markProcessed(razorpayEventId);
  return Response.json({ received: true });
}
