"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// The signature element: a literal rendering of the real policy gate
// bounds (0.6 hold threshold, 0.9 auto-refund threshold, ₹2,000 cap - the
// actual defaults in lib/policyGate.js), not a generic stat/gradient hero.
// A transaction at risk 0.95 sweeps in and settles in the auto-refund
// zone on mount, spring-eased with a touch of overshoot rather than a
// linear CSS transition - the one deliberate motion moment on the page.
const ZONES = [
  { key: "allow", widthPct: 60, colorClass: "bg-success" },
  { key: "hold", widthPct: 30, colorClass: "bg-warning" },
  { key: "refund", widthPct: 10, colorClass: "bg-refund" },
];

const DEMO_RISK = 0.95;

export function GateVisualization() {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-xs text-muted-foreground">risk score</span>
        <span
          className={`font-mono text-sm font-semibold transition-opacity duration-700 ${settled ? "opacity-100" : "opacity-0"}`}
        >
          {DEMO_RISK.toFixed(2)}
        </span>
      </div>

      <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {ZONES.map((z) => (
          <div key={z.key} className={z.colorClass} style={{ width: `${z.widthPct}%` }} />
        ))}
        <motion.div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
          initial={{ left: "3%" }}
          animate={{ left: settled ? `${DEMO_RISK * 100}%` : "3%" }}
          transition={{ type: "spring", stiffness: 140, damping: 15 }}
        />
      </div>

      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>0.0</span>
        <span>0.6</span>
        <span>0.9</span>
        <span>1.0</span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" /> Allow
          </div>
          <p className="mt-0.5 text-muted-foreground">risk ≤ 0.6</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 font-medium text-warning">
            <span className="size-1.5 rounded-full bg-warning" /> Hold for review
          </div>
          <p className="mt-0.5 text-muted-foreground">risk &gt; 0.6</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 font-medium text-refund">
            <span className="size-1.5 rounded-full bg-refund" /> Auto-refund
          </div>
          <p className="mt-0.5 text-muted-foreground">risk &gt; 0.9, confidence &gt; 0.8, ≤ ₹2,000</p>
        </div>
      </div>
    </div>
  );
}
