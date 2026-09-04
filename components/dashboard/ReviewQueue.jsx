"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskGauge } from "@/components/brand/RiskGauge";
import { DecisionIcon } from "@/components/brand/DecisionIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

const SORT_TABS = [
  { value: "risk", label: "Highest risk first" },
  { value: "oldest", label: "Oldest first" },
];

function formatINR(amount) {
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatDuration(ms) {
  if (ms == null) return "–";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 24, transition: { duration: 0.15 } },
};

function QueueRow({ item, bounds, onApprove, onKeep, busy }) {
  const isRefundFailed = item.policyDecision === "auto_refund" && item.refundExecuted === false;

  return (
    <motion.div
      layout
      variants={ROW_VARIANTS}
      initial="hidden"
      animate="show"
      exit="exit"
      className="flex flex-col gap-3 border-b border-border p-4 last:border-0 sm:flex-row sm:items-center sm:gap-6"
    >
      <div className="flex items-center gap-3 sm:w-40 sm:shrink-0">
        <DecisionIcon decision={item.policyDecision} className="size-4 shrink-0" />
        <div>
          <p className="font-mono text-sm font-medium">{formatINR(item.amount)}</p>
          <p className="text-muted-foreground font-mono text-xs">{item.txnId}</p>
        </div>
      </div>

      <div className="sm:w-36 sm:shrink-0">
        <RiskGauge
          riskScore={item.riskScore}
          holdThreshold={bounds?.holdThreshold}
          refundThreshold={bounds?.minRiskScore}
          size="xs"
        />
      </div>

      <div className="min-w-0 flex-1">
        {item.topReasons.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {item.topReasons.map((reason, i) => (
              <li key={i} className="line-clamp-2 text-muted-foreground">
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm italic">No specific signal recorded</p>
        )}
        {isRefundFailed && (
          <p className="text-destructive mt-1 text-xs">
            Refund attempted, not completed: {item.refundError || "unknown error"}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 sm:w-64 sm:shrink-0 sm:justify-end">
        <Badge variant="outline" className="shrink-0 text-xs font-normal">
          waiting {formatDuration(Date.now() - new Date(item.createdAt).getTime())}
        </Badge>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onKeep(item.id)}
          >
            Keep decision
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => onApprove(item.id)}>
            Approve
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
      <p className="font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function ReviewQueue({ bounds, onQueueChange }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("risk");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  // Authoritative refetch rather than optimistic local patching - after an
  // approve/keep action, the current page's item count, total pages, and
  // the "oldest waiting" stat can all shift in ways that are simpler to
  // just re-ask the server for than to reconstruct client-side (e.g.
  // approving the last item on the last page needs to fall back a page,
  // which the requestedPage guard below handles).
  function refetch(requestedSort, requestedPage) {
    setLoading(true);
    fetch(`/api/review-queue?sort=${requestedSort}&page=${requestedPage}`)
      .then((res) => res.json())
      .then((result) => {
        if (result?.items?.length === 0 && requestedPage > 1) {
          setPage(requestedPage - 1);
          return;
        }
        setData(result);
        onQueueChange?.(result?.summary?.count ?? null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refetch(sort, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, page]);

  function handleSortChange(value) {
    setSort(value);
    setPage(1);
  }

  async function handleApprove(id) {
    if (!window.confirm("Approve this transaction? This reverses the flagged decision to allow.")) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/transactions/${id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "queue_quick_approve" }),
      });
      const responseData = await res.json();
      if (!res.ok) {
        toast({ title: "Could not approve", description: responseData.error || "Try again.", variant: "error" });
        return;
      }
      toast({ title: "Approved", description: "Removed from the review queue.", variant: "success" });
      refetch(sort, page);
    } catch {
      toast({ title: "Could not approve", description: "Check your connection and try again.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleKeep(id) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/transactions/${id}/review`, { method: "POST" });
      const responseData = await res.json();
      if (!res.ok) {
        toast({ title: "Could not mark reviewed", description: responseData.error || "Try again.", variant: "error" });
        return;
      }
      toast({ title: "Marked reviewed", description: "Decision kept, removed from the queue.", variant: "info" });
      refetch(sort, page);
    } catch {
      toast({ title: "Could not mark reviewed", description: "Check your connection and try again.", variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Review Queue</h2>
        <p className="text-muted-foreground text-sm">
          Flagged transactions that haven't been acted on yet - approve, or confirm the decision
          should stand. Once you act, a transaction leaves this queue but stays fully visible in
          the Transactions tab.
        </p>
      </div>

      {loading ? (
        <div className="flex gap-8" aria-busy="true" aria-label="Loading review queue">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-14" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <SummaryStat label="Waiting" value={data?.summary.count ?? 0} />
          <SummaryStat label="Oldest waiting" value={formatDuration(data?.summary.oldestWaitMs)} />
          <SummaryStat
            label="Avg. time to resolution"
            value={
              data?.summary.avgResolutionMs != null
                ? formatDuration(data.summary.avgResolutionMs)
                : "–"
            }
          />
        </div>
      )}

      <Tabs value={sort} onValueChange={handleSortChange}>
        <TabsList>
          {SORT_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="rounded-lg border border-border" aria-busy="true" aria-label="Loading queue items">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-border p-4 last:border-0">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-2 w-28 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-8 w-40" />
            </div>
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-muted-foreground text-sm">
            Nothing waiting for review. Every flagged transaction has been approved or confirmed.
          </p>
        </div>
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <AnimatePresence initial={false}>
              {data.items.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  bounds={bounds}
                  onApprove={handleApprove}
                  onKeep={handleKeep}
                  busy={busyId === item.id}
                />
              ))}
            </AnimatePresence>
          </Card>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs">
                Showing {(data.page - 1) * data.pageSize + 1}–
                {Math.min(data.page * data.pageSize, data.totalCount)} of {data.totalCount} waiting
                · page {data.page} of {data.totalPages}
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
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
