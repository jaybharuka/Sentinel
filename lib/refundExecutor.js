import Razorpay from "razorpay";

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
 * Calls Razorpay's real Refund API for one payment. Never throws - the
 * policy gate's "auto_refund" decision must be recorded on the audit trail
 * regardless of whether the actual refund call succeeds, so failures are
 * returned as data, not exceptions.
 */
export async function executeRefund(paymentId, amountInPaise) {
  try {
    const client = getClient();
    const refund = await client.payments.refund(paymentId, { amount: amountInPaise });
    return { success: true, refundId: refund.id, status: refund.status };
  } catch (err) {
    const message =
      err?.error?.description || err?.message || String(err);
    return { success: false, error: message };
  }
}
