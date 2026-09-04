"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, ArrowDown, Minus, Lightbulb } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionsTable } from "@/components/dashboard/TransactionsTable";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DecisionIcon } from "@/components/brand/DecisionIcon";
import { RiskGauge } from "@/components/brand/RiskGauge";
import { SIGNAL_CATEGORIES, SIGNAL_DEFS } from "@/components/dashboard/riskSignals";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewQueue } from "@/components/dashboard/ReviewQueue";
import { Insights } from "@/components/dashboard/Insights";
import { TransactionTrendChart } from "@/components/dashboard/TransactionTrendChart";
import { RiskHistogramChart } from "@/components/dashboard/RiskHistogramChart";
import { StaggerContainer, StaggerItem } from "@/components/motion/Stagger";
import { useToast } from "@/components/ui/toast";

const HOW_IT_WORKS_SEEN_KEY = "sentinel_how_it_works_seen";
const GETTING_STARTED_SEEN_KEY = "sentinel_getting_started_seen";
const DEFAULT_TAB = "overview";

const DASHBOARD_TABS = [
  { value: "overview", label: "Overview" },
  { value: "review-queue", label: "Review Queue" },
  { value: "transactions", label: "Transactions" },
  { value: "insights", label: "Insights" },
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

// Policy Simulator delta indicator: an up/down arrow + color showing
// whether a metric improved or worsened. "Higher is better" (precision/
// recall/F1) and "lower is better" (false-positive cost) need opposite
// color logic for the same-direction arrow, so the caller says which one
// this metric is. Decision-count deltas pass higherIsBetter: null - a
// shift in how many transactions land in each bucket has no inherent
// "good" direction on its own, so those render as a neutral change, not a
// verdict, rather than borrowing decision colors that would imply one.
function SimDelta({ diff, higherIsBetter, formatDiff }) {
  if (diff == null || Math.abs(diff) < 1e-9) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Minus className="size-3.5" /> no change
      </span>
    );
  }
  const up = diff > 0;
  const isGood = higherIsBetter == null ? null : higherIsBetter ? up : !up;
  const colorClass = isGood == null ? "text-foreground" : isGood ? "text-success" : "text-refund";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${colorClass}`}>
      <Icon className="size-4" />
      {formatDiff(Math.abs(diff))}
    </span>
  );
}

function SimMetricCard({ label, currentValue, simulatedValue, diff, higherIsBetter, formatDiff }) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2 font-mono">
        <span className="text-muted-foreground text-base">{currentValue}</span>
        <span className="text-muted-foreground text-sm">→</span>
        <span className="text-2xl font-semibold">{simulatedValue}</span>
      </div>
      <SimDelta diff={diff} higherIsBetter={higherIsBetter} formatDiff={formatDiff} />
    </div>
  );
}

// Detects the specific, real pattern this simulator has surfaced before:
// a threshold change that only moves transactions between hold_for_review
// and auto_refund (both already "flagged" for precision/recall purposes)
// leaves accuracy identical - the change only affects what happens next
// (a human review vs. an automatic refund), not which transactions get
// caught. Worth calling out explicitly rather than leaving a merchant to
// wonder why the accuracy numbers didn't move.
function detectMixOnlyShift(simResult) {
  if (!simResult) return false;
  const { current, simulated } = simResult;
  const accuracyUnchanged =
    current.precision === simulated.precision &&
    current.recall === simulated.recall &&
    current.f1 === simulated.f1;
  const mixChanged =
    current.decisionCounts.allow !== simulated.decisionCounts.allow ||
    current.decisionCounts.hold_for_review !== simulated.decisionCounts.hold_for_review ||
    current.decisionCounts.auto_refund !== simulated.decisionCounts.auto_refund;
  return accuracyUnchanged && mixChanged;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardContent({ emailVerified, merchantName }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  // Dismissing hides the banner for this page view only - plain component
  // state, not localStorage. Navigating away and back (or reloading)
  // brings it back for as long as the account is actually unverified, per
  // the "dismissible but reappearing" requirement - deliberately different
  // from GettingStarted/"How this works", which are meant to go away
  // permanently once seen.
  const [verificationBannerDismissed, setVerificationBannerDismissed] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
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
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [reviewQueueCount, setReviewQueueCount] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [simInputs, setSimInputs] = useState(null);
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(null);
  const [applyingPolicy, setApplyingPolicy] = useState(false);
  const [pendingRefunds, setPendingRefunds] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [recentRows, setRecentRows] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(true);
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
      .catch(() => {})
      .finally(() => setRecentLoading(false));
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

  async function handleResendVerification() {
    setResendingVerification(true);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Could not resend", description: data.error || "Try again.", variant: "error" });
        return;
      }
      toast({ title: "Verification email sent", description: "Check your inbox.", variant: "success" });
    } catch {
      toast({ title: "Could not resend", description: "Check your connection and try again.", variant: "error" });
    } finally {
      setResendingVerification(false);
    }
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
    fetch("/api/metrics/trend")
      .then((res) => res.json())
      .then(setTrend)
      .catch(() => setTrend(null))
      .finally(() => setTrendLoading(false));
  }, []);

  // Just for the tab badge - ReviewQueue fetches the full queue (with
  // sorting) itself once its tab is actually mounted; this lightweight
  // count keeps the badge accurate even before that tab has ever been
  // opened. ReviewQueue reports back through onQueueChange as items are
  // approved/kept so the badge stays live without a second poll.
  useEffect(() => {
    fetch("/api/review-queue")
      .then((res) => res.json())
      .then((data) => setReviewQueueCount(data?.summary?.count ?? null))
      .catch(() => setReviewQueueCount(null));
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettingsForm(data);
        // Only seed the simulator's starting values once, from the live
        // bounds - a later settings refetch (e.g. after "Apply this
        // policy") shouldn't clobber whatever the merchant has since typed.
        setSimInputs((prev) =>
          prev
            ? prev
            : {
                autoRefundMaxAmount: data.autoRefundMaxAmount,
                dailyRefundCap: data.dailyRefundCap,
                autoRefundMinRiskScore: data.autoRefundMinRiskScore,
                autoRefundMinConfidence: data.autoRefundMinConfidence,
                holdForReviewMinRiskScore: data.holdForReviewMinRiskScore,
              }
        );
      })
      .catch(() => setSettingsForm(null));
  }, []);

  function updateSimInput(key, value) {
    setSimInputs((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSimulate() {
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await fetch("/api/policy-simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simInputs),
      });
      const data = await res.json();
      if (!res.ok) {
        setSimError(data.error || "Simulation failed");
        return;
      }
      setSimResult(data);
    } catch {
      setSimError("Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  async function handleApplySimulatedPolicy() {
    setApplyingPolicy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settingsForm, ...simInputs }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Could not apply policy", description: data.error || "Try again.", variant: "error" });
        return;
      }
      setSettingsForm(data);
      refetchBounds();
      toast({
        title: "Policy applied",
        description: "These bounds are now live and enforced on the next transaction processed.",
        variant: "success",
      });
    } catch {
      toast({ title: "Could not apply policy", description: "Check your connection and try again.", variant: "error" });
    } finally {
      setApplyingPolicy(false);
    }
  }

  useEffect(() => {
    fetch("/api/transactions?pageSize=20")
      .then((res) => res.json())
      .then((data) => setRecentRows(data.rows || []))
      .catch(() => setRecentRows([]))
      .finally(() => setRecentLoading(false));
  }, []);

  useEffect(() => {
    setAuditLoading(true);
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
      })
      .finally(() => setAuditLoading(false));
  }, [decisionFilter, sourceFilter, page]);

  const totalPages = Math.max(1, Math.ceil(auditTotal / pageSize));

  return (
    <div className="space-y-6">
      {emailVerified === false && !verificationBannerDismissed && (
        <div className="flex items-center justify-between gap-4 rounded-lg border-2 border-warning bg-warning/5 p-4">
          <div>
            <p className="text-sm font-medium">Verify your email address</p>
            <p className="text-muted-foreground text-xs">
              We sent a link when you signed up. Verifying isn't required to use the product, but
              confirms we can actually reach you.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResendVerification}
              disabled={resendingVerification}
            >
              {resendingVerification ? "Sending…" : "Resend email"}
            </Button>
            <button
              type="button"
              onClick={() => setVerificationBannerDismissed(true)}
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* No "Dashboard" eyebrow / "Sentinel" heading here - the top nav
          already says both. The h1 carries real information instead: whose
          workspace this is, which the Header now only shows on wider
          viewports (see Header.jsx). */}
      <div>
        <h1 className="text-2xl font-semibold">{merchantName}</h1>
        <p className="text-muted-foreground text-sm">
          Explainable fraud &amp; chargeback risk guard, with an audit trail and held-out test metrics.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-6">
        <TabsList>
          {DASHBOARD_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.label}
              {tab.value === "review-queue" && reviewQueueCount != null && reviewQueueCount > 0 && (
                <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                  {reviewQueueCount}
                </Badge>
              )}
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
                    aria-expanded={howItWorksOpen}
                    aria-controls="how-this-works-panel"
                    className="flex w-full items-center justify-between px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-lg"
                  >
                    <span className="text-sm font-medium">How this works</span>
                    <span className="text-muted-foreground text-xs">
                      {howItWorksOpen ? "Hide ▲" : "Show ▼"}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {howItWorksOpen && (
                      <motion.div
                        id="how-this-works-panel"
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
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10" aria-busy="true" aria-label="Loading metrics">
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-14 w-24" />
                      </div>
                      <div className="w-full space-y-3 border-t border-border pt-2 sm:max-w-xs sm:flex-1 sm:border-t-0 sm:pt-0">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    </div>
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

              {/* Volume + decision-mix trend */}
              <StaggerItem>
                <section className="space-y-3">
                  <div>
                    <h2 className="text-lg font-medium">Volume &amp; decision mix</h2>
                    <p className="text-muted-foreground text-sm">
                      Transactions per day over the last 30 days, split by what the policy gate decided.
                    </p>
                  </div>
                  <TransactionTrendChart data={trend?.daily} loading={trendLoading} />
                </section>
              </StaggerItem>

              {/* Today's budget gauge */}
              <StaggerItem>
                <section className="space-y-3">
                  {!bounds ? (
                    <Card aria-busy="true" aria-label="Loading today's budget">
                      <CardHeader>
                        <Skeleton className="h-3 w-40" />
                        <Skeleton className="mt-1.5 h-5 w-32" />
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <Skeleton className="h-2 w-full rounded-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </CardContent>
                    </Card>
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
                    loading={recentLoading}
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
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10" aria-busy="true" aria-label="Loading held-out metrics">
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-14 w-20" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <div className="w-full space-y-3 border-t border-border pt-2 sm:max-w-sm sm:flex-1 sm:border-t-0 sm:pt-0">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-full" />
                        ))}
                      </div>
                    </div>
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

            </StaggerContainer>
          )}

          {/* ============ REVIEW QUEUE ============ */}
          {activeTab === "review-queue" && (
            <ReviewQueue bounds={bounds} onQueueChange={setReviewQueueCount} />
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
                  loading={auditLoading}
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

          {/* ============ INSIGHTS ============ */}
          {activeTab === "insights" && <Insights />}

          {/* ============ POLICY & SIGNALS ============ */}
          {activeTab === "policy-signals" && (
            <StaggerContainer className="space-y-10">
              {/* Policy Simulator: pure re-computation against already-stored
                  synthetic scores, no AI calls, instant. Promoted to the top
                  of this tab and given real visual weight - Stripe Radar's
                  own framing for this exact feature is "simulated against 6
                  months of real charges before going live"; ours is honest
                  about being a 400-row synthetic set rather than borrowing
                  that specific claim, but the "backtest before you commit"
                  framing is the same idea. */}
              <StaggerItem id="policy-simulator" className="scroll-mt-6 space-y-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-primary">
                    Before you change your policy
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">See what it would have done</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Simulated against your 400-row synthetic held-out test set's already-stored AI
                    scores, not a live re-evaluation of new transactions. Changing a threshold here
                    re-runs the policy gate against those past scores instantly; it never calls the
                    AI again and doesn't predict how future transactions will actually score.
                  </p>
                </div>
                {!simInputs ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading policy simulator">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="space-y-1">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Max single auto-refund (₹)</label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={simInputs.autoRefundMaxAmount}
                          onChange={(e) => updateSimInput("autoRefundMaxAmount", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Daily refund budget (₹)</label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={simInputs.dailyRefundCap}
                          onChange={(e) => updateSimInput("dailyRefundCap", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Auto-refund min risk score (0-1)</label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={simInputs.autoRefundMinRiskScore}
                          onChange={(e) => updateSimInput("autoRefundMinRiskScore", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Auto-refund min confidence (0-1)</label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={simInputs.autoRefundMinConfidence}
                          onChange={(e) => updateSimInput("autoRefundMinConfidence", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium">Hold-for-review risk threshold (0-1)</label>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={simInputs.holdForReviewMinRiskScore}
                          onChange={(e) => updateSimInput("holdForReviewMinRiskScore", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button type="button" onClick={handleSimulate} disabled={simLoading}>
                        {simLoading ? "Simulating…" : "Simulate"}
                      </Button>
                      {simError && <p className="text-destructive text-sm">{simError}</p>}
                    </div>

                    <AnimatePresence mode="wait">
                      {simResult && (
                        <motion.div
                          key="sim-result"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                          className="space-y-4"
                        >
                          {detectMixOnlyShift(simResult) && (
                            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                              <Lightbulb className="text-primary mt-0.5 size-4 shrink-0" />
                              <p>
                                <span className="font-medium text-foreground">
                                  Why precision and recall didn't move:{" "}
                                </span>
                                this change only shifted decisions between hold-for-review and
                                auto-refund - both already count as "flagged," so the same
                                transactions get caught either way. Only what happens next (a human
                                review vs. an automatic refund) changed, which shows up below in the
                                decision mix instead.
                              </p>
                            </div>
                          )}

                          <div>
                            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                              Accuracy
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              <SimMetricCard
                                label="Precision"
                                currentValue={formatPercent(simResult.current.precision)}
                                simulatedValue={formatPercent(simResult.simulated.precision)}
                                diff={
                                  simResult.current.precision != null && simResult.simulated.precision != null
                                    ? simResult.simulated.precision - simResult.current.precision
                                    : null
                                }
                                higherIsBetter={true}
                                formatDiff={(d) => `${(d * 100).toFixed(1)}pp`}
                              />
                              <SimMetricCard
                                label="Recall"
                                currentValue={formatPercent(simResult.current.recall)}
                                simulatedValue={formatPercent(simResult.simulated.recall)}
                                diff={
                                  simResult.current.recall != null && simResult.simulated.recall != null
                                    ? simResult.simulated.recall - simResult.current.recall
                                    : null
                                }
                                higherIsBetter={true}
                                formatDiff={(d) => `${(d * 100).toFixed(1)}pp`}
                              />
                              <SimMetricCard
                                label="F1"
                                currentValue={simResult.current.f1 != null ? simResult.current.f1.toFixed(3) : "–"}
                                simulatedValue={
                                  simResult.simulated.f1 != null ? simResult.simulated.f1.toFixed(3) : "–"
                                }
                                diff={
                                  simResult.current.f1 != null && simResult.simulated.f1 != null
                                    ? simResult.simulated.f1 - simResult.current.f1
                                    : null
                                }
                                higherIsBetter={true}
                                formatDiff={(d) => d.toFixed(3)}
                              />
                              <SimMetricCard
                                label="False-positive cost"
                                currentValue={formatINR(simResult.current.falsePositiveCost)}
                                simulatedValue={formatINR(simResult.simulated.falsePositiveCost)}
                                diff={simResult.simulated.falsePositiveCost - simResult.current.falsePositiveCost}
                                higherIsBetter={false}
                                formatDiff={(d) => formatINR(d)}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                              Decision mix
                            </p>
                            <div className="grid gap-4 sm:grid-cols-3">
                              <SimMetricCard
                                label="Allow"
                                currentValue={simResult.current.decisionCounts.allow}
                                simulatedValue={simResult.simulated.decisionCounts.allow}
                                diff={simResult.simulated.decisionCounts.allow - simResult.current.decisionCounts.allow}
                                higherIsBetter={null}
                                formatDiff={(d) => `${d}`}
                              />
                              <SimMetricCard
                                label="Hold for review"
                                currentValue={simResult.current.decisionCounts.hold_for_review}
                                simulatedValue={simResult.simulated.decisionCounts.hold_for_review}
                                diff={
                                  simResult.simulated.decisionCounts.hold_for_review -
                                  simResult.current.decisionCounts.hold_for_review
                                }
                                higherIsBetter={null}
                                formatDiff={(d) => `${d}`}
                              />
                              <SimMetricCard
                                label="Auto-refund"
                                currentValue={simResult.current.decisionCounts.auto_refund}
                                simulatedValue={simResult.simulated.decisionCounts.auto_refund}
                                diff={
                                  simResult.simulated.decisionCounts.auto_refund -
                                  simResult.current.decisionCounts.auto_refund
                                }
                                higherIsBetter={null}
                                formatDiff={(d) => `${d}`}
                              />
                            </div>
                          </div>

                          <p className="text-muted-foreground text-xs">
                            Simulated against your {simResult.totalRows}-row synthetic test set's
                            already-stored AI scores.
                            {simResult.unparseable > 0 &&
                              ` ${simResult.unparseable} row(s) could not be re-simulated and were excluded.`}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleApplySimulatedPolicy}
                            disabled={applyingPolicy}
                          >
                            {applyingPolicy ? "Applying…" : "Apply this policy"}
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </StaggerItem>

              <StaggerItem id="policy-bounds" className="scroll-mt-6 space-y-3">
                <h2 className="text-lg font-medium">Policy Bounds</h2>
                {!bounds ? (
                  <div className="space-y-6" aria-busy="true" aria-label="Loading policy bounds">
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-14 w-28" />
                      </div>
                      <div className="w-full space-y-3 sm:max-w-sm sm:flex-1">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-full" />
                        ))}
                      </div>
                    </div>
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
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
                      <CardContent className="space-y-6">
                        <RiskGauge holdThreshold={bounds.holdThreshold} refundThreshold={bounds.minRiskScore} />
                        <div className="space-y-2 border-t border-border pt-4">
                          <p className="text-xs font-medium text-muted-foreground">
                            Actual distribution of scored transactions across these zones (last 30 days)
                          </p>
                          <RiskHistogramChart
                            data={trend?.riskHistogram}
                            holdThreshold={bounds.holdThreshold}
                            refundThreshold={bounds.minRiskScore}
                            loading={trendLoading}
                          />
                        </div>
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
