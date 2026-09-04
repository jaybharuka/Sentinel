"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

// Same three decision colors as everywhere else in the product (RiskGauge,
// GateVisualization, DecisionIcon, the badge variants) - referenced as the
// literal CSS custom properties rather than a second hardcoded palette, so
// a future token change (see app/globals.css's WCAG-driven adjustments)
// stays in sync here automatically instead of drifting.
const SERIES = [
  { key: "allow", label: "Allow", color: "var(--color-success)" },
  { key: "hold_for_review", label: "Hold for review", color: "var(--color-warning)" },
  { key: "auto_refund", label: "Auto-refund", color: "var(--color-refund)" },
];

function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{formatDateShort(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.fill }} />
            {SERIES.find((s) => s.key === p.dataKey)?.label}
          </span>
          <span className="font-mono">{p.value}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-border pt-1 font-mono text-muted-foreground">total {total}</p>
    </div>
  );
}

export function TransactionTrendChart({ data, loading }) {
  if (loading) {
    return <Skeleton className="h-64 w-full" aria-label="Loading transaction volume trend" />;
  }

  const hasVolume = data && data.some((d) => d.allow + d.hold_for_review + d.auto_refund > 0);
  if (!data || !hasVolume) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border">
        <p className="text-muted-foreground text-sm">No transaction volume in the last 30 days yet.</p>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`Bar chart of daily transaction volume over the last 30 days, split by decision: allow, hold for review, and auto-refund.`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateShort}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-muted-foreground">{SERIES.find((s) => s.key === value)?.label}</span>
            )}
          />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="decision" fill={s.color} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
