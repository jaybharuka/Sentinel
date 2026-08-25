"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

// Purely cosmetic time-based progression, not tied to real backend state -
// we have no server-pushed signal for "which step scoring is on" right now
// (it's one fire-and-forget async call, not a multi-stage job we track).
// The point is giving a sense of motion during a wait that can run up to
// ~60s, not literal accuracy per step - see lib/aiScoring.js for what's
// actually happening (a 3-tier provider chain, each tier retried once)
// during that window.
const STEPS = [
  { label: "Payment verified", atSeconds: 0 },
  { label: "Scoring risk", atSeconds: 1 },
  { label: "Checking policy", atSeconds: 14 },
  { label: "Finishing up", atSeconds: 25 },
];

export function AnalyzingProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const activeIndex = STEPS.reduce(
    (idx, step, i) => (elapsed >= step.atSeconds ? i : idx),
    0
  );

  return (
    <ol className="space-y-2">
      {STEPS.map((step, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={step.label} className="flex items-center gap-2 text-sm">
            {done ? (
              <Check className="text-success size-4 shrink-0" />
            ) : active ? (
              <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
            ) : (
              <span className="border-border size-4 shrink-0 rounded-full border" />
            )}
            <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
