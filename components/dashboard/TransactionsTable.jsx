"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  if (decision === "auto_refund") return <Badge>auto_refund</Badge>;
  if (decision === "hold_for_review") return <Badge variant="warning">hold_for_review</Badge>;
  return <Badge variant="outline">allow</Badge>;
}

function SourceBadge({ usedFallback }) {
  return usedFallback ? (
    <Badge variant="warning">Fallback</Badge>
  ) : (
    <Badge variant="success">Gemini</Badge>
  );
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

export function TransactionsTable({ rows, emptyMessage = "No transactions match these filters." }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!rows || rows.length === 0) {
    return <p className="text-muted-foreground text-sm py-8 text-center">{emptyMessage}</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Txn ID</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
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
                  <TableCell>{formatINR(row.amount)}</TableCell>
                  <TableCell>{row.riskScore != null ? row.riskScore.toFixed(2) : "—"}</TableCell>
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
                    <TableCell colSpan={8} className="whitespace-normal py-4">
                      <div className="space-y-2 text-sm">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide">
                          Gemini / fallback reasons + policy decision
                        </div>
                        <ul className="list-disc pl-5 space-y-1">
                          {(row.reasons || []).map((reason, i) => (
                            <li
                              key={i}
                              className={
                                reason.startsWith("Policy:")
                                  ? "font-medium text-foreground"
                                  : reason.startsWith("Gemini recommended:") || reason.startsWith("Fallback recommended:")
                                    ? "text-muted-foreground italic"
                                    : ""
                              }
                            >
                              {reason}
                            </li>
                          ))}
                        </ul>
                        <div className="text-muted-foreground text-xs pt-1">
                          confidence: {row.confidence != null ? row.confidence.toFixed(2) : "—"} · email:{" "}
                          {row.email} · ip: {row.ipCountry} → billing: {row.billingCountry}
                        </div>
                        {row.actionTaken === "auto_refund" && (
                          <div className="text-xs pt-1">
                            {row.refundExecuted === null ? (
                              <span className="text-muted-foreground">
                                Refund authorized — Razorpay call in progress, outcome not yet known
                              </span>
                            ) : row.refundExecuted ? (
                              <span className="text-success">
                                Refund executed — Razorpay refund ID: {row.refundId}
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
