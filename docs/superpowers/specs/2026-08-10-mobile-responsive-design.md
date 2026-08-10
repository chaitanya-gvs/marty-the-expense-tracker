# Mobile-Responsive Frontend Design

## Goal

The app currently only works on desktop — the sidebar nav uses hover-to-expand (no equivalent on touch devices), almost no components have responsive breakpoints, and the Transactions page's 16-column table can't fit a phone screen. This spec makes the existing Next.js frontend genuinely usable on a mobile browser: touch-friendly navigation, readable layouts, no horizontal scrolling, full feature parity across all six pages (Transactions, Analytics, Budgets, Settlements, Review, Settings).

**Explicitly out of scope:** installable PWA (manifest, icons, offline shell), native app, and any backend changes — this is a frontend presentation-layer project only.

## Current State (why this is needed)

- `Navigation` (`frontend/src/components/layout/navigation.tsx`) is a hover-expand sidebar (`onMouseEnter`/`onMouseLeave`) — permanently collapsed to a 56px icon strip on any touch device, since touch has no hover state.
- Only 26 of 97 `.tsx` files in `frontend/src` contain any responsive Tailwind prefix (`sm:`/`md:`/`lg:`/`xl:`) at all, and those are mostly incidental.
- `TransactionsTable` renders 16 columns via TanStack Table + `@tanstack/react-virtual` — structurally cannot fit a phone viewport; needs a genuinely different mobile view, not a CSS tweak.
- `AnalyticsOverview` and `BudgetsOverview` use fixed grids (`grid-cols-3`, `grid-cols-2`) with no mobile breakpoint.
- Settlements and Settings are `Tabs`-based and are the closest to mobile-ready already.

## Architecture: one shared breakpoint, minimal new components

**Breakpoint:** `md` (768px) is the single cutover point for every structural mobile/desktop decision in this project. Below it → mobile UI; at/above it → today's desktop UI, unchanged. One shared cutover (not a different breakpoint per component) keeps the nav shell and the transaction view swapping in sync.

**Implementation split:**
- **Structural differences** (markup genuinely needs to differ, not just resize) use a `useIsMobile()` hook — a new hook in `frontend/src/hooks/` wrapping a `(max-width: 767px)` match-media query — to branch between two components. This applies to exactly two places: the nav shell and the transactions list.
- **Everything else** (grids, spacing, drawer widths) gets Tailwind `md:` prefixes added directly to existing components' className strings. No new components, no JS branching — pure CSS.

This hybrid keeps new component surface area minimal: two new components (`MobileNav`, `TransactionCardList`) plus one new hook, versus a full parallel mobile page tree.

## Component 1: Mobile navigation shell

**New file:** `frontend/src/components/layout/mobile-nav.tsx`

A fixed bottom bar, rendered by `MainLayout` instead of `Navigation` when `useIsMobile()` is true:
- 4 direct tabs, one tap each: **Transactions, Analytics, Budgets, Review**
- 5th slot: **"More"** — opens a bottom sheet (reusing the existing Radix `Sheet` primitive from `frontend/src/components/ui/`) listing **Settlements** and **Settings**
- Bar height 56px + `env(safe-area-inset-bottom)` padding for iPhone home-indicator clearance
- `MainLayout`'s content wrapper gets `pb-16 md:pb-0` so mobile content never sits under the bar

**Unchanged:** `Navigation` (desktop sidebar) and its hover logic — `MobileNav` is a new sibling, not a rewrite. Zero risk to desktop behavior.

**Interfaces:**
- Consumes: `usePathname()` (active-tab highlighting), same `navigation` route list already defined in `navigation.tsx` (import/share, don't duplicate)
- Produces: nothing consumed elsewhere — this is a leaf UI component

## Component 2: Transactions page mobile view

**New file:** `frontend/src/components/transactions/transaction-card-list.tsx`

Rendered instead of `TransactionsTable` when `useIsMobile()` is true, on the same data:
- Same `useInfiniteTransactions` hook, same `@tanstack/react-virtual` virtualization — only the row renderer changes
- Each row is a card: date, description, amount (color-coded debit/credit), category chip
- Tap a card → opens the **existing** `TransactionDetailsDrawer` (already a Radix `Sheet`)

**Modified:** `TransactionDetailsDrawer` and other existing drawers/modals (split, group, email/PDF viewer) get a width class change only — `w-full md:w-[480px]` (exact widths per-component, matching each one's current desktop width) — so they render full-height on mobile instead of a fixed-width side panel. No new drawer components.

**Modified:** `TransactionFilters` — currently an always-visible horizontal row — collapses into a "Filters" button that opens the same filter controls inside a bottom sheet on mobile. Desktop rendering unchanged above `md`.

**Modified:** Bulk-select action bar becomes a sticky strip pinned above the mobile nav bar when items are selected (`bottom-14` positioning), instead of consuming permanent vertical space.

**Known behavior difference (explicit, not accidental):** desktop's tap-to-edit-inline-in-the-table-row (category/tags/description without opening a modal) has no card-list equivalent. On mobile, all edits go through `TransactionDetailsDrawer` instead. The edit capability itself is unchanged — only the entry point differs. This was discussed and accepted, not a gap to silently work around.

**Interfaces:**
- Consumes: `useInfiniteTransactions(filters)` (existing, unchanged), `TransactionDetailsDrawer` (existing, width-adjusted per above)
- Produces: nothing new consumed elsewhere

## Component 3: `useIsMobile` hook

**New file:** `frontend/src/hooks/use-is-mobile.ts`

```ts
export function useIsMobile(): boolean
```

Wraps `window.matchMedia("(max-width: 767px)")` with a `useState` + `useEffect` listener (SSR-safe: returns `false` on first render, updates after mount — matches this codebase's existing SSR-safe patterns in `format-utils.ts`). Used only by `MainLayout` (nav swap) and the transactions page (table/card-list swap) — not sprinkled through every component.

## Remaining pages: CSS-only retrofit, no new components

Applied directly to existing components' className strings — every change below is additive (`md:` prefix on top of the existing class), nothing removed:

| Page | Change |
|---|---|
| **Analytics** (`analytics-overview.tsx`) | Stat-card row: `grid-cols-3` → `grid-cols-1 md:grid-cols-3`. Chart grid already collapses to 1 column below `lg`; no change needed there. `ResponsiveContainer` (Recharts) already handles chart resizing. |
| **Budgets** (`budgets-overview.tsx`) | Stats grid: `grid-cols-2` → `grid-cols-1 md:grid-cols-2`. `BudgetCard` list (`budgets-list.tsx`) is already card-shaped — spacing/padding only. |
| **Settlements** (`settlements/page.tsx`, `splitwise-tab.tsx`) | `Tabs` component already narrow-width tolerant. Fill remaining gaps in `splitwise-tab.tsx`, which already has some responsive classes. |
| **Settings** (`settings/page.tsx`) | `CategoriesManager`/`TagsManager` tabs — same treatment, expected smallest diff of all six pages. |
| **Review** (`review-queue.tsx`) | Already a card-per-item layout (not a wide table) — padding/touch-target sizing only, no restructuring. |

## Verification

No automated frontend test suite exists in this repo today (confirmed during exploration) — this project does not introduce one; that would be a separate, larger effort. Verification is manual, per page, using the `run` skill to load the actual app:
1. Load each changed page at a 375px-wide viewport (iPhone SE-class, the tightest common width) and confirm no horizontal scroll, all text readable, all touch targets reachable
2. Reload the same page at desktop width and confirm zero visual/behavioral change from before this project
3. Confirm the nav swap (sidebar ↔ bottom bar) happens exactly at the 768px boundary, both directions

## Explicitly deferred (not in this project)

- Installable PWA (manifest, icons, offline shell) — separate future project if wanted
- Swipe gestures (swipe-to-delete/categorize) — not requested, adds interaction-design surface beyond "make it functional"
- Automated visual-regression or component tests — no existing frontend test infra to extend; introducing one is a separate decision
