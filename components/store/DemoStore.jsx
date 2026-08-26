"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { DecisionIcon } from "@/components/brand/DecisionIcon";
import { useRazorpayCheckout } from "@/components/checkout/useRazorpayCheckout";
import { AnalyzingProgress } from "@/components/checkout/AnalyzingProgress";
import { useToast } from "@/components/ui/toast";

// Same fade+slide language as the dashboard's tab-body transitions - each
// checkout stage (checkout/verifying/found/etc.) gets one, keyed by stage
// name so AnimatePresence swaps them instead of an instant cut.
const STAGE_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
const STAGE_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] };

// Matches app/api/checkout/create-order/route.js's MAX_AMOUNT_RUPEES - kept
// as a duplicated client-side constant (not imported) since that route
// pulls in the server-only Razorpay SDK, which has no business in a client
// bundle. Checked here so a full cart shows a friendly inline message
// instead of a failed API call at checkout time.
const MAX_ORDER_RUPEES = 5000;
const MAX_QTY_PER_ITEM = 5;

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function DemoStore({ products }) {
  const { toast } = useToast();
  const [scriptReady, setScriptReady] = useState(false);
  const [cart, setCart] = useState({}); // productId -> qty
  const { stage, error, paymentId, foundTransaction, pay, reset } = useRazorpayCheckout();

  useEffect(() => {
    if ((stage === "error" || stage === "verify_failed") && error) {
      toast({ title: "Payment couldn't complete", description: error, variant: "error" });
    }
  }, [stage, error, toast]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === Number(id)), qty }))
        .filter((item) => item.product && item.qty > 0),
    [cart, products]
  );

  const total = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.product.price * item.qty, 0),
    [cartItems]
  );

  function setQty(productId, qty) {
    setCart((prev) => ({ ...prev, [productId]: Math.max(0, Math.min(MAX_QTY_PER_ITEM, qty)) }));
  }

  function addToCart(productId) {
    setQty(productId, (cart[productId] || 0) + 1);
  }

  function buildDescription() {
    const summary = cartItems.map((item) => `${item.qty}x ${item.product.title}`).join(", ");
    return summary.slice(0, 200);
  }

  async function handleCheckout() {
    if (!scriptReady || cartItems.length === 0) return;
    pay({ amount: Math.round(total * 100) / 100, description: buildDescription() });
  }

  const overCap = total > MAX_ORDER_RUPEES;
  const showStorefront = stage === "idle" || stage === "error";

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Demo Store</h1>
        <p className="text-muted-foreground text-sm">
          Real product data from{" "}
          <a href="https://fakestoreapi.com" target="_blank" rel="noreferrer" className="underline">
            FakeStoreAPI
          </a>
          . Add items to your cart and check out through Razorpay's real hosted checkout, the
          same pipeline as everything else on this dashboard. Prices are USD amounts relabeled as
          ₹ for this test-mode demo, not a live currency conversion.{" "}
          <Link href="/demo-payment" className="underline">
            Prefer a plain amount instead? Use the quick test payment.
          </Link>
        </p>
      </div>

      {showStorefront && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {products.map((product) => (
              <Card key={product.id} className="flex flex-col overflow-hidden py-0">
                <div className="flex aspect-square items-center justify-center bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external FakeStoreAPI CDN image, not worth a next/image remote-pattern config for a demo */}
                  <img
                    src={product.image}
                    alt={product.title}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <CardContent className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 flex-1 text-xs font-medium">{product.title}</p>
                  <p className="font-mono text-sm font-semibold">{formatINR(product.price)}</p>
                  {cart[product.id] > 0 ? (
                    <div className="flex items-center justify-between gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="size-7 p-0"
                        onClick={() => setQty(product.id, cart[product.id] - 1)}
                      >
                        −
                      </Button>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={cart[product.id]}
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                          className="font-mono text-sm"
                        >
                          {cart[product.id]}
                        </motion.span>
                      </AnimatePresence>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="size-7 p-0"
                        disabled={cart[product.id] >= MAX_QTY_PER_ITEM}
                        onClick={() => setQty(product.id, cart[product.id] + 1)}
                      >
                        +
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" onClick={() => addToCart(product.id)}>
                      Add to cart
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="h-fit lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle className="font-display text-lg">Cart</CardTitle>
              <CardDescription>
                {cartItems.length === 0
                  ? "No items yet"
                  : `${cartItems.reduce((n, i) => n + i.qty, 0)} item(s)`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {cartItems.length === 0 ? (
                <p className="text-muted-foreground text-sm">Add a product to get started.</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    <AnimatePresence initial={false}>
                      {cartItems.map(({ product, qty }) => (
                        <motion.li
                          key={product.id}
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                          className="flex items-center justify-between gap-2 text-sm overflow-hidden"
                        >
                          <span className="line-clamp-1">{qty}x {product.title}</span>
                          <span className="font-mono shrink-0">{formatINR(product.price * qty)}</span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                  <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-medium">
                    <span>Total</span>
                    <span className="font-mono">{formatINR(total)}</span>
                  </div>
                  {overCap && (
                    <p className="text-destructive text-xs">
                      Cart total exceeds the ₹{MAX_ORDER_RUPEES.toLocaleString("en-IN")} test-mode
                      order limit. Remove an item or reduce a quantity to check out.
                    </p>
                  )}
                  {error && <p className="text-destructive text-xs">{error}</p>}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!scriptReady || overCap || stage === "creating"}
                    onClick={handleCheckout}
                  >
                    {stage === "creating"
                      ? "Creating order…"
                      : !scriptReady
                        ? "Loading checkout…"
                        : `Checkout · ${formatINR(total)}`}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <AnimatePresence mode="wait">
        {stage === "checkout" && (
          <motion.div key="checkout" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
            <Card>
              <CardContent className="py-6">
                <p className="text-muted-foreground text-sm">
                  Razorpay's checkout should be open now. Complete or close it to continue.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage === "verifying" && (
          <motion.div key="verifying" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
            <Card>
              <CardContent className="py-6">
                <p className="text-muted-foreground text-sm">Verifying payment signature…</p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage === "verify_failed" && (
          <motion.div key="verify_failed" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
            <Card>
              <CardContent className="space-y-3 py-6">
                <p className="text-destructive text-sm">{error}</p>
                <Button variant="outline" size="sm" onClick={reset}>
                  Back to store
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage === "analyzing" && (
          <motion.div key="analyzing" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
            <Card>
              <CardContent className="space-y-3 py-6">
                <p className="text-sm font-medium">
                  Purchase received. Sentinel is analyzing this transaction now…
                </p>
                <AnalyzingProgress />
                <p className="text-muted-foreground font-mono text-xs">payment_id: {paymentId}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {stage === "found" && foundTransaction && (
          <motion.div key="found" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
            <Card>
              <CardContent className="space-y-3 py-6">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCart({});
                      reset();
                    }}
                  >
                    Shop again
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      {stage === "timeout" && (
        <motion.div key="timeout" variants={STAGE_VARIANTS} initial="initial" animate="animate" exit="exit" transition={STAGE_TRANSITION}>
        <Card>
          <CardContent className="space-y-3 py-6">
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCart({});
                  reset();
                }}
              >
                Shop again
              </Button>
            </div>
          </CardContent>
        </Card>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
