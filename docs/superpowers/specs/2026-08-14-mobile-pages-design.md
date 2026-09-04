# Mobile Pages — Design (Phase 3: Analytics, Budgets, Review, Settlements, Settings)

## Goal

The Transactions page is now mobile-first end to end. The other five pages received only the original CSS-only retrofit (stacking a few grids). Two of them have confirmed layout bugs at 375px — Analytics' date-range/group row makes `<main>` 393px wide and Budgets' list-header row makes it 388px, so both pages silently scroll sideways — and all five still have desktop-sized controls. This slice fixes the overflows structurally, sizes charts for phones, and applies the Phase 2c/2d touch rulebook (`2026-08-14-mobile-modal-internals-design.md`, rules R1–R9) to every page component, keeping ≥768px identical.

## Decisions (autonomous; alternatives noted)

1. **Overflow is fixed by wrapping/scrolling the offending rows, not by shrinking their contents.** Analytics' preset pills (`Last Mo · This Mo · 3 Mo · 6 Mo · YTD · calendar`) become a horizontally scrolling strip on mobile (`overflow-x-auto` with `shrink-0` pills, no scrollbar chrome), and the group-by control moves to its own row below it (`flex-col md:flex-row`). Budgets' header becomes `flex-col md:flex-row` with the month navigator on its own centred row and the list header (`Monthly budgets · N active` / sort / Add) wraps. Rejected: abbreviating labels or hiding controls behind a menu (loses parity with desktop for no structural gain).
2. **Charts get phone-sized heights via `useIsMobile()`.** Recharts' `ResponsiveContainer` takes a numeric `height`; the two tall charts (420/380) become 300/280 on mobile, the 230 one stays. Rejected: CSS-only heights (ResponsiveContainer needs a number).
3. **Budget-card icon actions use the dense-row exception** (`h-9 w-9 md:h-7 md:w-7`): three 44px buttons plus the name and amount do not fit a 343px card row; 36px does. Everything else follows R2 literally.
4. **Settlement filter popover migrates to `ResponsivePopover`** (tap-to-open, fixed `w-72` — exactly the case the Phase 2a wrapper exists for).
5. **Tab strips are full-width on mobile.** `TabsList` on Settlements and the nested Categories (debit/credit) tabs get `w-full grid grid-cols-2 md:inline-flex md:w-auto` so each trigger is a wide, 44px target; Settings' page-level list already does this.
6. **No new components.** All changes are class/attribute-level plus one `useIsMobile()` call in the charts component.

## Current state (verified)

- `components/analytics/analytics-filters.tsx:79-104`: one `flex items-center justify-between gap-3` row holding two `shrink-0` clusters (preset segmented control; calendar/custom + group toggle) — cannot shrink → 393px. Group-by row at `:194-199` already wraps.
- `components/analytics/analytics-overview.tsx`: stat grid already `grid-cols-1 md:grid-cols-3`; chart grid `grid-cols-1 lg:grid-cols-2`.
- `components/analytics/analytics-charts.tsx:213,519,554`: `ResponsiveContainer height={230|420|380}`; legend list `max-h-[156px]`.
- `app/budgets/page.tsx:71-90`: header `flex items-center justify-between` with title block + month navigator (`min-w-[140px]` label between two buttons); a second row holds the list label, the sort `<select>` and the Add Budget button — the 388px overflow.
- `components/budgets/budget-card.tsx:144-168`: three `h-7 w-7` icon buttons; `:214` chip row already `flex-wrap`. `budgets-overview.tsx` already stacks at `md:`. `budget-create-modal.tsx` / `budget-override-modal.tsx` are `Modal size="sm"` (bottom sheets now) with raw inputs to size (R1).
- `components/review/statement-review-queue.tsx`: card per item; `size="sm"` Link/Reject buttons (`:276`), `Fetch Latest` (`:93`), `text-xs` meta.
- `app/settlements/page.tsx:17-20`: `TabsList` with two triggers; `components/settlements/settlement-filters.tsx:230,257`: `grid-cols-2 md:grid-cols-4` filters and a `PopoverContent className="w-72"`; `splitwise-tab.tsx:236` / `manual-tab.tsx:230,239`: stat grids `grid-cols-2 sm:grid-cols-4`; both tabs list rows with `text-xs` actions.
- `app/settings/page.tsx:18`: `TabsList className="grid w-full grid-cols-2"` (already good); `components/settings/categories-manager.tsx:117-124,198`: header with Add button, nested debit/credit `TabsList`, row edit/delete buttons; `tags-manager.tsx:122`: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`.

## Component 1: Analytics

- `analytics-filters.tsx:79`: outer row → `flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between md:gap-3`. Preset cluster (`:82`) → add `overflow-x-auto max-w-full [&>*]:shrink-0` on mobile (`md:overflow-visible`); keep its pills, but give each pill `min-h-9 md:min-h-0` (dense segmented control). Calendar/custom + group toggle cluster (`:104`) → `flex-wrap` on mobile, `min-h-9` controls. Custom-range inputs (`:157-190`): R1 (`h-11 md:h-8`, `text-base md:text-xs` restored to their current values) and `flex-col md:flex-row`.
- `analytics-charts.tsx`: `const isMobile = useIsMobile()` at the top of the component; `height={isMobile ? 300 : 420}` and `height={isMobile ? 280 : 380}`; legend list stays. Any `text-xs` tappable legend rows → R7.
- `analytics-overview.tsx`: R2 on any buttons; tooltip `min-w-[150px]` stays (<375).

## Component 2: Budgets

- `app/budgets/page.tsx`: header → `flex flex-col gap-4 md:flex-row md:items-center md:justify-between`; month navigator wrapper → `flex items-center justify-center gap-2 md:justify-end`, its buttons `h-11 w-11 md:h-9 md:w-9` (R2), label keeps `min-w-[140px]`. List header row → `flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-between`; the label `w-full md:w-auto`; the sort `<select>` `flex-1 md:flex-none h-11 md:h-9 text-base md:text-sm`; Add Budget `shrink-0 min-h-11 md:min-h-0`.
- `budget-card.tsx`: icon buttons `h-9 w-9 md:h-7 md:w-7` (decision 3); any `text-xs` tappables R7; row `min-h-11 md:min-h-0` where the card header is tappable/expandable.
- `budget-create-modal.tsx`, `budget-override-modal.tsx`: R1 on inputs (`inputMode="decimal"` for amounts), R2 on footer buttons.
- `no-budget-warning.tsx`: R2 on its buttons; its two `flex items-center justify-between` rows → `flex-wrap gap-2 md:flex-nowrap`.

## Component 3: Review queue

- `statement-review-queue.tsx`: R2 on `Fetch Latest`, `Link`, `Reject`/`None of these` buttons (`min-h-11 md:min-h-0`); candidate rows (`:269`) `min-h-11 md:min-h-0`; the header row (`:86`) `flex-wrap gap-2 md:flex-nowrap`; R7 on tappable `text-xs`.

## Component 4: Settlements

- `app/settlements/page.tsx:17`: `TabsList className="w-full grid grid-cols-2 md:inline-flex md:w-auto"`; triggers `min-h-11 md:min-h-0`.
- `settlement-filters.tsx`: Popover import → `ResponsivePopover*` aliases (Phase 2a pattern) with `title="Filter settlements"`; R1 on inputs; R2 on buttons; the `grid-cols-2 md:grid-cols-4` stays.
- `splitwise-tab.tsx`, `manual-tab.tsx`: stat grids keep `grid-cols-2 sm:grid-cols-4`; participant/settlement rows R3 (`min-h-11 md:min-h-0`), R2 on buttons, R7 on tappable `text-xs`, R8 on badge rows.

## Component 5: Settings

- `categories-manager.tsx`: header `flex-wrap gap-2 md:flex-nowrap`; nested `TabsList` → `w-full grid grid-cols-2 md:inline-flex md:w-auto`, triggers `min-h-11 md:min-h-0`; list rows `min-h-11 md:min-h-0`; edit/delete icon buttons `h-9 w-9 md:h-<current> md:w-<current>`; Add Category dialog inputs R1.
- `tags-manager.tsx`: card action buttons R2; inputs R1; grid stays.

## Out of scope

Login page (already mobile-correct); the desktop sidebar; PWA; chart type changes.

## Verification (code-level now; browser later — never create/edit/delete budgets, categories, tags, or settlements)

Reviewer confirms for Analytics and Budgets that no row can exceed the viewport: every former `shrink-0` cluster either wraps, scrolls in an `overflow-x-auto` strip, or is on its own row below `md`. Browser list (once logged in): `/analytics`, `/budgets`, `/review`, `/settlements`, `/settings` at 375×812 → `document.querySelector('main').scrollWidth === 375`; controls ≥44px (or 36px where the dense exception applies); tab strips full-width; charts fit without squashed labels; 1280×800 pixel-identical.
