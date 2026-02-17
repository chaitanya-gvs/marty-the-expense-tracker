"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { ResultItem } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Loader2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldAutocomplete } from "./field-autocomplete";
import { CategoryAutocomplete } from "./category-autocomplete";

interface GroupExpenseModalProps {
  selectedTransactions: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onGroupSuccess: () => void;
}

export function GroupExpenseModal({
  selectedTransactions,
  isOpen,
  onClose,
  onGroupSuccess,
}: GroupExpenseModalProps) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Calculate net amount
  const netAmount = selectedTransactions.reduce((sum, t) => {
    // Use net_amount if available (for transactions with refunds), otherwise use amount
    const amount = t.net_amount ?? t.amount;
    
    // Use split_share_amount if transaction is shared
    const effectiveAmount = t.is_shared && t.split_share_amount !== undefined 
      ? t.split_share_amount 
      : amount;
    
    // Credits are positive, debits are negative
    return t.direction === "credit" 
      ? sum + effectiveAmount 
      : sum - effectiveAmount;
  }, 0);

  // Find earliest date
  const earliestDate = selectedTransactions.reduce((earliest, t) => {
    const txDate = new Date(t.date);
    return !earliest || txDate < earliest ? txDate : earliest;
  }, null as Date | null);

  // Auto-generate a default description
  useEffect(() => {
    if (isOpen && selectedTransactions.length > 0) {
      const defaultDescription = `Grouped expense (${selectedTransactions.length} transactions)`;
      setDescription(defaultDescription);
      
      // Use the category from the first transaction
      if (selectedTransactions[0].category) {
        setCategory(selectedTransactions[0].category);
      }
    }
  }, [isOpen, selectedTransactions]);

  const handleGroupExpense = async () => {
    if (!description.trim()) {
      toast.error("Please enter a description for the grouped expense");
      return;
    }

    setIsLoading(true);
    try {
      const transactionIds = selectedTransactions.map(t => t.id);
      await apiClient.groupExpense(
        transactionIds,
        description,
        category || undefined
      );
      
      toast.success(`Successfully grouped ${selectedTransactions.length} transactions`);
      onGroupSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to group expense:", error);
      toast.error("Failed to group transactions. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Layers className="h-4 w-4" />}
        title="Group Expense"
        subtitle="Combine multiple transactions into a single expense"
        onClose={onClose}
        variant="category"
      />

      <Modal.Body className="space-y-6">
        {/* Net Amount Summary */}
        <div className="rounded-xl bg-[var(--modal-accent)]/10 border border-[var(--modal-accent)]/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--modal-accent)] mb-2 font-semibold">
            Net Amount Calculation
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Credits (positive):</span>
              <span className="text-green-600 font-medium">
                +{formatCurrency(selectedTransactions
                  .filter(t => t.direction === "credit")
                  .reduce((sum, t) => {
                    const amount = t.net_amount ?? t.amount;
                    return sum + (t.is_shared && t.split_share_amount !== undefined ? t.split_share_amount : amount);
                  }, 0)
                )}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Debits (negative):</span>
              <span className="text-red-600 font-medium">
                -{formatCurrency(selectedTransactions
                  .filter(t => t.direction === "debit")
                  .reduce((sum, t) => {
                    const amount = t.net_amount ?? t.amount;
                    return sum + (t.is_shared && t.split_share_amount !== undefined ? t.split_share_amount : amount);
                  }, 0)
                )}
              </span>
            </div>
            <div className="pt-2 border-t border-[var(--modal-accent)]/20">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Net Amount:</span>
                <span className={cn(
                  "text-lg font-bold",
                  netAmount >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {netAmount >= 0 ? "+" : ""}
                  {formatCurrency(Math.abs(netAmount))}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Direction: {netAmount >= 0 ? "Credit ↑" : "Debit ↓"}
              </div>
            </div>
          </div>
        </div>

        {/* Description Input */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <FieldAutocomplete
            fieldName="description"
            value={description}
            onValueChange={setDescription}
            placeholder="Enter a description for the grouped expense"
            onSave={async (val) => setDescription(val)}
          />
        </div>

        {/* Category Input (optional) */}
        <div className="space-y-2">
          <Label htmlFor="category">Category (optional)</Label>
          <CategoryAutocomplete
            value={category}
            onValueChange={setCategory}
            placeholder="Leave empty to use first transaction's category"
            transactionDirection={netAmount >= 0 ? "credit" : "debit"}
            onSave={async (val) => setCategory(val)}
            onCancel={() => {}}
          />
          {selectedTransactions[0]?.category && !category && (
            <p className="text-xs text-muted-foreground">
              Will use: {selectedTransactions[0].category}
            </p>
          )}
        </div>

        {/* Transactions to be Grouped */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground/80">
            Transactions to group ({selectedTransactions.length}):
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
            {selectedTransactions.map((tx) => {
              const effectiveAmount = tx.is_shared && tx.split_share_amount !== undefined 
                ? tx.split_share_amount 
                : (tx.net_amount ?? tx.amount);
              
              return (
                <ResultItem key={tx.id}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium truncate">
                          {tx.description}
                        </span>
                        <Badge 
                          variant={tx.direction === "debit" ? "destructive" : "default"}
                          className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0"
                        >
                          {tx.direction}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(tx.date)}</span>
                        <span>•</span>
                        <span>{tx.account.split(" ").slice(0, -2).join(" ")}</span>
                        {tx.category && (
                          <>
                            <span>•</span>
                            <span>{tx.category}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <div className={cn(
                        "text-sm font-semibold",
                        tx.direction === "credit" ? "text-green-600" : "text-red-600"
                      )}>
                        {tx.direction === "credit" ? "+" : "-"}
                        {formatCurrency(effectiveAmount)}
                      </div>
                      {tx.is_shared && (
                        <div className="text-[10px] text-muted-foreground">
                          (shared)
                        </div>
                      )}
                      {tx.net_amount !== undefined && tx.net_amount < tx.amount && (
                        <div className="text-[10px] text-muted-foreground">
                          (has refund)
                        </div>
                      )}
                    </div>
                  </div>
                </ResultItem>
              );
            })}
          </div>
        </div>

        {/* Info Note */}
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3">
          <p className="text-xs text-blue-800 dark:text-blue-200">
            <strong>Note:</strong> The grouped expense will hide these individual transactions 
            and show only the collapsed transaction with the net amount. You can expand to view 
            details later, and the collapsed transaction can be split/shared like any other transaction.
          </p>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button 
          onClick={handleGroupExpense} 
          disabled={isLoading || !description.trim()}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Grouping...
            </>
          ) : (
            <>
              <Layers className="mr-2 h-4 w-4" />
              Group Expense
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
