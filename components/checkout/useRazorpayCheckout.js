"use client";

import { useState } from "react";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // ~60s - the webhook acks Razorpay fast, but
// scoring (AI + fallback + policy gate) runs fire-and-forget after, and
// real-world delivery (webhook retries, latency) can add more time on top
// of the scoring call itself.

/**
 * Shared create-order -> Checkout.js modal -> verify -> poll-for-result
 * flow, used by both CheckoutDemo (amount/description from a form) and
 * DemoStore (amount/description from a cart) - the flow itself is
 * identical either way, only where amount/description come from differs.
 *
 * Caller is responsible for rendering the Razorpay checkout.js <Script>
 * tag and only calling pay() once it has loaded (window.Razorpay defined).
 */
export function useRazorpayCheckout() {
  const [stage, setStage] = useState("idle"); // idle | creating | checkout | verifying | verify_failed | analyzing | found | timeout | error
  const [error, setError] = useState(null);
  const [paymentId, setPaymentId] = useState(null);
  const [foundTransaction, setFoundTransaction] = useState(null);

  async function pollForTransaction(txnId, attempt = 0) {
    try {
      const res = await fetch("/api/transactions?pageSize=10");
      const data = await res.json();
      const match = (data.rows || []).find((r) => r.txnId === txnId);
      if (match) {
        setFoundTransaction(match);
        setStage("found");
        return;
      }
    } catch {
      // keep polling despite a transient fetch error
    }
    if (attempt + 1 >= POLL_MAX_ATTEMPTS) {
      setStage("timeout");
      return;
    }
    setTimeout(() => pollForTransaction(txnId, attempt + 1), POLL_INTERVAL_MS);
  }

  async function pay({ amount, description }) {
    setError(null);

    if (!window.Razorpay) {
      setError("Razorpay checkout is still loading. Try again in a moment.");
      return;
    }

    setStage("creating");
    let order;
    try {
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, description }),
      });
      order = await res.json();
      if (!res.ok) {
        setError(order.error || "Could not create order");
        setStage("error");
        return;
      }
    } catch {
      setError("Could not create order");
      setStage("error");
      return;
    }

    setStage("checkout");

    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "Sentinel (test mode)",
      description: order.description,
      order_id: order.orderId,
      theme: { color: "#3B4CE0" },
      handler: async (response) => {
        setStage("verifying");
        try {
          const verifyRes = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok || !verifyData.verified) {
            setError(verifyData.error || "Signature verification failed");
            setStage("verify_failed");
            return;
          }
          setPaymentId(response.razorpay_payment_id);
          setStage("analyzing");
          pollForTransaction(response.razorpay_payment_id);
        } catch {
          setError("Could not verify payment");
          setStage("verify_failed");
        }
      },
      modal: {
        // Fires only when the user closes the modal before completing
        // payment - the success handler above hasn't run yet at this
        // point, so it's always safe to reset without checking current
        // stage (which would be stale here anyway, captured from the
        // render that called pay()).
        ondismiss: () => setStage("idle"),
      },
    });

    rzp.on("payment.failed", () => {
      setError("Payment failed or was cancelled in the Razorpay checkout.");
      setStage("error");
    });

    rzp.open();
  }

  function reset() {
    setStage("idle");
    setError(null);
    setPaymentId(null);
    setFoundTransaction(null);
  }

  return { stage, error, paymentId, foundTransaction, pay, reset };
}
