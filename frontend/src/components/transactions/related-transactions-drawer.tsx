"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useCategories } from "@/hooks/use-categories";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import {
  ArrowDown, ArrowRight, ArrowLeftRight, Unlink, Trash2,
  Layers, Split, CornerUpLeft, Check, AlertTriangle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface RelatedTransactionsDrawerProps {
  transaction: Transaction;
  parentTransaction?: Transaction;
  childTransactions?: Transaction[];
  transferGroup?: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onUnlink: () => void;
  onUnlinkChild?: (childId: string) => void;
  onUngroup: () => void;
  onRemoveFromGroup: (transactionId: string) => void;
  /** When set, overrides inferred mode (e.g. "groupedExpense" when opened from group expense icon). */
  modeOverride?: "split" | "transfer" | "groupedExpense";
}

type DrawerMode = "refund" | "transfer" | "split" | "groupedExpense";

// Shared pastel colors matching the table pills
const DEBIT_TEXT = "text-[#F44D4D]";
const DEBIT_BG = "bg-[#F44D4D]/10";
const CREDIT_TEXT = "text-emerald-300";
const CREDIT_BG = "bg-emerald-300/10";
const VIOLET_TEXT = "text-violet-300";
const VIOLET_BG = "bg-violet-400/15";
const VIOLET_BORDER = "border-violet-400/30";

// Part colors — same palette as split-transaction-modal
const PART_COLORS = [
  "#6366f1",
  "#14b8a6",
  "#f59e0b",
  "#f43f5e",
  "#a78bfa",
  "#84cc16",
];

// Neutral transaction card — no alarming red background
const txCard = "p-4 rounded-lg border bg-muted/50 border-border";

export function RelatedTransactionsDrawer({
  transaction,
  parentTransaction,
  childTransactions = [],
  transferGroup = [],
  isOpen,
  onClose,
  onUnlink,
  onUnlinkChild,
  onUngroup,
  onRemoveFromGroup,
  modeOverride,
}: RelatedTransactionsDrawerProps) {
  const mode: DrawerMode = modeOverride ?? (!!parentTransaction
    ? "refund"
    : childTransactions.length > 0
      ? "refund"
      : transaction.is_split
        ? "split"
        : "transfer");

  const netAmount = transferGroup.reduce((sum, t) => sum + t.amount, 0);
  const { data: categories = [] } = useCategories();

  const getCategoryColor = (categoryName: string, fallbackIndex: number): string => {
    const cat = categories.find(
      (c: { name: string; color?: string }) => c.name === categoryName
    );
    return cat?.color || PART_COLORS[fallbackIndex % PART_COLORS.length];
  };

  const modeConfig = {
    refund:        { icon: <CornerUpLeft className="h-4 w-4" />, title: "Refund Details" },
    split:         { icon: <Split className="h-4 w-4" />,         title: "Split Transaction" },
    groupedExpense:{ icon: <Layers className="h-4 w-4" />,       title: "Grouped Expense" },
    transfer:      { icon: <ArrowLeftRight className="h-4 w-4" />, title: "Transfer Group" },
  };

  const handleUnlink = async () => {
    try {
      onUnlink();
      onClose();
      toast.success("Refund unlinked successfully");
    } catch {
      toast.error("Failed to unlink refund");
    }
  };

  const handleUngroup = async () => {
    try {
      if (mode === "split") {
        if (transaction.transaction_group_id) {
          await apiClient.ungroupSplit(transaction.transaction_group_id);
          toast.success("Split removed. Original transaction restored.");
          onClose();
          window.location.reload();
        }
      } else if (mode === "groupedExpense") {
        onUngroup();
        onClose();
      } else {
        onUngroup();
        onClose();
      }
    } catch {
      toast.error(mode === "split" ? "Failed to remove split" : mode === "groupedExpense" ? "Failed to ungroup expense" : "Failed to ungroup transfer");
    }
  };

  const handleRemoveFromGroup = async (transactionId: string) => {
    try {
      onRemoveFromGroup(transactionId);
      toast.success("Transaction removed from transfer group");
    } catch {
      toast.error("Failed to remove from group");
    }
  };

  const handleUnlinkChild = async (childId: string) => {
    try {
      if (onUnlinkChild) {
        await onUnlinkChild(childId);
        toast.success("Refund unlinked successfully");
      }
    } catch {
      toast.error("Failed to unlink refund");
    }
  };

  // Shared transaction card renderer
  const TxCard = ({ t, children }: { t: Transaction; children?: React.ReactNode }) => {
    const isDebit = t.direction === "debit";
    return (
      <div className={txCard}>
        <div className="space-y-1.5">
          <div className="font-medium text-sm text-foreground truncate">{t.description}</div>
          <div className={cn("text-xs font-mono", isDebit ? DEBIT_TEXT : CREDIT_TEXT)}>
            {isDebit ? "↓" : "↑"} {formatCurrency(Math.abs(t.amount))}
            <span className="text-muted-foreground font-sans"> · {formatDate(t.date)}</span>
            {t.account && <span className="text-muted-foreground font-sans"> · {t.account.split(" ").slice(0, -2).join(" ") || t.account}</span>}
          </div>
          {(t.category || t.subcategory) && (
            <div className="flex items-center gap-1 pt-0.5">
              {t.category && <Badge variant="secondary" className="text-xs">{t.category}</Badge>}
              {t.subcategory && <Badge variant="outline" className="text-xs">{t.subcategory}</Badge>}
            </div>
          )}
          {t.notes && <div className="text-xs text-muted-foreground italic">{t.notes}</div>}
          {children}
        </div>
      </div>
    );
  };

  const NetAmount = ({ amount, label, sub }: { amount: number; label: string; sub?: string }) => (
    <div className="p-4 bg-muted/50 rounded-lg border border-border text-center space-y-1">
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
      <div className={cn("text-xl font-bold font-mono tabular-nums", amount >= 0 ? CREDIT_TEXT : DEBIT_TEXT)}>
        {amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(amount))}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );

  const SectionLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn("text-xs font-medium text-muted-foreground uppercase tracking-wide", className)}>
      {children}
    </div>
  );

  const renderRefundMode = () => {
    if (parentTransaction) {
      const netSpent = Math.abs(parentTransaction.amount) - Math.abs(transaction.amount);
      return (
        <div className="space-y-4">
          <SectionLabel>Original Purchase</SectionLabel>
          <TxCard t={parentTransaction} />
          <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-muted-foreground" /></div>
          <SectionLabel>Refund</SectionLabel>
          <TxCard t={transaction} />
          <NetAmount
            amount={-netSpent}
            label="Net Amount Spent"
            sub={`${formatCurrency(Math.abs(parentTransaction.amount))} − ${formatCurrency(Math.abs(transaction.amount))}`}
          />
          <Button variant="outline" onClick={handleUnlink} className="w-full text-muted-foreground">
            <Unlink className="h-4 w-4 mr-2" />
            Unlink Refund
          </Button>
        </div>
      );
    }

    if (childTransactions.length > 0) {
      const totalRefunded = childTransactions.reduce((sum, c) => sum + Math.abs(c.amount), 0);
      const netSpent = Math.abs(transaction.amount) - totalRefunded;
      return (
        <div className="space-y-4">
          <SectionLabel>Original Purchase</SectionLabel>
          <TxCard t={transaction} />
          <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-muted-foreground" /></div>
          <SectionLabel>Refund{childTransactions.length > 1 ? `s (${childTransactions.length})` : ""}</SectionLabel>
          <div className="space-y-2">
            {childTransactions.map((child) => (
              <TxCard key={child.id} t={child}>
                {onUnlinkChild && (
                  <div className="pt-2 mt-2 border-t border-border">
                    <Button variant="outline" size="sm" onClick={() => handleUnlinkChild(child.id)} className="w-full text-muted-foreground">
                      <Unlink className="h-3 w-3 mr-2" />
                      Unlink Refund
                    </Button>
                  </div>
                )}
              </TxCard>
            ))}
          </div>
          <NetAmount
            amount={-netSpent}
            label="Net Amount Spent"
            sub={`${formatCurrency(Math.abs(transaction.amount))} − ${formatCurrency(totalRefunded)} refunded`}
          />
          {!onUnlinkChild && (
            <p className="text-xs text-muted-foreground text-center">
              Click on the refund transaction in the table to unlink individual refunds.
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const renderGroupedExpenseMode = () => {
    const members = transferGroup.filter(t => !t.is_grouped_expense);
    const groupNet = members.reduce((sum, t) =>
      sum + (t.direction === 'debit' ? -Math.abs(t.amount) : Math.abs(t.amount)), 0);

    if (members.length === 0) {
      return (
        <p className="text-sm text-muted-foreground text-center py-4">No transactions in this group.</p>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground text-center">Combined into a single expense row</p>
        <div className="space-y-2">
          {members.map((t) => <TxCard key={t.id} t={t} />)}
        </div>
        <NetAmount amount={groupNet} label="Net Amount" />
      </div>
    );
  };

  const renderTransferMode = () => {
    if (transferGroup.length === 0) return null;
    const isBalanced = Math.abs(netAmount) < 1;

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground text-center">Money movement between accounts</p>
        <div className="space-y-2">
          {transferGroup.map((t, index) => (
            <div key={t.id} className="relative">
              {index > 0 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              <TxCard t={t}>
                {t.id !== transaction.id && (
                  <div className="pt-2 mt-2 border-t border-border">
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveFromGroup(t.id)} className="w-full text-muted-foreground hover:text-destructive h-7">
                      <Trash2 className="h-3 w-3 mr-2" />
                      Remove from group
                    </Button>
                  </div>
                )}
              </TxCard>
            </div>
          ))}
        </div>
        <div className={cn("p-3 rounded-lg border flex items-center gap-2 text-xs",
          isBalanced
            ? "bg-emerald-300/10 border-emerald-300/20 text-emerald-300"
            : "bg-[#F44D4D]/10 border-[#F44D4D]/20 text-[#F44D4D]"
        )}>
          {isBalanced
            ? <><Check className="h-3.5 w-3.5 shrink-0" /> Transfer is balanced</>
            : <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Imbalance of {formatCurrency(Math.abs(netAmount))} — should be zero</>
          }
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full border-destructive/50 text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Entire Group
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Remove entire group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unlink all transactions in this group. They will remain in your records but will no longer be grouped together.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleUngroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Remove Group
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  const renderSplitMode = () => {
    if (transferGroup.length === 0) return null;

    const parentTx = transferGroup.find(t => t.is_split === false);
    const childTxs = transferGroup.filter(t => t.is_split === true);
    const childrenTotal = childTxs.reduce((sum, t) => {
      return sum + Math.abs(t.is_shared && t.split_share_amount != null ? t.split_share_amount : t.amount);
    }, 0);
    const parentAmount = parentTx ? Math.abs(parentTx.amount) : 0;
    const parentComparableAmount =
      parentTx?.is_shared && parentTx?.split_share_amount != null
        ? Math.abs(parentTx.split_share_amount)
        : parentAmount;
    const isBalanced = Math.abs(childrenTotal - parentComparableAmount) < 0.01;

    return (
      <div className="space-y-4">
        {/* Source strip */}
        {parentTx && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/40">
            <div className="w-0.5 self-stretch rounded-full bg-[#6366f1]/50 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">
                {parentTx.description}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[
                  formatDate(parentTx.date),
                  parentTx.account
                    ? parentTx.account.split(" ").slice(0, -2).join(" ") || parentTx.account
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="text-sm font-mono text-muted-foreground flex-shrink-0 text-right">
              {parentTx.is_shared && parentTx.split_share_amount != null ? (
                <>
                  <span className="text-foreground font-semibold">
                    {formatCurrency(Math.abs(parentTx.split_share_amount))}
                  </span>
                  <span className="text-xs block text-muted-foreground/60">
                    / {formatCurrency(parentAmount)} total
                  </span>
                </>
              ) : (
                <span className="text-foreground font-semibold">
                  {formatCurrency(parentAmount)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Read-only allocation bar */}
        {childTxs.length > 0 && (
          <div className="space-y-2">
            <div className="relative h-2 rounded-full overflow-hidden bg-muted/40">
              <div className="absolute inset-0 flex">
                {childTxs.map((t, i) => {
                  const amt = Math.abs(
                    t.is_shared && t.split_share_amount != null
                      ? t.split_share_amount
                      : t.amount
                  );
                  const pct =
                    parentComparableAmount > 0
                      ? Math.min(100, (amt / parentComparableAmount) * 100)
                      : 0;
                  return (
                    <div
                      key={t.id}
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isBalanced
                          ? getCategoryColor(t.category || "", i)
                          : "#f43f5e",
                      }}
                    />
                  );
                })}
              </div>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {childTxs.map((t, i) => {
                const amt = Math.abs(
                  t.is_shared && t.split_share_amount != null ? t.split_share_amount : t.amount
                );
                return (
                  <div key={t.id} className="flex items-center gap-1.5 text-xs">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getCategoryColor(t.category || "", i) }}
                    />
                    <span className="text-muted-foreground truncate max-w-[72px]">
                      {t.description}
                    </span>
                    <span className="font-mono text-foreground/60 tabular-nums">
                      {formatCurrency(amt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Parts list */}
        {childTxs.length > 0 && (
          <>
            <SectionLabel>Split Parts ({childTxs.length})</SectionLabel>
            <div className="space-y-2">
              {childTxs.map((t, i) => {
                const amt = Math.abs(
                  t.is_shared && t.split_share_amount != null ? t.split_share_amount : t.amount
                );
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: getCategoryColor(t.category || "", i) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {t.description}
                      </div>
                      {(t.category || t.subcategory) && (
                        <div className="flex items-center gap-1 mt-1">
                          {t.category && (
                            <Badge variant="secondary" className="text-xs">
                              {t.category}
                            </Badge>
                          )}
                          {t.subcategory && (
                            <Badge variant="outline" className="text-xs">
                              {t.subcategory}
                            </Badge>
                          )}
                        </div>
                      )}
                      {t.notes && (
                        <div className="text-xs text-muted-foreground italic mt-1">
                          {t.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-mono font-semibold text-foreground/80 flex-shrink-0">
                      {formatCurrency(amt)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Balance indicator */}
        <div className="flex items-center justify-center gap-1.5 text-xs">
          {isBalanced ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">
                Amounts match · {formatCurrency(childrenTotal)}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-[#F44D4D]" />
              <span className="text-[#F44D4D]">
                Mismatch: parts ({formatCurrency(childrenTotal)}) ≠ original (
                {formatCurrency(parentComparableAmount)})
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  const { icon, title } = modeConfig[mode];

  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <Modal.Header
        icon={icon}
        title={title}
        onClose={onClose}
        variant="share"
      />
      <Modal.Body className="scrollbar-none">
        {mode === "refund"
          ? renderRefundMode()
          : mode === "split"
            ? renderSplitMode()
            : mode === "groupedExpense"
              ? renderGroupedExpenseMode()
              : renderTransferMode()}
      </Modal.Body>
      <Modal.Footer>
        {mode === "groupedExpense" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="mr-auto border-destructive/50 text-destructive hover:bg-destructive/10"
              >
                <Unlink className="h-4 w-4 mr-2" />
                Ungroup
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Ungroup transactions?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the group link between these transactions. They will remain in your records but will no longer be grouped together.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleUngroup}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Ungroup
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {mode === "split" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="mr-auto border-destructive/50 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove Split
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Remove split?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all split parts and restore the original transaction. This cannot be undone.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleUngroup}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove Split
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
