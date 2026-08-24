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
    // The Razorpay SDK doesn't always throw an Error instance or a
    // populated { error: { description } } body - a plain 404 with no
    // response body has been observed to throw { statusCode, error:
    // undefined }, where both String(err) and err.message are useless
    // ("[object Object]" / undefined). Fall through to the status code,
    // then to a JSON dump, so the audit trail never records a
    // non-informative error string.
    const message =
      err?.error?.description ||
      err?.message ||
      (err?.statusCode ? `Razorpay API error (status ${err.statusCode})` : null) ||
      (() => {
        try {
          return JSON.stringify(err);
        } catch {
          return String(err);
        }
      })();
    return { success: false, error: message };
  }
}
