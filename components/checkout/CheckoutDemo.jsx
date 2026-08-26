"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
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
import { AnalyzingProgress } from "@/components/checkout/AnalyzingProgress";
import { useToast } from "@/components/ui/toast";

// Same fade+slide language as the dashboard's tab-body transitions.
const STAGE_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
const STAGE_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] };

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function CheckoutDemo() {
  const { toast } = useToast();
  const [scriptReady, setScriptReady] = useState(false);
  const [amount, setAmount] = useState("50");
  const [description, setDescription] = useState("Sentinel test payment");
  const { stage, error, paymentId, foundTransaction, pay, reset } = useRazorpayCheckout();

  useEffect(() => {
    if ((stage === "error" || stage === "verify_failed") && error) {
      toast({ title: "Payment couldn't complete", description: error, variant: "error" });
    }
  }, [stage, error, toast]);

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
            Opens Razorpay's real hosted checkout widget on this page, not a card form built by
            us. Test mode only. Test card:{" "}
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

          <AnimatePresence mode="wait">
            {stage === "checkout" && (
              <motion.p key="checkout" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="text-muted-foreground text-sm">
                Razorpay's checkout should be open now. Complete or close it to continue.
              </motion.p>
            )}

            {stage === "verifying" && (
              <motion.p key="verifying" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="text-muted-foreground text-sm">
                Verifying payment signature…
              </motion.p>
            )}

            {stage === "verify_failed" && (
              <motion.div key="verify_failed" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="space-y-3">
                <p className="text-destructive text-sm">{error}</p>
                <Button variant="outline" size="sm" onClick={reset}>
                  Try again
                </Button>
              </motion.div>
            )}

            {stage === "analyzing" && (
              <motion.div key="analyzing" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="space-y-3">
                <p className="text-sm font-medium">
                  Payment received. Sentinel is analyzing this transaction now…
                </p>
                <AnalyzingProgress />
                <p className="text-muted-foreground font-mono text-xs">payment_id: {paymentId}</p>
              </motion.div>
            )}

            {stage === "found" && foundTransaction && (
              <motion.div key="found" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="space-y-3">
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
              </motion.div>
            )}

            {stage === "timeout" && (
              <motion.div key="timeout" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION} className="space-y-3">
                <p className="text-sm font-medium">Still analyzing. This is taking longer than usual.</p>
                <p className="text-muted-foreground text-sm">
                  Your payment was verified successfully, so nothing's wrong on that end. It hasn't
                  shown up in the audit trail within a minute yet. Check the dashboard, it may
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
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </>
  );
}
