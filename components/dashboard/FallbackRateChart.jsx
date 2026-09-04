"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{formatDateShort(label)}</p>
      <p className="font-mono text-muted-foreground">
        {p.fallbackRate != null ? `${(p.fallbackRate * 100).toFixed(1)}% fallback` : "no traffic"}
      </p>
      {p.total > 0 && <p className="font-mono text-muted-foreground">{p.total} scored</p>}
    </div>
  );
}

// Deliberately not one of the success/warning/refund decision colors -
// fallback rate is a provider-reliability signal, not a decision state, so
// borrowing that palette would imply a meaning it doesn't have. Uses
// primary instead, same as the rest of the app's non-decision accents.
export function FallbackRateChart({ data, loading }) {
  if (loading) {
    return <Skeleton className="h-56 w-full" aria-label="Loading fallback rate trend" />;
  }

  const hasVolume = data && data.some((d) => d.total > 0);
  if (!data || !hasVolume) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border">
        <p className="text-muted-foreground text-sm">No scored transactions in this range yet.</p>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Line chart of the daily fallback rate (share of transactions scored by the backup rule-based system instead of the AI model) over the selected date range."
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-border)" }} />
          <Line
            type="monotone"
            dataKey="fallbackRate"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
