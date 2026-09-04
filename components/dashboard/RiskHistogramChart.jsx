"use client";

import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

// Each bucket is colored by which zone its upper edge falls into - same
// three-zone grammar as RiskGauge/GateVisualization, so a bar's color here
// means the same thing it means everywhere else risk score shows up.
function bucketColor(bucketStart, holdThreshold, refundThreshold) {
  if (bucketStart >= refundThreshold) return "var(--color-refund)";
  if (bucketStart >= holdThreshold) return "var(--color-warning)";
  return "var(--color-success)";
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">risk {p.bucket}</p>
      <p className="font-mono text-muted-foreground">{p.count} transaction{p.count === 1 ? "" : "s"}</p>
    </div>
  );
}

export function RiskHistogramChart({ data, holdThreshold = 0.6, refundThreshold = 0.9, loading }) {
  if (loading) {
    return <Skeleton className="h-56 w-full" aria-label="Loading risk score distribution" />;
  }

  const hasVolume = data && data.some((d) => d.count > 0);
  if (!data || !hasVolume) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border">
        <p className="text-muted-foreground text-sm">No scored transactions yet.</p>
      </div>
    );
  }

  const chartData = data.map((d, i) => ({
    ...d,
    color: bucketColor(i / data.length, holdThreshold, refundThreshold),
  }));

  return (
    <div
      role="img"
      aria-label={`Histogram of risk scores across all scored transactions, in ${data.length} buckets from 0 to 1. Bars are colored by zone: allow up to ${holdThreshold.toFixed(1)}, hold for review up to ${refundThreshold.toFixed(1)}, auto-refund above.`}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="bucket"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
            interval={1}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
          <Bar dataKey="count" maxBarSize={36}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
