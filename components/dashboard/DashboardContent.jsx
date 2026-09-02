"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
import { DecisionIcon } from "@/components/brand/DecisionIcon";
import { RiskGauge } from "@/components/brand/RiskGauge";
import { SIGNAL_CATEGORIES, SIGNAL_DEFS } from "@/components/dashboard/riskSignals";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import { StaggerContainer, StaggerItem } from "@/components/motion/Stagger";
import { useToast } from "@/components/ui/toast";

const HOW_IT_WORKS_SEEN_KEY = "sentinel_how_it_works_seen";
const GETTING_STARTED_SEEN_KEY = "sentinel_getting_started_seen";
const DEFAULT_TAB = "overview";

const DASHBOARD_TABS = [
  { value: "overview", label: "Overview" },
  { value: "transactions", label: "Transactions" },
  { value: "policy-signals", label: "Policy & Signals" },
  { value: "demo", label: "Demo & Testing" },
  { value: "alerts", label: "Alerts" },
];

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
  { value: "false", label: "AI" },
  { value: "true", label: "Fallback" },
];

// Tab-body entrance: a quick fade+slide on mount, and a slight reverse-slide
// on exit - AnimatePresence's mode="wait" makes the outgoing tab finish its
// exit before the incoming one starts, so the two never overlap/jank.
const TAB_VARIANTS = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
const TAB_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] };

function formatPercent(value) {
  return value == null ? "–" : `${(value * 100).toFixed(1)}%`;
}

function formatINR(value) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// One dominant, unboxed number per stat group instead of a row of identical
// boxes - the headline figure for that section (which number is "dominant"
// varies section to section, deliberately, so the five stat groups on this
// page don't all repeat the same shape). Supporting figures sit beside it as
// a compact list, not a matching grid of their own.
function FeaturedStat({ label, value, caption, info }) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {info && <InfoTooltip text={info} />}
      </span>
      <span className="block font-mono text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
        {value}
      </span>
      {caption && <p className="mt-2 max-w-xs text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

function StatList({ items, className }) {
  return (
    <dl className={`divide-y divide-border border-t border-border ${className || ""}`}>
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4 py-2">
          <dt className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {item.label}
            {item.info && <InfoTooltip text={item.info} />}
          </dt>
          <dd className="font-mono text-sm font-medium text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const activeTab = DASHBOARD_TABS.some((t) => t.value === searchParams.get("tab"))
    ? searchParams.get("tab")
    : DEFAULT_TAB;

  function handleTabChange(value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === DEFAULT_TAB) {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const query = params.toString();
    // A real history entry per tab, not a replace - so browser back/forward
    // moves between tabs the way it would between pages, per the request
    // that back/forward navigation behave correctly.
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const [howItWorksOpen, setHowItWorksOpen] = useState(true);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(true);
  const [bounds, setBounds] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [benchmarkMetrics, setBenchmarkMetrics] = useState(null);
  const [liveMetrics, setLiveMetrics] = useState(null);
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

  // All data fetching lives here, in the parent, regardless of which tab is
  // active - only the rendered markup switches with activeTab. This state
  // (and the effects below) are untouched by which tab is showing, so
  // switching tabs never re-fetches anything already loaded.
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

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(GETTING_STARTED_SEEN_KEY);
      if (seen) {
        setGettingStartedOpen(false);
      } else {
        window.localStorage.setItem(GETTING_STARTED_SEEN_KEY, "1");
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) - default to open, harmless.
    }
  }, []);

  function dismissGettingStarted() {
    setGettingStartedOpen(false);
    toast({
      title: "You're set",
      description: "Won't show this again on this browser.",
      variant: "info",
    });
  }

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
    fetch("/api/metrics/benchmark")
      .then((res) => res.json())
      .then(setBenchmarkMetrics)
      .catch(() => setBenchmarkMetrics(null));
  }, []);

  useEffect(() => {
    fetch("/api/metrics/live")
      .then((res) => res.json())
      .then(setLiveMetrics)
      .catch(() => setLiveMetrics(null));
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
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Dashboard</p>
        <h1 className="mt-1 text-2xl font-semibold">Sentinel</h1>
        <p className="text-muted-foreground text-sm">
          Explainable fraud &amp; chargeback risk guard, with an audit trail and held-out test metrics.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-6">
        <TabsList>
          {DASHBOARD_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          role="tabpanel"
          variants={TAB_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={TAB_TRANSITION}
        >
          {/* ============ OVERVIEW ============ */}
          {activeTab === "overview" && (
            <StaggerContainer className="space-y-8">
              {gettingStartedOpen && (
                <StaggerItem>
                  <GettingStarted onDismiss={dismissGettingStarted} />
                </StaggerItem>
              )}

              <StaggerItem>
                <section className="rounded-lg border border-border bg-secondary/50">
                  <button
                    type="button"
                    onClick={() => setHowItWorksOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm font-medium">How this works</span>
                    <span className="text-muted-foreground text-xs">
                      {howItWorksOpen ? "Hide ▲" : "Show ▼"}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {howItWorksOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 text-sm text-muted-foreground space-y-1">
                          <p>
                            The AI is never trusted with money. It scores every payment for fraud risk
                            and explains why — but a separate, fixed set of rules is the only thing that
                            decides what actually happens (allow it, flag it for human review, or
                            auto-refund it), and the only thing that can approve moving real money.
                          </p>
                          <p>
                            If the AI is unavailable, a backup rule-based system scores the payment
                            instead — either way, the same rules decide the outcome. Those rules are
                            visible on the Policy &amp; Signals tab, and everything that happens is
                            logged in the audit trail on the Transactions tab.
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              </StaggerItem>

              {/* Condensed stats row */}
              <StaggerItem>
                <section className="space-y-3">
                  <h2 className="text-lg font-medium">At a glance</h2>
                  {!metrics ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  ) : (
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
                      <FeaturedStat label="Recall" value={formatPercent(metrics.recall)} />
                      <StatList
                        className="sm:max-w-xs sm:flex-1"
                        items={[
                          { label: "Precision", value: formatPercent(metrics.precision) },
                          {
                            label: "Fallback rate",
                            value: formatPercent(metrics.fallbackRate),
                            info: "How often the backup rule-based scorer ran instead of the AI model - either way, the same policy gate decides what happens.",
                          },
                        ]}
                      />
                    </div>
                  )}
                </section>
              </StaggerItem>

              {/* Today's budget gauge */}
              <StaggerItem>
                <section className="space-y-3">
                  {!bounds ? (
                    <p className="text-muted-foreground text-sm">Loading budget…</p>
                  ) : (
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
                              <motion.div
                                className={`h-full rounded-full ${barColor}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                              />
                            </div>
                          );
                        })()}
                        <p className="text-muted-foreground text-xs">
                          Counts approved auto_refund decisions, not confirmed successful Razorpay
                          refunds. A failed real refund still consumes budget, so a retry can't open
                          more room than was actually authorized.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </section>
              </StaggerItem>

              {/* Pending refunds */}
              {pendingRefunds && pendingRefunds.count > 0 && (
                <StaggerItem>
                  <section className="space-y-3 rounded-lg border-2 border-warning p-4">
                    <div>
                      <h2 className="text-lg font-medium">
                        Pending refunds <Badge variant="warning">{pendingRefunds.count}</Badge>
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        Decision made, Razorpay call not yet resolved. Usually a call in flight, but if
                        one stays here it means the process was interrupted mid-refund, and this row
                        needs a manual check against Razorpay's dashboard.
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
                </StaggerItem>
              )}

              {/* Recent activity preview */}
              <StaggerItem>
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-medium">Recent activity</h2>
                      <p className="text-muted-foreground text-sm">The 5 most recent transactions.</p>
                    </div>
                    <Link
                      href={pathname + "?tab=transactions"}
                      onClick={(e) => {
                        e.preventDefault();
                        handleTabChange("transactions");
                      }}
                      className="text-primary shrink-0 text-sm underline"
                    >
                      View all transactions →
                    </Link>
                  </div>
                  <TransactionsTable
                    rows={recentRows.slice(0, 5)}
                    bounds={bounds}
                    emptyMessage="No transactions yet."
                    emptyAction={
                      <div className="flex justify-center gap-2">
                        <Button asChild size="sm">
                          <Link href="/demo-store">Try the demo store</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link href="/demo-payment">Make a test payment</Link>
                        </Button>
                      </div>
                    }
                  />
                </section>
              </StaggerItem>

              {/* Full held-out metrics detail */}
              <StaggerItem>
                <section className="space-y-3">
                  <h2 className="text-lg font-medium">Held-out test set metrics</h2>
                  {!metrics ? (
                    <p className="text-muted-foreground text-sm">Loading metrics…</p>
                  ) : (
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
                      <FeaturedStat
                        label="F1"
                        value={metrics.f1 != null ? metrics.f1.toFixed(3) : "–"}
                        caption="Harmonic mean of precision and recall on the 400-row held-out synthetic test set."
                      />
                      <StatList
                        className="sm:max-w-sm sm:flex-1"
                        items={[
                          { label: "Precision", value: formatPercent(metrics.precision) },
                          { label: "Recall", value: formatPercent(metrics.recall) },
                          {
                            label: "False-positive cost",
                            value: formatINR(metrics.falsePositiveCost),
                            info: "₹ value of legitimate transactions wrongly flagged/refunded.",
                          },
                          {
                            label: "Fallback rate",
                            value: formatPercent(metrics.fallbackRate),
                            info: "How often the backup rule-based scorer ran instead of the AI model, usually due to rate limits on the model provider. Every one of those calls still passed through the same policy gate.",
                          },
                        ]}
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
              </StaggerItem>

              {/* External Benchmark: Kaggle Credit Card Fraud Dataset */}
              <StaggerItem>
                <section className="space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-medium">External Benchmark (Kaggle Credit Card Fraud Dataset)</h2>
                      <Badge variant="outline" className="text-muted-foreground text-[10px] font-normal uppercase tracking-wide">
                        Secondary validation
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Run against a real, publicly available, independently-labeled fraud dataset not
                      authored by us. Feature mapping is necessarily partial since this dataset's
                      fields are anonymized; see the methodology note below.
                    </p>
                  </div>
                  {!benchmarkMetrics ? (
                    <p className="text-muted-foreground text-sm">Loading benchmark metrics…</p>
                  ) : benchmarkMetrics.totalScored === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Not yet run. See scripts/sampleKaggleDataset.js and
                      app/api/seed/kaggle-benchmark.
                    </p>
                  ) : (
                    <>
                      {/* Compact list only here, deliberately no FeaturedStat - this
                          number shouldn't compete visually with the 93% recall
                          headline above; see the methodology note for why 0% is
                          the honest, expected result on this reduced signal set. */}
                      <StatList
                        className="max-w-md"
                        items={[
                          {
                            label: "Recall",
                            value: formatPercent(benchmarkMetrics.recall),
                            info: "Deliberately near-zero on this reduced-signal dataset - honest abstention, not failure. See the note below.",
                          },
                          { label: "Precision", value: formatPercent(benchmarkMetrics.precision) },
                          {
                            label: "F1",
                            value: benchmarkMetrics.f1 != null ? benchmarkMetrics.f1.toFixed(3) : "–",
                          },
                          {
                            label: "Scored so far",
                            value: `${benchmarkMetrics.totalScored} / ${benchmarkMetrics.datasetSize}`,
                            info: "Rows from the sampled subset run through the pipeline.",
                          },
                          { label: "Fallback rate", value: formatPercent(benchmarkMetrics.fallbackRate) },
                        ]}
                      />

                      <Card className="border-warning/40 bg-warning/5">
                        <CardHeader>
                          <CardTitle className="font-display text-base">
                            Methodology &amp; honest abstention
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm text-muted-foreground">
                          <p>
                            This dataset (
                            <a
                              href={benchmarkMetrics.datasetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-foreground underline"
                            >
                              {benchmarkMetrics.datasetSource}
                            </a>
                            ) only exposes <code className="font-mono text-xs">Time</code>,{" "}
                            <code className="font-mono text-xs">Amount</code>, and 28 PCA-anonymized
                            columns published specifically so no one, including us, can recover what
                            they represent. Of our 12 signals, only two have an honest equivalent here:
                            the raw amount, and an approximate odd-hour signal derived from elapsed
                            time. The other ten (velocity, chargeback history, merchant context,
                            account age, and the rest) don't exist for this data. There's no customer,
                            email, or merchant history to compute them from, so they're omitted rather
                            than defaulted to a fake "clean" value.
                          </p>
                          <p>
                            With only two weak signals available, the system correctly never crosses
                            its hold-for-review threshold on this sample: 0% recall, and precision is
                            undefined because zero positive predictions were made at all. That's{" "}
                            <strong className="text-foreground">honest abstention, not failure</strong>:
                            it declines to fabricate confidence it doesn't have, rather than
                            hallucinating a fraud signal out of data that can't actually support one.
                            The same scoring pipeline and policy gate that catch real signals in the
                            synthetic and live data above have nothing to work with here, which is
                            itself evidence the system isn't pattern-matching noise into false
                            positives.
                          </p>
                        </CardContent>
                      </Card>
                    </>
                  )}
                </section>
              </StaggerItem>

              {/* Live Accuracy: accumulating from real Razorpay transactions */}
              <StaggerItem>
                <section className="space-y-3">
                  <div>
                    <h2 className="text-lg font-medium">
                      Live Accuracy (accumulating from real Razorpay transactions)
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      Precision/recall computed only from real payments with a confirmed real-world
                      outcome: a genuine dispute via Razorpay's{" "}
                      <code className="font-mono text-xs">payment.dispute.created</code> webhook
                      retroactively labels the original transaction as fraud. This grows as real
                      disputes (and, over time, more confirmed-clean volume) accumulate. It is not
                      synthetic.
                    </p>
                  </div>
                  {!liveMetrics ? (
                    <p className="text-muted-foreground text-sm">Loading live metrics…</p>
                  ) : liveMetrics.totalLabeled === 0 ? (
                    <p className="text-muted-foreground text-sm italic">
                      N=0 real transactions with a confirmed outcome so far. No disputes have landed
                      on a live payment yet. This panel activates automatically the moment one does;
                      it's shown here to demonstrate the mechanism is live and real, not a simulation.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
                        <FeaturedStat label="N (confirmed outcomes)" value={liveMetrics.totalLabeled} />
                        <StatList
                          className="sm:max-w-xs sm:flex-1"
                          items={[
                            { label: "Precision", value: formatPercent(liveMetrics.precision) },
                            { label: "Recall", value: formatPercent(liveMetrics.recall) },
                            {
                              label: "F1",
                              value: liveMetrics.f1 != null ? liveMetrics.f1.toFixed(3) : "–",
                            },
                          ]}
                        />
                      </div>
                      <p className="text-muted-foreground text-xs italic">
                        N={liveMetrics.totalLabeled} real transaction
                        {liveMetrics.totalLabeled === 1 ? "" : "s"} with a confirmed outcome so far,
                        too small to be statistically meaningful yet. Shown for transparency and to
                        demonstrate the ground-truth mechanism is live and real, not synthetic.
                      </p>
                    </>
                  )}
                </section>
              </StaggerItem>
            </StaggerContainer>
          )}

          {/* ============ TRANSACTIONS ============ */}
          {activeTab === "transactions" && (
            <StaggerContainer className="space-y-4">
              <StaggerItem>
                <div>
                  <h2 className="text-lg font-medium">Transactions</h2>
                  <p className="text-muted-foreground text-sm">
                    Full audit trail, filterable by policy decision and scoring source. Click a row for
                    AI/fallback reasons and the policy gate's decision.
                  </p>
                </div>
              </StaggerItem>

              <StaggerItem className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
              </StaggerItem>

              <StaggerItem>
                <TransactionsTable
                  rows={auditRows}
                  bounds={bounds}
                  emptyMessage="No transactions match these filters."
                  emptyAction={
                    <div className="flex justify-center gap-2">
                      <Button asChild size="sm">
                        <Link href="/demo-store">Try the demo store</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/demo-payment">Make a test payment</Link>
                      </Button>
                    </div>
                  }
                />
              </StaggerItem>

              <StaggerItem className="flex items-center justify-between">
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
              </StaggerItem>
            </StaggerContainer>
          )}

          {/* ============ POLICY & SIGNALS ============ */}
          {activeTab === "policy-signals" && (
            <StaggerContainer className="space-y-10">
              <StaggerItem id="policy-bounds" className="scroll-mt-6 space-y-3">
                <h2 className="text-lg font-medium">Policy Bounds</h2>
                {!bounds ? (
                  <p className="text-muted-foreground text-sm">Loading policy bounds…</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
                      <FeaturedStat
                        label="Daily refund budget"
                        value={formatINR(bounds.dailyRefundCap)}
                        info="A hard ceiling on total auto-refunds per day across all transactions. Once hit, everything else gets flagged for a human instead."
                      />
                      <StatList
                        className="sm:max-w-sm sm:flex-1"
                        items={[
                          {
                            label: "Max single auto-refund",
                            value: formatINR(bounds.maxSingleRefund),
                            info: "The system will never auto-refund more than this amount in a single transaction, no matter how confident the AI is.",
                          },
                          {
                            label: "Auto-refund requires",
                            value: `risk > ${bounds.minRiskScore} AND confidence > ${bounds.minConfidence}`,
                            info: "Both the risk score AND the confidence score have to clear their own bar before an auto-refund is considered.",
                          },
                          {
                            label: "Hold-for-review threshold",
                            value: `risk > ${bounds.holdThreshold}`,
                            info: "Above this risk score, a transaction gets flagged for a human to look at, even if it doesn't qualify for auto-refund.",
                          },
                        ]}
                      />
                    </div>

                    <Card>
                      <CardHeader>
                        <CardDescription>Risk zones</CardDescription>
                        <CardTitle className="text-lg">
                          Where a score lands decides what happens
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <RiskGauge holdThreshold={bounds.holdThreshold} refundThreshold={bounds.minRiskScore} />
                      </CardContent>
                    </Card>

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
                              <motion.div
                                className={`h-full rounded-full ${barColor}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                              />
                            </div>
                          );
                        })()}
                        <p className="text-muted-foreground text-xs">
                          Counts approved auto_refund decisions, not confirmed successful Razorpay
                          refunds. A failed real refund still consumes budget, so a retry can't open
                          more room than was actually authorized.
                        </p>
                      </CardContent>
                    </Card>

                    <p className="text-muted-foreground text-xs">
                      These bounds are enforced in code, not by the AI. The model can recommend an
                      action, but only this policy gate can approve real money movement.
                    </p>
                  </>
                )}
              </StaggerItem>

              <StaggerItem className="space-y-3">
                <div>
                  <h2 className="text-lg font-medium">Risk Signals</h2>
                  <p className="text-muted-foreground text-sm">
                    Every payment is evaluated against these 12 deterministic signals before scoring,
                    the same multi-signal philosophy as Razorpay's own Vulcan model, deliberately
                    kept small and explainable rather than a black-box foundation model.
                  </p>
                </div>
                <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {SIGNAL_CATEGORIES.map((category) => {
                    const signals = SIGNAL_DEFS.filter((s) => s.category === category.key);
                    return (
                      <StaggerItem key={category.key}>
                        <Card className="border-border/80">
                          <CardHeader>
                            <CardDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
                              <category.Icon className="size-3.5" />
                              {category.label} ({signals.length})
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2.5 pt-0">
                            {signals.map((signal) => (
                              <div key={signal.key} className="flex items-start gap-2">
                                <signal.Icon className="text-primary mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm leading-tight font-medium">{signal.label}</p>
                                  <p className="text-muted-foreground text-xs leading-tight">
                                    {signal.blurb}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </StaggerItem>
                    );
                  })}
                </StaggerContainer>
              </StaggerItem>
            </StaggerContainer>
          )}

          {/* ============ DEMO & TESTING ============ */}
          {activeTab === "demo" && (
            <StaggerContainer className="space-y-8">
              <StaggerItem className="space-y-3">
                <div>
                  <h2 className="text-lg font-medium">Try it yourself</h2>
                  <p className="text-muted-foreground text-sm">
                    Send a real payment through the actual pipeline: Razorpay's hosted checkout,
                    real signature verification, real scoring.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href="/demo-store">Visit demo store →</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/demo-payment">Quick test payment</Link>
                  </Button>
                </div>
              </StaggerItem>

              <StaggerItem
                id="demo-outage"
                className="scroll-mt-6 space-y-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/[0.03] p-4"
              >
                <div>
                  <h2 className="text-lg font-medium">Demo: Simulate AI Scoring Outage</h2>
                  <p className="text-muted-foreground text-sm">
                    Cosmetic demo control. Runs one synthetic transaction through the real pipeline
                    with the AI scoring call forced to fail, so you can show the fallback path live.
                    Does not call the AI provider, and never executes a real Razorpay refund (all
                    rows are tagged source: demo_simulated). Safe to click repeatedly.
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

                <Button
                  onClick={async () => {
                    await runDemo();
                    toast({
                      title: "Demo scenario complete",
                      description: "Check the result below, and Recent Activity on Overview.",
                      variant: "success",
                    });
                  }}
                  disabled={demoLoading}
                >
                  {demoLoading ? "Simulating…" : "Run demo scenario"}
                </Button>

                <AnimatePresence mode="wait">
                  {demoResult && !demoResult.error && (
                    <motion.div
                      key="demo-result"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="grid gap-3 md:grid-cols-2 pt-2"
                    >
                      <Card>
                        <CardHeader>
                          <CardDescription>Before: AI scoring call</CardDescription>
                          <CardTitle className="text-base">Attempted, failed</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                          <Badge variant="warning">Simulated outage</Badge>
                          <p className="text-muted-foreground text-xs pt-1">{demoResult.scoringError}</p>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardDescription>After: fallback heuristic</CardDescription>
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
                            <Badge
                              variant={
                                demoResult.policyDecision === "auto_refund"
                                  ? "refund"
                                  : demoResult.policyDecision === "allow"
                                    ? "outline"
                                    : "warning"
                              }
                              className="gap-1"
                            >
                              <DecisionIcon decision={demoResult.policyDecision} className="size-3" />
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
                    </motion.div>
                  )}
                </AnimatePresence>
                {demoResult?.error && (
                  <p className="text-destructive text-sm">{demoResult.error}</p>
                )}
              </StaggerItem>
            </StaggerContainer>
          )}

          {/* ============ ALERTS ============ */}
          {activeTab === "alerts" && (
            <StaggerContainer className="space-y-3">
              <StaggerItem>
                <div>
                  <h2 className="text-lg font-medium">Alerts</h2>
                  <p className="text-muted-foreground text-sm">
                    Real email alerts sent to the merchant's registered address, with delivery status
                    shown below.
                  </p>
                </div>
              </StaggerItem>
              {alerts.length === 0 ? (
                <StaggerItem className="space-y-3 py-4 text-center">
                  <p className="text-muted-foreground text-sm">
                    No alerts yet. These fire when a real payment gets held for review or refunded.
                    Not every test payment triggers one (that depends on the risk score), but making
                    a few real purchases is the fastest way to see one land.
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/demo-store">Make a real test purchase</Link>
                  </Button>
                </StaggerItem>
              ) : (
                <StaggerItem className="rounded-lg border divide-y">
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
                </StaggerItem>
              )}
            </StaggerContainer>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
