"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Search, ArrowRight, ArrowLeft, X, Loader2, Trash2, Plus } from "lucide-react";

interface GroupTransferModalProps {
  transaction: Transaction;
  transferGroup?: Transaction[];
  allTransactions?: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onGroup: (transactionIds: string[]) => void;
  onUngroup: () => void;
  onAddToGroup: (transactionIds: string[]) => void;
  onRemoveFromGroup: (transactionId: string) => void;
}

interface TransactionSuggestion {
  id: string;
  description: string;
  date: string;
  amount: number;
  account: string;
  direction: "debit" | "credit";
  isSimilarAmount: boolean;
  isOppositeDirection: boolean;
}

export function GroupTransferModal({
  transaction,
  transferGroup = [],
  allTransactions = [],
  isOpen,
  onClose,
  onGroup,
  onUngroup,
  onAddToGroup,
  onRemoveFromGroup,
}: GroupTransferModalProps) {
  // Early return - don't render anything if closed
  if (!isOpen) {
    return null;
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TransactionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<TransactionSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Debounce search query
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  
  // Define isGrouped before using it in useEffect
  const isGrouped = transferGroup.length > 0;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load suggestions when modal opens
  useEffect(() => {
    if (isOpen && !isGrouped) {
      loadSuggestions();
    }
  }, [isOpen, isGrouped]);

  // Search when debounced query changes
  useEffect(() => {
    if (debouncedSearchQuery.trim() && isOpen) {
      handleSearch(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, isOpen]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      // Search for transactions with similar amounts
      const searchQuery = `${Math.abs(transaction.amount)}`;
      
      const response = await apiClient.searchTransactions(
        searchQuery,
        15,
        0
      );
      
      if (!response.data || !Array.isArray(response.data)) {
        setSuggestions([]);
        tryFallbackSuggestions();
        return;
      }
      
      // Filter and format suggestions
      const formattedSuggestions: TransactionSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.id !== transaction.id &&
          !t.transfer_group_id
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '),
          direction: t.direction,
          isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1,
          isOppositeDirection: t.direction !== transaction.direction
        }))
        .sort((a, b) => {
          if (a.isOppositeDirection && !b.isOppositeDirection) return -1;
          if (!a.isOppositeDirection && b.isOppositeDirection) return 1;
          if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
          if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .slice(0, 10);

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load transfer suggestions:", error);
      setSuggestions([]);
      tryFallbackSuggestions();
    } finally {
      setIsLoading(false);
    }
  };

  const tryFallbackSuggestions = () => {
    if (allTransactions.length === 0) return;
    
    const fallbackSuggestions: TransactionSuggestion[] = allTransactions
      .filter((t: Transaction) => 
        t.id !== transaction.id &&
        !t.transfer_group_id
      )
      .map((t: Transaction) => ({
        id: t.id,
        description: t.description,
        date: t.date,
        amount: t.amount,
        account: t.account.split(' ').slice(0, -2).join(' '),
        direction: t.direction,
        isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1,
        isOppositeDirection: t.direction !== transaction.direction
      }))
      .sort((a, b) => {
        if (a.isOppositeDirection && !b.isOppositeDirection) return -1;
        if (!a.isOppositeDirection && b.isOppositeDirection) return 1;
        if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
        if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      })
      .slice(0, 10);

    setSuggestions(fallbackSuggestions);
  };

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    try {
      const response = await apiClient.searchTransactions(query, 20, 0);
      
      if (!response.data || !Array.isArray(response.data)) {
        setSearchResults([]);
        return;
      }
      
      const formattedResults: TransactionSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.id !== transaction.id &&
          !t.transfer_group_id
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '),
          direction: t.direction,
          isSimilarAmount: Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1,
          isOppositeDirection: t.direction !== transaction.direction
        }))
        .sort((a, b) => {
          if (a.isOppositeDirection && !b.isOppositeDirection) return -1;
          if (!a.isOppositeDirection && b.isOppositeDirection) return 1;
          if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
          if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .slice(0, 20);

      setSearchResults(formattedResults);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectTransaction = (transactionId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(transactionId)) {
      newSelectedIds.delete(transactionId);
    } else {
      newSelectedIds.add(transactionId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleGroupSelected = async () => {
    const selectedTransactionIds = Array.from(selectedIds);
    if (selectedTransactionIds.length === 0) {
      toast.error("Please select at least one transaction to group");
      return;
    }
    
    await onGroup([transaction.id, ...selectedTransactionIds]);
    // Don't call onClose() - parent component handles it
  };

  const handleAddToGroup = async () => {
    const selectedTransactionIds = Array.from(selectedIds);
    if (selectedTransactionIds.length === 0) {
      toast.error("Please select at least one transaction to add");
      return;
    }
    
    await onAddToGroup(selectedTransactionIds);
    // Don't call onClose() - parent component handles it
  };

  const displayTransactions = searchQuery.trim() ? searchResults : suggestions;
  const selectedTransactions = displayTransactions.filter(t => selectedIds.has(t.id));
  const hasOppositeDirection = selectedTransactions.some(t => t.isOppositeDirection);
  const netAmount = transferGroup.reduce((sum, t) => 
    t.direction === 'debit' ? sum - t.amount : sum + t.amount, 0
  );

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 z-[10000] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">⇄</span>
              Group Transfer Legs
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Current transaction */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
              Transfer leg to group:
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium text-sm">{transaction.description}</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">
                  {formatDate(transaction.date)} • {transaction.account.split(' ').slice(0, -2).join(' ')}
                </div>
              </div>
              <Badge variant={transaction.direction === 'credit' ? 'default' : 'destructive'}>
                {transaction.direction === 'credit' ? 'In' : 'Out'}
              </Badge>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(transaction.amount)}</div>
              </div>
            </div>
          </div>

          {/* Grouped transactions view */}
          {isGrouped && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Current Transfer Group ({transferGroup.length} legs)</h3>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await onUngroup();
                    onClose();
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Ungroup All
                </Button>
              </div>

              <div className="space-y-2">
                {transferGroup.map((t) => (
                  <div
                    key={t.id}
                    className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{t.description}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {formatDate(t.date)} • {t.account.split(' ').slice(0, -2).join(' ')}
                        </div>
                      </div>
                      <Badge variant={t.direction === 'credit' ? 'default' : 'destructive'}>
                        {t.direction === 'credit' ? 'In' : 'Out'}
                      </Badge>
                      <div className="text-right">
                        <div className="font-semibold">{formatCurrency(t.amount)}</div>
                      </div>
                      {t.id !== transaction.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await onRemoveFromGroup(t.id);
                            // Keep modal open to see updated group
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className={`p-4 rounded-lg ${
                Math.abs(netAmount) < 10 
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' 
                  : Math.abs(netAmount) < 100
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Net Transfer Amount:</span>
                  <span className={`text-lg font-bold ${
                    Math.abs(netAmount) < 10 
                      ? 'text-green-600 dark:text-green-400' 
                      : Math.abs(netAmount) < 100
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {formatCurrency(Math.abs(netAmount))}
                  </span>
                </div>
                {Math.abs(netAmount) < 10 && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Balanced transfer</p>
                )}
                {Math.abs(netAmount) >= 10 && Math.abs(netAmount) < 100 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">⚠ Net amount should be close to ₹0 (within ₹10)</p>
                )}
                {Math.abs(netAmount) >= 100 && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">⚠ Significant imbalance - expected net ~₹0</p>
                )}
              </div>
            </div>
          )}

          {/* Search and add more legs */}
          {isGrouped && (
            <div>
              <h3 className="font-medium mb-3">Add More Legs</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for transactions to add..."
                  className="pl-9"
                />
              </div>
            </div>
          )}

          {/* Search interface for new groups */}
          {!isGrouped && (
            <div>
              <h3 className="font-medium mb-3">Find Transfer Legs</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by description, amount, or account..."
                  className="pl-9"
                />
              </div>
            </div>
          )}

          {/* Suggestions list */}
          {!isGrouped && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {searchQuery ? 'Search Results' : 'Suggested Matches'}
                </h3>
                {selectedIds.size > 0 && (
                  <span className="text-sm text-gray-600">{selectedIds.size} selected</span>
                )}
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              )}

              {!isLoading && displayTransactions.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No transactions found
                </div>
              )}

              {!isLoading && displayTransactions.map((sug) => (
                <div
                  key={sug.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedIds.has(sug.id)
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => handleSelectTransaction(sug.id)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedIds.has(sug.id)}
                      onCheckedChange={() => handleSelectTransaction(sug.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{sug.description}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {formatDate(sug.date)} • {sug.account}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sug.isOppositeDirection && (
                        <Badge variant="secondary" className="text-xs">
                          Opposite
                        </Badge>
                      )}
                      {sug.isSimilarAmount && (
                        <Badge variant="secondary" className="text-xs">
                          Similar ₹
                        </Badge>
                      )}
                      <Badge variant={sug.direction === 'credit' ? 'default' : 'destructive'}>
                        {sug.direction === 'credit' ? 'In' : 'Out'}
                      </Badge>
                      <div className="text-right">
                        <div className="font-semibold">{formatCurrency(sug.amount)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add to group results */}
          {isGrouped && !isLoading && displayTransactions.length > 0 && (
            <div className="space-y-2">
              {displayTransactions.map((sug) => (
                <div
                  key={sug.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedIds.has(sug.id)
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => handleSelectTransaction(sug.id)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedIds.has(sug.id)}
                      onCheckedChange={() => handleSelectTransaction(sug.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{sug.description}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {formatDate(sug.date)} • {sug.account}
                      </div>
                    </div>
                    <Badge variant={sug.direction === 'credit' ? 'default' : 'destructive'}>
                      {sug.direction === 'credit' ? 'In' : 'Out'}
                    </Badge>
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(sug.amount)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            {!isGrouped && (
              <Button
                onClick={handleGroupSelected}
                disabled={selectedIds.size === 0}
              >
                Group {selectedIds.size > 0 && `(${selectedIds.size + 1} legs)`}
              </Button>
            )}

            {isGrouped && (
              <Button
                onClick={handleAddToGroup}
                disabled={selectedIds.size === 0}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add {selectedIds.size > 0 && `(${selectedIds.size})`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
