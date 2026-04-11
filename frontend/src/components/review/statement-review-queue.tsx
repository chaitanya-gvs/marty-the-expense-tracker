"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReviewQueue,
  useConfirmReviewItem,
  useDeleteReviewItem,
  useLinkReviewItem,
  useRunEmailIngestion,
} from "@/hooks/use-review-queue";
import type { ReviewQueueItem } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { RefreshCw, CheckCheck, Link2 } from "lucide-react";

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
          <span className="text-sm font-medium">
            Ambiguous
          </span>
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
    return <div className="text-muted-foreground text-sm">Loading...</div>;

  if (items.length === 0)
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        No ambiguous matches — all clear
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
