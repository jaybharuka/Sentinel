import crypto from "crypto";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Different from the webhook's signature scheme (app/api/webhooks/razorpay):
// that one HMACs the raw webhook body with RAZORPAY_WEBHOOK_SECRET. This one
// HMACs "{order_id}|{payment_id}" with RAZORPAY_KEY_SECRET, per Razorpay's
// Checkout.js success-callback verification docs. Two different secrets,
// two different signed strings - not reusable code despite both being
// "verify a Razorpay signature."
function verifyCheckoutSignature(orderId, paymentId, signature, secret) {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signature, "utf-8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// This route only confirms to the frontend that the checkout response is
// authentically from Razorpay, so the UI can honestly say "payment
// received" before the real webhook (already built, source of truth for
// scoring/persistence) has necessarily arrived. It does not itself call
// ingestTransaction - no double-processing risk.
export async function POST(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return Response.json({ error: "Missing order/payment/signature" }, { status: 400 });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return Response.json({ error: "RAZORPAY_KEY_SECRET is not configured" }, { status: 500 });
  }

  const verified = verifyCheckoutSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    secret
  );

  if (!verified) {
    return Response.json({ verified: false, error: "Signature does not match" }, { status: 400 });
  }

  return Response.json({ verified: true, paymentId: razorpay_payment_id });
}
