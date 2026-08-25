import Razorpay from "razorpay";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const MIN_AMOUNT_RUPEES = 1;
const MAX_AMOUNT_RUPEES = 5000; // test-mode only, but keep even test amounts sane

let razorpayInstance = null;
function getClient() {
  if (razorpayInstance) return razorpayInstance;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET is not configured");
  }
  razorpayInstance = new Razorpay({ key_id, key_secret });
  return razorpayInstance;
}

/**
 * Creates a real Razorpay test-mode Order via the Orders API, for the
 * in-app checkout (Razorpay's own hosted Checkout.js widget, not a
 * home-built card form - PCI scope stays entirely with Razorpay).
 */
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

  const amount = Number(body.amount);
  const description = String(body.description || "Sentinel test payment").slice(0, 200);

  if (!Number.isFinite(amount) || amount < MIN_AMOUNT_RUPEES || amount > MAX_AMOUNT_RUPEES) {
    return Response.json(
      { error: `Amount must be between ₹${MIN_AMOUNT_RUPEES} and ₹${MAX_AMOUNT_RUPEES}` },
      { status: 400 }
    );
  }

  try {
    const client = getClient();
    const order = await client.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `sentinel_demo_${Date.now()}`,
      notes: { description, merchantId: merchant.id },
    });

    return Response.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      description,
    });
  } catch (err) {
    const message = err?.error?.description || err?.message || String(err);
    return Response.json({ error: `Could not create order: ${message}` }, { status: 502 });
  }
}
