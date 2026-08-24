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
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";

const HOW_IT_WORKS_SEEN_KEY = "sentinel_how_it_works_seen";

const DEMO_SCENARIOS = [
  { value: "clean", label: "Clean transaction" },
  { value: "suspicious", label: "Suspicious transaction" },
  { value: "auto_refund", label: "Auto-refund (forced)" },
];

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

function StatCard({ label, value, caption, info }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-1">
          {label}
          {info && <InfoTooltip text={info} />}
        </CardDescription>
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

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardContent() {
  const [howItWorksOpen, setHowItWorksOpen] = useState(true);
  const [bounds, setBounds] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [pendingRefunds, setPendingRefunds] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [recentRows, setRecentRows] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [demoScenario, setDemoScenario] = useState("clean");
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoResult, setDemoResult] = useState(null);

  function refetchRecent() {
    fetch("/api/transactions?pageSize=20")
      .then((res) => res.json())
      .then((data) => setRecentRows(data.rows || []))
      .catch(() => {});
    refetchAlerts();
    refetchPendingRefunds();
  }

  async function runDemo() {
    setDemoLoading(true);
    setDemoResult(null);
    try {
      const res = await fetch("/api/demo/simulate-outage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: demoScenario }),
      });
      const data = await res.json();
      setDemoResult(data);
      refetchRecent();
    } catch {
      setDemoResult({ error: "Demo call failed" });
    } finally {
      setDemoLoading(false);
    }
  }

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(HOW_IT_WORKS_SEEN_KEY);
      if (seen) {
        setHowItWorksOpen(false);
      } else {
        window.localStorage.setItem(HOW_IT_WORKS_SEEN_KEY, "1");
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) - default to open, harmless.
    }
  }, []);

  function refetchBounds() {
    fetch("/api/policy-bounds")
      .then((res) => res.json())
      .then(setBounds)
      .catch(() => setBounds(null));
  }

  useEffect(() => {
    refetchBounds();
  }, []);

  function refetchPendingRefunds() {
    fetch("/api/pending-refunds")
      .then((res) => res.json())
      .then(setPendingRefunds)
      .catch(() => setPendingRefunds(null));
  }

  useEffect(() => {
    refetchPendingRefunds();
  }, []);

  function refetchAlerts() {
    fetch("/api/alerts")
      .then((res) => res.json())
      .then((data) => setAlerts(data.alerts || []))
      .catch(() => setAlerts([]));
  }

  useEffect(() => {
    refetchAlerts();
  }, []);

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
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Sentinel</h1>
        <p className="text-muted-foreground text-sm">
          Explainable fraud &amp; chargeback risk guard — audit trail and held-out test metrics.
        </p>
      </div>

      {/* How this works */}
      <section className="rounded-lg border bg-muted/30">
        <button
          type="button"
          onClick={() => setHowItWorksOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium">How this works</span>
          <span className="text-muted-foreground text-xs">{howItWorksOpen ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {howItWorksOpen && (
          <div className="px-4 pb-4 text-sm text-muted-foreground space-y-1">
            <p>
              A payment comes in → Gemini (or a backup rule-based system if Gemini is
              unavailable) scores it for fraud risk and explains why → a separate, simple set of
              rules decides what happens (allow it, flag it for human review, or auto-refund it).
            </p>
            <p>
              The AI can only <em>suggest</em> — a fixed set of hard-coded rules is the only thing
              that can actually approve moving real money, and those rules are visible below.
              Everything that happens is logged in the audit trail at the bottom of this page.
            </p>
          </div>
        )}
      </section>

      {/* Policy bounds panel */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Policy Bounds</h2>
        {!bounds ? (
          <p className="text-muted-foreground text-sm">Loading policy bounds…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label="Max single auto-refund"
                value={formatINR(bounds.maxSingleRefund)}
                info="The system will never auto-refund more than this amount in a single transaction, no matter how confident the AI is."
              />
              <StatCard
                label="Daily refund budget"
                value={formatINR(bounds.dailyRefundCap)}
                info="A hard ceiling on total auto-refunds per day across all transactions — once hit, everything else gets flagged for a human instead."
              />
              <StatCard
                label="Auto-refund requires"
                value={`risk > ${bounds.minRiskScore} AND confidence > ${bounds.minConfidence}`}
                info="Both the risk score AND the confidence score have to clear their own bar before an auto-refund is even considered — one high number alone isn't enough."
              />
              <StatCard
                label="Hold-for-review threshold"
                value={`risk > ${bounds.holdThreshold}`}
                info="Above this risk score, a transaction gets flagged for a human to look at, even if it doesn't qualify for auto-refund."
              />
            </div>

            <Card>
              <CardHeader>
                <CardDescription>Today's auto-refund budget authorized</CardDescription>
                <CardTitle className="text-lg">
                  {formatINR(bounds.dailyAuthorizedToday)} / {formatINR(bounds.dailyRefundCap)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(() => {
                  const pct = Math.min(
                    100,
                    (bounds.dailyAuthorizedToday / bounds.dailyRefundCap) * 100
                  );
                  const barColor = pct >= 80 ? "bg-warning" : "bg-success";
                  return (
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  );
                })()}
                <p className="text-muted-foreground text-xs">
                  Counts approved auto_refund decisions, not confirmed successful Razorpay
                  refunds — a failed real refund still consumes budget, so a retry can't open
                  more room than was actually authorized.
                </p>
              </CardContent>
            </Card>

            <p className="text-muted-foreground text-xs">
              These bounds are enforced in code, not by the AI — Gemini can recommend an action,
              but only this policy gate can approve real money movement.
            </p>
          </>
        )}
      </section>

      {/* Pending refunds */}
      {pendingRefunds && pendingRefunds.count > 0 && (
        <section className="space-y-3 rounded-lg border-2 border-warning p-4">
          <div>
            <h2 className="text-lg font-medium">
              Pending refunds <Badge variant="warning">{pendingRefunds.count}</Badge>
            </h2>
            <p className="text-muted-foreground text-sm">
              Decision made, Razorpay call not yet resolved — usually just a call in flight,
              but if one stays here it means the process was interrupted mid-refund and this
              row needs a manual check against Razorpay's dashboard.
            </p>
          </div>
          <div className="rounded-lg border divide-y">
            {pendingRefunds.rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <span className="font-mono text-xs">{row.txnId}</span>
                <span>{formatINR(row.amount)}</span>
                <span className="text-muted-foreground text-xs">{formatDateTime(row.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
              info="How often the backup rule-based scorer ran instead of Gemini."
              caption={`${formatPercent(metrics.fallbackRate)} of transactions were scored by the backup rule-based system instead of the AI, usually due to Gemini's free-tier rate limits — this is expected and demonstrates graceful failure handling, not a bug. Every one of those calls still passed through the same policy gate.`}
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

      {/* Demo: simulate Gemini outage */}
      <section className="space-y-3 rounded-lg border-2 border-dashed p-4">
        <div>
          <h2 className="text-lg font-medium">Demo: Simulate Gemini Outage</h2>
          <p className="text-muted-foreground text-sm">
            Cosmetic demo control — runs one synthetic transaction through the real pipeline with
            the Gemini call forced to fail, so you can show the fallback path live. Does not call
            Gemini or touch GEMINI_API_KEY, and never executes a real Razorpay refund (all rows are
            tagged source: demo_simulated). Safe to click repeatedly.
          </p>
        </div>

        <Tabs value={demoScenario} onValueChange={setDemoScenario}>
          <TabsList>
            {DEMO_SCENARIOS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button onClick={runDemo} disabled={demoLoading}>
          {demoLoading ? "Simulating…" : "Run demo scenario"}
        </Button>

        {demoResult && !demoResult.error && (
          <div className="grid gap-3 md:grid-cols-2 pt-2">
            <Card>
              <CardHeader>
                <CardDescription>Before — Gemini call</CardDescription>
                <CardTitle className="text-base">Attempted, failed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <Badge variant="warning">Simulated outage</Badge>
                <p className="text-muted-foreground text-xs pt-1">{demoResult.geminiError}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>After — fallback heuristic</CardDescription>
                <CardTitle className="text-base">
                  risk {demoResult.riskScore?.toFixed(2)} · confidence{" "}
                  {demoResult.confidence?.toFixed(2)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {(demoResult.fallbackReasons || []).map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
                <div className="pt-1">
                  <Badge variant={demoResult.policyDecision === "allow" ? "outline" : "warning"}>
                    Policy: {demoResult.policyDecision}
                  </Badge>
                </div>
                {demoResult.policyDecision === "auto_refund" && (
                  <p className="text-muted-foreground text-xs pt-1 italic">
                    Demo mode: refund not actually executed (no real payment to refund). Real
                    auto-refund calls only fire for source: razorpay_live transactions.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        {demoResult?.error && (
          <p className="text-destructive text-sm">{demoResult.error}</p>
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

      {/* Alerts */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Alerts</h2>
          <p className="text-muted-foreground text-sm">
            Real email alerts sent to the merchant's registered address, with delivery status
            shown below.
          </p>
        </div>
        {alerts.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">
            No alerts yet. A hold_for_review or auto_refund decision on a real (razorpay_live)
            transaction will generate one.
          </p>
        ) : (
          <div className="rounded-lg border divide-y">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-4 px-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{alert.subject}</p>
                  <p className="text-muted-foreground text-xs">
                    to {alert.sentTo} · txn {alert.transaction?.txnId}
                  </p>
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  {alert.emailSent ? (
                    <Badge variant="success">sent</Badge>
                  ) : (
                    <Badge variant="destructive" title={alert.emailError || "unknown error"}>
                      failed
                    </Badge>
                  )}
                  <p className="text-muted-foreground text-xs">{formatDateTime(alert.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
  );
}
