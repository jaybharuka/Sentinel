"use client";

import { Fragment, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionIcon } from "@/components/brand/DecisionIcon";
import { RiskGauge } from "@/components/brand/RiskGauge";
import { SIGNAL_DEFS, countContributedSignals } from "@/components/dashboard/riskSignals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Same "skip the boilerplate line" logic used for merchant email alerts
// (lib/alerting.js) - surfaces the first actual signal rather than the
// generic "AI scoring unavailable" notice or the recommended-action echo line.
function plainEnglishReason(reasons) {
  return (
    (reasons || []).find(
      (r) => !r.startsWith("⚠️") && !r.startsWith("Fallback recommended") && !r.startsWith("AI recommended") && !r.startsWith("Policy:")
    ) || "no specific signal recorded"
  );
}

const COLUMN_INFO = {
  Risk: "The fraud risk score from 0 (no risk) to 1 (certain fraud), from the AI model or the backup rule-based system.",
  Decision: "What the policy gate decided to do about this transaction, based on the risk score and the merchant's configured bounds.",
  Action: "What actually happened as a result of the decision. For auto-refund, whether the real Razorpay refund call succeeded. allow_overridden means a merchant manually reversed a hold/refund decision.",
  Source: "Whether the AI model scored this transaction directly, or the backup rule-based system did (usually because the model provider's rate limit was hit).",
  Signals: "How many of the 12 deterministic risk signals (see the Risk Signals panel above) looked risky on this specific transaction.",
};

const OVERRIDE_REASONS = [
  { value: "trusted_customer", label: "Trusted customer" },
  { value: "false_positive", label: "False positive" },
  { value: "customer_contacted", label: "Customer contacted us" },
  { value: "other", label: "Other" },
];

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DecisionBadge({ decision }) {
  const variant =
    decision === "auto_refund" ? "refund" : decision === "hold_for_review" ? "warning" : "outline";
  return (
    <Badge variant={variant} className="gap-1">
      <DecisionIcon decision={decision} className="size-3" />
      {decision || "allow"}
    </Badge>
  );
}

function SourceBadge({ usedFallback }) {
  return (
    <span className="inline-flex items-center gap-1">
      {usedFallback ? (
        <Badge variant="warning">Fallback</Badge>
      ) : (
        <Badge variant="success">AI</Badge>
      )}
      <InfoTooltip
        text={
          usedFallback
            ? "The AI model was unavailable or timed out for this transaction, so the backup rule-based scorer handled it instead."
            : "The AI model scored this transaction directly."
        }
      />
    </span>
  );
}

// Data rows fade+slide in on mount (opacity/y only, never a transform-based
// "lift" - table rows don't handle scale/translate reliably inside a table
// layout, so hover feedback below stays a background/glow change instead).
// motion.create(TableRow) forwards the primitive's own classes/props
// through untouched, same pattern as Button's motion.create(Slot).
const MotionRow = motion.create(TableRow);
const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
};

function SignalsBadge({ features }) {
  const count = countContributedSignals(features);
  const variant = count === 0 ? "outline" : count <= 2 ? "warning" : "destructive";
  return <Badge variant={variant}>{count}/12 flagged</Badge>;
}

// refundExecuted is a real tri-state: true (confirmed success), false (no
// attempt, or a confirmed failure), null (decision made, Razorpay call not
// yet resolved - a real window since the transaction row now exists before
// that call completes, not after).
function RefundStatus({ refundExecuted, refundId, refundError }) {
  if (refundExecuted === null) {
    return (
      <span title="Refund call in progress" className="text-muted-foreground">
        … pending
      </span>
    );
  }
  if (refundExecuted) {
    return (
      <span title={`Refund ${refundId}`} className="text-success">
        ✓ refunded
      </span>
    );
  }
  return (
    <span title={refundError || "unknown error"} className="text-destructive">
      ✗ refund failed
    </span>
  );
}

// Same column count/shape as the real table below, so the loading state
// occupies the same footprint - no layout jump when real rows replace it.
function SkeletonRows({ count = 5 }) {
  return (
    <div className="rounded-lg border border-border bg-card" aria-busy="true" aria-label="Loading transactions">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Txn ID</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Signals</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: count }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 9 }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full max-w-20" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TransactionsTable({
  rows,
  loading = false,
  emptyMessage = "No transactions match these filters.",
  emptyAction,
  bounds,
}) {
  const holdThreshold = bounds?.holdThreshold ?? 0.6;
  const refundThreshold = bounds?.minRiskScore ?? 0.9;
  const [expandedId, setExpandedId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [retryingId, setRetryingId] = useState(null);
  const [retryError, setRetryError] = useState(null);
  const [overridingId, setOverridingId] = useState(null);
  const [overrideReason, setOverrideReason] = useState("trusted_customer");
  const [overrideOtherText, setOverrideOtherText] = useState("");
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState(null);

  if (loading && (!rows || rows.length === 0)) {
    return <SkeletonRows />;
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  async function handleRetry(rowId) {
    setRetryingId(rowId);
    setRetryError(null);
    try {
      const res = await fetch(`/api/transactions/${rowId}/retry-scoring`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRetryError(data.error || "Retry failed");
        return;
      }
      setOverrides((prev) => ({ ...prev, [rowId]: data }));
    } catch {
      setRetryError("Retry failed");
    } finally {
      setRetryingId(null);
    }
  }

  function openOverride(rowId) {
    setOverridingId(rowId);
    setOverrideReason("trusted_customer");
    setOverrideOtherText("");
    setOverrideError(null);
  }

  async function handleOverrideSubmit(rowId) {
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      const res = await fetch(`/api/transactions/${rowId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: overrideReason, otherText: overrideOtherText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOverrideError(data.error || "Override failed");
        return;
      }
      setOverrides((prev) => ({ ...prev, [rowId]: data }));
      setOverridingId(null);
    } catch {
      setOverrideError("Override failed");
    } finally {
      setOverrideSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Txn ID</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Risk <InfoTooltip text={COLUMN_INFO.Risk} />
              </span>
            </TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Signals <InfoTooltip text={COLUMN_INFO.Signals} />
              </span>
            </TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Decision <InfoTooltip text={COLUMN_INFO.Decision} />
              </span>
            </TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Action <InfoTooltip text={COLUMN_INFO.Action} />
              </span>
            </TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Source <InfoTooltip text={COLUMN_INFO.Source} />
              </span>
            </TableHead>
            <TableHead>Label</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((rawRow, index) => {
            const row = overrides[rawRow.id] || rawRow;
            const isExpanded = expandedId === row.id;
            return (
              <Fragment key={row.id}>
                <MotionRow
                  className="cursor-pointer transition-shadow hover:shadow-[inset_2px_0_0_var(--color-primary)] focus-visible:shadow-[inset_2px_0_0_var(--color-primary)] focus-visible:outline-none focus-visible:bg-muted/50"
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                  aria-label={`Transaction ${row.txnId}, ${formatINR(row.amount)}, decision ${row.policyDecision || "allow"}. ${isExpanded ? "Press Enter to collapse details." : "Press Enter to see full details."}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : row.id);
                    }
                  }}
                  variants={ROW_VARIANTS}
                  initial="hidden"
                  animate="show"
                  transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.02 }}
                >
                  <TableCell className="font-mono text-xs">
                    {row.txnId}
                    {row.source === "razorpay_live" && (
                      <Badge variant="success" className="ml-2">
                        live
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatINR(row.amount)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-8 shrink-0">
                        {row.riskScore != null ? row.riskScore.toFixed(2) : "–"}
                      </span>
                      {row.riskScore != null && (
                        <RiskGauge
                          riskScore={row.riskScore}
                          holdThreshold={holdThreshold}
                          refundThreshold={refundThreshold}
                          size="xs"
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell><SignalsBadge features={row.features} /></TableCell>
                  <TableCell><DecisionBadge decision={row.policyDecision} /></TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.actionTaken}
                    {row.policyDecision === "auto_refund" && (
                      <span className="ml-1">
                        <RefundStatus
                          refundExecuted={row.refundExecuted}
                          refundId={row.refundId}
                          refundError={row.refundError}
                        />
                      </span>
                    )}
                    {row.humanOverride && (
                      <Badge variant="outline" className="ml-1.5 gap-1">
                        <Undo2 className="size-3" />
                        Overridden by merchant
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell><SourceBadge usedFallback={row.usedFallback} /></TableCell>
                  <TableCell>
                    {row.isLabeledFraud === true && <Badge variant="destructive">fraud</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatTimestamp(row.timestamp)}
                  </TableCell>
                </MotionRow>
                <AnimatePresence>
                {isExpanded && (
                  <MotionRow
                    key="expanded"
                    className="bg-muted/30 hover:bg-muted/30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TableCell colSpan={9} className="whitespace-normal py-4">
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15, delay: 0.03, ease: [0.16, 1, 0.3, 1] }}
                        className="space-y-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <p className="font-medium">
                            {row.actionTaken === "allow"
                              ? `This transaction was allowed because: ${plainEnglishReason(row.reasons)}`
                              : `This transaction was flagged because: ${plainEnglishReason(row.reasons)}`}
                          </p>
                          {row.usedFallback && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              disabled={retryingId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetry(row.id);
                              }}
                            >
                              {retryingId === row.id ? "Retrying…" : "Retry with AI"}
                            </Button>
                          )}
                        </div>
                        {retryingId === null && retryError && expandedId === row.id && (
                          <p className="text-destructive text-xs">{retryError}</p>
                        )}
                        <div className="text-muted-foreground text-xs uppercase tracking-wide pt-1">
                          Full technical reasons (AI / fallback + policy decision)
                        </div>
                        <ul className="list-disc pl-5 space-y-1">
                          {(row.reasons || []).map((reason, i) => (
                            <li
                              key={i}
                              className={
                                reason.startsWith("Policy:")
                                  ? "font-medium text-foreground"
                                  : reason.startsWith("AI recommended:") || reason.startsWith("Fallback recommended:")
                                    ? "text-muted-foreground italic"
                                    : ""
                              }
                            >
                              {reason}
                            </li>
                          ))}
                        </ul>
                        <div className="text-muted-foreground text-xs pt-1">
                          confidence: {row.confidence != null ? row.confidence.toFixed(2) : "–"} · email:{" "}
                          {row.email} · ip: {row.ipCountry} → billing: {row.billingCountry}
                        </div>
                        {row.riskScore != null && (
                          <div className="max-w-xs pt-2">
                            <RiskGauge
                              riskScore={row.riskScore}
                              holdThreshold={holdThreshold}
                              refundThreshold={refundThreshold}
                            />
                          </div>
                        )}
                        {row.features && (
                          <div className="pt-2">
                            <div className="text-muted-foreground text-xs uppercase tracking-wide pb-1.5">
                              Risk signals ({countContributedSignals(row.features)}/12 flagged)
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                              {SIGNAL_DEFS.map((def) => {
                                const flagged = def.contributed(row.features);
                                return (
                                  <div
                                    key={def.key}
                                    className={
                                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs " +
                                      (flagged
                                        ? "bg-warning/10 ring-1 ring-warning/30"
                                        : "text-muted-foreground")
                                    }
                                  >
                                    <def.Icon
                                      className={`size-3.5 shrink-0 ${flagged ? "text-warning-text" : "text-muted-foreground/70"}`}
                                    />
                                    <span className={`truncate ${flagged ? "font-medium text-foreground" : ""}`}>
                                      {def.label}: {def.describe(row.features[def.key])}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {row.policyDecision === "auto_refund" && (
                          <div className="text-xs pt-1">
                            {row.refundExecuted === null ? (
                              <span className="text-muted-foreground">
                                Refund authorized. Razorpay call in progress, outcome not yet known
                              </span>
                            ) : row.refundExecuted ? (
                              <span className="text-success">
                                Refund executed. Razorpay refund ID: {row.refundId}
                              </span>
                            ) : (
                              <span className="text-destructive">
                                Refund NOT executed: {row.refundError || "unknown error"}
                              </span>
                            )}
                          </div>
                        )}

                        {(row.policyDecision === "hold_for_review" || row.policyDecision === "auto_refund") && (
                          <div className="border-t border-border pt-3 mt-2">
                            {row.humanOverride ? (
                              <div className="flex items-start gap-2 text-xs">
                                <Undo2 className="text-primary mt-0.5 size-3.5 shrink-0" />
                                <p>
                                  <span className="font-medium text-foreground">Overridden by merchant</span>{" "}
                                  — {row.overrideReason}, {formatTimestamp(row.overriddenAt)}. Recorded on
                                  the audit trail as{" "}
                                  <code className="font-mono text-[11px]">allow_overridden</code>, not a
                                  new AI or policy decision.
                                  {row.policyDecision === "auto_refund" && row.refundExecuted && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      The real Razorpay refund ({row.refundId}) was already executed and
                                      was not reversed — that needs manual action in Razorpay's dashboard.
                                    </span>
                                  )}
                                </p>
                              </div>
                            ) : overridingId === row.id ? (
                              <div
                                className="space-y-2 rounded-md border border-border bg-card p-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <p className="text-xs font-medium">Override this decision</p>
                                <p className="text-muted-foreground text-xs">
                                  Marks this transaction as approved despite the flag. This never calls
                                  Razorpay.
                                  {row.policyDecision === "auto_refund" && row.refundExecuted && (
                                    <>
                                      {" "}
                                      A real refund already executed for this transaction — overriding
                                      records your disagreement for the audit trail, it will not reverse
                                      the refund.
                                    </>
                                  )}
                                </p>
                                <select
                                  value={overrideReason}
                                  onChange={(e) => setOverrideReason(e.target.value)}
                                  className="border-input h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                >
                                  {OVERRIDE_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                      {r.label}
                                    </option>
                                  ))}
                                </select>
                                {overrideReason === "other" && (
                                  <Input
                                    value={overrideOtherText}
                                    onChange={(e) => setOverrideOtherText(e.target.value)}
                                    placeholder="Describe the reason"
                                    maxLength={300}
                                    className="h-8 text-xs"
                                  />
                                )}
                                {overrideError && <p className="text-destructive text-xs">{overrideError}</p>}
                                <div className="flex gap-2 pt-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      overrideSubmitting ||
                                      (overrideReason === "other" && !overrideOtherText.trim())
                                    }
                                    onClick={() => handleOverrideSubmit(row.id)}
                                  >
                                    {overrideSubmitting ? "Submitting…" : "Confirm override"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={overrideSubmitting}
                                    onClick={() => setOverridingId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOverride(row.id);
                                }}
                              >
                                Override decision
                              </Button>
                            )}
                          </div>
                        )}
                      </motion.div>
                    </TableCell>
                  </MotionRow>
                )}
                </AnimatePresence>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
