# Mobile Transactions Page — List, Header, Filters, Selection & Details Drawer (Slice 1)

## Goal

The `feature/mobile-responsive` branch made the Transactions page *functional* on mobile (a card-list view, a bottom-tab nav, filters collapsed to a sheet). This spec is a design and craft pass on top of that foundation, scoped to one slice: the transaction list itself, the page header/stats, the filter row, the selection/multi-select model, and the transaction details drawer (including making it editable for the first time — see below). It replaces the corresponding sections of `2026-08-10-mobile-responsive-design.md` for these components.

**Explicitly out of scope for this slice** (each gets its own design→spec→implement round later): Add Transaction Modal, Bulk Edit Modal, Delete confirmation styling, Split/Group Expense/Group Transfer modals, category/tag picker components, Import Workflow Sheet, Email Links Drawer, PDF Viewer, Related Transactions Drawer. Analytics and Budgets pages are separate future slices — this spec does not touch them, though it notes two bugs found on them for that future work.

## Current state (verified during design walkthrough)

- `frontend/src/components/transactions/transaction-card-list.tsx` — functional but visually generic: bordered cards, plain category text (no color), simple "Select" toggle button, no long-press affordance.
- `frontend/src/components/transactions/transactions-page.tsx` — header has full text "Import"/"Add" buttons; stats render as 4 stacked full-width cards (`grid-cols-1 sm:grid-cols-4`) — a lot of vertical space before any transaction is visible on a phone.
- `frontend/src/components/transactions/transaction-filters.tsx` (1375 lines) — desktop-oriented; mobile gets it collapsed into a sheet already, but the trigger row (Filters button + active-filter chips + Clear) has no horizontal-overflow handling.
- `frontend/src/components/transactions/transaction-details-drawer.tsx` — **read-only**. No edit affordance exists anywhere in it. On mobile there is currently no way to edit a transaction's category, tags, description, or anything else — desktop editing happens via in-table inline edit and a separate `TransactionEditModal` (`frontend/src/components/transactions/transaction-edit-modal.tsx`, 380 lines), neither reachable from the mobile card list.
- Per-transaction actions that exist on desktop (via `transactions-table.tsx` row action buttons) but have no mobile entry point at all: Split, Group expense (join/create/Ungroup), Group Transfer, Email Links, Flag toggle, Direction toggle, Delete, View source PDF, Related Transactions, mark-as-recurring.
- Verified during this walkthrough: the Transactions page filter row does **not** currently overflow at 375px (`scrollWidth === clientWidth === 375`). Two other pages do have a confirmed overflow bug — **Budgets** (header row scrollWidth 388 vs clientWidth 375, the "Add Budget" button/sort-dropdown row) and **Analytics** (scrollWidth 393 vs 375, the date-range pill row) — both `<main>`-level horizontal scroll with no visible scrollbar, silently clipping content off-screen. These are real bugs but belong to their own future slices (Budgets, Analytics), not this one.
- `Category` (`frontend/src/lib/types/index.ts:127`) already has an optional `color?: string` field, set per-category in Settings. `Transaction.category` is a name string, not a joined object — category color must be resolved client-side via `useCategories()` (`frontend/src/hooks/use-categories.ts`) building a name→color lookup.
- Breakpoint: `useIsMobile()` (`frontend/src/hooks/use-is-mobile.ts`), `(max-width: 767px)`, SSR-safe, already wired into `transactions-page.tsx`. Unchanged by this spec.

## Visual language

No new design system — this stays inside the app's existing dark OkLCH theme (`frontend/src/app/globals.css`): `--card: #131418`, `--primary: #6366F1` (indigo), `--muted: #1A1B20`, `--muted-foreground: #94A3B8`, `--border: rgba(255,255,255,0.07)`, credit green `emerald-500 (#10B981)`, destructive `#EF4444`. Category dot colors come from the real `Category.color` field, not an invented palette. All action icons (Component 5 and 6) are the app's existing `lucide-react` set, matching the exact icon desktop already uses per action (see Component 6) — not emoji or invented glyphs; the brainstorming mockups used emoji only as browser-mockup placeholders, never intended for implementation.

## Component 1: Transaction card list — "Dense Ledger" style

**File:** `transaction-card-list.tsx` (modified, not replaced)

Rows become flat list items instead of individually bordered cards: no per-row card background/border, a 1px `border-border` divider between rows, ~44px row height (meets the 44×44pt touch-target minimum). Each row:
- Leading: 8px category-color dot (from `Category.color`, resolved via a name→color map built from `useCategories()`)
- Middle: single-line truncated description
- Trailing, right-aligned, stacked: amount (mono, bold, credit green or default per direction) above, category name in small muted text below

Existing sticky date-group headers with daily debit totals are unchanged (already implemented, already correct).

This intentionally drops the current per-row card chrome (border, background, padding-heavy shape) — it's a flatter, denser, bank-statement-style list. Higher information density per screen, less visual weight per row.

## Component 2: Header & stats bar — one-line summary

**File:** `transactions-page.tsx` (modified)

- Title ("Transactions") + date-range subtext stay top-left, unchanged.
- "Import" and "Add" buttons collapse from full text buttons to compact icon-only buttons (upload icon, plus icon) on mobile only (`md:` prefix keeps desktop's current full-text buttons unchanged).
- The four-stat block (`Total Spent`/`Total In`/`Net`/`Transactions`) collapses from 4 stacked full-width cards into a single ~44px-tall row with vertical dividers between segments, using **abbreviated Indian numbering** (e.g. `₹6.9L` instead of `₹6,90,105.49`) so it reliably fits one line without scrolling or truncation at any phone width down to 375px. Desktop's existing 4-card grid is unchanged (`md:` breakpoint keeps current layout).

## Component 3: Filter row

**File:** `transaction-filters.tsx` (modified — mobile trigger row only; the sheet contents already work and are unchanged)

The always-a-full-row "Filters ⌄" text button becomes a compact icon button with a small numeric badge showing the active-filter count. Active filters render as horizontally-scrollable chips next to it. When zero filters are active, the row collapses to just the icon button (no wasted full-width row for an empty state, which is the common case right after opening the page). This is a robustness improvement consistent with the rest of this redesign, not a fix for a currently-broken row (see Current State above — this row doesn't overflow today, but the new design is deliberately overflow-proof by construction: an icon + horizontally-scrollable chip strip can never silently clip content off-screen the way a rigid flex row can).

## Component 4: Selection & interaction model

Three entry points, one shared "selection mode" state (already exists in `transaction-card-list.tsx` as `selectMode`/`selectedIds` — reused, not replaced):

1. **Plain tap on a row** (not in selection mode) → opens the Transaction Details Drawer (Component 6) in view mode.
2. **Long-press on a row** (not in selection mode) → opens the quick-action panel (Component 5) anchored to that row.
3. **Header "Select" button** (existing, restyled to match) → enters selection mode directly, no row pre-checked.

Once in selection mode (entered via #3, or via "Select" inside the panel from #2 — see Component 5):
- **Every touch on a row — tap or long-press — toggles that row's checkbox.** No mode-switch ambiguity: while selecting, all touches mean "add/remove from the batch," full stop. (Rejected alternative: keeping long-press's normal "open panel" meaning even inside selection mode — decided against, in favor of the simpler single-behavior-per-mode model, matching how Google Photos/Gmail-style multi-select works.)
- The sticky bulk-action bar (Edit/Delete) above the bottom nav bar — already implemented at `bottom: calc(3.5rem + env(safe-area-inset-bottom))` — is unchanged in position/behavior, restyled only to match the new visual language (Component 1/2's flatter, less-bordered aesthetic).
- Exiting selection mode (header toggle back to "Cancel", or completing a bulk action) is unchanged.

**Gesture note (why no swipe):** an earlier iteration considered "swipe a row to enter selection mode." Rejected: horizontal swipe gestures on a vertically-scrolling list create scroll/swipe ambiguity, and near the screen edge collide with iOS Safari's/Android Chrome's native swipe-back gesture. Long-press is the platform-standard gesture for a contextual action panel and doesn't have either conflict, so multi-select entry is folded into that panel's action list (see Component 5) instead of getting its own gesture. The header "Select" button remains as an always-visible, gesture-free fallback per the general rule that no critical action should be gesture-only.

## Component 5: Long-press quick-action panel (new component)

**New file:** `frontend/src/components/transactions/transaction-quick-actions-panel.tsx`

On long-press of a row (outside selection mode): a scrim dims the rest of the list, the pressed row itself gets a subtle highlight, and a panel anchors directly below that row (not a centered modal — stays spatially connected to what was pressed). Panel contents:
- Small header repeating the transaction's description + amount + category, for confirmation of what's being acted on
- A 4-column icon-tile grid, exactly 2 full rows of 8 tiles: **Edit, Split, Group, Flag, Links, PDF, Recurring, Select**. This is a deliberately reduced set (the "quick" surface) — it does not include the direction-toggle ("Swap ±") action that the full Details Drawer has; that one's reachable via Edit → Details Drawer instead. Keeping the panel at a clean 8-tile/2-row grid was prioritized over exhaustive parity with the drawer's action set.
- **Delete** is a separate full-width row below a divider at the panel's bottom, visually distinct (red-tinted background/text) from the routine-action grid above — deliberately not just another equal-weight tile, to reduce accidental destructive taps
- Tapping any tile invokes that action's existing flow (opens the relevant modal/drawer — those flows themselves are out of scope for this slice, see top of doc) except:
  - **Edit** → opens the Details Drawer (Component 6) directly in edit mode
  - **Select** → dismisses the panel, enters selection mode with this row pre-checked (see Component 4)
- Tap outside the panel (on the scrim) or press Escape-equivalent (swipe-down / back gesture) dismisses it with no action taken

**Interfaces:**
- Consumes: the same per-transaction action handlers `transactions-table.tsx` already has for Split/Group/Flag/Direction-toggle/Delete/PDF/Links (reused, not reimplemented — this slice wires the mobile entry point; the target modals/drawers themselves are future slices, so for now these tiles can open the existing desktop modals full-screen via the `w-full md:w-[...]` pattern already established elsewhere in the mobile-responsive branch, pending each modal's own design pass)
- Produces: nothing new consumed elsewhere — leaf UI component

## Component 6: Transaction Details Drawer — now editable

**File:** `transaction-details-drawer.tsx` (substantially modified — adds edit capability that does not exist today)

**View mode** (default, what tapping a row opens):
- Header: description (large, bold) + amount (mono, large) + a small close button
- Category and account as chips below the header (category chip uses the same `Category.color` used in the card list, for visual continuity)
- A 2-column field grid: Date, Tags (existing fields from the current read-only version, kept)
- Primary "Edit" button
- An 8-tile action grid (4 columns × 2 full rows, no gaps): **Shared** (`Users`), **Group** (`Layers`), **Split** (`Split`), **Recurring** (`RefreshCw`), **Links** (`Mail`), **Flag** (`AlertTriangle`), **Swap direction** (`ArrowLeftRight` — desktop has no dedicated icon for this, it's keyboard-shortcut-only there), **PDF** (`FileText`) — plus an isolated Delete row (`Trash2`) below a divider. All icons match the exact Lucide icons `transaction-columns.tsx` already uses for these actions on desktop, not invented glyphs. Note "Shared" and "Split" are two distinct desktop actions (Shared = mark as shared expense, opens the split editor for percentage allocation; Split = divide one transaction into multiple ledger entries via `SplitTransactionModal`) — an earlier draft of this spec incorrectly conflated them into one tile. This is the *complete* action set (unlike the panel's reduced 8-tile set in Component 5, which keeps its own simpler 8: Edit/Split/Group/Flag/Links/PDF/Recurring/Select, no Shared or direction-toggle, and excludes Edit/Select here since Edit is already the primary button above and Select doesn't apply — you're already viewing one specific transaction, not a list). Rationale for having a full action set here at all, not just in the long-press panel: the drawer is reached by a *plain tap*, the primary/expected way to open a transaction on mobile — it needs to be a complete hub on its own, not depend on the user knowing long-press exists.
- Existing conditional sections (Grouped Expense info + Ungroup button, Notes, dev-only raw JSON) are kept, restyled to match.

**Edit mode** (entered via the Edit button, from either view mode or directly from the quick-action panel):
- Core fields always visible: Description, Category, Tags, Notes — these are the fields actually touched most often
- Everything else desktop's `TransactionEditModal` has — Date, Account, Direction, Amount, Split share amount, and the `is_shared`/`is_refund`/`is_transfer`/`is_recurring`+period flags — lives under a collapsible "Advanced" section, collapsed by default
- Cancel / Save buttons at the bottom; Save calls the same `useUpdateTransaction` mutation `TransactionEditModal` already uses (no new backend/API work — this is purely a new mobile-friendly form surface over existing mutations)
- Sheet stays open across the view↔edit toggle (no separate modal stacking)

**Interfaces:**
- Consumes: `useUpdateTransaction`, `useCategories`, `useTags` (all existing, from `use-transactions.ts`/`use-categories.ts`/`use-tags.ts`), same mutation contract `TransactionEditModal` already uses
- Produces: nothing new consumed elsewhere

## Explicitly deferred (future slices, not this one)

- Add Transaction Modal mobile redesign
- Bulk Edit Modal + Delete Confirmation Dialog mobile redesign
- Split Transaction Modal, Group Expense Modal, Group Expense Search Modal, Group Transfer Modal — mobile redesign (this slice only wires *entry points* to them from the panel/drawer; their own internal mobile layout is unchanged/not addressed until their own slice)
- Category/tag picker components (`category-selector.tsx`, `category-autocomplete.tsx`, `multi-tag-selector.tsx`, etc.) — mobile redesign
- Import Workflow Sheet, Email Links Drawer, PDF Viewer, Related Transactions Drawer — mobile redesign
- Budgets page header-row overflow bug (confirmed, `scrollWidth` 388 vs 375)
- Analytics page date-range-row overflow bug (confirmed, `scrollWidth` 393 vs 375)

## Verification

Manual, using the `run`/browser-preview workflow, at 375px viewport (iPhone SE-class):
1. Card list renders as flat dense rows with correct category-color dots sourced from real category data; date-group headers/daily totals unchanged
2. Header/stat row fits on one line without scroll or truncation; Import/Add icon buttons work
3. Filter row: icon+badge with zero filters (collapsed to icon only), then with 1–2 filters active (chips scroll, don't overflow the viewport)
4. Tap a row → Details Drawer opens in view mode with correct data; Edit → form appears in place with core fields inline and Advanced collapsed; Save persists and drawer returns to view mode with updated data
5. Long-press a row → panel appears anchored below that row, scrim visible, all 8 tiles present, Delete visually isolated; tap outside dismisses with no action
6. Tap "Select" inside the panel → selection mode activates, that row pre-checked; tapping other rows (not holding) toggles their checkboxes too; bulk bar appears above bottom nav
7. Header "Select" button still works as an independent entry point
8. Reload at desktop width (≥768px) and confirm zero visual/behavioral change from before this slice — all changes are `md:`-gated or `useIsMobile()`-branched
