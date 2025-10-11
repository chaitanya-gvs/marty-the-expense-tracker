"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Search, Link, Unlink, X } from "lucide-react";

interface RefundAdjustmentSectionProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onLinkRefund: (childId: string, parentId: string) => void;
  onUnlinkRefund: (childId: string) => void;
}

interface RefundSuggestion {
  id: string;
  description: string;
  date: string;
  amount: number;
  account: string;
  confidence: number;
  reason: string;
}

export function RefundAdjustmentSection({
  transaction,
  allTransactions,
  onLinkRefund,
  onUnlinkRefund,
}: RefundAdjustmentSectionProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<RefundSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<RefundSuggestion[]>([]);

  // Find parent transaction for refunds
  const parentTransaction = useMemo(() => {
    if (!transaction.link_parent_id) return undefined;
    return allTransactions.find(t => t.id === transaction.link_parent_id);
  }, [transaction.link_parent_id, allTransactions]);

  // Find child refunds/adjustments
  const childRefunds = useMemo(() => {
    return allTransactions.filter(t => t.link_parent_id === transaction.id);
  }, [transaction.id, allTransactions]);

  // Calculate net effect
  const netEffect = useMemo(() => {
    if (!parentTransaction && !childRefunds.length) return null;
    
    const parentAmount = parentTransaction ? Math.abs(parentTransaction.amount) : 0;
    const childAmounts = childRefunds.map(t => Math.abs(t.amount));
    const totalChildAmount = childAmounts.reduce((sum, amount) => sum + amount, 0);
    
    return parentAmount - totalChildAmount;
  }, [parentTransaction, childRefunds]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      // Search for potential parent transactions
      const response = await apiClient.searchTransactions(
        `debit ${Math.abs(transaction.amount)}`,
        5,
        0
      );
      
      // Filter and format suggestions
      const formattedSuggestions: RefundSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id &&
          Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1 // 10% tolerance
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '), // Remove last 2 words
          confidence: 0.8, // Placeholder confidence
          reason: "Similar amount and opposite direction"
        }))
        .slice(0, 5);

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load refund suggestions:", error);
      toast.error("Failed to load suggestions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    try {
      const response = await apiClient.searchTransactions(searchQuery, 10, 0);
      
      const formattedResults: RefundSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '),
          confidence: 0.6,
          reason: "Search result"
        }));

      setSearchResults(formattedResults);
    } catch (error) {
      console.error("Failed to search transactions:", error);
      toast.error("Failed to search transactions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLink = async (parentId: string) => {
    try {
      await apiClient.linkRefund(transaction.id, parentId);
      onLinkRefund(transaction.id, parentId);
      toast.success("Refund linked successfully", {
        action: {
          label: "Undo",
          onClick: () => handleUnlink(),
        },
      });
    } catch (error) {
      console.error("Failed to link refund:", error);
      toast.error("Failed to link refund");
    }
  };

  const handleUnlink = async () => {
    try {
      await apiClient.updateTransaction(transaction.id, {
        link_parent_id: undefined,
        is_refund: false,
      });
      onUnlinkRefund(transaction.id);
      toast.success("Refund unlinked successfully", {
        action: {
          label: "Undo",
          onClick: () => handleLink(transaction.link_parent_id!),
        },
      });
    } catch (error) {
      console.error("Failed to unlink refund:", error);
      toast.error("Failed to unlink refund");
    }
  };

  const displaySuggestions = searchQuery.trim() ? searchResults : suggestions;

  // Only show for credit transactions or if already linked
  if (transaction.direction !== "credit" && !parentTransaction && !childRefunds.length) {
    return (
      <div className="text-sm text-gray-500 italic">
        This transaction is not a credit, so refund linking is not applicable.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Parent transaction summary */}
      {parentTransaction && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
            Parent transaction:
          </div>
          <div className="space-y-1 text-sm">
            <div className="text-slate-700 dark:text-slate-300">
              <span className="font-medium">{parentTransaction.description}</span>
            </div>
            <div className="text-slate-500 dark:text-slate-400">
              {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))} · {parentTransaction.account.split(' ').slice(0, -2).join(' ')}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUnlink}
            className="mt-2 border-red-500 text-red-600 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Unlink className="h-4 w-4 mr-2" />
            Unlink refund
          </Button>
        </div>
      )}

      {/* Child refunds */}
      {childRefunds.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Child refunds/adjustments:
          </div>
          {childRefunds.map((child) => (
            <div
              key={child.id}
              className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {child.description}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDate(child.date)} · {formatCurrency(Math.abs(child.amount))} · {child.account.split(' ').slice(0, -2).join(' ')}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onUnlinkRefund(child.id)}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Net effect */}
      {netEffect !== null && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Net effect: {formatCurrency(netEffect)}
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
            Parent amount minus sum of child refunds/adjustments
          </div>
        </div>
      )}

      {/* Link to parent interface (for credit transactions) */}
      {transaction.direction === "credit" && !parentTransaction && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Link to parent purchase:
          </div>
          
          {/* Search input */}
          <div className="flex gap-2">
            <Input
              placeholder="Search for parent transaction..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              disabled={isLoading || !searchQuery.trim()}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadSuggestions}
              disabled={isLoading}
            >
              Load suggestions
            </Button>
          </div>

          {/* Suggestions */}
          {isLoading ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              Loading suggestions...
            </div>
          ) : displaySuggestions.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {displaySuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                  onClick={() => handleLink(suggestion.id)}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 h-8 px-2 text-emerald-600 hover:text-emerald-700"
                    >
                      <Link className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500 text-sm">
              {searchQuery.trim() ? "No transactions found" : "No suggestions available. Search for a parent transaction or click 'Load suggestions'."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


