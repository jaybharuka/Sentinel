"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionsTable } from "@/components/dashboard/TransactionsTable";

const DECISION_TABS = [
  { value: "all", label: "All" },
  { value: "allow", label: "Allow" },
  { value: "hold_for_review", label: "Hold for review" },
  { value: "auto_refund", label: "Auto-refund" },
];

const SOURCE_TABS = [
  { value: "all", label: "All sources" },
  { value: "false", label: "Gemini" },
  { value: "true", label: "Fallback" },
];

function formatPercent(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatINR(value) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value, caption }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      {caption && (
        <CardContent>
          <p className="text-muted-foreground text-xs">{caption}</p>
        </CardContent>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [recentRows, setRecentRows] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    fetch("/api/metrics")
      .then((res) => res.json())
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    fetch("/api/transactions?pageSize=20")
      .then((res) => res.json())
      .then((data) => setRecentRows(data.rows || []))
      .catch(() => setRecentRows([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (decisionFilter !== "all") params.set("policyDecision", decisionFilter);
    if (sourceFilter !== "all") params.set("usedFallback", sourceFilter);

    fetch(`/api/transactions?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setAuditRows(data.rows || []);
        setAuditTotal(data.total || 0);
      })
      .catch(() => {
        setAuditRows([]);
        setAuditTotal(0);
      });
  }, [decisionFilter, sourceFilter, page]);

  const totalPages = Math.max(1, Math.ceil(auditTotal / pageSize));

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <div>
          <h1 className="text-2xl font-semibold">Sentinel</h1>
          <p className="text-muted-foreground text-sm">
            Explainable fraud &amp; chargeback risk guard — audit trail and held-out test metrics.
          </p>
        </div>

        {/* Metrics panel */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Held-out test set metrics</h2>
          {!metrics ? (
            <p className="text-muted-foreground text-sm">Loading metrics…</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Precision" value={formatPercent(metrics.precision)} />
              <StatCard label="Recall" value={formatPercent(metrics.recall)} />
              <StatCard label="F1" value={metrics.f1 != null ? metrics.f1.toFixed(3) : "—"} />
              <StatCard
                label="False-positive cost"
                value={formatINR(metrics.falsePositiveCost)}
                caption="₹ value of legitimate transactions wrongly flagged/refunded"
              />
              <StatCard
                label="Fallback rate"
                value={formatPercent(metrics.fallbackRate)}
                caption="Real Gemini free-tier throttling observed during testing — not a bug. Every one of those calls was caught and handled by the rule-based fallback, then still passed through the same policy gate."
              />
            </div>
          )}
          {metrics && (
            <p className="text-muted-foreground text-xs">
              {metrics.totalLabeled} labeled transactions · TP {metrics.truePositives} · FP{" "}
              {metrics.falsePositives} · FN {metrics.falseNegatives} · TN {metrics.trueNegatives}
            </p>
          )}
        </section>

        {/* Live / recent feed */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Recent transactions</h2>
          <p className="text-muted-foreground text-sm">
            Most recent 20 processed transactions. Click a row for Gemini/fallback reasons and the
            policy gate's decision.
          </p>
          <TransactionsTable rows={recentRows} />
        </section>

        {/* Audit trail */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Audit trail</h2>
            <p className="text-muted-foreground text-sm">
              Full log, filterable by policy decision and scoring source.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={decisionFilter}
              onValueChange={(v) => {
                setDecisionFilter(v);
                setPage(1);
              }}
            >
              <TabsList>
                {DECISION_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Tabs
              value={sourceFilter}
              onValueChange={(v) => {
                setSourceFilter(v);
                setPage(1);
              }}
            >
              <TabsList>
                {SOURCE_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <TransactionsTable rows={auditRows} />

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {auditTotal} matching transactions · page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
