"use client";

import { motion } from "framer-motion";

// Same three-zone threshold-bar grammar as GateVisualization (the landing
// page's signature element), reused everywhere a risk score actually shows
// up in the product - the transactions table, the row-expansion detail, and
// the Policy & Signals tab - instead of that visual idea existing once on a
// marketing page and nowhere in the real product.
//
// Zone widths are driven by the merchant's real configured bounds (not the
// hardcoded demo constants GateVisualization uses pre-login), so this stays
// accurate if a merchant changes their thresholds in Settings.
//
// riskScore is optional: omit it for a reference-only zone diagram (Policy
// & Signals tab, showing "what the zones are" with no specific transaction
// in mind) rather than forcing a marker to render at 0.
//
// The marker's position is a spring, not a CSS transition - it settles into
// place with a touch of overshoot rather than easing linearly, so it reads
// as something that landed there, not a progress bar filling up.
export function RiskGauge({ riskScore, holdThreshold = 0.6, refundThreshold = 0.9, size = "sm" }) {
  const hasScore = typeof riskScore === "number" && Number.isFinite(riskScore);
  const clamped = hasScore ? Math.max(0, Math.min(1, riskScore)) : null;

  const allowPct = holdThreshold * 100;
  const holdPct = (refundThreshold - holdThreshold) * 100;
  const refundPct = (1 - refundThreshold) * 100;

  const isXs = size === "xs";

  return (
    <div className={isXs ? "w-16 shrink-0" : "w-full"}>
      <div
        className={`relative flex ${isXs ? "h-1.5" : "h-2.5"} w-full overflow-hidden rounded-full bg-muted`}
      >
        <div className="bg-success" style={{ width: `${allowPct}%` }} />
        <div className="bg-warning" style={{ width: `${holdPct}%` }} />
        <div className="bg-refund" style={{ width: `${refundPct}%` }} />
        {hasScore && (
          <motion.div
            className={`absolute top-1/2 ${isXs ? "size-2.5" : "size-3.5"} -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow`}
            initial={{ left: "3%", opacity: 0 }}
            animate={{ left: `${clamped * 100}%`, opacity: 1 }}
            transition={{
              left: { type: "spring", stiffness: 260, damping: 22 },
              opacity: { duration: 0.15 },
            }}
          />
        )}
      </div>
      {!isXs && (
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>0.0</span>
          <span>{holdThreshold.toFixed(1)}</span>
          <span>{refundThreshold.toFixed(1)}</span>
          <span>1.0</span>
        </div>
      )}
    </div>
  );
}
