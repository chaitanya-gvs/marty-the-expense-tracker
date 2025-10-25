"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { X, ArrowDown, ArrowRight, ArrowLeft, Unlink, Trash2, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api/client";

interface RelatedTransactionsDrawerProps {
  transaction: Transaction;
  parentTransaction?: Transaction;
  transferGroup?: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onUnlink: () => void;
  onUngroup: () => void;
  onRemoveFromGroup: (transactionId: string) => void;
}

type DrawerMode = "refund" | "transfer" | "split";

export function RelatedTransactionsDrawer({
  transaction,
  parentTransaction,
  transferGroup = [],
  isOpen,
  onClose,
  onUnlink,
  onUngroup,
  onRemoveFromGroup,
}: RelatedTransactionsDrawerProps) {
  // Early return - don't render anything if closed
  if (!isOpen) {
    return null;
  }

  // Determine mode: refund, split, or transfer
  const mode: DrawerMode = !!parentTransaction 
    ? "refund" 
    : transaction.is_split 
    ? "split" 
    : "transfer";
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
        // For split transactions, use the special ungroup-split endpoint
        if (transaction.transaction_group_id) {
          await apiClient.ungroupSplit(transaction.transaction_group_id);
          toast.success("Split removed. Original transaction restored.");
          onClose();
          // Trigger a page refresh or callback to refresh the transaction list
          window.location.reload();
        }
      } else {
        // For transfer groups, use the normal ungroup
        onUngroup();
        onClose();
      }
    } catch (error) {
      console.error("Failed to ungroup:", error);
      toast.error(mode === "split" ? "Failed to remove split" : "Failed to ungroup transfer");
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

  const renderRefundMode = () => {
    if (!parentTransaction) return null;

    const netSpent = Math.abs(parentTransaction.amount) - Math.abs(transaction.amount);

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            Refund Relationship
          </div>
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <ArrowDown className="h-4 w-4" />
            <span className="text-xs">Refund of original purchase</span>
          </div>
        </div>

        {/* Parent Transaction */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400">
              Original Purchase
            </Badge>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="space-y-2">
              <div className="font-medium text-sm">{parentTransaction.description}</div>
              <div className="text-xs text-red-600 dark:text-red-400">
                {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))} · {parentTransaction.account.split(' ').slice(0, -2).join(' ')}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400 text-xs">
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
            <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
              Refund
            </Badge>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="space-y-2">
              <div className="font-medium text-sm">{transaction.description}</div>
              <div className="text-xs text-green-600 dark:text-green-400">
                {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount))} · {transaction.account.split(' ').slice(0, -2).join(' ')}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400 text-xs">
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
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-center space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Net Amount Spent
            </div>
            <div className={`text-lg font-bold ${netSpent >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
              {netSpent >= 0 ? '-' : '+'}{formatCurrency(Math.abs(netSpent))}
            </div>
            <div className="text-xs text-gray-500">
              Original: {formatCurrency(Math.abs(parentTransaction.amount))} - Refund: {formatCurrency(Math.abs(transaction.amount))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUnlink}
            className="w-full border-red-500 text-red-600 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Unlink className="h-4 w-4 mr-2" />
            Unlink Refund
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
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            Transfer Group ({transferGroup.length} legs)
          </div>
          <div className="flex items-center justify-center gap-2 text-gray-500">
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
                  <ArrowDown className="h-3 w-3 text-gray-400" />
                </div>
              )}
              <div className={`p-4 rounded-lg border ${
                t.direction === 'debit' 
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{t.description}</div>
                    <div className={`text-xs ${t.direction === 'debit' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))} · {t.account.split(' ').slice(0, -2).join(' ')}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${t.direction === 'debit' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-green-500 text-green-600 dark:text-green-400'}`}
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
                      className="ml-3 h-8 w-8 p-0 text-red-400 hover:text-red-300"
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
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-center space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Transfer Net Effect
            </div>
            <div className={`text-lg font-bold ${Math.abs(netAmount) < 1 ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(Math.abs(netAmount))}
              {Math.abs(netAmount) >= 1 && " ⚠️"}
            </div>
            <div className="text-xs text-gray-500">
              Should be zero for proper transfers
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-red-500 text-red-600 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
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

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            Split Transaction ({transferGroup.length} parts)
          </div>
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <span className="text-base">⚡</span>
            <span className="text-xs">One transaction split into multiple categories</span>
          </div>
        </div>

        {/* Split Parts */}
        <div className="space-y-3">
          {transferGroup.map((t, index) => (
            <div key={t.id} className="relative">
              {index > 0 && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <ArrowDown className="h-3 w-3 text-gray-400" />
                </div>
              )}
              <div className="p-4 rounded-lg border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{t.description}</div>
                    <div className="text-xs text-purple-600 dark:text-purple-400">
                      {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))} · {t.account.split(' ').slice(0, -2).join(' ')}
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
                      <div className="text-xs text-gray-500 mt-2 italic">
                        {t.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-center space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Total Split Amount
            </div>
            <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
              {formatCurrency(totalSplitAmount)}
            </div>
            <div className="text-xs text-gray-500">
              {transferGroup.length} parts from one transaction
            </div>
          </div>
        </div>

        {/* Info */}
        {transferGroup.length > 1 && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {transferGroup.some((t, idx) => idx === 0 && t.id === transaction.id) ? (
                <>
                  ✓ Original transaction is preserved in this group. 
                  Removing the split will restore it.
                </>
              ) : (
                <>
                  ℹ️ This split group contains {transferGroup.length} parts. 
                  Removing will delete all split parts and restore the original if it exists.
                </>
              )}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleUngroup}
            className="w-full border-purple-500 text-purple-600 hover:bg-purple-50 dark:border-purple-400 dark:text-purple-400 dark:hover:bg-purple-900/20"
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
      <div className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl z-50 transform transition-transform">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-base">
                {mode === "refund" ? "↩︎" : mode === "split" ? "⚡" : "⇄"}
              </span>
              <span className="font-medium text-sm">
                {mode === "refund" ? "Refund Details" : mode === "split" ? "Split Transaction" : "Transfer Group"}
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
            {mode === "refund" ? renderRefundMode() : mode === "split" ? renderSplitMode() : renderTransferMode()}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
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
