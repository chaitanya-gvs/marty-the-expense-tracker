"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { Search, Loader2, Layers, Ungroup } from "lucide-react";
import { cn } from "@/lib/utils";

interface GroupExpenseSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTransactions: (transactions: Transaction[]) => void;
  /** When set, this transaction is always included; user searches to add more. */
  initialTransaction?: Transaction | null;
  /** When set (and initialTransaction is in a group), show existing group members and Ungroup option. */
  existingGroupMembers?: Transaction[];
  /** Called when user clicks Ungroup; receives the transaction_group_id. */
  onUngroup?: (transactionGroupId: string) => Promise<void>;
}

export function GroupExpenseSearchModal({
  isOpen,
  onClose,
  onSelectTransactions,
  initialTransaction = null,
  existingGroupMembers = [],
  onUngroup,
}: GroupExpenseSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ungrouping, setUngrouping] = useState(false);
  const [fetchedGroupMembers, setFetchedGroupMembers] = useState<Transaction[]>([]);
  const [loadingGroupMembers, setLoadingGroupMembers] = useState(false);

  const isExistingGroup = !!initialTransaction?.transaction_group_id;
  const effectiveGroupMembers =
    (existingGroupMembers?.length ? existingGroupMembers : fetchedGroupMembers) ?? [];
  const isViewExistingGroup = isExistingGroup && (effectiveGroupMembers.length > 0 || loadingGroupMembers);

  useEffect(() => {
    if (!isOpen || !initialTransaction?.transaction_group_id || existingGroupMembers?.length) {
      if (!isOpen) setFetchedGroupMembers([]);
      return;
    }
    let cancelled = false;
    setLoadingGroupMembers(true);
    apiClient
      .getGroupTransactions(initialTransaction.id)
      .then((res) => {
        if (cancelled || !res.data) return;
        setFetchedGroupMembers(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setFetchedGroupMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingGroupMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, initialTransaction?.id, initialTransaction?.transaction_group_id, existingGroupMembers?.length]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    if (!debouncedQuery) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setResults([]);
    apiClient
      .searchTransactions(debouncedQuery, 30, 0)
      .then((res) => {
        if (cancelled || !res.data || !Array.isArray(res.data)) return;
        // Exclude collapsed grouped-expense rows (summary row only)
        let list = res.data.filter(
          (t) => !(t.transaction_group_id && t.is_grouped_expense)
        );
        const excludeIds = new Set<string>();
        if (initialTransaction?.id) excludeIds.add(initialTransaction.id);
        effectiveGroupMembers.forEach((t) => excludeIds.add(t.id));
        if (excludeIds.size) {
          list = list.filter((t) => !excludeIds.has(t.id));
        }
        setResults(list);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, debouncedQuery, initialTransaction?.id, effectiveGroupMembers]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setDebouncedQuery("");
      setResults([]);
      setSelectedIds(new Set());
      setFetchedGroupMembers([]);
    }
  }, [isOpen]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedFromSearch = results.filter((t) => selectedIds.has(t.id));
  const canGroup =
    isViewExistingGroup
      ? selectedFromSearch.length >= 1
      : !!initialTransaction || selectedFromSearch.length >= 1;

  const handleGroupSelected = () => {
    if (!canGroup) return;
    const toGroup = isViewExistingGroup
      ? [...effectiveGroupMembers, ...selectedFromSearch]
      : initialTransaction
        ? [initialTransaction, ...selectedFromSearch]
        : selectedFromSearch;
    onSelectTransactions(toGroup);
    onClose();
  };

  const handleUngroup = async () => {
    if (!initialTransaction?.transaction_group_id || !onUngroup) return;
    setUngrouping(true);
    try {
      await onUngroup(initialTransaction.transaction_group_id);
      onClose();
    } finally {
      setUngrouping(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Layers className="h-4 w-4" />}
        title="Group expense"
        subtitle={
          isViewExistingGroup
            ? "These transactions are grouped together. You can ungroup them or add more below."
            : initialTransaction
              ? "Search to add more transactions to group with this one"
              : "Search and select 1 or more transactions to group into a single expense"
        }
        onClose={onClose}
        variant="category"
      />

      <Modal.Body className="space-y-4">
        {isViewExistingGroup && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Transactions in this group:</p>
            <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 rounded-lg border border-border bg-muted/30 p-2">
              {loadingGroupMembers ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                effectiveGroupMembers.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{t.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(t.date)}
                        {t.account && ` · ${t.account.split(" ").slice(0, -2).join(" ") || t.account}`}
                      </p>
                    </div>
                    <Badge variant={t.direction === "debit" ? "destructive" : "default"} className="shrink-0 text-xs">
                      {t.direction === "credit" ? "+" : "−"}
                      {formatCurrency(Math.abs(t.amount))}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {initialTransaction && !isViewExistingGroup && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Included in group:</p>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{initialTransaction.description}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(initialTransaction.date)}
                  {initialTransaction.account && ` · ${initialTransaction.account.split(" ").slice(0, -2).join(" ") || initialTransaction.account}`}
                </p>
              </div>
              <Badge variant={initialTransaction.direction === "debit" ? "destructive" : "default"} className="shrink-0 text-xs">
                {initialTransaction.direction === "credit" ? "+" : "−"}
                {formatCurrency(Math.abs(initialTransaction.amount))}
              </Badge>
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by description, amount, account..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {!debouncedQuery && !isViewExistingGroup && (
          <p className="text-sm text-muted-foreground">
            {initialTransaction
              ? "Search to add more transactions to this group, then click Group."
              : "Type to search transactions. Select one or more, then click Group selected."}
          </p>
        )}
        {!debouncedQuery && isViewExistingGroup && (
          <p className="text-sm text-muted-foreground">
            Search below to add more transactions to this group, or click Ungroup to break the group apart.
          </p>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {debouncedQuery && !isLoading && results.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No transactions found.</p>
        )}

        {debouncedQuery && !isLoading && results.length > 0 && (
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            <div className="flex items-center justify-between sticky top-0 bg-background py-1">
              <span className="text-xs font-medium text-muted-foreground">
                {initialTransaction && !isViewExistingGroup ? 1 + selectedIds.size : isViewExistingGroup ? effectiveGroupMembers.length + selectedIds.size : selectedIds.size} in group
              </span>
            </div>
            {results.map((t) => (
              <label
                key={t.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  selectedIds.has(t.id)
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <Checkbox
                  checked={selectedIds.has(t.id)}
                  onCheckedChange={() => toggleSelection(t.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{t.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(t.date)} · {t.account.split(" ").slice(0, -2).join(" ")}
                    {t.category && ` · ${t.category}`}
                  </div>
                </div>
                <Badge variant={t.direction === "debit" ? "destructive" : "default"} className="shrink-0 text-xs">
                  {t.direction === "credit" ? "+" : "−"}
                  {formatCurrency(Math.abs(t.amount))}
                </Badge>
              </label>
            ))}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {isViewExistingGroup && onUngroup && (
          <Button
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={handleUngroup}
            disabled={ungrouping}
          >
            {ungrouping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ungroup className="h-4 w-4 mr-2" />}
            Ungroup
          </Button>
        )}
        <Button onClick={handleGroupSelected} disabled={!canGroup}>
          <Layers className="h-4 w-4 mr-2" />
          {isViewExistingGroup
            ? `Group (${effectiveGroupMembers.length + selectedIds.size})`
            : initialTransaction
              ? `Group (${1 + selectedIds.size})`
              : `Group selected (${selectedIds.size})`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
