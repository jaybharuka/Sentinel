"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// The signature element: a literal rendering of the real policy gate
// bounds (0.6 hold threshold, 0.9 auto-refund threshold, ₹2,000 cap - the
// actual defaults in lib/policyGate.js), not a generic stat/gradient hero.
// On mount, the three zones draw themselves in left-to-right (an
// instrument powering on), then a transaction at risk 0.95 glides in and
// settles in the auto-refund zone - a slow, no-overshoot tween (not a
// bouncy spring) so it reads as a considered settle, not a toy animation.
// Once settled, the marker breathes with a slow, subtle pulse - a small
// "this is live" cue rather than a static dot.
const ZONES = [
  { key: "allow", widthPct: 60, colorClass: "bg-success", delay: 0 },
  { key: "hold", widthPct: 30, colorClass: "bg-warning", delay: 0.15 },
  { key: "refund", widthPct: 10, colorClass: "bg-refund", delay: 0.3 },
];

const DEMO_RISK = 0.95;

export function GateVisualization() {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 650);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full">
      <div className="relative flex h-6 w-full overflow-hidden rounded-full bg-muted sm:h-8">
        {ZONES.map((z) => (
          <motion.div
            key={z.key}
            className={`${z.colorClass} origin-left`}
            style={{ width: `${z.widthPct}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: z.delay }}
          />
        ))}
        <motion.div
          className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-background bg-foreground shadow sm:size-8"
          initial={{ left: "3%", opacity: 0 }}
          animate={
            settled
              ? { left: `${DEMO_RISK * 100}%`, opacity: 1, scale: [1, 1.12, 1] }
              : { left: "3%", opacity: 0 }
          }
          transition={
            settled
              ? {
                  left: { duration: 1.6, ease: [0.22, 1, 0.36, 1] },
                  opacity: { duration: 0.3 },
                  scale: { duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 1.6 },
                }
              : { duration: 0.2 }
          }
        />
      </div>

      {/* The two numbers that actually decide, given real typographic weight
          instead of buried in a small axis-label row - positioned at their
          real percentage along the bar, not decoratively placed. 0.9 is
          anchored from the right so it can never clip the edge on narrow
          viewports; 0.0/1.0 stay small since they're just the axis bounds. */}
      <div className="relative mt-3 h-11 sm:mt-4 sm:h-16">
        <span className="absolute left-0 top-1 font-mono text-[10px] text-muted-foreground sm:text-xs">
          0.0
        </span>
        <span
          className="absolute top-0 -translate-x-1/2 font-display text-2xl font-semibold leading-none sm:text-4xl lg:text-5xl"
          style={{ left: "60%" }}
        >
          0.6
        </span>
        <span
          className="absolute top-0 -translate-x-full font-display text-2xl font-semibold leading-none sm:text-4xl lg:text-5xl"
          style={{ left: "90%" }}
        >
          0.9
        </span>
        <span className="absolute right-0 top-1 font-mono text-[10px] text-muted-foreground sm:text-xs">
          1.0
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs sm:text-sm">
        <span className="flex items-center gap-1.5 font-medium text-success">
          <span className="size-1.5 rounded-full bg-success" /> Allow, risk ≤ 0.6
        </span>
        <span className="flex items-center gap-1.5 font-medium text-warning">
          <span className="size-1.5 rounded-full bg-warning" /> Hold for review, risk &gt; 0.6
        </span>
        <span className="flex items-center gap-1.5 font-medium text-refund">
          <span className="size-1.5 rounded-full bg-refund" /> Auto-refund, risk &gt; 0.9
        </span>
      </div>

      <p
        className={`mt-3 font-mono text-xs text-muted-foreground transition-opacity duration-700 ${settled ? "opacity-100" : "opacity-0"}`}
      >
        Live example: a transaction scores{" "}
        <span className="text-foreground font-semibold">{DEMO_RISK.toFixed(2)}</span> → auto-refund
        (confidence &gt; 0.8, ≤ ₹2,000).
      </p>
    </div>
  );
}
