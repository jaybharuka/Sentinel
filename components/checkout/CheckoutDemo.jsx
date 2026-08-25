"use client";

import { useState } from "react";
import Script from "next/script";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DecisionIcon } from "@/components/brand/DecisionIcon";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // ~60s - the webhook acks Razorpay fast, but
// scoring (AI + fallback + policy gate) runs fire-and-forget after, and
// real-world delivery (webhook retries, tunnel latency in dev) can add more
// time on top of the scoring call itself.

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function CheckoutDemo() {
  const [scriptReady, setScriptReady] = useState(false);
  const [amount, setAmount] = useState("50");
  const [description, setDescription] = useState("Sentinel test payment");
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!scriptReady || !window.Razorpay) {
      setError("Razorpay checkout is still loading — try again in a moment.");
      return;
    }

    setStage("creating");
    let order;
    try {
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), description }),
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
        // render that called handleSubmit).
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

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Try a live test payment</CardTitle>
          <CardDescription>
            Opens Razorpay's real checkout — their hosted widget, not a card form built by us —
            directly on this page. Test mode only. Test card:{" "}
            <span className="font-mono">4386 2894 0766 0153</span>, any future expiry, OTP{" "}
            <span className="font-mono">1234</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(stage === "idle" || stage === "error" || stage === "creating") && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="amount">
                  Amount (₹)
                </label>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  max="5000"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="description">
                  Description
                </label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={stage === "creating" || !scriptReady} className="w-full">
                {stage === "creating"
                  ? "Creating order…"
                  : !scriptReady
                    ? "Loading checkout…"
                    : "Pay with Razorpay"}
              </Button>
            </form>
          )}

          {stage === "checkout" && (
            <p className="text-muted-foreground text-sm">
              Razorpay's checkout should be open now. Complete or close it to continue.
            </p>
          )}

          {stage === "verifying" && (
            <p className="text-muted-foreground text-sm">Verifying payment signature…</p>
          )}

          {stage === "verify_failed" && (
            <div className="space-y-3">
              <p className="text-destructive text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={reset}>
                Try again
              </Button>
            </div>
          )}

          {stage === "analyzing" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Payment received — Sentinel is analyzing this transaction now…
              </p>
              <p className="text-muted-foreground text-xs">
                This can take up to a minute — the AI scores it, then the policy gate decides.
              </p>
              <p className="text-muted-foreground font-mono text-xs">payment_id: {paymentId}</p>
            </div>
          )}

          {stage === "found" && foundTransaction && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Analysis complete.</p>
              <div className="flex items-center gap-2 rounded-md border p-3">
                <DecisionIcon decision={foundTransaction.policyDecision} className="size-5" />
                <div>
                  <p className="text-sm font-medium">{foundTransaction.policyDecision}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    risk {foundTransaction.riskScore?.toFixed(2)} · {formatINR(foundTransaction.amount)}
                  </p>
                </div>
                <Badge variant={foundTransaction.usedFallback ? "warning" : "success"} className="ml-auto">
                  {foundTransaction.usedFallback ? "Fallback" : "AI"}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm">
                  <Link href="/dashboard">View on dashboard</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={reset}>
                  Send another
                </Button>
              </div>
            </div>
          )}

          {stage === "timeout" && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Still analyzing — this is taking longer than usual.</p>
              <p className="text-muted-foreground text-sm">
                Your payment was verified successfully, so nothing's wrong on that end. It just
                hasn't shown up in the audit trail within a minute. Check the dashboard — it may
                already be there, or land in the next few seconds.
              </p>
              <div className="flex gap-2">
                <Button asChild size="sm">
                  <Link href="/dashboard">Go to dashboard</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={reset}>
                  Send another
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
