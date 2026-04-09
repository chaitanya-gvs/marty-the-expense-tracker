"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReviewQueue,
  useConfirmReviewItem,
  useDeleteReviewItem,
  useBulkConfirmReviewItems,
  useLinkReviewItem,
  useRunEmailIngestion,
} from "@/hooks/use-review-queue";
import type { ReviewQueueItem } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { RefreshCw, CheckCheck, Trash2, Link2 } from "lucide-react";

export function StatementReviewQueue() {
  const { data: statementOnly, isLoading: loadingOnly } =
    useReviewQueue("statement_only");
  const { data: ambiguous, isLoading: loadingAmbiguous } =
    useReviewQueue("ambiguous");
  const confirm = useConfirmReviewItem();
  const del = useDeleteReviewItem();
  const bulkConfirm = useBulkConfirmReviewItems();
  const link = useLinkReviewItem();
  const runIngestion = useRunEmailIngestion();
  const [activeTab, setActiveTab] = useState<"statement_only" | "ambiguous">(
    "statement_only"
  );

  const statementOnlyItems = statementOnly?.items ?? [];
  const ambiguousItems = ambiguous?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("statement_only")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "statement_only"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Statement-Only
            {statementOnlyItems.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {statementOnlyItems.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab("ambiguous")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "ambiguous"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Ambiguous
            {ambiguousItems.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {ambiguousItems.length}
              </Badge>
            )}
          </button>
        </div>
        <div className="flex gap-2">
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
          {activeTab === "statement_only" && statementOnlyItems.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                bulkConfirm.mutate(statementOnlyItems.map((i) => i.id))
              }
              disabled={bulkConfirm.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Confirm All
            </Button>
          )}
        </div>
      </div>

      {activeTab === "statement_only" && (
        <StatementOnlyList
          items={statementOnlyItems}
          isLoading={loadingOnly}
          onConfirm={(id) => confirm.mutate({ itemId: id })}
          onDelete={(id) => del.mutate(id)}
        />
      )}

      {activeTab === "ambiguous" && (
        <AmbiguousList
          items={ambiguousItems}
          isLoading={loadingAmbiguous}
          onLink={(itemId, txId) =>
            link.mutate({ itemId, transactionId: txId })
          }
          onNoneMatch={(itemId) => confirm.mutate({ itemId })}
        />
      )}
    </div>
  );
}

function StatementOnlyList({
  items,
  isLoading,
  onConfirm,
  onDelete,
}: {
  items: ReviewQueueItem[];
  isLoading: boolean;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (isLoading)
    return (
      <div className="text-muted-foreground text-sm">Loading...</div>
    );
  if (items.length === 0)
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No statement-only transactions -- all matched
      </div>
    );

  return (
    <div className="divide-y rounded-md border">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between px-4 py-3 gap-4"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.description}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.transaction_date)} &middot; {item.account}
            </p>
          </div>
          <span
            className={`text-sm font-semibold shrink-0 ${
              item.direction === "debit"
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {item.direction === "debit" ? "-" : "+"}
            {formatCurrency(item.amount)}
          </span>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onConfirm(item.id)}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

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
    return (
      <div className="text-muted-foreground text-sm">Loading...</div>
    );
  if (items.length === 0)
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No ambiguous matches
      </div>
    );

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(item.transaction_date)} &middot; {item.account}{" "}
                &middot;{" "}
                <span
                  className={
                    item.direction === "debit"
                      ? "text-red-500"
                      : "text-green-500"
                  }
                >
                  {formatCurrency(item.amount)}
                </span>
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onNoneMatch(item.id)}
            >
              None of these
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.ambiguous_candidate_ids?.length ?? 0} possible email matches:
          </p>
          <div className="flex flex-wrap gap-2">
            {(item.ambiguous_candidate_ids ?? []).map((txId) => (
              <Button
                key={txId}
                size="sm"
                variant="outline"
                onClick={() => onLink(item.id, txId)}
              >
                <Link2 className="h-3.5 w-3.5 mr-1" />
                Link {txId.slice(0, 8)}...
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
