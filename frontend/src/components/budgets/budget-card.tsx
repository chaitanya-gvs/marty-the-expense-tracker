"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Replace, Edit2, Trash2, ChevronDown, XCircle } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTransactions } from "@/hooks/use-transactions";
import { useRecurringCount, useCancelRecurring } from "@/hooks/use-budgets";

interface BudgetCardProps {
  budget: BudgetSummary;
  period: string; // "YYYY-MM"
  onEdit: (budget: BudgetSummary) => void;
  onDelete: (id: string) => void;
  onOverride: (budget: BudgetSummary) => void;
}

function getUtilisationColor(pct: number): string {
  if (pct >= 95) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

function getUtilisationTextColor(pct: number): string {
  if (pct >= 95) return "text-red-400";
  if (pct >= 75) return "text-orange-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-green-400";
}

function getUtilisationBorderColor(pct: number): string {
  if (pct >= 95) return "border-l-red-500";
  if (pct >= 75) return "border-l-orange-500";
  if (pct >= 50) return "border-l-yellow-500";
  return "border-l-green-500";
}

function shortDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return dateString;
  }
}

function periodToDateRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${period}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function BudgetCard({ budget, period, onEdit, onDelete, onOverride }: BudgetCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const { data: countData, isLoading: countLoading } = useRecurringCount(confirmingKey);
  const cancelRecurring = useCancelRecurring();
  const isOverBudget = budget.headroom < 0;
  const totalSpend = budget.committed_spend + budget.variable_spend;

  // Progress bar widths
  const committedPct = budget.effective_limit > 0
    ? Math.min((budget.committed_spend / budget.effective_limit) * 100, 100)
    : 0;
  const projectedAmt = budget.committed_items
    .filter(item => item.is_projected)
    .reduce((sum, item) => sum + item.amount, 0);
  const projectedPct = budget.effective_limit > 0
    ? (Math.min(projectedAmt, Math.max(0, budget.effective_limit - budget.committed_spend)) / budget.effective_limit) * 100
    : 0;
  const variablePct = budget.effective_limit > 0
    ? (Math.min(budget.variable_spend, Math.max(0, budget.effective_limit - budget.committed_spend - projectedAmt))
        / budget.effective_limit) * 100
    : 0;

  const healthBg     = getUtilisationColor(budget.utilisation_pct);
  const healthText   = getUtilisationTextColor(budget.utilisation_pct);
  const healthBorder = getUtilisationBorderColor(budget.utilisation_pct);

  // Transactions — fetched lazily on first expand
  const dateRange = useMemo(() => periodToDateRange(period), [period]);
  const { data: txData, isLoading: txLoading } = useTransactions(
    isExpanded
      ? { categories: [budget.category_name], date_range: dateRange }
      : undefined,
    { field: "date", direction: "desc" },
    { page: 0, limit: 200 },
    { enabled: isExpanded },
  );
  const transactions = txData?.data ?? [];
  const upcomingItems = budget.committed_items.filter(item => item.is_projected);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card border-l-[3px] space-y-3",
        healthBorder,
        isOverBudget && "border-t border-t-red-500/20",
      )}
    >
      {/* Clickable card body */}
      <div
        className="p-4 space-y-3 cursor-pointer hover:bg-accent/20 transition-colors rounded-xl"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        {/* Card header */}
        <div>
          <div className="flex items-center gap-2">

            {/* Name + Override badge */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-semibold text-foreground truncate">
                {budget.name ?? budget.category_name}
              </span>
              {budget.has_override && (
                <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-400">
                  Override
                </span>
              )}
            </div>

            {/* Spent amount + headroom badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={cn("text-base font-bold font-mono", healthText)}>
                {formatCurrency(totalSpend)}
              </span>
              {isOverBudget ? (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                  Over {formatCurrency(Math.abs(budget.headroom))}
                </span>
              ) : (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {formatCurrency(budget.headroom)} left
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 rounded-md"
                onClick={(e) => { e.stopPropagation(); onOverride(budget); }}
                title="Set monthly override"
              >
                <Replace className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 rounded-md"
                onClick={(e) => { e.stopPropagation(); onEdit(budget); }}
                title="Edit budget"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 rounded-md text-destructive/60 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(budget.id); }}
                title="Delete budget"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground/50 transition-transform ml-0.5",
                  isExpanded && "rotate-180",
                )}
              />
            </div>

          </div>

          {/* Limit subtitle */}
          <div className="text-xs text-muted-foreground mt-0.5">
            Limit: {formatCurrency(budget.effective_limit)} / month
          </div>
        </div>

        {/* Stacked progress bar */}
        <div className="h-[10px] rounded-full bg-muted overflow-hidden flex">
          {isOverBudget ? (
            <div className="h-full w-full bg-gradient-to-r from-orange-500 to-red-500" />
          ) : (
            <>
              {committedPct > 0 && (
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${committedPct}%` }}
                />
              )}
              {projectedPct > 0 && (
                <div
                  className="h-full bg-indigo-500/30 transition-all"
                  style={{ width: `${projectedPct}%` }}
                />
              )}
              {variablePct > 0 && (
                <div
                  className={cn("h-full transition-all", healthBg)}
                  style={{ width: `${variablePct}%` }}
                />
              )}
            </>
          )}
        </div>

        {/* Legend row */}
        <div className="flex items-center gap-4 flex-wrap">
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] text-indigo-400",
              budget.committed_spend === 0 && "opacity-40",
            )}
          >
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-indigo-500 shrink-0" />
            Committed {formatCurrency(budget.committed_spend)}
          </span>

          {projectedAmt > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-400/60">
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-indigo-500/30 shrink-0" />
              Projected {formatCurrency(projectedAmt)}
            </span>
          )}

          <span
            className={cn(
              "flex items-center gap-1 text-[10px]",
              healthText,
              budget.variable_spend === 0 && "opacity-40",
            )}
          >
            <span className={cn("inline-block h-[7px] w-[7px] rounded-full shrink-0", healthBg)} />
            Variable {formatCurrency(budget.variable_spend)}
          </span>

          {isOverBudget ? (
            <span className="flex items-center gap-1 text-[10px] text-red-400 ml-auto">
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground/30 shrink-0" />
              −{formatCurrency(Math.abs(budget.headroom))} over
            </span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] text-muted-foreground ml-auto",
                budget.headroom === 0 && "opacity-40",
              )}
            >
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground/30 shrink-0" />
              {formatCurrency(budget.headroom)} free
            </span>
          )}
        </div>
      </div>

      {/* Unified timeline — shown when expanded */}
      {isExpanded && (
        <div className="border-t border-border/60 mx-4 pb-4">
          {txLoading ? (
            <div className="space-y-2 pt-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : transactions.length === 0 && upcomingItems.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No transactions this period.
            </p>
          ) : (
            <div className="pt-2">
              {/* Actual transactions — recurring and variable interleaved by date */}
              {transactions.map((tx) => {
                const isRecurring = tx.is_recurring === true;
                const isCredit = tx.direction === "credit";
                return (
                  <div
                    key={tx.id}
                    className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0"
                  >
                    <span
                      className={cn(
                        "shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
                        isRecurring
                          ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40"
                          : "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {isRecurring ? "Recurring" : "Variable"}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground w-12 tabular-nums">
                      {shortDate(tx.date)}
                    </span>
                    <span className="flex-1 text-sm text-foreground/80 truncate">
                      {tx.description}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-mono tabular-nums",
                        isCredit
                          ? "text-green-400"
                          : isRecurring
                            ? "text-indigo-400"
                            : "text-foreground",
                      )}
                    >
                      {formatCurrency(tx.split_share_amount ?? tx.amount)}
                    </span>
                  </div>
                );
              })}

              {/* Dashed divider + upcoming projected items */}
              {upcomingItems.length > 0 && (
                <>
                  {transactions.length > 0 && (
                    <div className="border-t border-dashed border-border/40 my-1" />
                  )}
                  {upcomingItems.map((item, i) => {
                    const key = item.recurring_key ?? String(i);
                    const isConfirming = confirmingKey === key;
                    return (
                      <div key={key}>
                        <div
                          className={cn(
                            "flex items-center gap-3 py-2 border-b border-border/20 last:border-0",
                            isConfirming ? "opacity-100" : "opacity-50",
                          )}
                        >
                          <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border whitespace-nowrap">
                            Upcoming
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground w-12 tabular-nums">
                            —
                          </span>
                          <span className="flex-1 text-sm text-muted-foreground italic truncate">
                            {item.description}
                          </span>
                          <span className="shrink-0 text-sm font-mono tabular-nums text-muted-foreground">
                            {formatCurrency(item.amount)}
                          </span>
                          <button
                            className="shrink-0 text-muted-foreground/40 hover:text-red-400 transition-colors"
                            title="Stop tracking this subscription"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmingKey(isConfirming ? null : key);
                            }}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {isConfirming && (
                          <div className="flex items-center justify-between gap-3 px-2 py-2 mb-1 rounded-md bg-red-500/10 border border-red-500/20">
                            <span className="text-[11px] text-red-400">
                              {countLoading
                                ? "Loading…"
                                : `Unmark ${countData?.data.count ?? "?"} past transaction${(countData?.data.count ?? 0) !== 1 ? "s" : ""} as recurring — stops future projections.`}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e) => { e.stopPropagation(); setConfirmingKey(null); }}
                              >
                                Cancel
                              </button>
                              <button
                                className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                                disabled={cancelRecurring.isPending || countLoading}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!item.recurring_key) return;
                                  await cancelRecurring.mutateAsync(item.recurring_key);
                                  setConfirmingKey(null);
                                }}
                              >
                                {cancelRecurring.isPending ? "Stopping…" : "Confirm"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Footer: count + total debit spend */}
          {!txLoading && transactions.length > 0 && (
            <div className="pt-3 border-t border-border flex items-center justify-between mt-1">
              <span className="text-xs text-muted-foreground">
                {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
              </span>
              <span className="text-sm font-mono font-semibold text-foreground">
                {formatCurrency(
                  transactions
                    .filter(t => t.direction !== "credit")
                    .reduce((sum, t) => sum + (t.split_share_amount ?? t.amount), 0),
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
