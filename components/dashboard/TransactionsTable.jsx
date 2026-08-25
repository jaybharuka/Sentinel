"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
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
  Action: "What actually happened as a result of the decision. For auto-refund, whether the real Razorpay refund call succeeded.",
  Source: "Whether the AI model scored this transaction directly, or the backup rule-based system did (usually because the model provider's rate limit was hit).",
  Signals: "How many of the 12 deterministic risk signals (see the Risk Signals panel above) looked risky on this specific transaction.",
};

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

export function TransactionsTable({
  rows,
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
          {rows.map((rawRow) => {
            const row = overrides[rawRow.id] || rawRow;
            const isExpanded = expandedId === row.id;
            return (
              <Fragment key={row.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
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
                    {row.actionTaken === "auto_refund" && (
                      <span className="ml-1">
                        <RefundStatus
                          refundExecuted={row.refundExecuted}
                          refundId={row.refundId}
                          refundError={row.refundError}
                        />
                      </span>
                    )}
                  </TableCell>
                  <TableCell><SourceBadge usedFallback={row.usedFallback} /></TableCell>
                  <TableCell>
                    {row.isLabeledFraud === true && <Badge variant="destructive">fraud</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatTimestamp(row.timestamp)}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={9} className="whitespace-normal py-4">
                      <div className="space-y-2 text-sm">
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
                                      className={`size-3.5 shrink-0 ${flagged ? "text-warning" : "text-muted-foreground/70"}`}
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
                        {row.actionTaken === "auto_refund" && (
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
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
