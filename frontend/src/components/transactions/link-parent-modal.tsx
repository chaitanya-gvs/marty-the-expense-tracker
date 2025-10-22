"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Search, Link, Unlink, X, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

interface LinkParentModalProps {
  transaction: Transaction;
  parentTransaction?: Transaction;
  allTransactions?: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onLink: (parentId: string) => void;
  onUnlink: () => void;
}

interface TransactionSuggestion {
  id: string;
  description: string;
  date: string;
  amount: number;
  account: string;
  isSimilarAmount: boolean;
}

export function LinkParentModal({
  transaction,
  parentTransaction,
  allTransactions = [],
  isOpen,
  onClose,
  onLink,
  onUnlink,
}: LinkParentModalProps) {
  // Early return - don't render anything if closed
  if (!isOpen) {
    return null;
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TransactionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<TransactionSuggestion[]>([]);
  
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load suggestions when modal opens (if not already linked)
  useEffect(() => {
    if (isOpen && !parentTransaction) {
      loadSuggestions();
    }
  }, [isOpen, parentTransaction]);

  // Search when debounced query changes
  useEffect(() => {
    if (debouncedSearchQuery.trim() && isOpen) {
      handleSearch(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, isOpen]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      // Search for ALL debit transactions (not just similar amounts)
      const response = await apiClient.searchTransactions(
        `debit`,
        50,
        0
      );
      
      
      if (!response.data || !Array.isArray(response.data)) {
        console.error("Invalid response data:", response);
        setSuggestions([]);
        return;
      }
      
      // Filter and format suggestions - show ALL debits
      const formattedSuggestions: TransactionSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id &&
          !t.link_parent_id // Don't suggest transactions that are already children
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '), // Remove last 2 words
          isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1 // 10% tolerance
        }))
        .sort((a, b) => {
          // Sort by similarity first, then by date (newer first)
          if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
          if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .slice(0, 20); // Show more results since we're showing all debits

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load refund suggestions:", error);
      toast.error("Failed to load suggestions");
      setSuggestions([]);
      
      // Fallback: try to use existing transactions data
      tryFallbackSuggestions();
    } finally {
      setIsLoading(false);
    }
  };

  const tryFallbackSuggestions = () => {
    if (allTransactions.length === 0) return;
    
    
    // Filter and format suggestions from existing transactions - show ALL debits
    const fallbackSuggestions: TransactionSuggestion[] = allTransactions
      .filter((t: Transaction) => 
        t.direction === "debit" && 
        t.id !== transaction.id &&
        !t.link_parent_id // Don't suggest transactions that are already children
      )
      .map((t: Transaction) => ({
        id: t.id,
        description: t.description,
        date: t.date,
        amount: t.amount,
        account: t.account.split(' ').slice(0, -2).join(' '), // Remove last 2 words
        isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1 // 10% tolerance
      }))
      .sort((a, b) => {
        // Sort by similarity first, then by date (newer first)
        if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
        if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      })
      .slice(0, 20); // Show more results

    setSuggestions(fallbackSuggestions);
  };

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    try {
      const response = await apiClient.searchTransactions(query, 15, 0);
      
      const formattedResults: TransactionSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id &&
          !t.link_parent_id
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '),
          isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1
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
      await onLink(parentId);
      // Don't call onClose() - parent component handles it
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
      await onUnlink();
      // Don't call onClose() - parent component handles it
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

  const displayTransactions = searchQuery.trim() ? searchResults : suggestions;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-base">↩︎</span>
            Link Parent Purchase
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto flex-1">
          {/* Current refund transaction */}
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Refund to link:</div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium text-sm">{transaction.description}</div>
                <div className="text-xs text-red-600 dark:text-red-400">
                  {formatDate(transaction.date)} · {formatCurrency(Math.abs(transaction.amount))} · {transaction.account.split(' ').slice(0, -2).join(' ')}
                </div>
              </div>
              <Badge variant="outline" className="border-red-500 text-red-600 dark:text-red-400">
                Refund
              </Badge>
            </div>
          </div>

          {parentTransaction ? (
            // Show current parent if already linked
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm font-medium">Currently linked to:</span>
              </div>
              
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{parentTransaction.description}</div>
                    <div className="text-xs text-green-600 dark:text-green-400">
                      {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))} · {parentTransaction.account.split(' ').slice(0, -2).join(' ')}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
                    Parent
                  </Badge>
                </div>
              </div>
              
              <div className="flex justify-center">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span>Net spent: {formatCurrency(Math.abs(parentTransaction.amount) - Math.abs(transaction.amount))}</span>
                </div>
              </div>
              
              <Button
                variant="outline"
                onClick={handleUnlink}
                className="w-full border-red-500 text-red-600 hover:bg-red-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Unlink className="h-4 w-4 mr-2" />
                Unlink Refund
              </Button>
            </div>
          ) : (
            // Show linking interface
            <div className="space-y-4">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search for parent transaction..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
                {isLoading && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                )}
              </div>

              {/* Suggestions/Results */}
              {isLoading && displayTransactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                  Loading suggestions...
                </div>
              ) : displayTransactions.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {searchQuery.trim() ? "Search Results" : "Suggested Parents"}
                  </div>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {displayTransactions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {suggestion.description}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {formatDate(suggestion.date)} · {formatCurrency(Math.abs(suggestion.amount))} · {suggestion.account}
                            </div>
                            <div className="flex gap-1 mt-1">
                              {suggestion.isSimilarAmount && (
                                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                  Similar Amount
                                </Badge>
                              )}
                              {!suggestion.isSimilarAmount && Math.abs(suggestion.amount) > Math.abs(transaction.amount) && (
                                <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                                  Partial Refund
                                </Badge>
                              )}
                              {!suggestion.isSimilarAmount && Math.abs(suggestion.amount) < Math.abs(transaction.amount) && (
                                <Badge variant="secondary" className="text-xs bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                                  Larger Amount
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLink(suggestion.id)}
                            className="ml-3 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-900/20"
                          >
                            <Link className="h-4 w-4 mr-1" />
                            Link
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery.trim() ? "No transactions found" : "No suggestions available"}
                  {!searchQuery.trim() && (
                    <div className="text-xs mt-2">
                      Try searching for the original purchase transaction
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
