"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TransactionTrendChart } from "@/components/dashboard/TransactionTrendChart";
import { FallbackRateChart } from "@/components/dashboard/FallbackRateChart";

const RANGE_TABS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function formatPercent(value) {
  return value == null ? "–" : `${(value * 100).toFixed(0)}%`;
}

function InsightStat({ label, value, caption }) {
  return (
    <div className="min-w-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="block font-mono text-4xl font-semibold leading-none tracking-tight">
        {value}
      </span>
      {caption && <p className="mt-2 max-w-xs text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

// A ranked horizontal bar list, not a Recharts chart - matches Stripe
// Radar's own "top risk factors" pattern (a scannable ranking, not a
// pie/donut that makes 12 slices unreadable), and stays in the same
// restrained-bar visual language RiskGauge and the budget gauge already
// use elsewhere rather than introducing a new chart type just for this.
function TopSignalsList({ signals, totalFlagged }) {
  if (!signals || signals.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">
        No flagged transactions in this range yet.
      </p>
    );
  }
  const maxCount = signals[0].count;
  return (
    <ul className="space-y-3">
      {signals.slice(0, 8).map((signal) => (
        <li key={signal.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">{signal.label}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              {signal.count} of {totalFlagged} flagged ({formatPercent(signal.pct)})
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="bg-warning-text h-full rounded-full"
              style={{ width: `${maxCount > 0 ? (signal.count / maxCount) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Insights() {
  const [days, setDays] = useState("30");
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  useEffect(() => {
    setTrendLoading(true);
    fetch(`/api/metrics/trend?days=${days}`)
      .then((res) => res.json())
      .then(setTrend)
      .catch(() => setTrend(null))
      .finally(() => setTrendLoading(false));

    setInsightsLoading(true);
    fetch(`/api/metrics/insights?days=${days}`)
      .then((res) => res.json())
      .then(setInsights)
      .catch(() => setInsights(null))
      .finally(() => setInsightsLoading(false));
  }, [days]);

  const pe = insights?.policyEffectiveness;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Insights</h2>
          <p className="text-muted-foreground text-sm">
            Fraud trends over time - all real data, computed from the audit trail, no new AI calls.
          </p>
        </div>
        <Tabs value={days} onValueChange={setDays}>
          <TabsList>
            {RANGE_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium">Volume &amp; decision mix</h3>
          <p className="text-muted-foreground text-sm">
            Transactions per day, split by what the policy gate decided.
          </p>
        </div>
        <TransactionTrendChart data={trend?.daily} loading={trendLoading} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <div>
            <h3 className="text-base font-medium">Fallback rate</h3>
            <p className="text-muted-foreground text-sm">
              How often the backup rule-based scorer ran instead of the AI model - rising means the
              provider chain is getting less reliable over this window.
            </p>
          </div>
          <FallbackRateChart data={trend?.daily} loading={trendLoading} />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-base font-medium">Policy effectiveness</h3>
            <p className="text-muted-foreground text-sm">
              Of flagged transactions a merchant has actually reviewed, how many were kept as-is
              vs. reversed - a rough read on whether the policy bounds are well-tuned.
            </p>
          </div>
          {insightsLoading ? (
            <div className="flex gap-8" aria-busy="true" aria-label="Loading policy effectiveness">
              <Skeleton className="h-14 w-24" />
              <Skeleton className="h-14 w-24" />
            </div>
          ) : !pe || pe.resolvedCount === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              Nothing reviewed in this range yet - approve or keep items in the Review Queue to
              build this stat up.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <InsightStat
                  label="Kept as-is"
                  value={formatPercent(pe.reviewedKeptPct)}
                  caption={`${pe.reviewedKept} of ${pe.resolvedCount} reviewed decisions confirmed unchanged.`}
                />
                <InsightStat
                  label="Overridden"
                  value={formatPercent(pe.overriddenPct)}
                  caption={`${pe.overridden} reversed by a merchant.`}
                />
              </div>
              {pe.pending > 0 && (
                <p className="text-muted-foreground text-xs">
                  {pe.pending} flagged transaction{pe.pending === 1 ? "" : "s"} in this range still
                  waiting in the Review Queue - not counted above.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium">Top risk signals</h3>
          <p className="text-muted-foreground text-sm">
            Which of the 12 deterministic signals show up most often on flagged transactions in
            this range - the same signal definitions used on the Transactions tab and the Policy
            &amp; Signals reference panel.
          </p>
        </div>
        {insightsLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading top risk signals">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <TopSignalsList signals={insights?.topSignals} totalFlagged={insights?.totalFlagged} />
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
