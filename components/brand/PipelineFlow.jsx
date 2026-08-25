import { Webhook, Sparkles, GitBranch, FileCheck2, ArrowRight } from "lucide-react";

// A real, ordered pipeline (this is the literal request path, not a
// generic feature list dressed up as steps) - see lib/ingestTransaction.js.
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
    body: "Fixed rules, not the AI, check the score against your configured bounds and choose: allow, hold, or auto-refund.",
  },
  {
    icon: FileCheck2,
    title: "Logged, always",
    body: "Every decision, and the reasoning behind it, lands in the audit trail, whether or not it moved money.",
  },
];

export function PipelineFlow() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-4 md:gap-4">
      {STAGES.map((stage, i) => (
        <div key={stage.title} className="relative flex items-start gap-4 md:flex-col md:gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary md:size-11">
            <stage.icon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{stage.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{stage.body}</p>
          </div>
          {i < STAGES.length - 1 && (
            <ArrowRight
              className="absolute -right-2 top-4 hidden size-4 text-border md:block"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
