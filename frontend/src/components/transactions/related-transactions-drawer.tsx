"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import {
  ArrowDown, ArrowRight, ArrowLeftRight, Unlink, Trash2,
  Layers, Zap, CornerUpLeft, Check, AlertTriangle,
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

  const modeConfig = {
    refund:        { icon: <CornerUpLeft className="h-4 w-4" />, title: "Refund Details" },
    split:         { icon: <Zap className="h-4 w-4" />,          title: "Split Transaction" },
    groupedExpense:{ icon: <Layers className="h-4 w-4" />,       title: "Grouped Expense" },
    transfer:      { icon: <ArrowLeftRight className="h-4 w-4" />, title: "Transfer Group" },
  };

  const handleUnlink = async () => {
    try {
      onUnlink();
      onClose();
      toast.success("Refund unlinked successfully");
    } catch (error) {
      console.error("Failed to unlink refund:", error);
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
    } catch (error) {
      console.error("Failed to ungroup:", error);
      toast.error(mode === "split" ? "Failed to remove split" : mode === "groupedExpense" ? "Failed to ungroup expense" : "Failed to ungroup transfer");
    }
  };

  const handleRemoveFromGroup = async (transactionId: string) => {
    try {
      onRemoveFromGroup(transactionId);
      toast.success("Transaction removed from transfer group");
    } catch (error) {
      console.error("Failed to remove from group:", error);
      toast.error("Failed to remove from group");
    }
  };

  const handleUnlinkChild = async (childId: string) => {
    try {
      if (onUnlinkChild) {
        await onUnlinkChild(childId);
        toast.success("Refund unlinked successfully");
      }
    } catch (error) {
      console.error("Failed to unlink refund:", error);
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
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">No transactions in this group.</p>
          <Button variant="outline" onClick={handleUngroup} className={cn("w-full", VIOLET_TEXT)}>
            <Unlink className="h-4 w-4 mr-2" />
            Ungroup expense
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground text-center">Combined into a single expense row</p>
        <div className="space-y-2">
          {members.map((t) => <TxCard key={t.id} t={t} />)}
        </div>
        <NetAmount amount={groupNet} label="Net Amount" />
        <Button variant="outline" onClick={handleUngroup} className={cn("w-full", VIOLET_TEXT)}>
          <Unlink className="h-4 w-4 mr-2" />
          Ungroup expense
        </Button>
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
        <Button variant="outline" onClick={handleUngroup} className="w-full text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          Remove Entire Group
        </Button>
      </div>
    );
  };

  const renderSplitMode = () => {
    if (transferGroup.length === 0) return null;

    const parentTx = transferGroup.find(t => t.is_split === false);
    const childTxs = transferGroup.filter(t => t.is_split === true);
    const childrenTotal = childTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const parentAmount = parentTx ? Math.abs(parentTx.amount) : 0;
    // When the parent is a shared/split transaction, compare against the user's share, not the full amount
    const parentComparableAmount = parentTx?.is_shared && parentTx?.split_share_amount != null
      ? Math.abs(parentTx.split_share_amount)
      : parentAmount;
    const isValid = Math.abs(childrenTotal - parentComparableAmount) < 0.01;

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground text-center">One transaction split into multiple categories</p>

        {parentTx && (
          <>
            <SectionLabel>Original Transaction</SectionLabel>
            <div className={cn("p-4 rounded-lg border-2", VIOLET_BG, VIOLET_BORDER)}>
              <div className="space-y-1.5">
                <div className="font-medium text-sm text-foreground">{parentTx.description}</div>
                <div className={cn("text-xs", VIOLET_TEXT)}>
                  {formatDate(parentTx.date)}
                  {parentTx.account && ` · ${parentTx.account.split(" ").slice(0, -2).join(" ") || parentTx.account}`}
                </div>
                <div className={cn("text-xs font-mono", VIOLET_TEXT)}>
                  {parentTx.is_shared && parentTx.split_share_amount != null
                    ? <>Your share: {formatCurrency(Math.abs(parentTx.split_share_amount))} · Total: {formatCurrency(parentAmount)}</>
                    : <>Amount: {formatCurrency(parentAmount)}</>
                  }
                </div>
                {(parentTx.category || parentTx.subcategory) && (
                  <div className="flex items-center gap-1 pt-0.5">
                    {parentTx.category && <Badge variant="secondary" className="text-xs">{parentTx.category}</Badge>}
                    {parentTx.subcategory && <Badge variant="outline" className="text-xs">{parentTx.subcategory}</Badge>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {parentTx && childTxs.length > 0 && (
          <div className="flex justify-center"><ArrowDown className="h-4 w-4 text-muted-foreground" /></div>
        )}

        {childTxs.length > 0 && (
          <>
            <SectionLabel>Split Parts ({childTxs.length})</SectionLabel>
            <div className="space-y-2 pl-4 border-l-2 border-border">
              {childTxs.map((t) => (
                <div key={t.id} className={txCard}>
                  <div className="space-y-1.5">
                    <div className="font-medium text-sm text-foreground truncate">{t.description}</div>
                    <div className={cn("text-xs", VIOLET_TEXT)}>
                      {formatDate(t.date)}
                      {t.account && ` · ${t.account.split(" ").slice(0, -2).join(" ") || t.account}`}
                    </div>
                    <div className={cn("text-xs font-mono", VIOLET_TEXT)}>
                      {t.is_shared && t.split_share_amount != null
                        ? <>Your share: {formatCurrency(Math.abs(t.split_share_amount))} · Total: {formatCurrency(Math.abs(t.amount))}</>
                        : <>Amount: {formatCurrency(Math.abs(t.amount))}</>
                      }
                    </div>
                    {(t.category || t.subcategory) && (
                      <div className="flex items-center gap-1 pt-0.5">
                        {t.category && <Badge variant="secondary" className="text-xs">{t.category}</Badge>}
                        {t.subcategory && <Badge variant="outline" className="text-xs">{t.subcategory}</Badge>}
                      </div>
                    )}
                    {t.notes && <div className="text-xs text-muted-foreground italic">{t.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className={cn("p-3 rounded-lg border flex items-center gap-2 text-xs",
          isValid
            ? "bg-emerald-300/10 border-emerald-300/20 text-emerald-300"
            : "bg-[#F44D4D]/10 border-[#F44D4D]/20 text-[#F44D4D]"
        )}>
          {isValid
            ? <><Check className="h-3.5 w-3.5 shrink-0" /> Amounts match: {formatCurrency(childrenTotal)} = {formatCurrency(parentComparableAmount)}</>
            : <><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Mismatch: parts ({formatCurrency(childrenTotal)}) ≠ original ({formatCurrency(parentComparableAmount)})</>
          }
        </div>

        <Button variant="outline" onClick={handleUngroup} className={cn("w-full", VIOLET_TEXT)}>
          <Trash2 className="h-4 w-4 mr-2" />
          Remove Split &amp; Restore Original
        </Button>
      </div>
    );
  };

  const { icon, title } = modeConfig[mode];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md bg-card border-border max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">{icon}</span>
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode === "refund"
            ? renderRefundMode()
            : mode === "split"
              ? renderSplitMode()
              : mode === "groupedExpense"
                ? renderGroupedExpenseMode()
                : renderTransferMode()}
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
