"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteTransactions, useBulkDeleteTransactions } from "@/hooks/use-transactions";
import { TransactionDetailsDrawer } from "./transaction-details-drawer";
import { BulkEditModal } from "./bulk-edit-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
import type { Transaction, TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { toast } from "sonner";

interface TransactionCardListProps {
  filters: TransactionFiltersType;
  sort?: TransactionSort;
}

export function TransactionCardList({ filters, sort }: TransactionCardListProps) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteTransactions(filters, sort);
  const bulkDeleteTransactions = useBulkDeleteTransactions();
  const categoryColorMap = useCategoryColorMap();

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allTransactions = useMemo(
    () => data?.pages?.flatMap((page) => page.data || []) || [],
    [data]
  );

  // Same 400px-from-bottom threshold as TransactionsTable's fetchMoreOnBottomReached.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, scrollTop, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 400 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Group by date, same as the table's date-header rows, so mobile keeps the
  // same "day totals" context instead of a flat undifferentiated list.
  const grouped = useMemo(() => {
    const groups: { date: string; label: string; dailyTotal: number; rows: Transaction[] }[] = [];
    let current: (typeof groups)[number] | null = null;
    for (const t of allTransactions) {
      const rowDate = t.date ? t.date.split("T")[0] : "";
      if (!current || current.date !== rowDate) {
        const label: string = rowDate
          ? new Date(rowDate + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "";
        current = { date: rowDate, label, dailyTotal: 0, rows: [] };
        groups.push(current);
      }
      current.rows.push(t);
      const amount = t.is_shared && t.split_share_amount ? t.split_share_amount : t.amount;
      if (t.direction === "debit") current.dailyTotal += amount;
    }
    return groups;
  }, [allTransactions]);

  const selectedTransactions = useMemo(
    () => allTransactions.filter((t) => selectedIds.has(t.id)),
    [allTransactions, selectedIds]
  );

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCardTap = (t: Transaction) => {
    if (selectMode) {
      toggleSelected(t.id);
    } else {
      setOpenTransaction(t);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await bulkDeleteTransactions.mutateAsync(Array.from(selectedIds));
      toast.success(`${selectedIds.size} transaction${selectedIds.size !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      setSelectMode(false);
      setIsDeleteConfirmOpen(false);
    } catch {
      toast.error("Failed to delete transactions");
    }
  };

  if (error) {
    return <p className="text-sm text-destructive">Error loading transactions: {error.message || "Unknown error"}</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{allTransactions.length} transactions</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}>
          {selectMode ? "Cancel" : "Select"}
        </Button>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto" style={{ maxHeight: "70vh" }}>
        {grouped.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-2 py-1.5 sticky top-0 bg-background z-10">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{group.label}</span>
              <div className="flex-1 h-px bg-border" />
              {group.dailyTotal > 0 && (
                <span className="text-xs font-mono text-muted-foreground/70 tabular-nums">{formatCurrency(group.dailyTotal)}</span>
              )}
            </div>
            <div className="space-y-1.5 mb-3">
              {group.rows.map((t) => {
                const dotColor = categoryColorMap[t.category] ?? "var(--muted-foreground)";
                const amount = t.is_shared && t.split_share_amount ? t.split_share_amount : t.amount;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleCardTap(t)}
                    className={cn(
                      "w-full flex items-center gap-2.5 py-2.5 px-1 text-left border-b border-border last:border-b-0 transition-colors min-h-11",
                      selectedIds.has(t.id) && "bg-primary/[0.06]"
                    )}
                  >
                    {selectMode && (
                      <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleSelected(t.id)} onClick={(e) => e.stopPropagation()} />
                    )}
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: dotColor }}
                    />
                    <p className="flex-1 min-w-0 text-[12.5px] font-medium text-foreground truncate">
                      {t.description}
                    </p>
                    <div className="text-right shrink-0">
                      <p className={cn(
                        "font-mono text-[12.5px] font-semibold tabular-nums",
                        t.direction === "credit" ? "text-emerald-500" : "text-foreground"
                      )}>
                        {t.direction === "credit" ? "+" : "−"}{formatCurrency(amount)}
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate max-w-[110px]">
                        {t.category}{t.is_shared ? " · Split" : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {isFetchingNextPage && <p className="text-xs text-center text-muted-foreground py-3">Loading more…</p>}
        {!hasNextPage && allTransactions.length > 0 && (
          <p className="text-xs text-center text-muted-foreground/60 py-3">No more transactions</p>
        )}
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="fixed left-0 right-0 z-40 flex items-center justify-between px-4 py-2.5 bg-primary/10 border-t border-primary/25 backdrop-blur-sm" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}>
          <span className="text-xs font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-primary" onClick={() => setIsBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => setIsDeleteConfirmOpen(true)}>Delete</Button>
          </div>
        </div>
      )}

      <TransactionDetailsDrawer
        transaction={openTransaction}
        isOpen={openTransaction !== null}
        onClose={() => setOpenTransaction(null)}
      />
      <BulkEditModal
        selectedTransactions={selectedTransactions}
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
      />
      <DeleteConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        transactions={selectedTransactions}
        isLoading={bulkDeleteTransactions.isPending}
      />
    </div>
  );
}
