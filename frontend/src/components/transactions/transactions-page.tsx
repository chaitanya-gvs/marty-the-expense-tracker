"use client";

import { useState, useEffect, useMemo } from "react";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { AddTransactionModal } from "@/components/transactions/add-transaction-modal";
import { TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Button } from "@/components/ui/button";
import { Plus, Play, X, TrendingDown, TrendingUp, ArrowRightLeft, Hash } from "lucide-react";
import { WorkflowSheet } from "@/components/workflow/workflow-sheet";
import { formatCurrency } from "@/lib/format-utils";

// Get default date range (This Month)
function getDefaultDateRange() {
  const today = new Date();
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: thisMonthStart.toISOString().split("T")[0],
    end: today.toISOString().split("T")[0]
  };
}

// Load filters from localStorage or use defaults
function getInitialFilters(): TransactionFiltersType {
  if (typeof window === 'undefined') return {};

  try {
    const saved = localStorage.getItem('transaction-filters');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading filters from localStorage:', error);
  }

  return {
    date_range: getDefaultDateRange()
  };
}

// Human-readable labels for active filter chips
const FILTER_LABELS: Record<string, string> = {
  search: "Search",
  date_range: "Date",
  categories: "Category",
  tags: "Tags",
  accounts: "Account",
  direction: "Direction",
  amount_range: "Amount",
  transaction_source: "Source",
  has_splits: "Has Splits",
  is_shared: "Shared",
  participants: "Participants",
  exclude_categories: "Excl. Category",
  exclude_tags: "Excl. Tags",
};

function getFilterChipLabel(key: string, value: unknown): string {
  const base = FILTER_LABELS[key] || key;
  if (key === "date_range" && value && typeof value === "object") {
    const dr = value as { start?: string; end?: string };
    if (dr.start && dr.end) return `${dr.start} → ${dr.end}`;
    if (dr.start) return `From ${dr.start}`;
    if (dr.end) return `To ${dr.end}`;
  }
  if (key === "direction") return value === "debit" ? "Debits only" : "Credits only";
  if (key === "amount_range" && value && typeof value === "object") {
    const ar = value as { min?: number; max?: number };
    if (ar.min !== undefined && ar.max !== undefined) return `₹${ar.min}–₹${ar.max}`;
    if (ar.min !== undefined) return `Min ₹${ar.min}`;
    if (ar.max !== undefined) return `Max ₹${ar.max}`;
  }
  if (Array.isArray(value)) return `${base} (${(value as unknown[]).length})`;
  if (key === "has_splits" || key === "is_shared") return base;
  return `${base}: ${value}`;
}

export function TransactionsPage() {
  const [filters, setFilters] = useState<TransactionFiltersType>(getInitialFilters);
  const [sort, setSort] = useState<TransactionSort | undefined>();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('transaction-filters', JSON.stringify(filters));
    } catch (error) {
      console.error('Error saving filters to localStorage:', error);
    }
  }, [filters]);

  const handleFiltersChange = (newFilters: TransactionFiltersType) => {
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleRemoveFilter = (key: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[key as keyof TransactionFiltersType];
      return next;
    });
  };

  const { data, isLoading, error } = useInfiniteTransactions(filters, sort);
  const allTransactions = useMemo(
    () => data?.pages?.flatMap(page => page.data || []) || [],
    [data]
  );

  // Compute stats
  const { totalDebits, totalCredits, net, count } = useMemo(() => {
    const getEffectiveAmount = (t: typeof allTransactions[0]) => {
      if (!t) return 0;
      return t.is_shared && t.split_share_amount ? t.split_share_amount : (t.amount || 0);
    };
    const debits = allTransactions.filter(t => t?.direction === 'debit').reduce((s, t) => s + getEffectiveAmount(t), 0);
    const credits = allTransactions.filter(t => t?.direction === 'credit').reduce((s, t) => s + getEffectiveAmount(t), 0);
    return { totalDebits: debits, totalCredits: credits, net: credits - debits, count: allTransactions.length };
  }, [allTransactions]);

  // Active filter chips
  const activeFilterKeys = useMemo(() => {
    return Object.entries(filters).filter(([, v]) => {
      if (v === undefined || v === null || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      if (typeof v === "object" && !Array.isArray(v) && Object.values(v).every(x => x === undefined || x === "" || x === null)) return false;
      return true;
    });
  }, [filters]);

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Transactions</h1>
        <p className="text-sm text-destructive">Error loading transactions: {error.message || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Transactions</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={() => setIsWorkflowOpen(true)}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Import
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-3 py-4 min-w-0">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            Total Spent
          </p>
          <p className="font-mono text-base font-semibold text-foreground tabular-nums">
            {formatCurrency(totalDebits)}
          </p>
        </div>
        <div className="px-3 py-4 min-w-0">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            Total In
          </p>
          <p className="font-mono text-base font-semibold text-foreground tabular-nums">
            {formatCurrency(totalCredits)}
          </p>
        </div>
        <div className="px-3 py-4 min-w-0">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <ArrowRightLeft className="h-3 w-3" />
            Net
          </p>
          <p className={`font-mono text-base font-semibold tabular-nums ${net >= 0 ? "text-emerald-500" : "text-destructive"}`}>
            {formatCurrency(Math.abs(net))}
          </p>
        </div>
        <div className="px-3 py-4 min-w-0">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Hash className="h-3 w-3" />
            Transactions
          </p>
          <p className="font-mono text-base font-semibold text-foreground tabular-nums">
            {count}
          </p>
        </div>
      </div>


      {/* Filters and Table */}
      <TransactionFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
      />
      <TransactionsTable filters={filters} sort={sort} />

      <AddTransactionModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
      <WorkflowSheet open={isWorkflowOpen} onOpenChange={setIsWorkflowOpen} />
    </div>
  );
}
