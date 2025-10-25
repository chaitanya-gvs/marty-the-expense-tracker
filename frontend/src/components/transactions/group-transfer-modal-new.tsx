"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { ResultItem, SummaryStat } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Search, Loader2, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TransactionSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<TransactionSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const isGrouped = transferGroup.length > 0;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load suggestions
  useEffect(() => {
    if (isOpen && !isGrouped) loadSuggestions();
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
      const response = await apiClient.searchTransactions(
        `${Math.abs(transaction.amount)}`,
        15,
        0
      );

      if (!response.data || !Array.isArray(response.data)) {
        setSuggestions([]);
        return;
      }

      const formattedSuggestions = formatSuggestions(response.data).slice(0, 10);
      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load transfer suggestions:", error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setIsLoading(true);
    try {
      const response = await apiClient.searchTransactions(query, 20, 0);

      if (!response.data || !Array.isArray(response.data)) {
        setSearchResults([]);
        return;
      }

      const formattedResults = formatSuggestions(response.data).slice(0, 20);
      setSearchResults(formattedResults);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatSuggestions = (transactions: Transaction[]): TransactionSuggestion[] => {
    return transactions
      .filter((t) => t.id !== transaction.id && !t.transaction_group_id)
      .map((t) => ({
        id: t.id,
        description: t.description,
        date: t.date,
        amount: t.amount,
        account: t.account.split(" ").slice(0, -2).join(" "),
        direction: t.direction,
        isSimilarAmount:
          Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) <
          Math.abs(transaction.amount) * 0.1,
        isOppositeDirection: t.direction !== transaction.direction,
      }))
      .sort((a, b) => {
        if (a.isOppositeDirection && !b.isOppositeDirection) return -1;
        if (!a.isOppositeDirection && b.isOppositeDirection) return 1;
        if (a.isSimilarAmount && !b.isSimilarAmount) return -1;
        if (!a.isSimilarAmount && b.isSimilarAmount) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
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
  };

  const handleAddToGroup = async () => {
    const selectedTransactionIds = Array.from(selectedIds);
    if (selectedTransactionIds.length === 0) {
      toast.error("Please select at least one transaction to add");
      return;
    }

    await onAddToGroup(selectedTransactionIds);
  };

  const displayTransactions = searchQuery.trim() ? searchResults : suggestions;
  const netAmount = transferGroup.reduce(
    (sum, t) => (t.direction === "debit" ? sum - t.amount : sum + t.amount),
    0
  );

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<span className="text-base">⇄</span>}
        title="Group Transfer Legs"
        subtitle="Group transactions that represent a single transfer between accounts"
        onClose={onClose}
        variant="transfer"
      />

      <Modal.Body className="space-y-6">
        {/* Current Transaction */}
        <div className="rounded-xl bg-[var(--modal-accent-2)]/10 border border-[var(--modal-accent-2)]/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--modal-accent-2)] mb-2 font-semibold">
            Transfer leg to group:
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-[var(--modal-text)]">
                {transaction.description}
              </div>
              <div className="text-xs text-[var(--modal-muted)] mt-0.5">
                {formatDate(transaction.date)} •{" "}
                {transaction.account.split(" ").slice(0, -2).join(" ")}
              </div>
            </div>
            <Badge
              variant={transaction.direction === "credit" ? "default" : "destructive"}
              className="shrink-0"
            >
              {transaction.direction === "credit" ? "In" : "Out"}
            </Badge>
            <div className="text-right shrink-0">
              <div className="font-semibold text-[var(--modal-text)]">
                {formatCurrency(transaction.amount)}
              </div>
            </div>
          </div>
        </div>

        {/* Grouped Transactions View */}
        {isGrouped && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--modal-text)]">
                Current Transfer Group ({transferGroup.length} legs)
              </h3>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await onUngroup();
                  onClose();
                }}
                className="rounded-lg bg-[var(--modal-danger)] hover:bg-red-500 text-white px-3 py-1 text-xs"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Ungroup All
              </Button>
            </div>

            <div className="space-y-2">
              {transferGroup.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-slate-900/70 border border-slate-800 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-[var(--modal-text)]">
                        {t.description}
                      </div>
                      <div className="text-xs text-[var(--modal-muted)] mt-0.5">
                        {formatDate(t.date)} • {t.account.split(" ").slice(0, -2).join(" ")}
                      </div>
                    </div>
                    <Badge
                      variant={t.direction === "credit" ? "default" : "destructive"}
                      className="shrink-0"
                    >
                      {t.direction === "credit" ? "In" : "Out"}
                    </Badge>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-[var(--modal-text)]">
                        {formatCurrency(t.amount)}
                      </div>
                    </div>
                    {t.id !== transaction.id && (
                      <button
                        type="button"
                        onClick={() => onRemoveFromGroup(t.id)}
                        className="p-1.5 rounded-full hover:bg-[var(--modal-danger)]/20 text-[var(--modal-muted)] hover:text-[var(--modal-danger)] transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Net Amount Summary */}
            <div
              className={cn(
                "rounded-xl border p-4",
                Math.abs(netAmount) < 10
                  ? "bg-[var(--modal-success)]/10 border-[var(--modal-success)]/30"
                  : Math.abs(netAmount) < 100
                    ? "bg-yellow-500/10 border-yellow-500/30"
                    : "bg-[var(--modal-danger)]/10 border-[var(--modal-danger)]/30"
              )}
            >
              <SummaryStat
                label="Net Transfer Amount"
                value={formatCurrency(Math.abs(netAmount))}
                valueColor={
                  Math.abs(netAmount) < 10
                    ? "success"
                    : Math.abs(netAmount) < 100
                      ? "warning"
                      : "danger"
                }
              />
              <p
                className={cn(
                  "text-xs mt-2",
                  Math.abs(netAmount) < 10
                    ? "text-[var(--modal-success)]"
                    : Math.abs(netAmount) < 100
                      ? "text-yellow-500"
                      : "text-[var(--modal-danger)]"
                )}
              >
                {Math.abs(netAmount) < 10 && "✓ Balanced transfer"}
                {Math.abs(netAmount) >= 10 &&
                  Math.abs(netAmount) < 100 &&
                  "⚠ Net should be close to ₹0 (within ₹10)"}
                {Math.abs(netAmount) >= 100 &&
                  "⚠ Significant imbalance - expected net ~₹0"}
              </p>
            </div>
          </div>
        )}

        {/* Search */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--modal-text)] mb-3">
            {isGrouped ? "Add More Legs" : "Find Transfer Legs"}
          </h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--modal-muted)]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isGrouped
                  ? "Search for transactions to add..."
                  : "Search by description, amount, or account..."
              }
              className="pl-9 h-10 bg-slate-800/60 border-slate-700 rounded-lg text-[var(--modal-text)]"
            />
          </div>
        </div>

        {/* Results */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-wider text-[var(--modal-muted)]">
              {searchQuery ? "Search Results" : "Suggested Matches"}
            </h3>
            {selectedIds.size > 0 && (
              <span className="text-xs text-[var(--modal-muted)]">
                {selectedIds.size} selected
              </span>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--modal-muted)]" />
            </div>
          )}

          {!isLoading && displayTransactions.length === 0 && (
            <div className="text-center py-8 text-[var(--modal-muted)] text-sm">
              No transactions found
            </div>
          )}

          {!isLoading &&
            displayTransactions.map((sug) => (
              <ResultItem
                key={sug.id}
                selected={selectedIds.has(sug.id)}
                onClick={() => handleSelectTransaction(sug.id)}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedIds.has(sug.id)}
                    onCheckedChange={() => handleSelectTransaction(sug.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--modal-text)]">
                      {sug.description}
                    </div>
                    <div className="text-xs text-[var(--modal-muted)] mt-0.5">
                      {formatDate(sug.date)} • {sug.account}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
                    <Badge
                      variant={sug.direction === "credit" ? "default" : "destructive"}
                    >
                      {sug.direction === "credit" ? "In" : "Out"}
                    </Badge>
                    <div className="text-right">
                      <div className="font-semibold text-[var(--modal-text)]">
                        {formatCurrency(sug.amount)}
                      </div>
                    </div>
                  </div>
                </div>
              </ResultItem>
            ))}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button
          variant="secondary"
          onClick={onClose}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2"
        >
          Cancel
        </Button>

        {!isGrouped && (
          <Button
            onClick={handleGroupSelected}
            disabled={selectedIds.size === 0}
            className={cn(
              "rounded-lg px-4 py-2",
              selectedIds.size > 0
                ? "bg-[var(--modal-accent-2)] hover:bg-cyan-500 text-white"
                : "bg-slate-700 text-slate-400 cursor-not-allowed"
            )}
          >
            Group {selectedIds.size > 0 && `(${selectedIds.size + 1} legs)`}
          </Button>
        )}

        {isGrouped && (
          <Button
            onClick={handleAddToGroup}
            disabled={selectedIds.size === 0}
            className={cn(
              "rounded-lg px-4 py-2",
              selectedIds.size > 0
                ? "bg-[var(--modal-accent-2)] hover:bg-cyan-500 text-white"
                : "bg-slate-700 text-slate-400 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add {selectedIds.size > 0 && `(${selectedIds.size})`}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

