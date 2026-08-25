"use client";

import Link from "next/link";
import { Sparkles, ShoppingBag, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    Icon: Sparkles,
    title: "See the rules",
    body: "Every decision is gated by fixed bounds, not the AI's judgment alone.",
    href: "#policy-bounds",
    cta: "View policy bounds",
  },
  {
    Icon: ShoppingBag,
    title: "Make a purchase",
    body: "Shop the demo store and check out for real through Razorpay.",
    href: "/demo-store",
    cta: "Visit demo store",
  },
  {
    Icon: ShieldAlert,
    title: "Break it on purpose",
    body: "Simulate an AI outage and watch the rule-based fallback take over.",
    href: "#demo-outage",
    cta: "Try the outage demo",
  },
];

export function GettingStarted({ onDismiss }) {
  return (
    <section className="space-y-4 rounded-lg border-2 border-primary/30 bg-primary/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Start here</p>
          <h2 className="font-display mt-1 text-xl font-semibold">Welcome to Sentinel</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Three things worth trying, about 30 seconds each. No setup needed.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <step.Icon className="text-primary size-4" />
              <span className="text-muted-foreground font-mono text-xs">{i + 1}</span>
            </div>
            <p className="text-sm font-medium">{step.title}</p>
            <p className="text-muted-foreground flex-1 text-xs">{step.body}</p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href={step.href}>{step.cta}</Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
