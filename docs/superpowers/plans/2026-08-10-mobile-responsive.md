# Mobile-Responsive Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the design in `docs/superpowers/specs/2026-08-10-mobile-responsive-design.md` — make all six frontend pages usable on a mobile browser via a shared 768px breakpoint, a new bottom-tab nav shell, a card-list view for the Transactions page, and CSS-only retrofits elsewhere.

**Architecture:** No architectural change to data-fetching or business logic — this is a presentation-layer project. Two new components (`MobileNav`, `TransactionCardList`) and one new hook (`useIsMobile`) handle the two places where mobile markup is structurally different from desktop. Everywhere else gets `md:` Tailwind prefixes added to existing className strings.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, Radix UI (`Sheet`, `Dialog`, `Tabs`), TanStack Query (`useInfiniteQuery`).

## Correction to the spec

The spec assumed the Transactions table uses `@tanstack/react-virtual` for row virtualization. It doesn't — `@tanstack/react-virtual` is a listed `package.json` dependency but is not imported anywhere in `frontend/src`. The actual pattern (`transactions-table.tsx`) is scroll-threshold infinite loading: an `onScroll` handler calls `fetchNextPage()` when the user scrolls within 400px of the bottom. `TransactionCardList` (Task 3) mirrors this real pattern, not virtualization.

## Global Constraints

- Run all frontend commands from `frontend/` (where `package.json` lives).
- No automated frontend test suite exists in this repo — per the spec, this project does not introduce one. Every task's verification step is: implement, then use the `run` skill to load the actual app and visually confirm at both a 375px-wide viewport (iPhone SE class) and desktop width, before committing. State exactly what to look for in each task — never "check it looks right" without specifics.
- Every new/edited file must pass `npm run lint` (ESLint) and `npm run type-check` (`tsc --noEmit`) before committing.
- One commit per task, on branch `feature/mobile-responsive` (already checked out, already has the spec commit `b7a83ed` as its base).
- The `768px` (`md`) breakpoint is the only cutover point for structural swaps (nav shell, transaction list). Do not introduce a different breakpoint for these two decisions.
- Do not modify `TransactionsTable`, `Navigation`, or any other desktop-path component's existing behavior — every task either adds a new sibling component or adds `md:`-prefixed classes that are no-ops at desktop widths.

---

### Task 1: `useIsMobile` hook

**Files:**
- Create: `frontend/src/hooks/use-is-mobile.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `useIsMobile(): boolean` — `true` below 768px, `false` at/above it and during SSR (first render). Consumed by Task 2 (`MainLayout`) and Task 4 (`TransactionsPage`).

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

/**
 * True below the 768px mobile breakpoint, false at/above it.
 * Returns false on first render (SSR and initial client render) to avoid
 * hydration mismatches, then updates after mount — same SSR-safe pattern
 * used in src/lib/format-utils.ts.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    setIsMobile(mql.matches);

    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isMobile;
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend
npm run type-check
npm run lint
```

Expected: both clean. This hook has no visual output on its own — it's verified indirectly when Tasks 2 and 4 consume it. No `run`-skill check needed for this task alone.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-is-mobile.ts
git commit -m "feat(mobile): add useIsMobile hook for the 768px breakpoint"
```

---

### Task 2: Mobile navigation shell

**Files:**
- Create: `frontend/src/components/layout/mobile-nav.tsx`
- Modify: `frontend/src/components/layout/main-layout.tsx`

**Interfaces:**
- Consumes: `useIsMobile()` (Task 1)
- Produces: nothing consumed by later tasks — this is a leaf UI swap in `MainLayout`, which every page already renders through.

- [ ] **Step 1: Write `MobileNav`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  TrendingUp,
  Target,
  ScanSearch,
  HandCoins,
  SlidersHorizontal,
  MoreHorizontal,
  LogOut,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Direct tabs, one tap each — the 4 sections used most often day-to-day.
const primaryTabs = [
  { name: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { name: "Analytics", href: "/analytics", icon: TrendingUp },
  { name: "Budgets", href: "/budgets", icon: Target },
  { name: "Review", href: "/review", icon: ScanSearch },
];

// Tucked under "More" — reached in 2 taps instead of 1.
const moreItems = [
  { name: "Settlements", href: "/settlements", icon: HandCoins },
  { name: "Settings", href: "/settings", icon: SlidersHorizontal },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    router.replace("/login");
  };

  const isMoreActive = moreItems.some((item) => pathname === item.href);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around bg-sidebar border-t border-sidebar-border h-14"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryTabs.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setIsMoreOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
            isMoreActive ? "text-primary" : "text-muted-foreground"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <SheetContent side="bottom" className="w-full sm:max-w-full rounded-t-xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 mt-2">
            {moreItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

Note: `SheetContent`'s default width classes (`w-3/4 ... sm:max-w-sm`) are for the `left`/`right` sides only — `side="bottom"` already gets `inset-x-0` (full width) from the base component in `frontend/src/components/ui/sheet.tsx`, so `className="w-full sm:max-w-full"` here is a belt-and-suspenders override, not strictly required, but keep it for clarity since `sm:max-w-sm` from the base component's `right`/`left` branches must not leak in.

- [ ] **Step 2: Wire it into `MainLayout`**

Change `frontend/src/components/layout/main-layout.tsx` from:

```tsx
"use client";

import { Navigation } from "./navigation";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="relative flex h-screen bg-background">
      <div className="w-14 shrink-0" />
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
      <Navigation />
    </div>
  );
}
```

to:

```tsx
"use client";

import { Navigation } from "./navigation";
import { MobileNav } from "./mobile-nav";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative flex flex-col min-h-screen bg-background">
        <main className="flex-1 overflow-auto pb-16">
          <div className="p-4">
            {children}
          </div>
        </main>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen bg-background">
      <div className="w-14 shrink-0" />
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
      <Navigation />
    </div>
  );
}
```

The desktop branch is byte-for-byte the original code — `isMobile` starts `false` (Task 1's SSR-safe default) so desktop users and SSR never see anything different.

- [ ] **Step 3: Verify with the `run` skill**

Load the app. At desktop width, confirm the hover-sidebar behaves exactly as before (no visual change). Resize the browser (or use devtools device toolbar) to 375px width and confirm: the sidebar disappears, a bottom bar with 5 icons appears (Transactions, Analytics, Budgets, Review, More), tapping each of the first 4 navigates and highlights the active tab, tapping "More" opens a bottom sheet listing Settlements and Settings, tapping either navigates and closes the sheet, and the page content never sits underneath the bar (nothing is clipped at the bottom of any page). Cross the 768px boundary by resizing slowly and confirm the swap happens right at that width, both directions.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/mobile-nav.tsx frontend/src/components/layout/main-layout.tsx
git commit -m "feat(mobile): add bottom-tab nav shell below 768px"
```

---

### Task 3: `TransactionCardList` component

**Files:**
- Create: `frontend/src/components/transactions/transaction-card-list.tsx`

**Interfaces:**
- Consumes: `useInfiniteTransactions(filters, sort)` (existing, `frontend/src/hooks/use-transactions.ts`), `useBulkDeleteTransactions()` (existing, same file), `BulkEditModal({ selectedTransactions, isOpen, onClose })` (existing), `DeleteConfirmationDialog({ isOpen, onClose, onConfirm, transactions, isLoading })` (existing), `TransactionDetailsDrawer({ transaction, isOpen, onClose })` (existing — this task renders it; Task 4 does not need to touch it beyond the width fix)
- Produces: `TransactionCardList({ filters, sort }: { filters: TransactionFiltersType; sort?: TransactionSort })` — same prop shape as `TransactionsTable`, so Task 4 can swap between them with no other changes. Consumed by Task 4.

**Scope note (a deliberate simplification, not an oversight):** `TransactionsTable` also has keyboard-navigation (meaningless on touch, not ported) and inline expand/collapse for grouped expenses (in the card list, a grouped expense just opens the details drawer like any other transaction — the drawer already shows group members, per its existing `onUngroupExpense` prop). Both omissions are intentional scope reductions for a touch-first view, not gaps to fix later.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteTransactions, useBulkDeleteTransactions } from "@/hooks/use-transactions";
import { TransactionDetailsDrawer } from "./transaction-details-drawer";
import { BulkEditModal } from "./bulk-edit-modal";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { Transaction, TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { toast } from "sonner";

interface TransactionCardListProps {
  filters: TransactionFiltersType;
  sort?: TransactionSort;
}

export function TransactionCardList({ filters, sort }: TransactionCardListProps) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteTransactions(filters, sort);
  const bulkDeleteTransactions = useBulkDeleteTransactions();

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allTransactions = useMemo(
    () => data?.pages?.flatMap((page) => page.data || []) || [],
    [data]
  );

  // Same 400px-from-bottom threshold as TransactionsTable's fetchMoreOnBottomReached.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, scrollTop, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 400 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Group by date, same as the table's date-header rows, so mobile keeps the
  // same "day totals" context instead of a flat undifferentiated list.
  const grouped = useMemo(() => {
    const groups: { date: string; label: string; dailyTotal: number; rows: Transaction[] }[] = [];
    let current: (typeof groups)[number] | null = null;
    for (const t of allTransactions) {
      const rowDate = t.date ? t.date.split("T")[0] : "";
      if (!current || current.date !== rowDate) {
        const label = rowDate
          ? new Date(rowDate + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "";
        current = { date: rowDate, label, dailyTotal: 0, rows: [] };
        groups.push(current);
      }
      current.rows.push(t);
      if (t.direction === "debit") current.dailyTotal += t.amount;
    }
    return groups;
  }, [allTransactions]);

  const selectedTransactions = useMemo(
    () => allTransactions.filter((t) => selectedIds.has(t.id)),
    [allTransactions, selectedIds]
  );

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCardTap = (t: Transaction) => {
    if (selectMode) {
      toggleSelected(t.id);
    } else {
      setOpenTransaction(t);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await bulkDeleteTransactions.mutateAsync(Array.from(selectedIds));
      toast.success(`${selectedIds.size} transaction${selectedIds.size !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      setSelectMode(false);
      setIsDeleteConfirmOpen(false);
    } catch {
      toast.error("Failed to delete transactions");
    }
  };

  if (error) {
    return <p className="text-sm text-destructive">Error loading transactions: {error.message || "Unknown error"}</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{allTransactions.length} transactions</span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}>
          {selectMode ? "Cancel" : "Select"}
        </Button>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto" style={{ maxHeight: "70vh" }}>
        {grouped.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-2 py-1.5 sticky top-0 bg-background z-10">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{group.label}</span>
              <div className="flex-1 h-px bg-border" />
              {group.dailyTotal > 0 && (
                <span className="text-xs font-mono text-muted-foreground/70 tabular-nums">{formatCurrency(group.dailyTotal)}</span>
              )}
            </div>
            <div className="space-y-1.5 mb-3">
              {group.rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleCardTap(t)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors",
                    selectedIds.has(t.id) && "border-primary bg-primary/5"
                  )}
                >
                  {selectMode && (
                    <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleSelected(t.id)} onClick={(e) => e.stopPropagation()} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.description}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.category}{t.is_shared ? " · Split" : ""}</p>
                  </div>
                  <span className={cn(
                    "font-mono text-sm font-semibold tabular-nums shrink-0",
                    t.direction === "credit" ? "text-emerald-500" : "text-foreground"
                  )}>
                    {t.direction === "credit" ? "+" : "−"}{formatCurrency(t.amount)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {isFetchingNextPage && <p className="text-xs text-center text-muted-foreground py-3">Loading more…</p>}
        {!hasNextPage && allTransactions.length > 0 && (
          <p className="text-xs text-center text-muted-foreground/60 py-3">No more transactions</p>
        )}
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-14 left-0 right-0 z-40 flex items-center justify-between px-4 py-2.5 bg-primary/10 border-t border-primary/25 backdrop-blur-sm">
          <span className="text-xs font-medium text-primary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-primary" onClick={() => setIsBulkEditOpen(true)}>Edit</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => setIsDeleteConfirmOpen(true)}>Delete</Button>
          </div>
        </div>
      )}

      <TransactionDetailsDrawer
        transaction={openTransaction}
        isOpen={openTransaction !== null}
        onClose={() => setOpenTransaction(null)}
      />
      <BulkEditModal
        selectedTransactions={selectedTransactions}
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
      />
      <DeleteConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        transactions={selectedTransactions}
        isLoading={bulkDeleteTransactions.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend
npm run type-check
npm run lint
```

This component isn't wired into any page yet (Task 4 does that), so there's nothing to visually check in isolation beyond type/lint cleanliness.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx
git commit -m "feat(mobile): add TransactionCardList (mobile view of the transactions table)"
```

---

### Task 4: Wire mobile transactions view into the page

**Files:**
- Modify: `frontend/src/components/transactions/transactions-page.tsx`
- Modify: `frontend/src/components/transactions/transaction-details-drawer.tsx`
- Modify: `frontend/src/components/transactions/transaction-filters.tsx`

**Interfaces:**
- Consumes: `TransactionCardList` (Task 3), `useIsMobile()` (Task 1)
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Swap the table for the card list below 768px, in `transactions-page.tsx`**

Add the import and the hook call, then branch the render. Change:

```tsx
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
```

to:

```tsx
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { TransactionCardList } from "@/components/transactions/transaction-card-list";
import { useIsMobile } from "@/hooks/use-is-mobile";
```

And inside `export function TransactionsPage() {`, add the hook call near the other `useState` calls:

```tsx
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
```

becomes:

```tsx
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const isMobile = useIsMobile();
```

Then change the render line near the bottom:

```tsx
      <TransactionsTable filters={filters} sort={sort} />
```

to:

```tsx
      {isMobile ? (
        <TransactionCardList filters={filters} sort={sort} />
      ) : (
        <TransactionsTable filters={filters} sort={sort} />
      )}
```

Also fix the stats bar grid — it's already partially responsive (`grid-cols-2 sm:grid-cols-4`) but 2 columns of 4 dense financial stat cells is still tight on a 375px phone. Change:

```tsx
      <motion.div variants={_itemVariants} className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px shadow-[0_1px_8px_oklch(0%_0_0_/_0.08)] dark:shadow-[0_1px_16px_oklch(0%_0_0_/_0.4)]">
```

to:

```tsx
      <motion.div variants={_itemVariants} className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px shadow-[0_1px_8px_oklch(0%_0_0_/_0.08)] dark:shadow-[0_1px_16px_oklch(0%_0_0_/_0.4)]">
```

Tailwind v4 doesn't ship an `xs` breakpoint by default — if `npm run type-check`/`lint` or the visual check in Step 4 shows `xs:` isn't taking effect, fall back to plain `grid-cols-1 sm:grid-cols-4` (drop the intermediate 2-column step) instead of introducing a custom breakpoint just for this one line.

- [ ] **Step 2: Fix the details drawer width, in `transaction-details-drawer.tsx`**

Change:

```tsx
            <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
```

to:

```tsx
            <SheetContent className="w-full sm:w-[540px] overflow-y-auto">
```

This is the only width-related line in this file (confirmed by grep before writing this task) — no other changes needed here.

- [ ] **Step 3: Collapse the filter bar into a mobile sheet, in `transaction-filters.tsx`**

This file is 1357 lines and contains the full filter UI (search, date range, category/tag/account pickers, etc.) already built as a togglable `expanded`/collapsed panel (see the existing `expanded` state and `panelRef` near the top of the file). Do not rewrite the filter fields themselves — wrap the **existing** expanded-panel JSX in a mobile-conditional container so it renders inside a bottom `Sheet` on mobile instead of an inline dropdown panel.

Read the file's return statement first to find exactly where the collapsed toolbar row and the expanded panel div are in the JSX, then:
1. Add `import { useIsMobile } from "@/hooks/use-is-mobile";` and `import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";` at the top
2. Add `const isMobile = useIsMobile();` inside the component
3. Where the expanded panel currently renders inline (conditionally on `expanded`), branch: if `isMobile`, render the exact same panel content inside `<Sheet open={expanded} onOpenChange={setExpanded}><SheetContent side="bottom" className="w-full sm:max-w-full max-h-[85vh] overflow-y-auto rounded-t-xl"><SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>{/* existing panel content, unchanged */}</SheetContent></Sheet>`; if not mobile, render it exactly as it renders today (unchanged inline panel)

Do not move, rename, or alter any of the existing filter field components/handlers inside that panel — only change the wrapper around them on mobile.

- [ ] **Step 4: Verify with the `run` skill**

At 375px width on `/transactions`:
- Confirm cards render (not the table), grouped by date with a daily total per group, matching the data you'd see in the desktop table for the same filters
- Tap a card (not in select mode) → the details drawer opens full-width, not clipped or overflowing
- Tap "Select" → checkboxes appear on cards; tap 2-3 cards → a selection bar appears above the bottom nav showing the count, with working Edit and Delete buttons
- Tap "Filters" → the filter panel opens as a bottom sheet, not an inline dropdown; existing filter fields (date, category, etc.) all work exactly as they do on desktop
- Scroll to the bottom of a long transaction list → more transactions load automatically
- Confirm the stat bar (Total Spent/In/Net/Count) doesn't overflow or wrap awkwardly

At desktop width, confirm zero change from before this task: table still renders, drawer still opens at its original width, filter panel still renders inline.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/transactions/transactions-page.tsx frontend/src/components/transactions/transaction-details-drawer.tsx frontend/src/components/transactions/transaction-filters.tsx
git commit -m "feat(mobile): wire mobile transactions view, fix drawer width, collapse filters to a sheet"
```

---

### Task 5: Analytics page responsive retrofit

**Files:**
- Modify: `frontend/src/components/analytics/analytics-overview.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Fix the stat-card grid (two occurrences — the loading skeleton and the real content)**

Change (skeleton, in `AnalyticsSkeleton`):

```tsx
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
```

to:

```tsx
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
```

Change (real content, in `SummaryCards`):

```tsx
    <div className="grid grid-cols-3 gap-4">
      <Card className="py-5">
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Spent</p>
```

to:

```tsx
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="py-5">
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Spent</p>
```

(Only the opening `<div className="grid grid-cols-3 gap-4">` line changes in each case — everything inside is unchanged.)

- [ ] **Step 2: Verify with the `run` skill**

At 375px width on `/analytics`: confirm the 3 stat cards (Total Spent, Transactions, and the third one) stack vertically, each full-width and readable, not cramped into 3 tiny columns. Confirm the chart area (already responsive via the existing `lg:grid-cols-2`) still stacks correctly. At desktop width, confirm the 3-column stat row and 2-column chart grid look exactly as before.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/analytics/analytics-overview.tsx
git commit -m "fix(mobile): stack analytics stat cards below 768px"
```

---

### Task 6: Budgets page responsive retrofit

**Files:**
- Modify: `frontend/src/components/budgets/budgets-overview.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed elsewhere

**Note beyond the spec's literal wording:** the spec said "stats grid → `grid-cols-1 md:grid-cols-2`", but reading the actual file shows the real problem is one level up — the ring-chart, divider, and stats grid are laid out in a single `flex items-center gap-6` row (`budgets-overview.tsx:78/21`), so fixing only the inner grid still leaves a 96px circle + divider + stats crammed horizontally on a 375px phone. This task fixes both the outer row and the inner grid, in both the loading and loaded states, so the fix actually solves the cramping.

- [ ] **Step 1: Fix the loading-state layout**

Change:

```tsx
      <div className="rounded-xl border border-border bg-card p-5 flex gap-6 items-center">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="w-px self-stretch bg-border shrink-0" />
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
```

to:

```tsx
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col md:flex-row gap-6 items-center">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="h-px w-full md:h-auto md:w-px md:self-stretch bg-border shrink-0" />
        <div className="flex-1 w-full grid grid-cols-2 gap-x-6 gap-y-4">
```

- [ ] **Step 2: Fix the loaded-state layout**

Change:

```tsx
      <div className="flex items-center gap-6">

        {/* Ring chart */}
        <div className="relative w-24 h-24 shrink-0">
```

to:

```tsx
      <div className="flex flex-col md:flex-row items-center gap-6">

        {/* Ring chart */}
        <div className="relative w-24 h-24 shrink-0">
```

And change:

```tsx
        {/* Vertical divider */}
        <div className="w-px self-stretch bg-border shrink-0" />

        {/* Stats 2×2 grid */}
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
```

to:

```tsx
        {/* Divider — horizontal on mobile (stacked layout), vertical on desktop */}
        <div className="h-px w-full md:h-auto md:w-px md:self-stretch bg-border shrink-0" />

        {/* Stats 2×2 grid */}
        <div className="flex-1 w-full grid grid-cols-2 gap-x-6 gap-y-4">
```

The inner grid stays `grid-cols-2` (not `grid-cols-1`) at every width — once the outer row is stacked, the 96px circle no longer competes with the grid for horizontal space, so 2 columns of short stat labels fit comfortably even at 375px. Confirm this in Step 3; if it's still cramped in practice, change this specific line to `grid-cols-1 md:grid-cols-2` instead.

- [ ] **Step 3: Verify with the `run` skill**

At 375px width on `/budgets`: confirm the ring chart sits above a horizontal divider, which sits above the 2×2 stats grid — nothing side-by-side, nothing cut off. Confirm `BudgetCard` items in the list below render at full readable width. At desktop width, confirm the ring/divider/stats row is back to side-by-side, identical to before this task.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/budgets/budgets-overview.tsx
git commit -m "fix(mobile): stack budgets overview (ring chart + stats) below 768px"
```

---

### Task 7: Settlements and Settings — verify, fix only what's actually broken

**Files:**
- Modify (if needed): `frontend/src/app/settlements/page.tsx`, `frontend/src/components/settlements/splitwise-tab.tsx`, `frontend/src/app/settings/page.tsx`
- No changes anticipated to `manual-tab.tsx`, `categories-manager.tsx`, `tags-manager.tsx` — check them in Step 1, only touch if genuinely needed

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed elsewhere

**Why this task looks different from the others:** exploration during planning found both pages already mostly mobile-tolerant — `splitwise-tab.tsx`'s own stat bar is already `grid-cols-2 sm:grid-cols-4`, and both pages' `Tabs`/`TabsList` don't force a wide fixed layout. This task is a verification pass with a narrow, specific fallback if the verification finds a real problem — not a known fix applied blindly.

- [ ] **Step 1: Verify with the `run` skill**

At 375px width on `/settlements`: check both the "Splitwise" and "Manual Computation" tabs. Confirm the tab triggers themselves don't overflow the screen width, the stat bar (already responsive) looks right, and the list of settlement/expense rows (`splitwise-tab.tsx` lines ~38-132, ~282-330) wrap or truncate sensibly rather than overflowing horizontally.

At 375px width on `/settings`: check both "Categories" and "Tags" tabs. Confirm the 2-column `TabsList` fits, and `CategoriesManager`/`TagsManager` content doesn't overflow.

- [ ] **Step 2: Fix only what Step 1 actually found broken**

If everything in Step 1 looked correct: skip to Step 3, no code changes.

If something specific overflowed or was unreadable: fix that specific element the same way Tasks 5/6 did — add a `md:` prefix to whatever fixed-width or fixed-columns class is causing it, keeping the change scoped to exactly the broken element. Do not restructure anything that already looked fine.

- [ ] **Step 3: Commit**

If Step 2 made changes:

```bash
git add <files you actually touched>
git commit -m "fix(mobile): <specific description of what you fixed>"
```

If Step 2 made no changes, skip the commit — there's nothing to commit for this task, and that's a valid outcome, not a failure to record in the ledger as "complete, no diff."

---

### Task 8: Review queue touch-target pass

**Files:**
- Modify (if needed): `frontend/src/components/review/statement-review-queue.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed elsewhere

**Why this task looks different from the others:** exploration found this component already uses a card-per-item layout with `flex-wrap` on its badge groups (lines ~199, ~296, ~305 as of this plan being written) — it's not a wide table, so there's no structural mismatch to fix. This task checks touch-target sizing and spacing only.

- [ ] **Step 1: Verify with the `run` skill**

At 375px width on `/review`: confirm every tappable element (accept/reject/action buttons, badges if clickable, row-level tap targets) is comfortably tappable — no element smaller than roughly 32×32px, no two adjacent tap targets closer than ~4px apart. Confirm badge groups wrap onto multiple lines cleanly (not clipped) when there isn't enough width, and confirm the queue header/filter row (`statement-review-queue.tsx` around line 195) doesn't overflow.

- [ ] **Step 2: Fix only what Step 1 actually found broken**

Same rule as Task 7 Step 2 — narrow, targeted fixes only for what's actually broken (e.g., bump a button's padding, add `flex-wrap` somewhere it's missing). If a touch target is genuinely too small, increase its padding/hit area rather than its visual size, to avoid changing desktop's appearance — e.g. add invisible padding via a wrapping element, or bump `py-1.5` → `py-2` if that specific button is under 32px tall.

- [ ] **Step 3: Commit**

Same pattern as Task 7 Step 3 — commit only if Step 2 made changes; a no-diff outcome is valid.

---

## Self-Review Notes

**Spec coverage:** All three spec components (`useIsMobile`, `MobileNav`, `TransactionCardList`) have dedicated tasks (1, 2, 3). All six pages are covered: Transactions (Tasks 3-4), Analytics (5), Budgets (6), Settlements + Settings (7), Review (8).

**Placeholder scan:** No TBD/TODO. Tasks 7 and 8 intentionally don't prescribe a fix in advance (the spec's own exploration found these pages likely need none) — but each gives a concrete, bounded verification checklist and an explicit rule for scoping any fix that verification does turn up, which is not the same as "add appropriate handling."

**Type consistency:** `TransactionCardList({ filters, sort })` (Task 3) matches `TransactionsTable`'s existing prop shape exactly, confirmed against the real call site in `transactions-page.tsx` before writing Task 3 — Task 4's swap is a like-for-like prop pass-through, not a reshaping.

**Correction carried from spec:** the `@tanstack/react-virtual` assumption is fixed at the top of this plan and `TransactionCardList` (Task 3) implements the real scroll-threshold pattern instead.
