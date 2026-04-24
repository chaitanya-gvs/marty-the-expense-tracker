# Budget Card Expanded View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the budget card's separate recurring-items block + flat transaction list with a single unified timeline that classifies rows as Recurring, Variable, or Upcoming.

**Architecture:** Single component change in `budget-card.tsx`. The collapsed state no longer shows the always-visible committed items block. The expanded state shows one merged list: actual transactions (classified by `tx.is_recurring`) sorted newest-first, followed by projected committed items dimmed below a dashed divider. No new files, hooks, or API calls needed.

**Tech Stack:** React, TypeScript, Tailwind CSS v4, TanStack React Query (`useTransactions` already wired), `cn()` from `@/lib/utils`

---

### Task 1: Rewrite the expanded view in `budget-card.tsx`

**Files:**
- Modify: `frontend/src/components/budgets/budget-card.tsx`

**Context:**

The current file has two things to change:

1. **Remove** the always-visible committed items block inside the clickable `<div>` (lines 255–308 in the current file). This is the `{budget.committed_items.length > 0 && <div ...>...</div>}` block.

2. **Replace** the `{isExpanded && ...}` section at the bottom (lines 311–348) with the new unified timeline.

The `Repeat` icon import is no longer needed after removing the committed items block.

`BudgetSummary` type (from `@/lib/types`):
```typescript
interface CommittedItem {
  recurring_key?: string | null;
  description: string;
  amount: number;
  recurrence_period?: string | null;
  is_projected: boolean;
}
interface BudgetSummary {
  // ...
  committed_items: CommittedItem[];
}
```

`Transaction` type has `is_recurring?: boolean` — use this to classify rows.

---

- [ ] **Step 1: Verify the current file looks as expected**

Run from `frontend/`:
```bash
npm run lint 2>&1 | head -20
```
Expected: no errors (confirms starting from a clean baseline).

---

- [ ] **Step 2: Write the complete replacement for `budget-card.tsx`**

Replace the entire file content with the following. Key changes vs current:
- `Repeat` removed from imports
- Committed items block removed from the clickable body
- `{isExpanded && ...}` section replaced with the unified timeline

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Replace, Edit2, Trash2, ChevronDown } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTransactions } from "@/hooks/use-transactions";

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
  const dateRange = periodToDateRange(period);
  const { data: txData, isLoading: txLoading } = useTransactions(
    isExpanded
      ? { categories: [budget.category_name], date_range: dateRange }
      : undefined,
    { field: "date", direction: "desc" },
    { page: 0, limit: 200 },
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
                      {formatCurrency(tx.amount)}
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
                  {upcomingItems.map((item, i) => (
                    <div
                      key={item.recurring_key ?? i}
                      className="flex items-center gap-3 py-2 opacity-50 border-b border-border/20 last:border-0"
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
                    </div>
                  ))}
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
                    .reduce((sum, t) => sum + t.amount, 0),
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

- [ ] **Step 3: Check TypeScript compiles cleanly**

Run from `frontend/`:
```bash
npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully` with no TypeScript errors. If you see `Module '"lucide-react"' has no exported member 'Repeat'` that means the old import is still present — re-check Step 2.

---

- [ ] **Step 4: Check lint passes**

Run from `frontend/`:
```bash
npm run lint 2>&1
```
Expected: no errors.

---

- [ ] **Step 5: Verify in browser**

The dev server at `http://localhost:3000` has hot reload. Navigate to `/budgets`.

Check all three states:

**Collapsed:** Cards show name, amount, progress bar, legend. No recurring items block visible.

**Expanded — card with recurring items paid + variable transactions:**
- Rows with indigo "Recurring" pill and indigo amount for `is_recurring === true` transactions
- Rows with gray "Variable" pill and default amount for `is_recurring !== true` transactions
- Dashed divider above any projected upcoming items
- Dimmed "Upcoming" rows at the bottom for projected committed items
- Footer shows total debit spend

**Expanded — card with no transactions this period:**
- "No transactions this period." centered message

**Expanded — over-budget card:**
- Bar shows full orange→red gradient (unchanged)
- Timeline still shows transactions correctly

---

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/components/budgets/budget-card.tsx
git commit -m "feat(budgets): unified timeline in expanded card view — Recurring/Variable/Upcoming pills"
```
