"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Trash2, X, ArrowRight } from "lucide-react";

interface TransferPopoverProps {
  transaction: Transaction;
  transferGroup?: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onGroup: (transactionIds: string[]) => void;
  onUngroup: () => void;
  onAddToGroup: (transactionIds: string[]) => void;
  onRemoveFromGroup: (transactionId: string) => void;
}


export function TransferPopover({
  transaction,
  transferGroup = [],
  isOpen,
  onClose,
  onGroup,
  onUngroup,
  onAddToGroup,
  onRemoveFromGroup,
}: TransferPopoverProps) {
  const isGrouped = !!transaction.transaction_group_id && transferGroup.length > 0;

  const handleCreateGroup = async (suggestionIds: string[]) => {
    try {
      const allTransactionIds = [transaction.id, ...suggestionIds];
      await apiClient.groupTransfer(allTransactionIds);
      onGroup(allTransactionIds);
      onClose();
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
      onUngroup();
      onClose();
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
      onRemoveFromGroup(transactionId);
      onClose();
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
      onAddToGroup(transactionIds);
      onClose();
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
    <Popover open={isOpen} onOpenChange={onClose}>
      <PopoverTrigger asChild>
        <div />
      </PopoverTrigger>
      <PopoverContent 
        className="w-[360px] p-3 rounded-xl bg-slate-900 shadow-lg border border-slate-800"
        align="start"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Group transfer legs</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {isGrouped ? (
            // Show current group
            <div className="space-y-3">
              <div className="text-sm text-slate-300 mb-2">
                Current transfer group ({transferGroup.length} legs):
              </div>
              
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {transferGroup.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-2 bg-slate-800 rounded-lg border border-slate-700"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {t.description}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDate(t.date)} · {formatCurrency(Math.abs(t.amount))} · {t.account.split(' ').slice(0, -2).join(' ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          t.direction === "debit" 
                            ? "border-red-500 text-red-400" 
                            : "border-green-500 text-green-400"
                        }`}
                      >
                        {t.direction === "debit" ? "Out" : "In"}
                      </Badge>
                      {t.id !== transaction.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveFromGroup(t.id)}
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleUngroup}
                className="w-full border-red-500 text-red-400 hover:bg-red-500/10"
              >
                Remove entire group
              </Button>
            </div>
          ) : (
            // Show manual grouping instructions
            <div className="space-y-3">
              <div className="text-center py-6 text-slate-400 text-sm">
                No automatic suggestions available.
                <br />
                <span className="text-slate-500">Use the multi-select toolbar to manually group transactions.</span>
              </div>
              
              <div className="text-xs text-slate-500 pt-2 border-t border-slate-700">
                To group transfers manually:
                <ol className="list-decimal list-inside mt-2 space-y-1 text-slate-400">
                  <li>Click "Multi-Select" at the top of the table</li>
                  <li>Select 2+ transactions with opposite directions</li>
                  <li>Click "Group transfer" in the toolbar</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


