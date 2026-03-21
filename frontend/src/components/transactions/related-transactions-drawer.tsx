"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { X, ArrowDown, ArrowRight, ArrowLeft, Unlink, Trash2, ExternalLink, Layers } from "lucide-react";
import { apiClient } from "@/lib/api/client";

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
  // Early return - don't render anything if closed
  if (!isOpen) {
    return null;
  }

  // Determine mode: refund, split, groupedExpense, or transfer
  const mode: DrawerMode = modeOverride ?? (!!parentTransaction
    ? "refund"
    : childTransactions.length > 0
      ? "refund"
      : transaction.is_split
        ? "split"
        : "transfer");
  const netAmount = transferGroup.reduce((sum, t) => sum + t.amount, 0);
  const totalSplitAmount = transferGroup.reduce((sum, t) => sum + Math.abs(t.amount), 0);

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


  const renderRefundMode = () => {
    // Handle refund child case (credit with parent)
    if (parentTransaction) {

      const netSpent = Math.abs(parentTransaction.amount) - Math.abs(transaction.amount);

      return (
        <div className="space-y-6">
          <div className="text-center">
            <div className="text-sm font-medium text-foreground mb-4">
              Refund Relationship
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <ArrowDown className="h-4 w-4" />
              <span className="text-xs">Refund of original purchase</span>
            </div>
          </div>

          {/* Parent Transaction */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-destructive/50 text-destructive">
                Original Purchase
              </Badge>
            </div>
            <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
              <div className="space-y-2">
                <div className="font-medium text-sm">{parentTransaction.description}</div>
                <div className="text-xs text-destructive">
                  {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))} · {parentTransaction.account.split(' ').slice(0, -2).join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="border-destructive/50 text-destructive text-xs">
                    Debit
                  </Badge>
                  {parentTransaction.category && (
                    <Badge variant="secondary" className="text-xs">
                      {parentTransaction.category}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Refund Transaction */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">
                Refund
              </Badge>
            </div>
            <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <div className="space-y-2">
                <div className="font-medium text-sm">{transaction.description}</div>
                <div className="text-xs text-emerald-500">
                  {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount))} · {transaction.account.split(' ').slice(0, -2).join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="border-emerald-500/50 text-emerald-500 text-xs">
                    Credit
                  </Badge>
                  {transaction.category && (
                    <Badge variant="secondary" className="text-xs">
                      {transaction.category}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Net Effect */}
          <div className="p-4 bg-muted/50 rounded-lg border border-border">
            <div className="text-center space-y-2">
              <div className="text-sm font-medium text-foreground">
                Net Amount Spent
              </div>
              <div className={`text-lg font-bold ${netSpent >= 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                {netSpent >= 0 ? '-' : '+'}{formatCurrency(Math.abs(netSpent))}
              </div>
              <div className="text-xs text-muted-foreground">
                Original: {formatCurrency(Math.abs(parentTransaction.amount))} - Refund: {formatCurrency(Math.abs(transaction.amount))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={handleUnlink}
              className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <Unlink className="h-4 w-4 mr-2" />
              Unlink Refund
            </Button>
          </div>
        </div>
      );
    }

    // Handle refund parent case (debit with children)
    if (childTransactions.length > 0) {
      const totalRefunded = childTransactions.reduce((sum, child) => sum + Math.abs(child.amount), 0);
      const netSpent = Math.abs(transaction.amount) - totalRefunded;

      return (
        <div className="space-y-6">
          <div className="text-center">
            <div className="text-sm font-medium text-foreground mb-4">
              Refund Relationship ({childTransactions.length} refund{childTransactions.length > 1 ? 's' : ''})
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <ArrowDown className="h-4 w-4" />
              <span className="text-xs">Original purchase with refunds</span>
            </div>
          </div>

          {/* Parent Transaction (this transaction) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-destructive/50 text-destructive">
                Original Purchase
              </Badge>
            </div>
            <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
              <div className="space-y-2">
                <div className="font-medium text-sm">{transaction.description}</div>
                <div className="text-xs text-destructive">
                  {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount))} · {transaction.account.split(' ').slice(0, -2).join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="border-destructive/50 text-destructive text-xs">
                    Debit
                  </Badge>
                  {transaction.category && (
                    <Badge variant="secondary" className="text-xs">
                      {transaction.category}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Refund Transactions (children) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">
                Refund{childTransactions.length > 1 ? 's' : ''} ({childTransactions.length})
              </Badge>
            </div>
            <div className="space-y-2">
              {childTransactions.map((child) => (
                <div key={child.id} className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <div className="space-y-2">
                    <div className="font-medium text-sm">{child.description}</div>
                    <div className="text-xs text-emerald-500">
                      {formatDate(child.date)} · {formatCurrency(Math.abs(child.amount))} · {child.account.split(' ').slice(0, -2).join(' ')}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="border-emerald-500/50 text-emerald-500 text-xs">
                        Credit
                      </Badge>
                      {child.category && (
                        <Badge variant="secondary" className="text-xs">
                          {child.category}
                        </Badge>
                      )}
                    </div>
                    {onUnlinkChild && (
                      <div className="mt-3 pt-3 border-t border-emerald-500/20">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnlinkChild(child.id)}
                          className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                        >
                          <Unlink className="h-3 w-3 mr-2" />
                          Unlink Refund
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Net Effect */}
          <div className="p-4 bg-muted/50 rounded-lg border border-border">
            <div className="text-center space-y-2">
              <div className="text-sm font-medium text-foreground">
                Net Amount Spent
              </div>
              <div className={`text-lg font-bold ${netSpent >= 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                {netSpent >= 0 ? '-' : '+'}{formatCurrency(Math.abs(netSpent))}
              </div>
              <div className="text-xs text-muted-foreground">
                Original: {formatCurrency(Math.abs(transaction.amount))} - Total Refunded: {formatCurrency(totalRefunded)}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {onUnlinkChild ? (
              <p className="text-xs text-muted-foreground text-center">
                Click "Unlink Refund" on any refund above to remove the link
              </p>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                To unlink individual refunds, click on the refund transaction in the table
              </p>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderGroupedExpenseMode = () => {
    // Exclude the collapsed summary row (is_grouped_expense) so we only show member transactions
    const members = transferGroup.filter(t => !t.is_grouped_expense);

    if (members.length === 0) {
      return (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground text-center">
            No transactions in this group. You can ungroup to remove the group.
          </p>
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-[#7C3AED]/30 text-[#7C3AED] hover:bg-[#7C3AED]/20"
          >
            <Unlink className="h-4 w-4 mr-2" />
            Ungroup expense
          </Button>
        </div>
      );
    }

    const netAmount = members.reduce((sum, t) => sum + t.amount, 0);

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-sm font-medium text-foreground mb-4">
            Grouped expense ({members.length} transactions)
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span className="text-xs">Combined into a single expense row</span>
          </div>
        </div>

        <div className="space-y-3">
          {members.map((t) => (
            <div
              key={t.id}
              className={`p-4 rounded-lg border ${t.direction === "debit"
                ? "bg-destructive/10 border-destructive/20"
                : "bg-emerald-500/10 border-emerald-500/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{t.description}</div>
                  <div className={`text-xs ${t.direction === "debit" ? "text-destructive" : "text-emerald-500"}`}>
                    {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))}
                    {t.account && ` · ${t.account.split(" ").slice(0, -2).join(" ") || t.account}`}
                  </div>
                  {t.category && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      {t.category}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border border-border">
          <div className="text-center space-y-1">
            <div className="text-sm font-medium text-foreground">Net amount</div>
            <div className={`text-lg font-bold ${netAmount >= 0 ? "text-emerald-500" : "text-destructive"}`}>
              {netAmount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(netAmount))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-[#7C3AED]/30 text-[#7C3AED] hover:bg-[#7C3AED]/20"
          >
            <Unlink className="h-4 w-4 mr-2" />
            Ungroup expense
          </Button>
        </div>
      </div>
    );
  };

  const renderTransferMode = () => {
    if (transferGroup.length === 0) return null;

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-sm font-medium text-foreground mb-4">
            Transfer Group ({transferGroup.length} legs)
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <ArrowRight className="h-4 w-4" />
            <span className="text-xs">Money movement between accounts</span>
          </div>
        </div>

        {/* Transfer Legs */}
        <div className="space-y-3">
          {transferGroup.map((t, index) => (
            <div key={t.id} className="relative">
              {index > 0 && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              <div className={`p-4 rounded-lg border ${t.direction === 'debit'
                ? 'bg-destructive/10 border-destructive/20'
                : 'bg-emerald-500/10 border-emerald-500/20'
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{t.description}</div>
                    <div className={`text-xs ${t.direction === 'debit' ? 'text-destructive' : 'text-emerald-500'}`}>
                      {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))} · {t.account.split(' ').slice(0, -2).join(' ')}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${t.direction === 'debit' ? 'border-destructive/50 text-destructive' : 'border-emerald-500/50 text-emerald-500'}`}
                      >
                        {t.direction === 'debit' ? 'Out' : 'In'}
                      </Badge>
                      {t.category && (
                        <Badge variant="secondary" className="text-xs">
                          {t.category}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {t.id !== transaction.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFromGroup(t.id)}
                      className="ml-3 h-8 w-8 p-0 text-destructive/70 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Net Effect */}
        <div className="p-4 bg-muted/50 rounded-lg border border-border">
          <div className="text-center space-y-2">
            <div className="text-sm font-medium text-foreground">
              Transfer Net Effect
            </div>
            <div className={`text-lg font-bold ${Math.abs(netAmount) < 1 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {formatCurrency(Math.abs(netAmount))}
              {Math.abs(netAmount) >= 1 && " ⚠️"}
            </div>
            <div className="text-xs text-muted-foreground">
              Should be zero for proper transfers
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Remove Entire Group
          </Button>
        </div>
      </div>
    );
  };

  const renderSplitMode = () => {
    if (transferGroup.length === 0) return null;

    // Separate parent (is_split=false) from children (is_split=true)
    const parentTransaction = transferGroup.find(t => t.is_split === false);
    const childTransactions = transferGroup.filter(t => t.is_split === true);

    // Validate: sum of children should equal parent amount
    const childrenTotal = childTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const parentAmount = parentTransaction ? Math.abs(parentTransaction.amount) : 0;
    const isValid = Math.abs(childrenTotal - parentAmount) < 0.01; // Allow small floating point differences

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-sm font-medium text-foreground mb-4">
            Split Transaction ({childTransactions.length} parts)
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <span className="text-base">⚡</span>
            <span className="text-xs">One transaction split into multiple categories</span>
          </div>
        </div>

        {/* Parent Transaction (Root Node) */}
        {parentTransaction && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-[#7C3AED]/30 text-[#7C3AED]">
                Original Transaction
              </Badge>
            </div>
            <div className="p-4 rounded-lg border-2 bg-[#7C3AED]/10 border-[#7C3AED]/30">
              <div className="space-y-2">
                <div className="font-medium text-sm">{parentTransaction.description}</div>
                <div className="text-xs text-[#7C3AED]">
                  {formatDate(parentTransaction.date)}
                </div>
                <div className="text-xs text-[#7C3AED]">
                  <span className="font-medium">Account:</span> {parentTransaction.account ? parentTransaction.account.split(' ').slice(0, -2).join(' ') || parentTransaction.account : '—'}
                </div>
                {parentTransaction.paid_by && (
                  <div className="text-xs text-[#7C3AED]">
                    <span className="font-medium">Paid by:</span> {parentTransaction.paid_by}
                  </div>
                )}
                <div className="text-xs text-[#7C3AED] pt-1">
                  {parentTransaction.is_shared && parentTransaction.split_share_amount != null ? (
                    <>
                      <span className="font-medium">Your share:</span> {formatCurrency(Math.abs(parentTransaction.split_share_amount))}
                      {" · "}
                      <span className="font-medium">Total:</span> {formatCurrency(parentAmount)}
                    </>
                  ) : (
                    <>
                      <span className="font-medium">Amount:</span> {formatCurrency(parentAmount)}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {parentTransaction.category && (
                    <Badge variant="secondary" className="text-xs">
                      {parentTransaction.category}
                    </Badge>
                  )}
                  {parentTransaction.subcategory && (
                    <Badge variant="outline" className="text-xs">
                      {parentTransaction.subcategory}
                    </Badge>
                  )}
                </div>
                {parentTransaction.notes && (
                  <div className="text-xs text-muted-foreground mt-2 italic">
                    {parentTransaction.notes}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Visual Connector */}
        {parentTransaction && childTransactions.length > 0 && (
          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {/* Split Parts (Children Nodes) */}
        {childTransactions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-border text-muted-foreground">
                Split Parts ({childTransactions.length})
              </Badge>
            </div>
            <div className="space-y-3 pl-4 border-l-2 border-border">
              {childTransactions.map((t, index) => (
                <div key={t.id} className="relative">
                  {index > 0 && (
                    <div className="absolute -top-3 left-0">
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-4 rounded-lg border bg-[#7C3AED]/10 border-[#7C3AED]/20">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{t.description}</div>
                        <div className="text-xs text-[#7C3AED]">
                          {formatDate(t.date)}
                          {t.account && ` · ${t.account.split(' ').slice(0, -2).join(' ') || t.account}`}
                        </div>
                        <div className="text-xs text-[#7C3AED] mt-0.5">
                          {t.is_shared && t.split_share_amount != null ? (
                            <>
                              <span className="font-medium">Your share:</span> {formatCurrency(Math.abs(t.split_share_amount))}
                              {" · "}
                              <span className="font-medium">Total:</span> {formatCurrency(Math.abs(t.amount))}
                            </>
                          ) : (
                            <>
                              <span className="font-medium">Amount:</span> {formatCurrency(Math.abs(t.amount))}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
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
                        {t.notes && (
                          <div className="text-xs text-muted-foreground mt-2 italic">
                            {t.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Validation */}
        {parentTransaction && (
          <div className={`p-3 rounded-lg border ${isValid
            ? 'bg-emerald-500/10 border-emerald-500/20'
            : 'bg-destructive/10 border-destructive/20'
            }`}>
            <div className="flex items-center gap-2">
              {isValid ? (
                <>
                  <span className="text-emerald-500">✓</span>
                  <p className="text-xs text-emerald-500">
                    Amounts match: {formatCurrency(childrenTotal)} = {formatCurrency(parentAmount)}
                  </p>
                </>
              ) : (
                <>
                  <span className="text-destructive">⚠</span>
                  <p className="text-xs text-destructive">
                    Amount mismatch: Split parts ({formatCurrency(childrenTotal)}) ≠ Original ({formatCurrency(parentAmount)})
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Info */}
        {parentTransaction && (
          <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
            <p className="text-xs text-primary">
              ✓ Original transaction is preserved in this group.
              Removing the split will restore it.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-[#7C3AED]/30 text-[#7C3AED] hover:bg-[#7C3AED]/20"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Remove Split & Restore Original
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 bg-card border-l border-border shadow-xl z-50 transform transition-transform">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-base">
                {mode === "refund" ? "↩︎" : mode === "split" ? "⚡" : mode === "groupedExpense" ? <Layers className="h-4 w-4" /> : "⇄"}
              </span>
              <span className="font-medium text-sm">
                {mode === "refund" ? "Refund Details" : mode === "split" ? "Split Transaction" : mode === "groupedExpense" ? "Grouped expense" : "Transfer Group"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {mode === "refund"
              ? renderRefundMode()
              : mode === "split"
                ? renderSplitMode()
                : mode === "groupedExpense"
                  ? renderGroupedExpenseMode()
                  : renderTransferMode()}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
