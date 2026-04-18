# Budgets Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Budgets page to make committed vs. variable spend immediately visible at every level — summary ring, card progress bars, and committed items block.

**Architecture:** Pure frontend rework of 4 existing components. No backend changes, no new files created. Each component is a self-contained rewrite/update that can be reviewed independently. No Radix Card primitives — plain divs for full border control.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Lucide React, Next.js App Router

---

## File Map

| File | Change |
|---|---|
| `frontend/src/components/budgets/budgets-overview.tsx` | Full rewrite — SVG ring chart + stat grid |
| `frontend/src/components/budgets/budget-card.tsx` | Full rewrite — left-border card, stacked bar, committed items block, Replace icon |
| `frontend/src/components/budgets/budget-threshold-alerts.tsx` | Update — collapse to single slim banner |
| `frontend/src/components/budgets/budgets-list.tsx` | Minor — section header count + empty state panel |

---

## Task 1: BudgetsOverview — SVG Ring Chart + Stat Grid

**Files:**
- Modify: `frontend/src/components/budgets/budgets-overview.tsx`

**What this does:** Replaces the 4-column stat card grid with a single wide card containing a donut ring chart (showing committed + variable arcs) on the left and a 2×2 stat grid on the right.

**Ring chart math:**
- SVG viewBox `0 0 96 96`, circle radius `r=38`, `strokeWidth=9`, circumference ≈ 238.76
- `<g transform="rotate(-90 48 48)">` rotates the coordinate system so arcs start at 12 o'clock
- Committed arc: `strokeDasharray="${committedArc} ${circumference}"`, no extra transform — starts at 12 o'clock
- Variable arc: same dasharray pattern, plus `transform="rotate(${variableStartDeg} 48 48)"` inside the group to start right after committed
- Center text overlaid via absolutely-positioned `<div>` (avoids SVG text colour/font issues)

- [ ] **Step 1: Replace the file with the new implementation**

```tsx
"use client";

import { BudgetsSummaryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetsOverviewProps {
  data: BudgetsSummaryResponse | undefined;
  isLoading: boolean;
}

function getHealthStroke(pct: number): string {
  if (pct >= 95) return "#ef4444"; // red-500
  if (pct >= 75) return "#f97316"; // orange-500
  if (pct >= 50) return "#eab308"; // yellow-500
  return "#22c55e";                 // green-500
}

export function BudgetsOverview({ data, isLoading }: BudgetsOverviewProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex gap-6 items-center">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="w-px self-stretch bg-border shrink-0" />
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2 bg-muted rounded animate-pulse w-16" />
              <div className="h-6 bg-muted rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const budgets = data?.budgets ?? [];
  const totalLimit = budgets.reduce((s, b) => s + b.effective_limit, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.committed_spend, 0);
  const totalVariable = budgets.reduce((s, b) => s + b.variable_spend, 0);
  const totalHeadroom = totalLimit - totalCommitted - totalVariable;
  const overCount = budgets.filter(b => b.headroom < 0).length;

  const totalSpend = totalCommitted + totalVariable;
  const utilisationPct = totalLimit > 0 ? (totalSpend / totalLimit) * 100 : 0;
  const healthStroke = getHealthStroke(utilisationPct);

  // SVG ring math
  // Each arc is drawn as a dash: dasharray="${arcLen} ${circumference}" (gap > full circle → never repeats).
  // The <g transform="rotate(-90 48 48)"> makes arcs start at 12 o'clock.
  // Variable arc uses an additional SVG rotate inside the group to start after committed.
  const r = 38;
  const circumference = 2 * Math.PI * r;
  const committedFrac = totalLimit > 0 ? Math.min(totalCommitted / totalLimit, 1) : 0;
  const variableFrac = totalLimit > 0
    ? Math.min(totalVariable / totalLimit, Math.max(0, 1 - committedFrac))
    : 0;
  const committedArc = committedFrac * circumference;
  const variableArc = variableFrac * circumference;
  const variableStartDeg = committedFrac * 360;

  const stats = [
    { label: "Total Budget", value: formatCurrency(totalLimit), color: "text-foreground" },
    { label: "Committed",    value: formatCurrency(totalCommitted), color: "text-indigo-400" },
    {
      label: "Variable",
      value: formatCurrency(totalVariable),
      color: overCount > 0 ? "text-red-400" : "text-orange-400",
    },
    {
      label: "Headroom",
      value: formatCurrency(totalHeadroom),
      color: totalHeadroom >= 0 ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-6">

        {/* ── Ring chart ── */}
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 96 96" className="w-24 h-24">
            {/*
              rotate(-90 48 48): rotates the whole group so arcs begin at 12 o'clock.
              Each arc: dasharray="${arcLen} ${circumference}" ensures no repeat.
            */}
            <g transform="rotate(-90 48 48)">
              {/* Track (empty ring) */}
              <circle
                cx="48" cy="48" r={r}
                fill="none"
                strokeWidth="9"
                className="stroke-muted"
              />
              {/* Committed segment — indigo, starts at 12 o'clock */}
              {committedArc > 0 && (
                <circle
                  cx="48" cy="48" r={r}
                  fill="none"
                  strokeWidth="9"
                  stroke="#6366f1"
                  strokeLinecap="butt"
                  strokeDasharray={`${committedArc} ${circumference}`}
                />
              )}
              {/* Variable segment — health colour, starts after committed */}
              {variableArc > 0 && (
                <circle
                  cx="48" cy="48" r={r}
                  fill="none"
                  strokeWidth="9"
                  stroke={healthStroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${variableArc} ${circumference}`}
                  transform={`rotate(${variableStartDeg} 48 48)`}
                />
              )}
            </g>
          </svg>

          {/* Centre text — absolutely positioned to avoid SVG text quirks */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-sm font-bold font-mono text-foreground leading-none">
              {Math.round(utilisationPct)}%
            </span>
            <span className="text-[8px] text-muted-foreground leading-none">used</span>
            {overCount > 0 && (
              <span className="text-[8px] text-red-400 leading-none">{overCount} over</span>
            )}
          </div>
        </div>

        {/* ── Vertical divider ── */}
        <div className="w-px self-stretch bg-border shrink-0" />

        {/* ── Stats 2×2 grid ── */}
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {stats.map(stat => (
            <div key={stat.label}>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {stat.label}
              </div>
              <div className={`text-xl font-bold font-mono ${stat.color}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint check**

Run from `frontend/`:
```bash
npm run lint
```
Expected: exits 0, no ESLint errors. TypeScript errors will surface in the next step.

- [ ] **Step 3: Build check**

Run from `frontend/`:
```bash
npm run build
```
Expected: exits 0. If there are TypeScript errors they will reference the file name — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/budgets/budgets-overview.tsx
git commit -m "feat(budgets): rewrite BudgetsOverview with SVG ring chart and stat grid"
```

---

## Task 2: BudgetCard — Left-border Card, Stacked Bar, Always-Visible Committed Block

**Files:**
- Modify: `frontend/src/components/budgets/budget-card.tsx`

**What this does:**
- Removes Radix Card; uses a plain `div` with `border-l-[3px] border-l-{health}` left accent
- Over-budget cards add `border-t border-t-red-500/20` top tint
- Header row: `[name + Override badge] [spent + headroom badge] [Replace | Edit2 | Trash2]`
- Stacked progress bar: indigo committed + health-colour variable; over-budget state → full gradient
- Legend row: dots for committed / variable / free with `opacity-40` when zero
- Committed items block: always shown (not collapsible) when `committed_items.length > 0`
- Adds `getUtilisationBorderColor` helper; keeps existing `getUtilisationColor` and `getUtilisationTextColor`
- Swaps `Calendar` icon for `Replace`, `Edit` for `Edit2`

- [ ] **Step 1: Replace the file with the new implementation**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Replace, Edit2, Trash2, Repeat } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetCardProps {
  budget: BudgetSummary;
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

export function BudgetCard({ budget, onEdit, onDelete, onOverride }: BudgetCardProps) {
  const isOverBudget = budget.headroom < 0;
  const totalSpend = budget.committed_spend + budget.variable_spend;

  // Progress bar widths
  const committedPct = budget.effective_limit > 0
    ? (budget.committed_spend / budget.effective_limit) * 100
    : 0;
  const variablePct = budget.effective_limit > 0
    ? (Math.min(budget.variable_spend, Math.max(0, budget.effective_limit - budget.committed_spend))
        / budget.effective_limit) * 100
    : 0;

  const healthBg     = getUtilisationColor(budget.utilisation_pct);
  const healthText   = getUtilisationTextColor(budget.utilisation_pct);
  const healthBorder = getUtilisationBorderColor(budget.utilisation_pct);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card border-l-[3px] p-4 space-y-3",
        healthBorder,
        isOverBudget && "border-t border-t-red-500/20",
      )}
    >
      {/* ── Card header ── */}
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

          {/* Action buttons — always visible */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md"
              onClick={() => onOverride(budget)}
              title="Set monthly override"
            >
              <Replace className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md"
              onClick={() => onEdit(budget)}
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md text-destructive/60 hover:text-destructive"
              onClick={() => onDelete(budget.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

        </div>

        {/* Limit subtitle */}
        <div className="text-xs text-muted-foreground mt-0.5">
          Limit: {formatCurrency(budget.effective_limit)} / month
        </div>
      </div>

      {/* ── Stacked progress bar ── */}
      <div className="h-[10px] rounded-full bg-muted overflow-hidden flex">
        {isOverBudget ? (
          // Over budget: full gradient
          <div className="h-full w-full bg-gradient-to-r from-orange-500 to-red-500" />
        ) : (
          <>
            {committedPct > 0 && (
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${committedPct}%` }}
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

      {/* ── Legend row ── */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Committed dot */}
        <span
          className={cn(
            "flex items-center gap-1 text-[10px] text-indigo-400",
            budget.committed_spend === 0 && "opacity-40",
          )}
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-indigo-500 shrink-0" />
          Committed {formatCurrency(budget.committed_spend)}
        </span>

        {/* Variable dot */}
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

        {/* Headroom / Over */}
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

      {/* ── Committed items block — only when recurring items exist ── */}
      {budget.committed_items.length > 0 && (
        <div className="bg-background/60 rounded-lg border border-border/50 p-3 space-y-2">

          {/* Section label */}
          <div className="flex items-center gap-1.5">
            <Repeat className="h-3 w-3 text-indigo-400 shrink-0" />
            <span className="text-[8px] uppercase tracking-wider text-muted-foreground font-medium">
              Recurring · {budget.committed_items.length} item{budget.committed_items.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="h-px bg-border/50" />

          {/* Item rows */}
          <div className="space-y-1.5">
            {budget.committed_items.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-2">

                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      "text-xs truncate",
                      item.is_projected
                        ? "text-muted-foreground italic"
                        : "text-foreground/80",
                    )}
                  >
                    {item.description}
                  </span>
                  {item.recurrence_period && (
                    <span className="shrink-0 text-[8px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-1 rounded capitalize">
                      {item.recurrence_period}
                    </span>
                  )}
                  {item.is_projected && (
                    <span className="shrink-0 text-[8px] text-muted-foreground/60 bg-muted/50 px-1 rounded">
                      projected
                    </span>
                  )}
                </div>

                <span
                  className={cn(
                    "shrink-0 text-xs font-mono",
                    item.is_projected ? "text-muted-foreground" : "text-indigo-400",
                  )}
                >
                  {formatCurrency(item.amount)}
                </span>

              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint check**

Run from `frontend/`:
```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 3: Build check**

Run from `frontend/`:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors in budget-card.tsx.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/budgets/budget-card.tsx
git commit -m "feat(budgets): rewrite BudgetCard with left-border accent, stacked bar, committed block"
```

---

## Task 3: BudgetThresholdAlerts — Single Slim Banner

**Files:**
- Modify: `frontend/src/components/budgets/budget-threshold-alerts.tsx`

**What this does:** Collapses multiple individual alert rows into one slim banner showing the worst-offending budget inline. If there are more alerts, appends "+N more".

- [ ] **Step 1: Replace the file with the updated implementation**

```tsx
"use client";

import { BudgetSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetThresholdAlertsProps {
  budgets: BudgetSummary[];
}

// Returns an alert level for budgets that need attention (same thresholds as before).
function getAlertLevel(b: BudgetSummary): "critical" | "warning" | "heads-up" | null {
  if (b.utilisation_pct >= 95) return "critical";
  if (b.utilisation_pct >= 75) return "warning";
  if (b.utilisation_pct >= 50) return "heads-up";
  return null;
}

export function BudgetThresholdAlerts({ budgets }: BudgetThresholdAlertsProps) {
  const alerts = budgets
    .filter(b => getAlertLevel(b) !== null)
    .sort((a, b) => b.utilisation_pct - a.utilisation_pct);

  if (alerts.length === 0) return null;

  const worst = alerts[0];
  const moreCount = alerts.length - 1;

  // Build the inline message for the worst offender.
  const name = worst.name ?? worst.category_name;
  const spent = formatCurrency(worst.committed_spend + worst.variable_spend);
  const limit = formatCurrency(worst.effective_limit);
  const message = worst.headroom < 0
    ? `${name} is over budget by ${formatCurrency(Math.abs(worst.headroom))} — ${spent} spent of ${limit} limit`
    : `${name} at ${worst.utilisation_pct.toFixed(0)}% — ${spent} spent of ${limit} limit`;

  return (
    <div className="rounded-xl bg-red-950/20 border border-red-500/30 px-4 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-red-400 shrink-0 text-sm">⚠</span>
        <span className="text-xs text-red-400 truncate">{message}</span>
      </div>
      {moreCount > 0 && (
        <span className="shrink-0 text-[10px] text-red-400/70">+{moreCount} more</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint check**

Run from `frontend/`:
```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 3: Build check**

Run from `frontend/`:
```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/budgets/budget-threshold-alerts.tsx
git commit -m "feat(budgets): update BudgetThresholdAlerts to single slim banner"
```

---

## Task 4: BudgetsList — Section Header Count + Empty State Panel

**Files:**
- Modify: `frontend/src/components/budgets/budgets-list.tsx`

**What this does:** Two small changes to the non-loading, non-empty render:
1. Section header text: `Monthly Budgets` → `Monthly Budgets · N active`
2. Empty state: replaces the plain text border-box with a centred panel (PiggyBank icon, heading, body, CTA button)

- [ ] **Step 1: Apply the two targeted changes**

**Change 1** — Section header (line ~52 in the current file):

```tsx
// OLD:
<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
  Monthly Budgets
</h2>

// NEW:
<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
  Monthly Budgets · {budgets.length} active
</h2>
```

**Change 2** — Empty state (the `budgets.length === 0` branch, ~lines 60-62):

```tsx
// OLD:
<div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
  No budgets set up yet. Create your first budget to start tracking spending.
</div>

// NEW:
<div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-border/50 bg-card/30">
  <PiggyBank className="h-10 w-10 text-muted-foreground/40" />
  <div className="text-center space-y-1">
    <h3 className="font-semibold text-foreground">No budgets yet</h3>
    <p className="text-sm text-muted-foreground">
      Create your first budget to start tracking spending limits.
    </p>
  </div>
  <Button
    size="sm"
    className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
    onClick={() => { setEditingBudget(null); setCreateOpen(true); }}
  >
    <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
  </Button>
</div>
```

**Change 3** — Add `PiggyBank` to the existing Lucide import at the top of the file:

```tsx
// OLD:
import { Plus } from "lucide-react";

// NEW:
import { Plus, PiggyBank } from "lucide-react";
```

The complete updated file after all three changes:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, PiggyBank } from "lucide-react";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetCreateModal } from "@/components/budgets/budget-create-modal";
import { BudgetOverrideModal } from "@/components/budgets/budget-override-modal";
import { useDeleteBudget } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";

interface BudgetsListProps {
  budgets: BudgetSummary[];
  isLoading: boolean;
  period: string;
  onCreateWithCategory?: (categoryId: string) => void;
}

export function BudgetsList({ budgets, isLoading, period }: BudgetsListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetSummary | null>(null);
  const [overrideBudget, setOverrideBudget] = useState<BudgetSummary | null>(null);
  const deleteBudget = useDeleteBudget();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this budget and all its overrides?")) return;
    try {
      await deleteBudget.mutateAsync(id);
      toast.success("Budget deleted");
    } catch { toast.error("Failed to delete budget"); }
  };

  const handleEdit = (budget: BudgetSummary) => {
    setEditingBudget(budget);
    setCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Monthly Budgets · {budgets.length} active
        </h2>
        <Button size="sm" onClick={() => { setEditingBudget(null); setCreateOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
        </Button>
      </div>

      {/* Empty state */}
      {budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-border/50 bg-card/30">
          <PiggyBank className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-center space-y-1">
            <h3 className="font-semibold text-foreground">No budgets yet</h3>
            <p className="text-sm text-muted-foreground">
              Create your first budget to start tracking spending limits.
            </p>
          </div>
          <Button
            size="sm"
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => { setEditingBudget(null); setCreateOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {budgets.map(b => (
            <BudgetCard
              key={b.id}
              budget={b}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOverride={(b) => setOverrideBudget(b)}
            />
          ))}
        </div>
      )}

      <BudgetCreateModal
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setEditingBudget(null); }}
        editingBudget={editingBudget}
      />
      <BudgetOverrideModal
        isOpen={!!overrideBudget}
        onClose={() => setOverrideBudget(null)}
        budget={overrideBudget}
        period={period}
      />
    </>
  );
}
```

- [ ] **Step 2: Lint check**

Run from `frontend/`:
```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 3: Build check**

Run from `frontend/`:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/budgets/budgets-list.tsx
git commit -m "feat(budgets): update BudgetsList section header and empty state panel"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Summary Card: ring chart (committed indigo + variable health-colour arcs, 12 o'clock start, centre %, "used", "N over") ✓ Task 1
- [x] Summary Card: 2×2 stat grid with correct label/colour mapping ✓ Task 1
- [x] Summary Card loading skeleton matches new layout ✓ Task 1
- [x] Budget Card: plain div, left `border-l-[3px]` in health colour ✓ Task 2
- [x] Budget Card: `border-t border-t-red-500/20` on over-budget ✓ Task 2
- [x] Budget Card: header with name, Override badge, spent amount, headroom badge, 3 always-visible action buttons ✓ Task 2
- [x] Budget Card: Replace icon for override, Edit2 for edit, Trash2 for delete ✓ Task 2
- [x] Budget Card: stacked bar — indigo committed + health variable; gradient fill when over ✓ Task 2
- [x] Budget Card: legend row with opacity-40 for zero-value dots ✓ Task 2
- [x] Budget Card: committed items block (Repeat icon, period badges, projected italic/muted) ✓ Task 2
- [x] Budget Card: `getUtilisationBorderColor` added ✓ Task 2
- [x] Threshold Alerts: single slim red banner, worst offender inline, +N more count ✓ Task 3
- [x] BudgetsList: "Monthly Budgets · N active" section header ✓ Task 4
- [x] BudgetsList: PiggyBank empty state with CTA ✓ Task 4
- [x] No changes to page.tsx, modals, hooks, types, or API ✓ (not in plan)

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:** `BudgetSummary` fields used (`committed_spend`, `variable_spend`, `headroom`, `utilisation_pct`, `committed_items`, `effective_limit`, `has_override`, `name`, `category_name`) are all verified against `src/lib/types/index.ts`. `CommittedItem` fields (`description`, `amount`, `recurrence_period`, `is_projected`) all verified.
