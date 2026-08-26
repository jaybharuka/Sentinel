"use client";

import { motion } from "framer-motion";
import { Webhook, Sparkles, GitBranch, FileCheck2 } from "lucide-react";

// A real, ordered pipeline (this is the literal request path, not a
// generic feature list dressed up as steps) - see lib/ingestTransaction.js.
// "dominant" marks the stage that's actually the point of the product (the
// gate, not the AI) - it gets real type-scale/size weight instead of the
// other three, rather than four identical boxes with an icon each.
const STAGES = [
  {
    icon: Webhook,
    title: "Payment arrives",
    body: "Razorpay sends a signed webhook the moment a payment is captured or fails.",
  },
  {
    icon: Sparkles,
    title: "Sentinel AI scores it",
    body: "A risk score, a confidence level, and plain-English reasons, or a rule-based backup scorer if the model's unavailable.",
  },
  {
    icon: GitBranch,
    title: "The gate decides",
    body: "Fixed rules, not the AI, check the score against your configured bounds and choose: allow, hold, or auto-refund. This is the one step the AI cannot override.",
    dominant: true,
  },
  {
    icon: FileCheck2,
    title: "Logged, always",
    body: "Every decision, and the reasoning behind it, lands in the audit trail, whether or not it moved money.",
  },
];

export function PipelineFlow() {
  return (
    <ol className="relative max-w-2xl space-y-8">
      <motion.div
        className="absolute left-5 top-5 bottom-5 w-px origin-top bg-border"
        aria-hidden="true"
        initial={{ scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
      {STAGES.map((stage, i) => (
        <motion.li
          key={stage.title}
          className="relative flex items-start gap-5"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: i * 0.12 }}
        >
          <div
            className={`relative z-10 flex shrink-0 items-center justify-center rounded-full border bg-card text-primary ${
              stage.dominant ? "size-14 border-primary/40" : "size-10 border-border"
            }`}
          >
            <stage.icon className={stage.dominant ? "size-6" : "size-5"} aria-hidden="true" />
          </div>
          <div className={`min-w-0 ${stage.dominant ? "pt-1" : "pt-2"}`}>
            <h3 className={stage.dominant ? "font-display text-xl font-semibold" : "text-sm font-semibold"}>
              {stage.title}
            </h3>
            <p
              className={`mt-1 text-muted-foreground ${
                stage.dominant ? "max-w-md text-base" : "max-w-sm text-sm"
              }`}
            >
              {stage.body}
            </p>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
