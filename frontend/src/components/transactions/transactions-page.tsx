"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, useSpring, useMotionValueEvent } from "framer-motion";

// 21st.dev animated number ticker — spring-physics count-up from 0
function AnimatedStat({ value, format }: { value: number; format: (n: number) => string }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const [display, setDisplay] = useState(format(0));
  useEffect(() => { if (value) spring.set(value); }, [value, spring]);
  useMotionValueEvent(spring, "change", (v) => setDisplay(format(v)));
  return <>{display}</>;
}

const _containerVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const _itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 400, damping: 35 } },
};
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { AddTransactionModal } from "@/components/transactions/add-transaction-modal";
import { TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Button } from "@/components/ui/button";
import { Plus, Upload, X, TrendingDown, TrendingUp, ArrowRightLeft, Hash } from "lucide-react";
import { WorkflowSheet } from "@/components/workflow/workflow-sheet";
import { formatCurrency } from "@/lib/format-utils";

// Get default date range (Last Month)
function getDefaultDateRange() {
  const today = new Date();
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(lastMonthStart), end: fmt(lastMonthEnd) };
}

// Load filters from localStorage or use defaults
function getInitialFilters(): TransactionFiltersType {
  return { date_range: getDefaultDateRange() };
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

  // Restore filters from localStorage after mount (must be client-only to avoid hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('transaction-filters');
      if (saved) setFilters(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('transaction-filters', JSON.stringify(filters));
    } catch {
      // Swallow localStorage write errors silently
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

  // Stats come from the first page's pagination metadata (computed server-side over the full filtered set)
  const firstPagePagination = data?.pages?.[0]?.pagination;
  const totalDebits = firstPagePagination?.total_debits ?? 0;
  const totalCredits = firstPagePagination?.total_credits ?? 0;
  const net = totalCredits - totalDebits;
  const count = firstPagePagination?.total ?? allTransactions.length;

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
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Transactions</h1>
        <p className="text-sm text-destructive">Error loading transactions: {error.message || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <motion.div className="space-y-5" variants={_containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={_itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Transactions</h1>
          {filters.date_range?.start && (
            <p className="text-xs text-muted-foreground/70 -mt-1">
              {filters.date_range.start} → {filters.date_range.end ?? "today"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8"
            onClick={() => setIsWorkflowOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent shadow-[0_0_12px_color-mix(in_oklch,var(--color-primary)_35%,transparent)] hover:shadow-[0_0_20px_color-mix(in_oklch,var(--color-primary)_50%,transparent)] transition-shadow duration-200"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </motion.div>

      {/* Stats Bar */}
      <motion.div variants={_itemVariants} className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px shadow-[0_1px_8px_oklch(0%_0_0_/_0.08)] dark:shadow-[0_1px_16px_oklch(0%_0_0_/_0.4)]">
        <div
          className="bg-card px-4 py-4 min-w-0 overflow-hidden transition-colors duration-150 hover:bg-muted/60 cursor-default group relative before:absolute before:inset-0 before:pointer-events-none before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300 before:bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),oklch(from_var(--color-primary)_l_c_h_/_0.07),transparent_70%)]"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mouse-x", `${((e.clientX - r.left) / r.width) * 100}%`); e.currentTarget.style.setProperty("--mouse-y", `${((e.clientY - r.top) / r.height) * 100}%`); }}
        >
          <p className="text-[11px] font-medium text-muted-foreground/70 mb-2 flex items-center gap-1.5 whitespace-nowrap tracking-wide uppercase">
            <TrendingDown className="h-3.5 w-3.5 shrink-0 text-destructive/40 group-hover:text-destructive/80 transition-colors" />
            Total Spent
          </p>
          <p className="font-mono text-xl font-semibold text-foreground tabular-nums truncate tracking-tight">
            <AnimatedStat value={totalDebits} format={formatCurrency} />
          </p>
        </div>
        <div
          className="bg-card px-4 py-4 min-w-0 overflow-hidden transition-colors duration-150 hover:bg-muted/60 cursor-default group relative before:absolute before:inset-0 before:pointer-events-none before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300 before:bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),oklch(from_var(--color-primary)_l_c_h_/_0.07),transparent_70%)]"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mouse-x", `${((e.clientX - r.left) / r.width) * 100}%`); e.currentTarget.style.setProperty("--mouse-y", `${((e.clientY - r.top) / r.height) * 100}%`); }}
        >
          <p className="text-[11px] font-medium text-muted-foreground/70 mb-2 flex items-center gap-1.5 whitespace-nowrap tracking-wide uppercase">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500/50 group-hover:text-emerald-500/90 transition-colors" />
            Total In
          </p>
          <p className="font-mono text-xl font-semibold text-emerald-500 tabular-nums truncate tracking-tight">
            <AnimatedStat value={totalCredits} format={formatCurrency} />
          </p>
        </div>
        <div
          className="bg-card px-4 py-4 min-w-0 overflow-hidden transition-colors duration-150 hover:bg-muted/60 cursor-default group relative before:absolute before:inset-0 before:pointer-events-none before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300 before:bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),oklch(from_var(--color-primary)_l_c_h_/_0.07),transparent_70%)]"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mouse-x", `${((e.clientX - r.left) / r.width) * 100}%`); e.currentTarget.style.setProperty("--mouse-y", `${((e.clientY - r.top) / r.height) * 100}%`); }}
        >
          <p className="text-[11px] font-medium text-muted-foreground/70 mb-2 flex items-center gap-1.5 whitespace-nowrap tracking-wide uppercase">
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors" />
            Net
          </p>
          <p className={`font-mono text-xl font-semibold tabular-nums truncate tracking-tight ${net >= 0 ? "text-emerald-500" : "text-destructive"}`}>
            {net >= 0 ? "+" : "−"}<AnimatedStat value={Math.abs(net)} format={formatCurrency} />
          </p>
        </div>
        <div
          className="bg-card px-4 py-4 min-w-0 overflow-hidden transition-colors duration-150 hover:bg-muted/60 cursor-default group relative before:absolute before:inset-0 before:pointer-events-none before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300 before:bg-[radial-gradient(circle_at_var(--mouse-x,50%)_var(--mouse-y,50%),oklch(from_var(--color-primary)_l_c_h_/_0.07),transparent_70%)]"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mouse-x", `${((e.clientX - r.left) / r.width) * 100}%`); e.currentTarget.style.setProperty("--mouse-y", `${((e.clientY - r.top) / r.height) * 100}%`); }}
        >
          <p className="text-[11px] font-medium text-muted-foreground/70 mb-2 flex items-center gap-1.5 whitespace-nowrap tracking-wide uppercase">
            <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors" />
            Transactions
          </p>
          <p className="font-mono text-xl font-semibold text-foreground tabular-nums tracking-tight">
            <AnimatedStat value={count} format={(n) => String(Math.round(n))} />
          </p>
        </div>
      </motion.div>

      {/* Filters and Table */}
      <motion.div variants={_itemVariants}>
        <TransactionFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onClearFilters={handleClearFilters}
        />
      </motion.div>
      <TransactionsTable filters={filters} sort={sort} />

      <AddTransactionModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
      <WorkflowSheet open={isWorkflowOpen} onOpenChange={setIsWorkflowOpen} />
    </motion.div>
  );
}
