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
import { useRazorpayCheckout } from "@/components/checkout/useRazorpayCheckout";

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function CheckoutDemo() {
  const [scriptReady, setScriptReady] = useState(false);
  const [amount, setAmount] = useState("50");
  const [description, setDescription] = useState("Sentinel test payment");
  const { stage, error, paymentId, foundTransaction, pay, reset } = useRazorpayCheckout();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!scriptReady) return;
    pay({ amount: Number(amount), description });
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
              <p className="text-muted-foreground text-center text-xs">
                Prefer shopping a real product grid?{" "}
                <Link href="/demo-store" className="underline">
                  Try the demo store
                </Link>
                .
              </p>
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
