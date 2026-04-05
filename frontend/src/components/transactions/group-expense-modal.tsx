"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow, ResultItem } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Loader2, Layers, TrendingUp, TrendingDown } from "lucide-react";
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

  // Auto-generate a default description from the highest-amount transaction
  useEffect(() => {
    if (isOpen && selectedTransactions.length > 0) {
      const highest = selectedTransactions.reduce((max, t) =>
        (t.amount > max.amount ? t : max), selectedTransactions[0]);
      setDescription(highest.description);
      
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
    } catch {
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
        variant="share"
      />

      <Modal.Body className="space-y-6">
        {/* Net Amount Summary */}
        <div className="rounded-xl bg-muted/40 border border-border/60 p-4">
          <div className="grid grid-cols-3 divide-x divide-border/60">
            <div className="pr-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Credits</p>
              <p className="font-mono text-sm font-semibold text-emerald-500 tabular-nums">
                +{formatCurrency(selectedTransactions
                  .filter(t => t.direction === "credit")
                  .reduce((sum, t) => {
                    const amount = t.net_amount ?? t.amount;
                    return sum + (t.is_shared && t.split_share_amount !== undefined ? t.split_share_amount : amount);
                  }, 0)
                )}
              </p>
            </div>
            <div className="px-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Debits</p>
              <p className="font-mono text-sm font-semibold text-destructive tabular-nums">
                −{formatCurrency(selectedTransactions
                  .filter(t => t.direction === "debit")
                  .reduce((sum, t) => {
                    const amount = t.net_amount ?? t.amount;
                    return sum + (t.is_shared && t.split_share_amount !== undefined ? t.split_share_amount : amount);
                  }, 0)
                )}
              </p>
            </div>
            <div className="pl-4 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Net Amount</p>
              <p className={cn(
                "font-mono text-base font-bold tabular-nums tracking-tight",
                netAmount >= 0 ? "text-emerald-500" : "text-destructive"
              )}>
                {netAmount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(netAmount))}
              </p>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                {netAmount >= 0
                  ? <TrendingUp className="h-3 w-3 text-emerald-500" />
                  : <TrendingDown className="h-3 w-3 text-destructive" />
                }
                <span className="text-[10px] text-muted-foreground">
                  {netAmount >= 0 ? "Credit" : "Debit"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Description Input */}
        <FieldRow label="Description">
          <FieldAutocomplete
            fieldName="description"
            value={description}
            onValueChange={setDescription}
            placeholder="Enter a description for the grouped expense"
            onSave={async (val) => setDescription(val ?? "")}
          />
        </FieldRow>

        {/* Category Input (optional) */}
        <FieldRow label="Category (optional)">
          <CategoryAutocomplete
            value={category}
            onValueChange={setCategory}
            placeholder="Leave empty to use first transaction's category"
            transactionDirection={netAmount >= 0 ? "credit" : "debit"}
            onSave={async (val) => setCategory(val ?? "")}
            onCancel={() => {}}
            autoFocus={false}
          />
          {selectedTransactions[0]?.category && !category && (
            <p className="text-xs text-muted-foreground">
              Will use: {selectedTransactions[0].category}
            </p>
          )}
        </FieldRow>

        {/* Transactions to be Grouped */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Transactions to group ({selectedTransactions.length})
          </p>
          <div className="max-h-[300px] overflow-y-auto scrollbar-none space-y-2 pr-2">
            {selectedTransactions.map((tx) => {
              const effectiveAmount = tx.is_shared && tx.split_share_amount !== undefined 
                ? tx.split_share_amount 
                : (tx.net_amount ?? tx.amount);
              
              return (
                <ResultItem key={tx.id}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {tx.direction === "debit"
                          ? <TrendingDown className="h-3 w-3 flex-shrink-0 text-destructive" />
                          : <TrendingUp className="h-3 w-3 flex-shrink-0 text-emerald-500" />
                        }
                        <span className="text-sm font-medium truncate">
                          {tx.description}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          formatDate(tx.date),
                          tx.account?.split(" ").slice(0, -2).join(" ") || null,
                          tx.category || null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <div className={cn(
                        "text-sm font-semibold",
                        tx.direction === "credit" ? "text-emerald-500" : "text-destructive"
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

        {/* Subtle hint */}
        <p className="text-center text-[11px] text-muted-foreground/60">
          Individual transactions will be hidden. You can expand or ungroup at any time.
        </p>
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
