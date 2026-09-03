"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useInfiniteTransactions,
  useBulkDeleteTransactions,
  useUpdateTransactionSplit,
  useClearTransactionSplit,
  useUpdateTransaction,
  useDeleteTransaction,
} from "@/hooks/use-transactions";
import { TransactionDetailsDrawer } from "./transaction-details-drawer";
import { BulkEditModal } from "./bulk-edit-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { SharedExpenseEditor } from "./shared-expense-editor";
import { SplitTransactionModal } from "./split-transaction-modal";
import { GroupExpenseSearchModal } from "./group-expense-search-modal";
import { GroupExpenseModal } from "./group-expense-modal";
import { RecurringModal } from "./recurring-modal";
import { EmailLinksDrawer } from "./email-links-drawer";
import { PdfViewer } from "./pdf-viewer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
import { useLongPress } from "@/hooks/use-long-press";
import { TransactionQuickActionsPanel } from "./transaction-quick-actions-panel";
import type { TransactionActionType } from "./action-tile-grid";
import type { Transaction, TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";

interface TransactionCardListProps {
  filters: TransactionFiltersType;
  sort?: TransactionSort;
}

function TransactionRow({
  transaction: t,
  dotColor,
  selected,
  selectMode,
  onTap,
  onLongPress,
}: {
  transaction: Transaction;
  dotColor: string;
  selected: boolean;
  selectMode: boolean;
  onTap: () => void;
  onLongPress: (rowEl: HTMLButtonElement) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const longPress = useLongPress({
    onLongPress: () => {
      if (rowRef.current) onLongPress(rowRef.current);
    },
    onClick: onTap,
  });
  const amount = t.is_shared && t.split_share_amount ? t.split_share_amount : t.amount;

  return (
    <button
      ref={rowRef}
      type="button"
      {...longPress}
      className={cn(
        "w-full flex items-center gap-2.5 py-2.5 px-1 text-left border-b border-border last:border-b-0 transition-colors min-h-11 select-none touch-manipulation",
        selected && "bg-primary/[0.06]"
      )}
    >
      {selectMode && (
        // Purely presentational here: the row's own tap handler (useLongPress's
        // onClick → onTap → handleCardTap) already calls toggleSelected when
        // selectMode is true. A live onCheckedChange would double-toggle since
        // pointer events already reach the row underneath (I4).
        <Checkbox checked={selected} className="pointer-events-none" />
      )}
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
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
}

export function TransactionCardList({ filters, sort }: TransactionCardListProps) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteTransactions(filters, sort);
  const queryClient = useQueryClient();
  const bulkDeleteTransactions = useBulkDeleteTransactions();
  const categoryColorMap = useCategoryColorMap();
  const updateTransactionSplit = useUpdateTransactionSplit();
  const clearTransactionSplit = useClearTransactionSplit();
  const updateTransaction = useUpdateTransaction();
  const deleteTransaction = useDeleteTransaction();

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Holds only the id, not a snapshot — the actual transaction object is
  // derived reactively below so the drawer picks up mutations (flag/swap/etc)
  // without needing to be re-opened (I2).
  const [openTransactionId, setOpenTransactionId] = useState<string | null>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [panelTransaction, setPanelTransaction] = useState<Transaction | null>(null);
  const [panelAnchorTop, setPanelAnchorTop] = useState<number | null>(null);
  const [drawerInitialMode, setDrawerInitialMode] = useState<"view" | "edit">("view");
  const [activeSubModal, setActiveSubModal] = useState<TransactionActionType | null>(null);
  const [subModalTransaction, setSubModalTransaction] = useState<Transaction | null>(null);
  const [singleDeleteTransaction, setSingleDeleteTransaction] = useState<Transaction | null>(null);
  // Group-expense flow: GroupExpenseSearchModal only selects candidates, the
  // real apiClient.groupExpense() call happens in GroupExpenseModal — mirrors
  // TransactionsTable's groupExpenseFromTransaction/isGroupExpenseModalOpen (C2).
  const [groupExpensePreselectedTransactions, setGroupExpensePreselectedTransactions] = useState<Transaction[] | null>(null);
  const [isGroupExpenseModalOpen, setIsGroupExpenseModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allTransactions = useMemo(
    () => data?.pages?.flatMap((page) => page.data || []) || [],
    [data]
  );

  const openTransaction = useMemo(
    () => allTransactions.find((t) => t.id === openTransactionId) ?? null,
    [allTransactions, openTransactionId]
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
    // In selection mode every touch — tap or long-press — just toggles the
    // checkbox (see design spec Component 4: no mode-switch ambiguity).
    if (selectMode) {
      toggleSelected(t.id);
      return;
    }
    setDrawerInitialMode("view");
    setOpenTransactionId(t.id);
  };

  // rowRect (from getBoundingClientRect()) is already viewport-relative, and
  // the panel renders as position:absolute inside a `fixed inset-0` overlay
  // (viewport space) — so the anchor must stay in pure viewport-space math,
  // no listRect/scrollTop mixed in (C3).
  const handleLongPress = (t: Transaction, rowEl: HTMLButtonElement) => {
    if (selectMode) {
      toggleSelected(t.id);
      return;
    }
    const rowRect = rowEl.getBoundingClientRect();
    const estimatedPanelHeight = 340; // 8 tiles + delete row + header
    let anchorTop = rowRect.bottom + 6;
    if (anchorTop + estimatedPanelHeight > window.innerHeight) {
      // Not enough room below — clamp so the panel never renders off-screen.
      anchorTop = Math.max(12, window.innerHeight - estimatedPanelHeight - 12);
    }
    setPanelAnchorTop(anchorTop);
    setPanelTransaction(t);
  };

  const handleAction = (type: TransactionActionType, t: Transaction) => {
    // The quick-actions panel is an ephemeral popup — every action tap
    // dismisses it, not just Edit/Select (I1).
    setPanelTransaction(null);

    if (type === "flag") {
      updateTransaction.mutate(
        { id: t.id, updates: { is_flagged: !(t.is_flagged === true) } },
        {
          onSuccess: () => toast.success(t.is_flagged ? "Warning removed" : "Transaction marked for review"),
          onError: () => toast.error("Failed to update warning status"),
        }
      );
      return;
    }
    if (type === "direction") {
      const nextDirection = t.direction === "debit" ? "credit" : "debit";
      updateTransaction.mutate(
        { id: t.id, updates: { direction: nextDirection } },
        {
          onSuccess: () => toast.success(`Marked as ${nextDirection === "credit" ? "credit (money in)" : "debit (money out)"}`),
          onError: () => toast.error("Failed to toggle transaction direction"),
        }
      );
      return;
    }
    // Every remaining action type opens a sub-modal (or the delete-confirm
    // dialog) on top of the drawer. The drawer is closed first so only one
    // overlay owns the screen at a time — independent of z-order, this keeps
    // focus, scroll-lock, and animation from fighting between the Sheet and
    // the sub-modal (C1). Flag/direction above are deliberately excluded —
    // I2 requires the drawer to stay open and reflect those mutations live
    // (openTransaction is now reactive).
    setOpenTransactionId(null);

    if (type === "delete") {
      setSingleDeleteTransaction(t);
      return;
    }
    // shared, split, group, recurring, links, pdf all open a sub-modal
    setSubModalTransaction(t);
    setActiveSubModal(type);
  };

  // Stable identity so TransactionQuickActionsPanel's Escape-listener effect
  // (keyed on onClose) doesn't tear down and re-subscribe on every render (M7).
  const closePanel = useCallback(() => setPanelTransaction(null), []);

  const closeSubModal = () => {
    setActiveSubModal(null);
    setSubModalTransaction(null);
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
    return (
      <p className="text-sm text-destructive text-center py-10">
        Error loading transactions: {error.message || "Unknown error"}
      </p>
    );
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
        <Button
          size="sm"
          variant={selectMode ? "secondary" : "ghost"}
          className="h-7 text-xs"
          onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
        >
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
            <div className="mb-3">
              {group.rows.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  dotColor={categoryColorMap[t.category] ?? "var(--muted-foreground)"}
                  selected={selectedIds.has(t.id)}
                  selectMode={selectMode}
                  onTap={() => handleCardTap(t)}
                  onLongPress={(rowEl) => handleLongPress(t, rowEl)}
                />
              ))}
            </div>
          </div>
        ))}
        {isFetchingNextPage && <p className="text-xs text-center text-muted-foreground py-3">Loading more…</p>}
        {!hasNextPage && allTransactions.length > 0 && (
          <p className="text-xs text-center text-muted-foreground/60 py-3">No more transactions</p>
        )}
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="fixed left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-card border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.25)]" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}>
          <span className="text-xs font-semibold text-foreground">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="h-8 text-xs px-3" onClick={() => setIsBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" className="h-8 text-xs px-3 bg-destructive/10 text-destructive hover:bg-destructive/15" onClick={() => setIsDeleteConfirmOpen(true)}>Delete</Button>
          </div>
        </div>
      )}

      <TransactionQuickActionsPanel
        transaction={panelTransaction}
        anchorTop={panelAnchorTop}
        onClose={closePanel}
        onEdit={(t) => {
          setPanelTransaction(null);
          setDrawerInitialMode("edit");
          setOpenTransactionId(t.id);
        }}
        onSelect={(t) => {
          setPanelTransaction(null);
          setSelectMode(true);
          setSelectedIds(new Set([t.id]));
        }}
        onAction={handleAction}
      />
      <TransactionDetailsDrawer
        transaction={openTransaction}
        isOpen={openTransaction !== null}
        onClose={() => setOpenTransactionId(null)}
        initialMode={drawerInitialMode}
        onAction={handleAction}
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

      {subModalTransaction && activeSubModal === "shared" && (
        <SharedExpenseEditor
          transaction={subModalTransaction}
          isOpen={true}
          isLoading={updateTransactionSplit.isPending || clearTransactionSplit.isPending}
          onClose={closeSubModal}
          onSave={async (splitBreakdown, myShareAmount) => {
            try {
              await updateTransactionSplit.mutateAsync({ id: subModalTransaction.id, splitBreakdown, myShareAmount });
              closeSubModal();
            } catch {
              toast.error("Failed to save split breakdown");
            }
          }}
          onClearSplit={async () => {
            try {
              await clearTransactionSplit.mutateAsync(subModalTransaction.id);
              closeSubModal();
            } catch {
              toast.error("Failed to clear split");
            }
          }}
        />
      )}

      {subModalTransaction && activeSubModal === "split" && (
        <SplitTransactionModal
          transaction={subModalTransaction}
          isOpen={true}
          onClose={closeSubModal}
        />
      )}

      {subModalTransaction && activeSubModal === "group" && (
        <GroupExpenseSearchModal
          isOpen={true}
          onClose={closeSubModal}
          initialTransaction={subModalTransaction}
          existingGroupMembers={
            subModalTransaction.transaction_group_id
              ? allTransactions.filter((tx) => tx.transaction_group_id === subModalTransaction.transaction_group_id)
              : undefined
          }
          onSelectTransactions={(txs) => {
            // GroupExpenseSearchModal only selects candidates — the real
            // apiClient.groupExpense() call happens in GroupExpenseModal,
            // mirroring desktop's chained search → group modal flow (C2).
            setGroupExpensePreselectedTransactions(txs);
            setIsGroupExpenseModalOpen(true);
            closeSubModal();
          }}
          onUngroup={async (transactionGroupId) => {
            try {
              await apiClient.ungroupExpense(transactionGroupId);
              toast.success("Expense ungrouped successfully");
              // Same cache-clear pattern as TransactionsTable's
              // handleUngroupExpense: the infinite-query cache can otherwise
              // keep a stale collapsed group row around.
              queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
              queryClient.invalidateQueries({ queryKey: ["transactions"] });
            } catch {
              toast.error("Failed to ungroup expense");
            } finally {
              closeSubModal();
            }
          }}
        />
      )}
      <GroupExpenseModal
        selectedTransactions={groupExpensePreselectedTransactions ?? []}
        isOpen={isGroupExpenseModalOpen}
        onClose={() => {
          setIsGroupExpenseModalOpen(false);
          setGroupExpensePreselectedTransactions(null);
        }}
        onGroupSuccess={() => {
          setIsGroupExpenseModalOpen(false);
          setGroupExpensePreselectedTransactions(null);
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
          queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
        }}
      />

      {subModalTransaction && activeSubModal === "recurring" && (
        <RecurringModal
          key={subModalTransaction.id}
          transaction={subModalTransaction}
          open={true}
          onClose={closeSubModal}
        />
      )}

      {subModalTransaction && activeSubModal === "links" && (
        <EmailLinksDrawer
          transaction={subModalTransaction}
          isOpen={true}
          onClose={closeSubModal}
          onTransactionUpdate={(updatedTransaction) => {
            // Fired after EACH link/unlink — must not close the modal (mirrors
            // desktop's onTransactionUpdate handler in transactions-table.tsx).
            // Only onClose (the drawer's own X / Close button) dismisses it.
            updateTransaction.mutate({
              id: updatedTransaction.id,
              updates: { related_mails: updatedTransaction.related_mails },
            });
          }}
        />
      )}

      {subModalTransaction && activeSubModal === "pdf" && (
        <PdfViewer
          transactionId={subModalTransaction.id}
          open={true}
          onOpenChange={(open) => { if (!open) closeSubModal(); }}
        />
      )}

      {singleDeleteTransaction && (
        <DeleteConfirmationDialog
          isOpen={true}
          onClose={() => setSingleDeleteTransaction(null)}
          onConfirm={async () => {
            try {
              await deleteTransaction.mutateAsync(singleDeleteTransaction.id);
              toast.success("Transaction deleted");
              setSingleDeleteTransaction(null);
            } catch {
              toast.error("Failed to delete transaction");
            }
          }}
          transactions={[singleDeleteTransaction]}
          isLoading={deleteTransaction.isPending}
        />
      )}
    </div>
  );
}
