"use client";

import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReviewQueue,
  useConfirmReviewItem,
  useLinkReviewItem,
  useRunEmailIngestion,
} from "@/hooks/use-review-queue";
import { apiClient } from "@/lib/api/client";
import type { ReviewQueueItem, Transaction } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { RefreshCw, Link2, Ban, ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// ── UPI description parser ────────────────────────────────────────────────────

interface ParsedUpi {
  ref: string;
  to: string | null;
  via: string | null;
}

function parseUpiDescription(desc: string): ParsedUpi | null {
  const segments = desc.split("/");
  if (segments[0] !== "UPI" || segments.length < 3) return null;

  const ref = segments[1] ?? "";
  const toPart = segments.find((s) => s.startsWith("To:"))?.slice(3).trim() ?? null;

  // "Paid via CRED" can be its own segment or part of the last segment
  const raw = segments.join("/");
  const viaMatch = raw.match(/Paid via ([^\s/]+)/i);
  const via = viaMatch ? viaMatch[1] : null;

  return { ref, to: toPart, via };
}

// ── Date proximity helpers ────────────────────────────────────────────────────

function daysDiff(sourceDate: string, candidateDate: string): number {
  const a = new Date(sourceDate).getTime();
  const b = new Date(candidateDate).getTime();
  return Math.round((b - a) / 86_400_000);
}

function DateProximityBadge({ diff }: { diff: number }) {
  if (diff === 0)
    return (
      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-400 border border-green-500/30">
        Same day
      </span>
    );
  const abs = Math.abs(diff);
  const label = `${abs}d ${diff > 0 ? "after" : "before"}`;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium border",
        abs === 1
          ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
          : "bg-muted text-muted-foreground border-border"
      )}
    >
      {label}
    </span>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function StatementReviewQueue() {
  const { data: ambiguous, isLoading } = useReviewQueue("ambiguous");
  const confirm = useConfirmReviewItem();
  const link = useLinkReviewItem();
  const runIngestion = useRunEmailIngestion();

  const items = ambiguous?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Ambiguous</span>
          {items.length > 0 && (
            <Badge variant="destructive">{items.length}</Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runIngestion.mutate(undefined)}
          disabled={runIngestion.isPending}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${runIngestion.isPending ? "animate-spin" : ""}`}
          />
          Fetch Latest
        </Button>
      </div>

      <AmbiguousList
        items={items}
        isLoading={isLoading}
        onLink={(itemId, txId) => link.mutate({ itemId, transactionId: txId })}
        onNoneMatch={(itemId) => confirm.mutate({ itemId })}
      />
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function AmbiguousList({
  items,
  isLoading,
  onLink,
  onNoneMatch,
}: {
  items: ReviewQueueItem[];
  isLoading: boolean;
  onLink: (itemId: string, txId: string) => void;
  onNoneMatch: (itemId: string) => void;
}) {
  if (isLoading)
    return <div className="text-muted-foreground text-sm py-6">Loading…</div>;

  if (items.length === 0)
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No ambiguous matches — all clear
      </div>
    );

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <AmbiguousItem
          key={item.id}
          item={item}
          onLink={onLink}
          onNoneMatch={onNoneMatch}
        />
      ))}
    </div>
  );
}

// ── Item card ─────────────────────────────────────────────────────────────────

function AmbiguousItem({
  item,
  onLink,
  onNoneMatch,
}: {
  item: ReviewQueueItem;
  onLink: (itemId: string, txId: string) => void;
  onNoneMatch: (itemId: string) => void;
}) {
  const candidateIds = item.ambiguous_candidate_ids ?? [];
  const parsed = parseUpiDescription(item.description);

  const candidateQueries = useQueries({
    queries: candidateIds.map((id) => ({
      queryKey: ["transaction", id],
      queryFn: () => apiClient.getTransaction(id),
      staleTime: 60_000,
    })),
  });

  const loadedTxs = candidateQueries.map((q) => q.data?.data ?? null);

  // Best match: same-day candidate whose amount exactly matches
  const bestMatchIdx = loadedTxs.findIndex(
    (tx) =>
      tx !== null &&
      Math.abs(tx.amount - item.amount) < 0.01 &&
      daysDiff(item.transaction_date, tx.date) === 0
  );

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* ── Source header ── */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-1.5">
          {parsed ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                {parsed.via && (
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    via {parsed.via}
                  </span>
                )}
                {parsed.to && (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-foreground/80">
                    {parsed.to}
                  </code>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                Ref: {parsed.ref}
              </p>
            </div>
          ) : (
            <p className="text-sm font-medium text-foreground break-words leading-snug">
              {item.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {formatDate(item.transaction_date)}&nbsp;&middot;&nbsp;{item.account}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            item.direction === "debit" ? "text-red-500" : "text-green-500"
          )}
        >
          {item.direction === "debit" ? "−" : "+"}
          {formatCurrency(item.amount)}
        </span>
      </div>

      {/* ── Candidates ── */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs text-muted-foreground font-medium">
          {candidateIds.length} possible{" "}
          {candidateIds.length === 1 ? "match" : "matches"} — select the one
          this transaction belongs to:
        </p>

        {candidateQueries.map((query, i) => {
          const txId = candidateIds[i];
          const tx: Transaction | null = loadedTxs[i];
          const isBest = i === bestMatchIdx;
          const diff = tx ? daysDiff(item.transaction_date, tx.date) : null;

          if (query.isLoading) {
            return (
              <div
                key={txId}
                className="rounded-md border px-3 py-2.5 flex items-center gap-3 animate-pulse"
              >
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
                <div className="h-3.5 bg-muted rounded w-16 shrink-0" />
                <div className="h-7 bg-muted rounded w-14 shrink-0" />
              </div>
            );
          }

          if (!tx) {
            return (
              <div
                key={txId}
                className="rounded-md border px-3 py-2.5 flex items-center gap-3 text-xs text-muted-foreground"
              >
                <span className="flex-1">
                  Could not load transaction{" "}
                  <code className="font-mono">{txId.slice(0, 8)}…</code>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onLink(item.id, txId)}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1.5" />
                  Link anyway
                </Button>
              </div>
            );
          }

          return (
            <div
              key={txId}
              className={cn(
                "rounded-md border px-3 py-2.5 flex items-center gap-3 transition-colors",
                isBest
                  ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                  : "hover:bg-muted/40"
              )}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate">{tx.description}</p>
                  {isBest && (
                    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary border border-primary/30 shrink-0">
                      <Sparkles className="h-2.5 w-2.5" />
                      Best match
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(tx.date)}&nbsp;&middot;&nbsp;{tx.account}
                    {tx.category ? <>&nbsp;&middot;&nbsp;{tx.category}</> : null}
                  </span>
                  {diff !== null && <DateProximityBadge diff={diff} />}
                </div>
                {tx.original_description &&
                  tx.original_description !== tx.description && (
                    <p className="text-[11px] text-muted-foreground/60 font-mono truncate">
                      {tx.original_description}
                    </p>
                  )}
              </div>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums shrink-0",
                  tx.direction === "debit" ? "text-red-500" : "text-green-500"
                )}
              >
                {tx.direction === "debit" ? "−" : "+"}
                {formatCurrency(tx.amount)}
              </span>
              <Button
                size="sm"
                onClick={() => onLink(item.id, txId)}
                className="shrink-0"
                variant={isBest ? "default" : "outline"}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                Link
              </Button>
            </div>
          );
        })}

        <div className="pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground text-xs h-7 px-2"
            onClick={() => onNoneMatch(item.id)}
          >
            <Ban className="h-3 w-3 mr-1.5" />
            None of these
          </Button>
        </div>
      </div>
    </div>
  );
}
