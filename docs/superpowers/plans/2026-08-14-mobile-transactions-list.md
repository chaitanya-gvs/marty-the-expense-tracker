# Mobile Transactions List (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the mobile Transactions page's list, header/stats, filter row, and selection model to a "dense ledger" visual style, and make the transaction details drawer editable and action-complete for the first time (it is currently read-only with no entry point to any of the app's per-transaction actions).

**Architecture:** Two new generic UI pieces (`ActionTileGrid` for the action-tile layout, `TransactionQuickActionsPanel` for the long-press context menu) plus two new hooks (`useCategoryColorMap`, `useLongPress`) are composed into the existing `TransactionCardList`/`TransactionDetailsDrawer`/`transactions-page.tsx`/`transaction-filters.tsx` components. `TransactionCardList` becomes the single owner of which per-transaction sub-modal (Split, Group, Recurring, Email Links, PDF, Delete) is open, driven by an `onAction` callback both the drawer and the panel call — this avoids duplicating modal-wiring code in two places, since a row is either tapped (drawer) or long-pressed (panel), never both at once.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, TanStack Query, Radix UI (`Sheet`), Lucide React icons, `cn()` from `@/lib/utils`.

## Global Constraints

- No new design tokens — reuse existing CSS custom properties in `frontend/src/app/globals.css` (`--card`, `--primary`, `--muted`, `--muted-foreground`, `--border`) via existing Tailwind classes (`bg-card`, `bg-primary`, `bg-muted`, `text-muted-foreground`, `border-border`). Never hardcode hex values in component code.
- All action icons are `lucide-react` imports matching the exact icon desktop's `transaction-columns.tsx` already uses per action (see Task 9's table) — never emoji, never invented glyphs.
- Every mobile-only change must be gated by `useIsMobile()` (from `frontend/src/hooks/use-is-mobile.ts`) or a `md:` Tailwind prefix so desktop behavior is provably unchanged — confirmed in Task 14.
- No backend/API changes. Every mutation used here (`useUpdateTransaction`, `useUpdateTransactionSplit`, `useClearTransactionSplit`, `useDeleteTransaction`, `useBulkDeleteTransactions`) already exists in `frontend/src/hooks/use-transactions.ts`.
- This repo has no frontend test runner (`frontend/package.json` has no `test` script, no Jest/Vitest/RTL dependency). Verification is `npm run type-check`, `npm run lint`, and manual browser checks at 375px via the browser-preview workflow — not automated unit tests. Every task's "write the failing test" step is replaced with a manual-verification step describing exactly what to check in the browser.

---

## File Structure

**New files:**
- `frontend/src/hooks/use-category-color-map.ts` — category name → color lookup
- `frontend/src/hooks/use-long-press.ts` — reusable long-press gesture hook (Pointer Events)
- `frontend/src/components/transactions/action-tile-grid.tsx` — generic action-tile grid + isolated delete row, and the shared `TransactionActionType` union type
- `frontend/src/components/transactions/transaction-quick-actions-panel.tsx` — the long-press panel

**Modified files:**
- `frontend/src/lib/format-utils.ts` — add `formatCurrencyCompact()`
- `frontend/src/components/transactions/transaction-card-list.tsx` — dense-ledger rows, long-press wiring, owns all per-transaction sub-modal state
- `frontend/src/components/transactions/transactions-page.tsx` — icon-only Import/Add on mobile, one-line stat bar on mobile
- `frontend/src/components/transactions/transaction-filters.tsx` — icon+badge+scrollable-chips trigger row on mobile
- `frontend/src/components/transactions/transaction-details-drawer.tsx` — view/edit toggle, action grid, bottom-sheet on mobile

---

### Task 1: `formatCurrencyCompact` utility

**Files:**
- Modify: `frontend/src/lib/format-utils.ts`

**Interfaces:**
- Produces: `formatCurrencyCompact(amount: number | null | undefined): string` — used by Task 6.

- [ ] **Step 1: Add the function**

Add this to `frontend/src/lib/format-utils.ts`, after the existing `formatCurrency` function (after line 26):

```typescript
/**
 * Compact Indian-numbering currency format for tight spaces (e.g. mobile stat bars).
 * ₹999 stays as-is; ₹1,000–₹99,999 → ₹1.2K; ₹1,00,000+ → ₹6.9L; ₹1,00,00,000+ → ₹2.3Cr.
 * SSR-safe: no locale APIs, pure arithmetic + string formatting.
 */
export function formatCurrencyCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '₹0';

  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs < 1000) {
    return `${sign}₹${Math.round(abs)}`;
  }
  if (abs < 100000) {
    // thousands: 1.2K
    const val = abs / 1000;
    return `${sign}₹${trimTrailingZero(val)}K`;
  }
  if (abs < 10000000) {
    // lakhs: 6.9L
    const val = abs / 100000;
    return `${sign}₹${trimTrailingZero(val)}L`;
  }
  // crores: 2.3Cr
  const val = abs / 10000000;
  return `${sign}₹${trimTrailingZero(val)}Cr`;
}

function trimTrailingZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run type-check`
Expected: no errors.

Then temporarily add `console.log(formatCurrencyCompact(690105.49))` to any client component that already renders (e.g. top of `TransactionsPage`'s function body), reload the dev server preview, check the browser console shows `₹6.9L`. Also check `formatCurrencyCompact(279)` → `₹279`, `formatCurrencyCompact(-182829.14)` → `-₹1.8L`. Remove the `console.log` before committing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/format-utils.ts
git commit -m "feat(format): add formatCurrencyCompact for mobile stat bar"
```

---

### Task 2: `useCategoryColorMap` hook

**Files:**
- Create: `frontend/src/hooks/use-category-color-map.ts`

**Interfaces:**
- Consumes: `useCategories()` from `frontend/src/hooks/use-categories.ts` (existing, returns `Category[]` via `select`).
- Produces: `useCategoryColorMap(): Record<string, string | undefined>` — used by Task 5 (card list dots) and Task 9 (drawer category chip).

- [ ] **Step 1: Write the hook**

```typescript
"use client";

import { useMemo } from "react";
import { useCategories } from "./use-categories";

/**
 * Maps category name -> its configured color (Category.color, set in Settings).
 * Transaction.category is a plain name string, not a joined object, so this
 * hook does the client-side join. Falls back to undefined for uncategorized
 * or unknown category names (callers should render a neutral default dot).
 */
export function useCategoryColorMap(): Record<string, string | undefined> {
  const { data: categories = [] } = useCategories();

  return useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const category of categories) {
      map[category.name] = category.color;
    }
    return map;
  }, [categories]);
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run type-check`
Expected: no errors (this hook has no consumers yet, so it just needs to compile standalone).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-category-color-map.ts
git commit -m "feat(hooks): add useCategoryColorMap for category-name-to-color lookup"
```

---

### Task 3: `useLongPress` hook

**Files:**
- Create: `frontend/src/hooks/use-long-press.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface UseLongPressOptions {
    onLongPress: () => void;
    onClick?: () => void;
    delay?: number;        // ms, default 500
    moveThreshold?: number; // px, default 10
  }
  interface LongPressHandlers {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
  }
  function useLongPress(options: UseLongPressOptions): LongPressHandlers
  ```
  Used by Task 11 (`TransactionCardList` row touch handling).

- [ ] **Step 1: Write the hook**

```typescript
"use client";

import { useCallback, useRef } from "react";

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  delay?: number;
  moveThreshold?: number;
}

interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Pointer-Events-based long-press detection with a movement threshold, so a
 * vertical scroll gesture starting on a row cancels the long-press instead of
 * firing it (see 2026-08-14-mobile-transactions-list-design.md's "Gesture
 * note" — this is what keeps long-press from fighting the list's scroll).
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 500,
  moveThreshold = 10,
}: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedLongPress = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button / primary touch contact
      if (e.button !== undefined && e.button !== 0) return;
      firedLongPress.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedLongPress.current = true;
        onLongPress();
      }, delay);
    },
    [delay, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPos.current) return;
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      if (dx > moveThreshold || dy > moveThreshold) {
        clear();
      }
    },
    [moveThreshold, clear]
  );

  const onPointerUp = useCallback(() => {
    const wasLongPress = firedLongPress.current;
    clear();
    if (!wasLongPress) {
      onClick?.();
    }
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Suppress the native browser context menu on long-press (desktop right-click
    // emulation / some Android browsers fire this on touch-and-hold).
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerUp, onPointerMove, onPointerLeave, onContextMenu };
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run type-check`
Expected: no errors (standalone, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-long-press.ts
git commit -m "feat(hooks): add useLongPress gesture hook with scroll-cancel threshold"
```

---

### Task 4: `ActionTileGrid` component

**Files:**
- Create: `frontend/src/components/transactions/action-tile-grid.tsx`

**Interfaces:**
- Produces:
  ```typescript
  export type TransactionActionType =
    | "shared" | "split" | "group" | "recurring"
    | "links" | "flag" | "direction" | "pdf" | "delete";

  export interface ActionTile {
    key: TransactionActionType;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
  }

  interface ActionTileGridProps {
    tiles: ActionTile[];
    onDelete?: () => void;
    deleteLabel?: string;
  }
  export function ActionTileGrid(props: ActionTileGridProps): JSX.Element
  ```
  Used by Task 9 (`TransactionDetailsDrawer`) and Task 10 (`TransactionQuickActionsPanel`).

- [ ] **Step 1: Write the component**

```typescript
"use client";

import type { LucideIcon } from "lucide-react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TransactionActionType =
  | "shared"
  | "split"
  | "group"
  | "recurring"
  | "links"
  | "flag"
  | "direction"
  | "pdf"
  | "delete";

export interface ActionTile {
  key: TransactionActionType;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;   // visually highlight (e.g. flag currently set)
  disabled?: boolean; // reduced opacity, non-interactive (e.g. no source PDF) — the
                       // tile still occupies its grid slot so the layout stays a
                       // clean 4-column rectangle regardless of per-transaction state
}

interface ActionTileGridProps {
  tiles: ActionTile[];
  onDelete?: () => void;
  deleteLabel?: string;
  className?: string;
}

/**
 * 4-column icon-tile grid used by both the Transaction Details Drawer's
 * view mode and the long-press quick-actions panel. Each caller passes its
 * own tile list (the two surfaces intentionally have different action sets
 * per 2026-08-14-mobile-transactions-list-design.md) — this component only
 * owns the grid layout and the isolated Delete row.
 */
export function ActionTileGrid({ tiles, onDelete, deleteLabel = "Delete transaction", className }: ActionTileGridProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            disabled={tile.disabled}
            onClick={tile.disabled ? undefined : tile.onClick}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg py-2.5 px-1 transition-colors",
              tile.disabled
                ? "bg-muted/50 text-muted-foreground/40 opacity-50 cursor-not-allowed"
                : tile.active
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <tile.icon className="h-[17px] w-[17px]" />
            <span className="text-[9px] font-semibold text-center leading-tight">{tile.label}</span>
          </button>
        ))}
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12.5px] font-semibold text-destructive bg-destructive/[0.08] hover:bg-destructive/[0.14] transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          {deleteLabel}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run type-check`
Expected: no errors (standalone component, no consumers yet — `Trash2` import used, confirms lucide-react resolves).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/action-tile-grid.tsx
git commit -m "feat(transactions): add ActionTileGrid shared component"
```

---

### Task 5: Dense-ledger row redesign (`TransactionCardList`, visual only)

This task only restyles the row markup and wires in category color — it does **not** change the tap/select interaction (that's Task 11), so `handleCardTap` and the existing `onClick={() => handleCardTap(t)}` stay exactly as they are today.

**Files:**
- Modify: `frontend/src/components/transactions/transaction-card-list.tsx`

**Interfaces:**
- Consumes: `useCategoryColorMap()` from Task 2.

- [ ] **Step 1: Add the import and hook call**

In `frontend/src/components/transactions/transaction-card-list.tsx`, add after line 11 (`import { cn } from "@/lib/utils";`):

```typescript
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
```

Inside `TransactionCardList`, after line 23 (`const bulkDeleteTransactions = useBulkDeleteTransactions();`), add:

```typescript
  const categoryColorMap = useCategoryColorMap();
```

- [ ] **Step 2: Replace the row markup**

Replace lines 136–160 (the `{group.rows.map((t) => (...))}` block) with:

```typescript
              {group.rows.map((t) => {
                const dotColor = categoryColorMap[t.category] ?? "var(--muted-foreground)";
                const amount = t.is_shared && t.split_share_amount ? t.split_share_amount : t.amount;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleCardTap(t)}
                    className={cn(
                      "w-full flex items-center gap-2.5 py-2.5 px-1 text-left border-b border-border last:border-b-0 transition-colors min-h-11",
                      selectedIds.has(t.id) && "bg-primary/[0.06]"
                    )}
                  >
                    {selectMode && (
                      <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleSelected(t.id)} onClick={(e) => e.stopPropagation()} />
                    )}
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: dotColor }}
                    />
                    <p className="flex-1 min-w-0 text-[12.5px] font-medium text-foreground truncate">
                      {t.description}
                    </p>
                    <div className="text-right shrink-0">
                      <p className={cn(
                        "font-mono text-[12.5px] font-semibold tabular-nums",
                        t.direction === "credit" ? "text-emerald-500" : "text-foreground"
                      )}>
                        {t.direction === "credit" ? "+" : "−"}{formatCurrency(amount)}
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate max-w-[110px]">
                        {t.category}{t.is_shared ? " · Split" : ""}
                      </p>
                    </div>
                  </button>
                );
              })}
```

This drops the old per-row `rounded-lg border border-border bg-card` card chrome in favor of a flat row with a bottom divider (`border-b border-border last:border-b-0`), matches the design spec's "Dense Ledger" style: leading category-color dot, single-line description, amount+category stacked right-aligned. `min-h-11` (44px) meets the touch-target minimum.

- [ ] **Step 3: Manual verification**

1. Ensure the dev server is running (`npm run dev` from `frontend/`, or reuse the existing one — don't restart per repo convention).
2. Open the browser preview at 375px width, navigate to `/transactions`, log in if needed.
3. Confirm: rows are flat (no individual card borders/backgrounds), a thin divider line separates each row, each row has a small colored dot on the left, description truncates on one line, amount+category stack on the right.
4. Confirm category dot colors match what's configured in Settings → Categories for a few known categories (spot-check 2-3).
5. Confirm tapping a row still opens the details drawer (existing `handleCardTap` behavior, unchanged).
6. Reload at desktop width (≥768px) — confirm `TransactionsTable` (not this component) still renders, zero change.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "feat(transactions): redesign mobile card list to dense-ledger row style"
```

---

### Task 6: Header + one-line stat bar (`transactions-page.tsx`)

**Files:**
- Modify: `frontend/src/components/transactions/transactions-page.tsx`

**Interfaces:**
- Consumes: `formatCurrencyCompact` from Task 1, `useIsMobile` from `frontend/src/hooks/use-is-mobile.ts` (already imported in this file at line 23).

- [ ] **Step 1: Import the compact formatter**

In `frontend/src/components/transactions/transactions-page.tsx`, change line 30:

```typescript
import { formatCurrency } from "@/lib/format-utils";
```

to:

```typescript
import { formatCurrency, formatCurrencyCompact } from "@/lib/format-utils";
```

- [ ] **Step 2: Icon-only Import/Add buttons on mobile**

Replace lines 170–188 (the header button group) with:

```typescript
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-8 w-8 md:w-auto p-0 md:px-3"
            onClick={() => setIsWorkflowOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Import</span>
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs h-8 w-8 md:w-auto p-0 md:px-3 bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent shadow-[0_0_12px_color-mix(in_oklch,var(--color-primary)_35%,transparent)] hover:shadow-[0_0_20px_color-mix(in_oklch,var(--color-primary)_50%,transparent)] transition-shadow duration-200"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Add</span>
          </Button>
        </div>
```

This keeps desktop's full-text buttons (`md:inline`, `md:px-3`, `md:w-auto`) exactly as they render today, and collapses to icon-only square buttons below `md`.

- [ ] **Step 3: One-line mobile stat bar**

Replace the entire Stats Bar block, lines 191–241 (`{/* Stats Bar */}` through the closing `</motion.div>` of that section), with:

```typescript
      {/* Stats Bar */}
      <motion.div variants={_itemVariants}>
        {/* Mobile: single-line summary with compact numbers */}
        <div className="md:hidden flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="text-center">
            <p className="text-[8.5px] font-medium text-muted-foreground/70 uppercase tracking-wide">Spent</p>
            <p className="font-mono text-[12.5px] font-semibold text-foreground tabular-nums">
              {formatCurrencyCompact(totalDebits)}
            </p>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="text-center">
            <p className="text-[8.5px] font-medium text-muted-foreground/70 uppercase tracking-wide">In</p>
            <p className="font-mono text-[12.5px] font-semibold text-emerald-500 tabular-nums">
              {formatCurrencyCompact(totalCredits)}
            </p>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="text-center">
            <p className="text-[8.5px] font-medium text-muted-foreground/70 uppercase tracking-wide">Net</p>
            <p className={`font-mono text-[12.5px] font-semibold tabular-nums ${net >= 0 ? "text-emerald-500" : "text-destructive"}`}>
              {net >= 0 ? "+" : "−"}{formatCurrencyCompact(Math.abs(net))}
            </p>
          </div>
          <div className="h-5 w-px bg-border" />
          <div className="text-center">
            <p className="text-[8.5px] font-medium text-muted-foreground/70 uppercase tracking-wide">Count</p>
            <p className="font-mono text-[12.5px] font-semibold text-foreground tabular-nums">{count}</p>
          </div>
        </div>

        {/* Desktop: existing 4-card grid, unchanged */}
        <div className="hidden md:grid grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px shadow-[0_1px_8px_oklch(0%_0_0_/_0.08)] dark:shadow-[0_1px_16px_oklch(0%_0_0_/_0.4)]">
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
        </div>
      </motion.div>
```

Note: the original grid was `grid-cols-1 sm:grid-cols-4` (a single stacked column below `sm`, 4 columns at/above it). This replaces that with two fully separate blocks gated by `md:hidden` / `hidden md:grid` — the mobile one-line bar, and the desktop 4-card grid pixel-identical to before. This is deliberately two render paths rather than one grid with responsive classes, because the mobile version uses different data formatting (compact) and structure (dividers, not cards) — trying to force both into one shared markup would fight itself.

- [ ] **Step 2: Manual verification**

1. Browser preview at 375px, `/transactions`.
2. Confirm the stat bar is a single row, ~44px tall, showing 4 segments separated by thin vertical dividers, with compact numbers (e.g. `₹6.9L` not `₹6,90,105.49`).
3. Confirm Import/Add buttons render as icon-only squares.
4. Tap Import → workflow sheet opens (unchanged behavior). Tap Add → add-transaction modal opens (unchanged behavior).
5. Reload at desktop width (≥768px): confirm the 4-card grid and full-text Import/Add buttons render exactly as before this change (compare against `git stash` if in doubt).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/transactions-page.tsx
git commit -m "feat(transactions): compact mobile header and one-line stat bar"
```

---

### Task 7: Filter row mobile redesign (`transaction-filters.tsx`)

**Files:**
- Modify: `frontend/src/components/transactions/transaction-filters.tsx`

- [ ] **Step 1: Add `Filter` icon import**

Change line 12 from:

```typescript
import { Calendar, Search, X, RotateCcw, Check, ChevronDown, ChevronUp, AlertTriangle, ChevronsUpDown, Plus } from "lucide-react";
```

to:

```typescript
import { Calendar, Search, X, RotateCcw, Check, ChevronDown, ChevronUp, AlertTriangle, ChevronsUpDown, Plus, Filter } from "lucide-react";
```

- [ ] **Step 2: Split the collapsed bar into mobile and desktop variants**

Replace lines 1293–1341 (the `{/* Collapsed Bar (Always Visible) */}` div through its closing `</div>`) with:

```typescript
      <div className="sticky top-0 z-20 bg-card backdrop-blur px-4 py-2 flex items-center gap-2 text-sm">
        {isMobile ? (
          <>
            <button
              ref={filtersButtonRef}
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls="transaction-filter-panel"
              className="relative shrink-0 rounded-full bg-muted hover:bg-primary/10 hover:text-primary h-8 w-8 flex items-center justify-center transition-colors"
            >
              <Filter className="h-3.5 w-3.5" />
              {activeFilterBadges.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {activeFilterBadges.length}
                </span>
              )}
            </button>

            {activeFilterBadges.length > 0 && (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
                {activeFilterBadges.map((badge) => (
                  <button
                    key={badge.key}
                    onClick={() => expandAndFocusControl(badge.key)}
                    className="shrink-0 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 text-[11px] font-medium flex items-center gap-1"
                  >
                    {badge.label}
                    <X
                      className="h-3 w-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFilter(badge.key as keyof TransactionFilters);
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              ref={filtersButtonRef}
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls="transaction-filter-panel"
              className="rounded-full bg-muted hover:bg-primary/10 hover:text-primary px-3 py-1 text-foreground flex items-center gap-1 transition-colors"
            >
              Filters
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            <div className="flex flex-wrap gap-2 items-center">
              {activeFilterBadges.length === 0 ? (
                <span className="text-xs text-muted-foreground/40 italic">All transactions shown</span>
              ) : (
                activeFilterBadges.map((badge) => (
                  <button
                    key={badge.key}
                    onClick={() => expandAndFocusControl(badge.key)}
                    className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1 hover:bg-primary/20 hover:border-primary/40 transition-all duration-150"
                  >
                    {badge.label}
                    <X
                      className="h-3 w-3 hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFilter(badge.key as keyof TransactionFilters);
                      }}
                    />
                  </button>
                ))
              )}
            </div>

            {hasActiveFilters && (
              <div className="ml-auto flex items-center">
                <button
                  onClick={onClearFilters}
                  className="rounded-md px-2 py-1 text-xs bg-muted hover:bg-accent text-foreground transition-colors flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              </div>
            )}
          </>
        )}
      </div>
```

This is a straight `isMobile ? mobile-jsx : desktop-jsx` split — the `else` branch is byte-for-byte the previous markup, so desktop is provably unchanged. The mobile branch replaces the text "Filters" button with an icon-only button carrying a count badge (hidden when `activeFilterBadges.length === 0`, so an empty-filters state is just the bare icon button, no wasted row), and chips scroll horizontally (`overflow-x-auto`) instead of wrapping.

- [ ] **Step 3: Manual verification**

1. Browser preview at 375px, `/transactions`, with default filters (Last Month date range active — so at least 1 badge shows).
2. Confirm the filter row shows a circular icon button with a small badge showing the count, and the date chip next to it.
3. Clear all filters (via the sheet's own clear-all control, or `handleClearFilters`) — confirm the row collapses to just the icon button, no empty row/wasted space.
4. Tap the icon button → the existing bottom sheet still opens (unchanged, only the trigger row changed).
5. Reload at desktop width (≥768px): confirm "Filters ⌄" text button, wrap-flowing chips, and "Clear filters" all render exactly as before.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/transactions/transaction-filters.tsx
git commit -m "feat(transactions): icon+badge filter trigger with scrollable chips on mobile"
```

---

### Task 8: `TransactionDetailsDrawer` — edit mode

**Files:**
- Modify: `frontend/src/components/transactions/transaction-details-drawer.tsx`

**Interfaces:**
- Consumes: `useUpdateTransaction` (`frontend/src/hooks/use-transactions.ts`), `useTags` (`frontend/src/hooks/use-tags.ts`), `CategorySelector` (`frontend/src/components/transactions/category-selector.tsx`, props `{ value?, onValueChange, placeholder?, className?, transactionDirection? }`), `MultiTagSelector` (`frontend/src/components/transactions/multi-tag-selector.tsx`, props `{ selectedTags: Tag[], onTagsChange, placeholder?, className? }`).
- Produces: drawer now has a `mode: "view" | "edit"` internal state; `TransactionDetailsDrawerProps` gains an optional `initialMode?: "view" | "edit"` (used by Task 12 so the quick-actions panel's "Edit" tile can jump straight into edit mode).

- [ ] **Step 1: Replace the whole file**

The current file is fully read-only (167 lines). This step replaces it wholesale with a version that adds a view/edit toggle. The action grid (Task 9) is added in the next task on top of this — this step only adds editing.

Write `frontend/src/components/transactions/transaction-details-drawer.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Transaction, Tag } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Layers, ChevronDown, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { useTags } from "@/hooks/use-tags";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
    initialMode?: "view" | "edit";
}

interface EditFormState {
    description: string;
    category: string;
    notes: string;
    date: string;
    account: string;
    direction: "debit" | "credit";
    amount: number;
    split_share_amount: number;
    is_shared: boolean;
    is_refund: boolean;
    is_transfer: boolean;
}

function toFormState(t: Transaction): EditFormState {
    return {
        description: t.description,
        category: t.category,
        notes: t.notes ?? "",
        date: t.date,
        account: t.account,
        direction: t.direction,
        amount: t.amount,
        split_share_amount: t.split_share_amount,
        is_shared: t.is_shared,
        is_refund: t.is_refund,
        is_transfer: t.is_transfer,
    };
}

export function TransactionDetailsDrawer({
    transaction,
    isOpen,
    onClose,
    onUngroupExpense,
    initialMode = "view",
}: TransactionDetailsDrawerProps) {
    const isMobile = useIsMobile();
    const categoryColorMap = useCategoryColorMap();
    const updateTransaction = useUpdateTransaction();
    const { data: allTags = [] } = useTags();

    const [mode, setMode] = useState<"view" | "edit">(initialMode);
    const [form, setForm] = useState<EditFormState | null>(null);
    const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // Reset local edit state whenever a different transaction is opened, or
    // the drawer is asked to open directly into edit mode (from the
    // quick-actions panel's Edit tile).
    useEffect(() => {
        if (!transaction) return;
        setMode(isOpen ? initialMode : "view");
        setForm(toFormState(transaction));
        const tagObjects = (transaction.tags || [])
            .map((name) => allTags.find((tag) => tag.name === name))
            .filter((tag): tag is Tag => tag !== undefined);
        setSelectedTags(tagObjects);
        setAdvancedOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transaction?.id, isOpen, initialMode]);

    if (!transaction || !form) return null;

    const categoryColor = categoryColorMap[transaction.category];

    const handleSave = async () => {
        try {
            await updateTransaction.mutateAsync({
                id: transaction.id,
                updates: {
                    description: form.description,
                    category: form.category,
                    notes: form.notes || undefined,
                    date: form.date,
                    account: form.account,
                    direction: form.direction,
                    amount: form.amount,
                    split_share_amount: form.split_share_amount,
                    is_shared: form.is_shared,
                    is_refund: form.is_refund,
                    is_transfer: form.is_transfer,
                    tags: selectedTags.map((t) => t.name),
                },
            });
            toast.success("Transaction updated");
            setMode("view");
        } catch {
            toast.error("Failed to update transaction");
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent
                side={isMobile ? "bottom" : "right"}
                className={cn(
                    "w-full sm:w-[540px] overflow-y-auto",
                    isMobile && "max-h-[90vh] rounded-t-xl"
                )}
            >
                {isMobile && (
                    <div className="w-9 h-1 rounded-full bg-border mx-auto mb-3" />
                )}
                <SheetHeader>
                    <SheetTitle>{mode === "edit" ? "Edit Transaction" : "Transaction Details"}</SheetTitle>
                    <SheetDescription>
                        {mode === "edit"
                            ? "Update this transaction's details."
                            : "View detailed information about this transaction."}
                    </SheetDescription>
                </SheetHeader>

                {mode === "view" ? (
                    <div className="mt-6 space-y-6">
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold">{transaction.description}</h2>
                            <div className="flex items-center gap-2">
                                <span className={`text-xl font-semibold ${transaction.direction === 'debit' ? 'text-destructive' : 'text-emerald-500'
                                    }`}>
                                    {transaction.direction === 'debit' ? '-' : '+'}{formatCurrency(transaction.amount)}
                                </span>
                                <Badge variant="outline">{transaction.account}</Badge>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: categoryColor ?? "var(--muted-foreground)" }}
                                />
                                <span className="text-sm text-muted-foreground">{transaction.category || "Uncategorized"}</span>
                            </div>
                        </div>

                        <Separator />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Date</p>
                                <p>{formatDate(transaction.date)}</p>
                            </div>
                            {transaction.subcategory && (
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Subcategory</p>
                                    <p>{transaction.subcategory}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Status</p>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                    {transaction.is_flagged && <Badge variant="destructive">Flagged</Badge>}
                                    {transaction.is_shared && <Badge variant="secondary">Shared</Badge>}
                                    {transaction.is_split && <Badge variant="secondary">Split</Badge>}
                                    {transaction.is_grouped_expense && (
                                        <Badge variant="outline" className="bg-primary/10 border-primary/30">
                                            <Layers className="h-3 w-3 mr-1" />
                                            Grouped
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>

                        {transaction.tags && transaction.tags.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground mb-2">Tags</h3>
                                <div className="flex flex-wrap gap-2">
                                    {transaction.tags.map(tag => (
                                        <Badge key={tag} variant="secondary">{tag}</Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Separator />

                        <Button className="w-full" onClick={() => setMode("edit")}>
                            Edit
                        </Button>

                        {transaction.is_grouped_expense && (
                            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4">
                                <div className="flex items-start gap-2">
                                    <Layers className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-primary mb-1">
                                            Grouped Expense
                                        </h3>
                                        <p className="text-xs text-primary/80">
                                            This transaction represents multiple transactions combined into a single net amount.
                                            The amount shown is the algebraic sum of all credits (positive) and debits (negative)
                                            in the group.
                                        </p>
                                        {transaction.transaction_group_id && (
                                            <p className="text-xs text-primary/70 mt-2 font-mono">
                                                Group ID: {transaction.transaction_group_id.slice(0, 8)}...
                                            </p>
                                        )}

                                        {onUngroupExpense && (
                                            <button
                                                onClick={async () => {
                                                    await onUngroupExpense(transaction);
                                                    onClose();
                                                }}
                                                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/30 rounded-md hover:bg-destructive/15 transition-colors"
                                            >
                                                <Layers className="h-4 w-4" />
                                                Ungroup Expense
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {transaction.notes && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground mb-1">Notes</h3>
                                <p className="text-sm bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
                                    {transaction.notes}
                                </p>
                            </div>
                        )}

                        {process.env.NEXT_PUBLIC_APP_ENV === 'development' && (
                            <details className="mt-4">
                                <summary className="text-xs text-muted-foreground/40 cursor-pointer select-none">
                                    Raw data (dev only)
                                </summary>
                                <pre className="mt-2 bg-muted text-muted-foreground text-[10px] p-3 rounded-md overflow-x-auto leading-relaxed">
                                    {JSON.stringify(transaction, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                ) : (
                    <div className="mt-6 space-y-4">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Description</label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Category</label>
                            <CategorySelector
                                value={form.category}
                                onValueChange={(value) => setForm({ ...form, category: value })}
                                transactionDirection={form.direction}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Tags</label>
                            <MultiTagSelector selectedTags={selectedTags} onTagsChange={setSelectedTags} />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Notes</label>
                            <Textarea
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder="Add a note…"
                                rows={3}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => setAdvancedOpen(!advancedOpen)}
                            className="w-full flex items-center justify-between py-2.5 border-t border-border text-xs font-semibold text-muted-foreground"
                        >
                            <span>Advanced (date, account, amount, flags)</span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                        </button>

                        {advancedOpen && (
                            <div className="space-y-4 pt-1">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Date</label>
                                        <input
                                            type="date"
                                            value={form.date}
                                            onChange={(e) => setForm({ ...form, date: e.target.value })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Account</label>
                                        <input
                                            type="text"
                                            value={form.account}
                                            onChange={(e) => setForm({ ...form, account: e.target.value })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Direction</label>
                                        <select
                                            value={form.direction}
                                            onChange={(e) => setForm({ ...form, direction: e.target.value as "debit" | "credit" })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        >
                                            <option value="debit">Debit (money out)</option>
                                            <option value="credit">Credit (money in)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Amount</label>
                                        <input
                                            type="number"
                                            value={form.amount}
                                            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm({ ...form, is_shared: e.target.checked })} />
                                        Shared
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_refund} onChange={(e) => setForm({ ...form, is_refund: e.target.checked })} />
                                        Refund
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_transfer} onChange={(e) => setForm({ ...form, is_transfer: e.target.checked })} />
                                        Transfer
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setMode("view")} disabled={updateTransaction.isPending}>
                                Cancel
                            </Button>
                            <Button className="flex-1" onClick={handleSave} disabled={updateTransaction.isPending}>
                                {updateTransaction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                            </Button>
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
```

Note: `split_share_amount` and the recurring fields (`is_recurring`/`recurrence_period`) are intentionally **not** in this edit form — recurring is handled by its own dedicated `RecurringModal` action tile (Task 9/12), matching desktop's pattern where recurring has its own trigger, not a form field buried in the edit modal's flag section. `split_share_amount` is set via the Shared action's `SharedExpenseEditor`, not this form — including a bare numeric field for it here without the accompanying split-breakdown UI would let it drift out of sync with the actual split data.

- [ ] **Step 2: Manual verification**

1. Browser preview at 375px, `/transactions`, tap a row → drawer opens in view mode, bottom-sheet style with a grabber handle, existing fields all present and correct (compare against a transaction's known values).
2. Tap "Edit" → form appears in place (sheet stays open, no separate modal), Description/Category/Tags/Notes visible, "Advanced" collapsed.
3. Change the description, tap "Advanced" to expand it, confirm Date/Account/Direction/Amount/Shared/Refund/Transfer fields appear with current values pre-filled.
4. Tap Save → toast confirms update, drawer returns to view mode showing the new description.
5. Reopen the same transaction — confirm the description change persisted (re-fetch from server, not just local state).
6. Reload at desktop width: confirm `side="right"` (not bottom), no grabber handle — `isMobile` false means the original desktop drawer shape is preserved.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/transaction-details-drawer.tsx
git commit -m "feat(transactions): make details drawer editable with view/edit toggle"
```

---

### Task 9: `TransactionDetailsDrawer` — action grid + isolated Delete

Builds on Task 8's file. Adds the 8-tile action grid to view mode and wires the tiles' click handlers via a new `onAction` prop (the actual modal-opening logic lives in `TransactionCardList`, wired in Task 12 — this task only adds the grid UI and the prop it calls).

**Files:**
- Modify: `frontend/src/components/transactions/transaction-details-drawer.tsx`

**Interfaces:**
- Consumes: `ActionTileGrid`, `TransactionActionType` from Task 4.
- Produces: `TransactionDetailsDrawerProps` gains `onAction: (type: TransactionActionType, transaction: Transaction) => void` (required — Task 12 supplies it).

- [ ] **Step 1: Add imports**

Add to the top of `frontend/src/components/transactions/transaction-details-drawer.tsx`:

```typescript
import { Users, Split, RefreshCw, Mail, AlertTriangle, ArrowLeftRight, FileText } from "lucide-react";
import { ActionTileGrid, type TransactionActionType } from "./action-tile-grid";
```

- [ ] **Step 2: Add `onAction` to the props interface**

Change:

```typescript
interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
    initialMode?: "view" | "edit";
}
```

to:

```typescript
interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
    initialMode?: "view" | "edit";
    onAction: (type: TransactionActionType, transaction: Transaction) => void;
}
```

And add `onAction` to the destructured function parameters:

```typescript
export function TransactionDetailsDrawer({
    transaction,
    isOpen,
    onClose,
    onUngroupExpense,
    initialMode = "view",
    onAction,
}: TransactionDetailsDrawerProps) {
```

- [ ] **Step 3: Insert the action grid into view mode**

In the `mode === "view"` branch, immediately after the `<Button className="w-full" onClick={() => setMode("edit")}>Edit</Button>` block and before the `{transaction.is_grouped_expense && (...)}` block, insert:

```typescript
                        <ActionTileGrid
                            tiles={[
                                { key: "shared", label: "Shared", icon: Users, active: transaction.is_shared, onClick: () => onAction("shared", transaction) },
                                { key: "group", label: "Group", icon: Layers, active: !!transaction.transaction_group_id, onClick: () => onAction("group", transaction) },
                                { key: "split", label: "Split", icon: Split, active: transaction.is_split, onClick: () => onAction("split", transaction) },
                                { key: "recurring", label: "Recurring", icon: RefreshCw, active: transaction.is_recurring === true, onClick: () => onAction("recurring", transaction) },
                                { key: "links", label: "Links", icon: Mail, active: !!(transaction.related_mails && transaction.related_mails.length > 0), onClick: () => onAction("links", transaction) },
                                { key: "flag", label: "Flag", icon: AlertTriangle, active: transaction.is_flagged === true, onClick: () => onAction("flag", transaction) },
                                { key: "direction", label: "Swap ±", icon: ArrowLeftRight, onClick: () => onAction("direction", transaction) },
                                { key: "pdf", label: "PDF", icon: FileText, disabled: !transaction.source_file, onClick: () => onAction("pdf", transaction) },
                            ]}
                            onDelete={() => onAction("delete", transaction)}
                        />
```

The `PDF` tile is always present (keeping the grid a clean 4×2 rectangle, matching the mockup you approved) but renders `disabled` when `transaction.source_file` is absent — a dimmed, non-clickable tile rather than an omitted one, so the grid's shape never depends on which transaction you're viewing.

- [ ] **Step 4: Manual verification**

1. Browser preview at 375px, tap a row with `source_file` set (any statement-ingested transaction) → drawer view mode shows the 8-tile grid (Shared/Group/Split/Recurring/Links/Flag/Swap ±/PDF) plus the isolated red Delete row below, PDF tile fully interactive.
2. Tap a row with no `source_file` (e.g. a manually-added transaction) → confirm all 8 tiles still render (same rectangular grid, no gap), but the PDF tile is visibly dimmed and does nothing when tapped.
3. Confirm tiles for currently-true states (e.g. a flagged transaction's "Flag" tile, a shared transaction's "Shared" tile) render with the `active` highlight (indigo background/text) vs the default muted style.
4. Tapping any tile at this point calls `onAction` — since `TransactionCardList` doesn't supply real handling yet (Task 12), confirm in the browser console (via a temporary `console.log` in a throwaway `onAction={(t, tx) => console.log(t, tx.id)}` passed from `TransactionCardList` for this check only, removed before commit) that the correct action type and transaction id are received per tile tapped.
5. `npm run type-check` — expect no errors (note: at this point `TransactionCardList` does not yet pass `onAction`, so type-check will fail until Step 5 below temporarily or Task 11/12 supplies it — see next step).

- [ ] **Step 5: Temporary stub to keep the build green until Task 12**

`TransactionDetailsDrawer` now requires `onAction`, but `TransactionCardList` doesn't call it with real logic until Task 12. To keep `npm run type-check` passing between this task and Task 12, open `frontend/src/components/transactions/transaction-card-list.tsx` and add a no-op stub prop to its existing `<TransactionDetailsDrawer ... />` usage (around line 180-184):

```typescript
      <TransactionDetailsDrawer
        transaction={openTransaction}
        isOpen={openTransaction !== null}
        onClose={() => setOpenTransaction(null)}
        onAction={() => { /* wired in Task 12 */ }}
      />
```

Run: `cd frontend && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/transactions/transaction-details-drawer.tsx frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "feat(transactions): add action grid to details drawer view mode"
```

---

### Task 10: `TransactionQuickActionsPanel` component (long-press panel)

**Files:**
- Create: `frontend/src/components/transactions/transaction-quick-actions-panel.tsx`

**Interfaces:**
- Consumes: `ActionTileGrid`, `TransactionActionType` from Task 4.
- Produces:
  ```typescript
  interface TransactionQuickActionsPanelProps {
    transaction: Transaction | null; // null = closed
    anchorTop: number | null;        // px offset from the panel's positioned ancestor
    onClose: () => void;
    onEdit: (transaction: Transaction) => void;
    onSelect: (transaction: Transaction) => void;
    onAction: (type: TransactionActionType, transaction: Transaction) => void;
  }
  export function TransactionQuickActionsPanel(props): JSX.Element | null
  ```
  Used by Task 11/12 (`TransactionCardList`).

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { Edit, Split, Layers, AlertTriangle, Mail, FileText, RefreshCw, CheckSquare } from "lucide-react";
import { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { ActionTileGrid, type TransactionActionType } from "./action-tile-grid";

interface TransactionQuickActionsPanelProps {
  transaction: Transaction | null;
  anchorTop: number | null;
  onClose: () => void;
  onEdit: (transaction: Transaction) => void;
  onSelect: (transaction: Transaction) => void;
  onAction: (type: TransactionActionType, transaction: Transaction) => void;
}

/**
 * Long-press quick-action panel: anchors below the pressed row (not a
 * centered modal), scrims the rest of the list. Deliberately a reduced
 * action set vs. the drawer's full grid (no direction-toggle/Shared split —
 * see 2026-08-14-mobile-transactions-list-design.md Component 5) so this
 * stays a clean 8-tile/2-row grid: Edit, Split, Group, Flag, Links, PDF,
 * Recurring, Select.
 */
export function TransactionQuickActionsPanel({
  transaction,
  anchorTop,
  onClose,
  onEdit,
  onSelect,
  onAction,
}: TransactionQuickActionsPanelProps) {
  if (!transaction || anchorTop === null) return null;

  const amount = transaction.is_shared && transaction.split_share_amount ? transaction.split_share_amount : transaction.amount;

  const tiles = [
    { key: "shared" as const, label: "Edit", icon: Edit, onClick: () => onEdit(transaction) },
    { key: "split" as const, label: "Split", icon: Split, active: transaction.is_split, onClick: () => onAction("split", transaction) },
    { key: "group" as const, label: "Group", icon: Layers, active: !!transaction.transaction_group_id, onClick: () => onAction("group", transaction) },
    { key: "flag" as const, label: "Flag", icon: AlertTriangle, active: transaction.is_flagged === true, onClick: () => onAction("flag", transaction) },
    { key: "links" as const, label: "Links", icon: Mail, active: !!(transaction.related_mails && transaction.related_mails.length > 0), onClick: () => onAction("links", transaction) },
    { key: "pdf" as const, label: "PDF", icon: FileText, disabled: !transaction.source_file, onClick: () => onAction("pdf", transaction) },
    { key: "recurring" as const, label: "Recurring", icon: RefreshCw, active: transaction.is_recurring === true, onClick: () => onAction("recurring", transaction) },
    { key: "direction" as const, label: "Select", icon: CheckSquare, onClick: () => onSelect(transaction) },
  ];

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="absolute left-3 right-3 rounded-xl bg-card border border-border shadow-2xl overflow-hidden"
        style={{ top: anchorTop }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-3 border-b border-border">
          <p className="text-sm font-bold truncate">{transaction.description}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {transaction.direction === "credit" ? "+" : "−"}{formatCurrency(amount)} · {transaction.category || "Uncategorized"}
          </p>
        </div>
        <div className="p-2.5">
          <ActionTileGrid tiles={tiles} onDelete={() => onAction("delete", transaction)} />
        </div>
      </div>
    </div>
  );
}
```

Note: the `key` field on the "Edit" and "Select" tiles reuses the `TransactionActionType` union (`"shared"`/`"direction"`) purely as a React list key — they don't call `onAction` with those types (they call `onEdit`/`onSelect` instead), so the mislabeled-looking key values are harmless but exist only to satisfy `ActionTile`'s typed `key` field without widening that type. This is intentional, not a bug: `TransactionActionType` is the grid's tile-identity type, not literally "the action this tile performs."

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run type-check`
Expected: no errors (standalone component, no consumers wired yet — verified visually once Task 11 wires it in).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/transaction-quick-actions-panel.tsx
git commit -m "feat(transactions): add long-press quick-actions panel component"
```

---

### Task 11: Wire tap / long-press / selection-mode interaction into `TransactionCardList`

**Files:**
- Modify: `frontend/src/components/transactions/transaction-card-list.tsx`

**Interfaces:**
- Consumes: `useLongPress` (Task 3), `TransactionQuickActionsPanel` (Task 10).

- [ ] **Step 1: Add imports and new state**

Add near the top imports:

```typescript
import { useLongPress } from "@/hooks/use-long-press";
import { TransactionQuickActionsPanel } from "./transaction-quick-actions-panel";
import type { TransactionActionType } from "./action-tile-grid";
```

Add new state alongside the existing `useState` calls in `TransactionCardList` (after `const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);`):

```typescript
  const [panelTransaction, setPanelTransaction] = useState<Transaction | null>(null);
  const [panelAnchorTop, setPanelAnchorTop] = useState<number | null>(null);
  const [drawerInitialMode, setDrawerInitialMode] = useState<"view" | "edit">("view");
```

- [ ] **Step 2: Replace `handleCardTap` and add a per-row long-press handler factory**

Replace the existing `handleCardTap` function:

```typescript
  const handleCardTap = (t: Transaction) => {
    if (selectMode) {
      toggleSelected(t.id);
    } else {
      setOpenTransaction(t);
    }
  };
```

with:

```typescript
  const handleCardTap = (t: Transaction) => {
    // In selection mode every touch — tap or long-press — just toggles the
    // checkbox (see design spec Component 4: no mode-switch ambiguity).
    if (selectMode) {
      toggleSelected(t.id);
      return;
    }
    setDrawerInitialMode("view");
    setOpenTransaction(t);
  };

  const handleLongPress = (t: Transaction, rowEl: HTMLButtonElement) => {
    if (selectMode) {
      toggleSelected(t.id);
      return;
    }
    const listEl = scrollRef.current;
    if (!listEl) return;
    const rowRect = rowEl.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();
    setPanelAnchorTop(rowRect.bottom - listRect.top + listEl.scrollTop + 6);
    setPanelTransaction(t);
  };
```

- [ ] **Step 3: Replace the row's button element to use `useLongPress` per row**

Because `useLongPress` is a hook and cannot be called inside `.map()` directly, extract the row into its own small inner component within the same file. Replace the row-rendering block from Task 5 (the `{group.rows.map((t) => { ... })}` block) with:

```typescript
              {group.rows.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  dotColor={categoryColorMap[t.category] ?? "var(--muted-foreground)"}
                  selected={selectedIds.has(t.id)}
                  selectMode={selectMode}
                  onTap={() => handleCardTap(t)}
                  onLongPress={(rowEl) => handleLongPress(t, rowEl)}
                  onToggleSelected={() => toggleSelected(t.id)}
                />
              ))}
```

Then add the `TransactionRow` component in the same file, above `export function TransactionCardList`:

```typescript
function TransactionRow({
  transaction: t,
  dotColor,
  selected,
  selectMode,
  onTap,
  onLongPress,
  onToggleSelected,
}: {
  transaction: Transaction;
  dotColor: string;
  selected: boolean;
  selectMode: boolean;
  onTap: () => void;
  onLongPress: (rowEl: HTMLButtonElement) => void;
  onToggleSelected: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const longPress = useLongPress({
    onLongPress: () => {
      if (rowRef.current) onLongPress(rowRef.current);
    },
    onClick: onTap,
  });
  const amount = t.is_shared && t.split_share_amount ? t.split_share_amount : t.amount;

  return (
    <button
      ref={rowRef}
      type="button"
      {...longPress}
      className={cn(
        "w-full flex items-center gap-2.5 py-2.5 px-1 text-left border-b border-border last:border-b-0 transition-colors min-h-11",
        selected && "bg-primary/[0.06]"
      )}
    >
      {selectMode && (
        <Checkbox checked={selected} onCheckedChange={onToggleSelected} onClick={(e) => e.stopPropagation()} />
      )}
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <p className="flex-1 min-w-0 text-[12.5px] font-medium text-foreground truncate">
        {t.description}
      </p>
      <div className="text-right shrink-0">
        <p className={cn(
          "font-mono text-[12.5px] font-semibold tabular-nums",
          t.direction === "credit" ? "text-emerald-500" : "text-foreground"
        )}>
          {t.direction === "credit" ? "+" : "−"}{formatCurrency(amount)}
        </p>
        <p className="text-[9px] text-muted-foreground truncate max-w-[110px]">
          {t.category}{t.is_shared ? " · Split" : ""}
        </p>
      </div>
    </button>
  );
}
```

This moves the per-row `onClick` handling from a plain `onClick={() => handleCardTap(t)}` (Task 5) to the `useLongPress` hook's returned Pointer Event handlers, which internally call `onClick` (our `onTap` → `handleCardTap`) on a short press and `onLongPress` on a sustained press — replacing, not adding to, the Task 5 button's interaction.

- [ ] **Step 4: Render the quick-actions panel**

Add, immediately before the closing `<TransactionDetailsDrawer ... />` in the component's return JSX:

```typescript
      <TransactionQuickActionsPanel
        transaction={panelTransaction}
        anchorTop={panelAnchorTop}
        onClose={() => setPanelTransaction(null)}
        onEdit={(t) => {
          setPanelTransaction(null);
          setDrawerInitialMode("edit");
          setOpenTransaction(t);
        }}
        onSelect={(t) => {
          setPanelTransaction(null);
          setSelectMode(true);
          setSelectedIds(new Set([t.id]));
        }}
        onAction={() => { /* wired in Task 12 */ }}
      />
```

And update the existing `<TransactionDetailsDrawer ... />` usage (the stub from Task 9 Step 5) to pass the new `initialMode`:

```typescript
      <TransactionDetailsDrawer
        transaction={openTransaction}
        isOpen={openTransaction !== null}
        onClose={() => setOpenTransaction(null)}
        initialMode={drawerInitialMode}
        onAction={() => { /* wired in Task 12 */ }}
      />
```

- [ ] **Step 5: Manual verification**

1. Browser preview at 375px, `/transactions`, not in selection mode.
2. Tap a row (quick tap, release immediately) → details drawer opens in view mode. Confirm long-press does *not* also open the drawer.
3. Press and hold a row for ~600ms without moving your finger/cursor → the quick-actions panel appears anchored just below that row, scrim visible over the rest of the list.
4. While holding, drag more than ~10px before releasing → confirm the panel does *not* open (this is the scroll-cancel threshold from `useLongPress`) and a normal tap-release fires instead only if you release without having moved past the threshold before the delay — otherwise nothing fires. Confirm a real vertical scroll gesture on the list still scrolls normally and never triggers the panel.
5. From the panel, tap "Edit" → panel closes, details drawer opens directly in edit mode (skips view mode).
6. From the panel, tap "Select" → panel closes, selection mode activates with that row's checkbox checked, sticky bulk-action bar appears (existing behavior).
7. While in selection mode, tap a different row → its checkbox toggles (no drawer opens). Long-press a different row while in selection mode → its checkbox toggles too (no panel opens) — confirms the Component 4 "every touch toggles" rule.
8. Tap outside the panel (on the scrim) → panel closes with no action taken.
9. Reload at desktop width: `TransactionsTable` renders, this component isn't mounted, zero effect.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "feat(transactions): wire tap/long-press/selection-mode interaction model"
```

---

### Task 12: Wire real per-transaction action modals into `TransactionCardList`

This is where `onAction` calls from both the drawer (Task 9) and the panel (Task 10/11) get real behavior. `TransactionCardList` becomes the single owner of "which sub-modal, for which transaction, is open" — both the drawer's and the panel's `onAction` prop point at the same handler.

**Files:**
- Modify: `frontend/src/components/transactions/transaction-card-list.tsx`

**Interfaces:**
- Consumes: `SharedExpenseEditor` (`./shared-expense-editor`, props `{ transaction, isOpen, isLoading, onClose, onSave(splitBreakdown, myShareAmount), onClearSplit }`), `SplitTransactionModal` (`./split-transaction-modal`, props `{ transaction, isOpen, onClose }`), `GroupExpenseSearchModal` (`./group-expense-search-modal`, props `{ isOpen, onClose, onSelectTransactions, initialTransaction?, existingGroupMembers?, onUngroup? }`), `RecurringModal` (`./recurring-modal`, props `{ transaction, open, onClose }`), `EmailLinksDrawer` (`./email-links-drawer`, props `{ transaction, isOpen, onClose, onTransactionUpdate }`), `PdfViewer` (`./pdf-viewer`, props `{ transactionId, open, onOpenChange }`), `useUpdateTransactionSplit`/`useClearTransactionSplit`/`useUpdateTransaction`/`useDeleteTransaction` (`@/hooks/use-transactions`).

- [ ] **Step 1: Add imports**

```typescript
import { SharedExpenseEditor } from "./shared-expense-editor";
import { SplitTransactionModal } from "./split-transaction-modal";
import { GroupExpenseSearchModal } from "./group-expense-search-modal";
import { RecurringModal } from "./recurring-modal";
import { EmailLinksDrawer } from "./email-links-drawer";
import { PdfViewer } from "./pdf-viewer";
import { useUpdateTransactionSplit, useClearTransactionSplit, useUpdateTransaction, useDeleteTransaction } from "@/hooks/use-transactions";
```

- [ ] **Step 2: Add mutation hooks and sub-modal state**

Add alongside the existing hook calls at the top of `TransactionCardList`:

```typescript
  const updateTransactionSplit = useUpdateTransactionSplit();
  const clearTransactionSplit = useClearTransactionSplit();
  const updateTransaction = useUpdateTransaction();
  const deleteTransaction = useDeleteTransaction();
```

Add alongside the state added in Task 11:

```typescript
  const [activeSubModal, setActiveSubModal] = useState<TransactionActionType | null>(null);
  const [subModalTransaction, setSubModalTransaction] = useState<Transaction | null>(null);
  const [singleDeleteTransaction, setSingleDeleteTransaction] = useState<Transaction | null>(null);
```

- [ ] **Step 3: Write the shared `handleAction` function**

Add this function inside `TransactionCardList`, near `handleLongPress`:

```typescript
  const handleAction = (type: TransactionActionType, t: Transaction) => {
    if (type === "flag") {
      updateTransaction.mutate(
        { id: t.id, updates: { is_flagged: !(t.is_flagged === true) } },
        {
          onSuccess: () => toast.success(t.is_flagged ? "Warning removed" : "Transaction marked for review"),
          onError: () => toast.error("Failed to update warning status"),
        }
      );
      return;
    }
    if (type === "direction") {
      const nextDirection = t.direction === "debit" ? "credit" : "debit";
      updateTransaction.mutate(
        { id: t.id, updates: { direction: nextDirection } },
        {
          onSuccess: () => toast.success(`Marked as ${nextDirection === "credit" ? "credit (money in)" : "debit (money out)"}`),
          onError: () => toast.error("Failed to toggle transaction direction"),
        }
      );
      return;
    }
    if (type === "delete") {
      setSingleDeleteTransaction(t);
      return;
    }
    // shared, split, group, recurring, links, pdf all open a sub-modal
    setSubModalTransaction(t);
    setActiveSubModal(type);
  };

  const closeSubModal = () => {
    setActiveSubModal(null);
    setSubModalTransaction(null);
  };
```

- [ ] **Step 4: Wire `handleAction` into the drawer and the panel**

Change the `<TransactionDetailsDrawer ... />` usage's `onAction` prop:

```typescript
        onAction={handleAction}
```

Change the `<TransactionQuickActionsPanel ... />` usage's `onAction` prop:

```typescript
        onAction={handleAction}
```

- [ ] **Step 5: Render the sub-modals**

Add, immediately after the `<TransactionQuickActionsPanel ... />` block:

```typescript
      {subModalTransaction && activeSubModal === "shared" && (
        <SharedExpenseEditor
          transaction={subModalTransaction}
          isOpen={true}
          isLoading={updateTransactionSplit.isPending || clearTransactionSplit.isPending}
          onClose={closeSubModal}
          onSave={async (splitBreakdown, myShareAmount) => {
            try {
              await updateTransactionSplit.mutateAsync({ id: subModalTransaction.id, splitBreakdown, myShareAmount });
              closeSubModal();
            } catch {
              toast.error("Failed to save split breakdown");
            }
          }}
          onClearSplit={async () => {
            try {
              await clearTransactionSplit.mutateAsync(subModalTransaction.id);
              closeSubModal();
            } catch {
              toast.error("Failed to clear split");
            }
          }}
        />
      )}

      {subModalTransaction && activeSubModal === "split" && (
        <SplitTransactionModal
          transaction={subModalTransaction}
          isOpen={true}
          onClose={closeSubModal}
        />
      )}

      {subModalTransaction && activeSubModal === "group" && (
        <GroupExpenseSearchModal
          isOpen={true}
          onClose={closeSubModal}
          initialTransaction={subModalTransaction}
          existingGroupMembers={
            subModalTransaction.transaction_group_id
              ? allTransactions.filter((tx) => tx.transaction_group_id === subModalTransaction.transaction_group_id)
              : undefined
          }
          onSelectTransactions={() => closeSubModal()}
          onUngroup={async () => {
            // Grouping/ungrouping mutations live behind GroupExpenseSearchModal's
            // own flow; this slice only wires the entry point per the design
            // spec's explicit deferral of Group modal internals to its own slice.
            closeSubModal();
          }}
        />
      )}

      {subModalTransaction && activeSubModal === "recurring" && (
        <RecurringModal
          key={subModalTransaction.id}
          transaction={subModalTransaction}
          open={true}
          onClose={closeSubModal}
        />
      )}

      {subModalTransaction && activeSubModal === "links" && (
        <EmailLinksDrawer
          transaction={subModalTransaction}
          isOpen={true}
          onClose={closeSubModal}
          onTransactionUpdate={() => closeSubModal()}
        />
      )}

      {subModalTransaction && activeSubModal === "pdf" && (
        <PdfViewer
          transactionId={subModalTransaction.id}
          open={true}
          onOpenChange={(open) => { if (!open) closeSubModal(); }}
        />
      )}

      {singleDeleteTransaction && (
        <DeleteConfirmationDialog
          isOpen={true}
          onClose={() => setSingleDeleteTransaction(null)}
          onConfirm={async () => {
            try {
              await deleteTransaction.mutateAsync(singleDeleteTransaction.id);
              toast.success("Transaction deleted");
              setSingleDeleteTransaction(null);
            } catch {
              toast.error("Failed to delete transaction");
            }
          }}
          transactions={[singleDeleteTransaction]}
          isLoading={deleteTransaction.isPending}
        />
      )}
```

Note on `onUngroup`: `GroupExpenseSearchModal`'s actual ungroup network call and confirmation UX are internal to that modal and out of this slice's scope per the design spec's explicit deferral ("Split/Group modals... this slice only wires entry points to them"). This callback intentionally just closes our sub-modal state; the modal's own internals (unaffected by this plan) drive the actual ungroup behavior through whatever mechanism it already uses on desktop.

- [ ] **Step 6: Manual verification**

For each of these, use the browser preview at 375px on `/transactions`:

1. Long-press a row → "Flag" tile → confirm toast "Transaction marked for review" and the tile now shows the active/highlighted style if you reopen the panel on the same row.
2. Long-press a row → "Swap ±" tile (via the drawer's grid, since the panel doesn't have this tile per Task 10) — actually verify via the **drawer**: tap a row → in view mode, tap "Swap ±" → confirm toast and the transaction's amount color/sign flips (credit ↔ debit) after refetch.
3. Tap a row → "Split" tile → confirm `SplitTransactionModal` opens with that transaction; close it → confirm it unmounts (no stale state blocking the next action).
4. Tap a row with `related_mails` set → "Links" tile → confirm `EmailLinksDrawer` opens showing the linked emails.
5. Tap a row with `source_file` set → "PDF" tile → confirm `PdfViewer` opens and loads the source PDF.
6. Tap a row → "Recurring" tile → confirm `RecurringModal` opens.
7. Tap a row → "Group" tile → confirm `GroupExpenseSearchModal` opens, pre-populated with that transaction.
8. Tap a row → "Shared" tile → confirm `SharedExpenseEditor` opens.
9. Tap a row → isolated "Delete transaction" row → confirm `DeleteConfirmationDialog` opens showing that one transaction; confirm → toast "Transaction deleted", transaction disappears from the list after refetch.
10. Run `npm run type-check` and `npm run lint` from `frontend/` — expect zero errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "feat(transactions): wire real per-transaction action modals from drawer/panel"
```

---

### Task 13: Restyle the bulk-action bar and header Select button

**Files:**
- Modify: `frontend/src/components/transactions/transaction-card-list.tsx`

- [ ] **Step 1: Restyle the "Select" toggle and bulk-action bar**

Replace the header row (the `<div className="flex items-center justify-between mb-2">...</div>` block near the top of the return statement) with:

```typescript
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{allTransactions.length} transactions</span>
        <Button
          size="sm"
          variant={selectMode ? "secondary" : "ghost"}
          className="h-7 text-xs"
          onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
        >
          {selectMode ? "Cancel" : "Select"}
        </Button>
      </div>
```

(Only change: `variant={selectMode ? "secondary" : "ghost"}` replaces the previous hardcoded `variant="ghost"`, so the button visually confirms selection mode is active — matches the same "active state gets a distinct visual treatment" principle used throughout this redesign, e.g. the action grid's `active` tiles.)

Replace the bulk-action bar block:

```typescript
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed left-0 right-0 z-40 flex items-center justify-between px-4 py-2.5 bg-primary/10 border-t border-primary/25 backdrop-blur-sm" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}>
          <span className="text-xs font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-primary" onClick={() => setIsBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => setIsDeleteConfirmOpen(true)}>Delete</Button>
          </div>
        </div>
      )}
```

with:

```typescript
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-card border-t border-border shadow-[0_-4px_16px_rgba(0,0,0,0.25)]" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}>
          <span className="text-xs font-semibold text-foreground">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="h-8 text-xs px-3" onClick={() => setIsBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" className="h-8 text-xs px-3 bg-destructive/10 text-destructive hover:bg-destructive/15" onClick={() => setIsDeleteConfirmOpen(true)}>Delete</Button>
          </div>
        </div>
      )}
```

This switches the bar from a tinted-primary translucent strip to a solid `bg-card`/`border-border` surface with a drop shadow — matching Component 1/2's flatter, less-tinted visual language established elsewhere in this redesign, per the design spec's Component 4 note ("restyled only to match the new visual language").

- [ ] **Step 2: Manual verification**

1. Browser preview at 375px, `/transactions`. Tap header "Select" → button switches to a filled/secondary style (visibly different from its default ghost look).
2. Select 2+ rows → confirm the bulk-action bar renders as a solid card-colored strip (not a tinted-primary translucent one) with a visible top shadow, positioned correctly above the bottom nav bar (not overlapping it, not floating with a gap).
3. Tap "Cancel" → selection mode exits, bar disappears, button reverts to ghost style.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "style(transactions): restyle Select button and bulk-action bar for consistency"
```

---

### Task 14: Full manual verification pass

No code changes — this task runs the design spec's complete Verification checklist end-to-end as the acceptance gate for the whole slice.

**Files:** none (verification only)

- [ ] **Step 1: Run the full checklist**

Using the browser-preview workflow at 375px width (iPhone SE-class) on `/transactions`, go through `docs/superpowers/specs/2026-08-14-mobile-transactions-list-design.md`'s Verification section items 1–8 in order:

1. Card list renders as flat dense rows with correct category-color dots; date-group headers/daily totals unchanged.
2. Header/stat row fits on one line without scroll or truncation; Import/Add icon buttons work.
3. Filter row: icon+badge with zero filters (collapsed to icon only), then with 1–2 filters active (chips scroll, don't overflow the viewport). Confirm via `document.querySelector('main').scrollWidth === document.querySelector('main').clientWidth` in the browser console (no horizontal overflow).
4. Tap a row → drawer opens in view mode; Edit → form appears in place; Save persists and returns to view mode with updated data.
5. Long-press a row → panel appears anchored below that row, scrim visible, all 8 tiles present (PDF dimmed/disabled rather than omitted when the transaction has no source PDF), Delete visually isolated; tap outside dismisses with no action.
6. Tap "Select" inside the panel → selection mode activates, that row pre-checked; tapping other rows toggles their checkboxes too; bulk bar appears above bottom nav.
7. Header "Select" button still works as an independent entry point.
8. Reload at desktop width (≥768px) and confirm zero visual/behavioral change from before this slice — check `/transactions` renders `TransactionsTable`, the original 4-card stat grid, the original text "Filters" button, and the original read-behavior-preserved drawer (`side="right"`, no grabber, no action grid shown differently — actually the action grid *does* now show on desktop too since Task 9 didn't gate it by `isMobile`; explicitly verify this is intentional: the action grid and edit-mode capability are genuine feature additions useful on desktop too, not mobile-only regressions — re-read Task 9/8's code to confirm neither is wrapped in an `isMobile` check, then confirm this reads correctly in the desktop drawer, not broken/overflowing).

- [ ] **Step 2: Type-check and lint the whole slice**

```bash
cd frontend
npm run type-check
npm run lint
```

Expected: zero errors from either command.

- [ ] **Step 3: Final commit (docs only, if any notes were needed)**

If Step 1's desktop check in item 8 surfaced anything worth noting (e.g. confirming the action grid's desktop appearance was intentional), no code change is needed — this was already the design spec's explicit intent (Component 6 doesn't restrict the drawer's edit/action additions to mobile only, since a read-only drawer with no edit path was a real gap on desktop too, not just mobile). No commit needed for this task unless verification finds a real bug, in which case stop and fix it in a follow-up task before considering the slice done.
