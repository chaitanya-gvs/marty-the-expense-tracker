"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Plus, Trash2, ArrowRight, Users } from "lucide-react";

interface TransferGroupSectionProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onGroupTransfer: (transactionIds: string[]) => void;
  onUngroupTransfer: (transactionId: string) => void;
  onAddToTransferGroup: (transactionIds: string[]) => void;
  onRemoveFromTransferGroup: (transactionId: string) => void;
}

interface TransferSuggestion {
  id: string;
  description: string;
  date: string;
  amount: number;
  account: string;
  direction: "debit" | "credit";
  confidence: number;
  reason: string;
}

export function TransferGroupSection({
  transaction,
  allTransactions,
  onGroupTransfer,
  onUngroupTransfer,
  onAddToTransferGroup,
  onRemoveFromTransferGroup,
}: TransferGroupSectionProps) {
  const [suggestions, setSuggestions] = useState<TransferSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Find transfer group for this transaction
  const transferGroup = useMemo(() => {
    if (!transaction.transaction_group_id) return [];
    return allTransactions.filter(t => t.transaction_group_id === transaction.transaction_group_id);
  }, [transaction.transaction_group_id, allTransactions]);

  const isGrouped = !!transaction.transaction_group_id && transferGroup.length > 0;

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      // Search for potential transfer pairs
      const response = await apiClient.searchTransactions(
        `opposite direction ${Math.abs(transaction.amount)}`,
        5,
        0
      );
      
      // Filter and format suggestions
      const formattedSuggestions: TransferSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction !== transaction.direction && 
          t.id !== transaction.id &&
          Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1 && // 10% tolerance
          t.account !== transaction.account && // Different accounts preferred
          !t.transaction_group_id // Not already in a group
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '), // Remove last 2 words
          direction: t.direction,
          confidence: 0.8, // Placeholder confidence
          reason: "Similar amount, opposite direction, different account"
        }))
        .slice(0, 5);

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load transfer suggestions:", error);
      toast.error("Failed to load suggestions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async (suggestionIds: string[]) => {
    try {
      const allTransactionIds = [transaction.id, ...suggestionIds];
      await apiClient.groupTransfer(allTransactionIds);
      onGroupTransfer(allTransactionIds);
      toast.success(`Grouped ${allTransactionIds.length} transactions as a transfer`, {
        action: {
          label: "Undo",
          onClick: () => handleUngroup(),
        },
      });
    } catch (error) {
      console.error("Failed to create transfer group:", error);
      toast.error("Failed to create transfer group");
    }
  };

  const handleUngroup = async () => {
    try {
      // Update all transactions in the group to remove transaction_group_id
      const updatePromises = transferGroup.map(t => 
        apiClient.updateTransaction(t.id, { transaction_group_id: undefined })
      );
      await Promise.all(updatePromises);
      onUngroupTransfer(transaction.id);
      toast.success("Transfer group removed", {
        action: {
          label: "Undo",
          onClick: () => handleCreateGroup(transferGroup.filter(t => t.id !== transaction.id).map(t => t.id)),
        },
      });
    } catch (error) {
      console.error("Failed to ungroup transfer:", error);
      toast.error("Failed to ungroup transfer");
    }
  };

  const handleRemoveFromGroup = async (transactionId: string) => {
    try {
      await apiClient.updateTransaction(transactionId, { transaction_group_id: undefined });
      onRemoveFromTransferGroup(transactionId);
      toast.success("Transaction removed from transfer group", {
        action: {
          label: "Undo",
          onClick: () => handleAddToGroup([transactionId]),
        },
      });
    } catch (error) {
      console.error("Failed to remove from group:", error);
      toast.error("Failed to remove from group");
    }
  };

  const handleAddToGroup = async (transactionIds: string[]) => {
    try {
      // Add to existing group by setting the same transaction_group_id
      const updatePromises = transactionIds.map(id => 
        apiClient.updateTransaction(id, { transaction_group_id: transaction.transaction_group_id })
      );
      await Promise.all(updatePromises);
      onAddToTransferGroup(transactionIds);
      toast.success(`Added ${transactionIds.length} transactions to transfer group`, {
        action: {
          label: "Undo",
          onClick: () => handleRemoveFromGroup(transactionIds[0]),
        },
      });
    } catch (error) {
      console.error("Failed to add to group:", error);
      toast.error("Failed to add to group");
    }
  };

  return (
    <div className="space-y-4">
      {isGrouped ? (
        // Show current group
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Transfer group ({transferGroup.length} legs):
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUngroup}
              className="border-red-500 text-red-600 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Remove entire group
            </Button>
          </div>
          
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {transferGroup.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {t.description}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))} · {t.account.split(' ').slice(0, -2).join(' ')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      t.direction === "debit" 
                        ? "border-red-500 text-red-600 dark:border-red-400 dark:text-red-400" 
                        : "border-green-500 text-green-600 dark:border-green-400 dark:text-green-400"
                    }`}
                  >
                    {t.direction === "debit" ? "Out" : "In"}
                  </Badge>
                  {t.id !== transaction.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFromGroup(t.id)}
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Transfer flow visualization */}
          {transferGroup.length === 2 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <span>{formatCurrency(Math.abs(transaction.amount))}</span>
                <ArrowRight className="h-4 w-4" />
                <span>Internal transfer</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Show suggestions for creating new group
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Create transfer group:
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadSuggestions}
              disabled={isLoading}
            >
              <Users className="h-4 w-4 mr-2" />
              Load suggestions
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              Loading suggestions...
            </div>
          ) : suggestions.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                Suggested transfer pairs:
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                    onClick={() => handleCreateGroup([suggestion.id])}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {suggestion.description}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(suggestion.date)} · {formatCurrency(Math.abs(suggestion.amount))} · {suggestion.account}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            suggestion.direction === "debit" 
                              ? "border-red-500 text-red-600 dark:border-red-400 dark:text-red-400" 
                              : "border-green-500 text-green-600 dark:border-green-400 dark:text-green-400"
                          }`}
                        >
                          {suggestion.direction === "debit" ? "Out" : "In"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-sky-600 hover:text-sky-700"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500 text-sm">
              No transfer suggestions available. Click "Load suggestions" to find potential transfer pairs.
            </div>
          )}
          
          <div className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
            Select a suggestion to create a transfer group, or use the multi-select toolbar to group manually.
          </div>
        </div>
      )}
    </div>
  );
}


