# Mobile Overlay Primitives — Design (Phase 1 of the mobile-responsive build)

## Goal

Every overlay surface in the app (13 components on the custom `Modal`, 5 on `Sheet`, 11 on Radix `Dialog`/`AlertDialog`) was designed for desktop: centred panels, fixed pixel widths, `100vh` math, and a z-index order in which the custom `Modal` (z-40) sits *below* the mobile bottom nav (z-50) and the drawer `Sheet` (z-50). On a phone that means modals can render under the nav bar, behind a sheet, or taller than the visible viewport. Slice 1's final review hit exactly this ("modals open behind the drawer").

This slice makes the three overlay primitives themselves mobile-aware, so all 29 consumers get correct mobile chrome without being rewritten. Phase 2 can then concentrate on each modal's *content* on a small screen, not its housing.

## Decisions (made autonomously per user instruction; alternatives noted)

1. **Adapt the existing primitives, don't add new ones.** Considered (A) new `BottomSheet`/`ActionSheet`/`FullScreenForm` components + migrating 13 consumers; (B) teach `Modal`, `Sheet`, `Dialog`/`AlertDialog` a mobile presentation gated by `useIsMobile()`; (C) add `vaul`. Chose B: zero consumer rewrites for chrome, one place to get safe-areas/z-index/scroll-lock right, desktop provably byte-identical. C rejected (new dependency for what Radix Dialog + framer-motion already cover; `vaul` is not installed).
2. **Presentation by `Modal` size.** `sm`/`md` → bottom sheet (`max-h-[92dvh]`, grabber, rounded top). `lg` → full-screen form (inset-0, sticky header + footer). Rationale: every `lg` consumer is a real form (edit, bulk edit, split, shared, group, group transfer, email links) that needs the whole screen; every `sm`/`md` is a short decision or a small form.
3. **One z-index scale, documented in `globals.css`.** Bottom nav 40 → Sheet 50 → quick-actions panel 55 → Modal 60 → Dialog/AlertDialog 70 → toasts (sonner, unchanged, highest). Confirmations must always win; modals must cover the nav; the panel's scrim must cover the nav so a stray tap cannot navigate away mid-gesture.
4. **No drag-to-dismiss.** Sheets and modals dismiss via scrim tap, the close button, Escape, or the footer's Cancel. Consistent with Slice 1's "no gesture-only interactions" rule; avoids a scroll-vs-drag conflict inside scrollable sheet bodies.
5. **Motion:** transform/opacity only, framer-motion spring (`stiffness: 380, damping: 34`) for the slide-up, `useReducedMotion()` → opacity-only. Exit is roughly 70% of enter duration.
6. **Stay in theme.** No new colour tokens or fonts. Grabber uses `bg-border`; sheet surface uses `--modal-panel` / `bg-card`; radius uses the existing scale (`rounded-t-2xl`).

## Current state (verified)

- `frontend/src/components/ui/modal/index.tsx`: `createPortal` to `document.body`, root `fixed inset-0 z-40`, panel `my-10 max-h-[calc(100vh-5rem)]`, `max-md:w-[calc(100vw-24px)]`; `Modal.Body` `max-h-[70vh]`; scroll lock sets `document.body.style.overflow = "hidden"` and clears it to `""` on close (breaks Radix's lock when a Sheet is still open — final-review M7).
- `frontend/src/components/ui/sheet.tsx`: Radix Dialog; overlay and content `z-50`; `side="bottom"` has no max-height, safe-area padding, or grabber. Consumers hand-roll grabbers (`transaction-details-drawer.tsx`).
- `frontend/src/components/ui/dialog.tsx`, `alert-dialog.tsx`: Radix, `z-50`, centred with translate(-50%,-50%); `max-w-[calc(100%-2rem)]` on mobile.
- `frontend/src/components/layout/mobile-nav.tsx`: `fixed bottom-0 z-50`, height `3.5rem + env(safe-area-inset-bottom)`.
- `frontend/src/components/transactions/transaction-quick-actions-panel.tsx`: `fixed inset-0 z-40` (below the nav; no Escape handling; no `role`).
- `useIsMobile()` exists (`frontend/src/hooks/use-is-mobile.ts`, `(max-width: 767px)`, SSR-safe false-first).
- Deps available: `framer-motion@12`, `@radix-ui/react-dialog`, Tailwind 4. No `vaul`.

## Component 1: `Modal` — mobile presentations

**File:** `frontend/src/components/ui/modal/index.tsx` (modified; API unchanged, one optional prop added)

- New optional prop `presentation?: "auto" | "sheet" | "fullscreen" | "center"` (default `"auto"`: desktop → `center`; mobile → `sheet` for `sm`/`md`, `fullscreen` for `lg`). Consumers need not pass it.
- Root: `fixed inset-0 z-[60]`. Backdrop unchanged (`bg-black/50 backdrop-blur-sm`).
- `sheet`: panel `absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-x-0 border-b-0 max-h-[92dvh] flex flex-col`, grabber (`h-1 w-9 rounded-full bg-border mx-auto mt-2 mb-1`), `pb-[env(safe-area-inset-bottom)]`. Enter `y: "100%" → 0`; exit `y: "100%"`.
- `fullscreen`: panel `absolute inset-0 rounded-none border-0 flex flex-col`, `pt-[env(safe-area-inset-top)]`. Same slide-up.
- `center` (desktop): existing classes, unchanged.
- `Modal.Header` on mobile: `px-4 py-3`, title `text-base`; keeps sticky + variant pill. `Modal.Body` on mobile: `flex-1 min-h-0 overflow-y-auto px-4 py-3` (no `max-h`; the panel's `max-h-[92dvh]` / `inset-0` bounds it). `Modal.Footer` on mobile: `px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`, children stretch (`[&>*]:flex-1`), solid `bg-[var(--modal-panel)]` (no gradient) so content never shows through it.
- Scroll lock: save `document.body.style.overflow` before setting `hidden`; restore the saved value on close.
- Reduced motion: `useReducedMotion()` from framer-motion → `initial/animate/exit` use opacity only.
- Desktop rendering path is byte-identical to today (the `center` branch reuses the current class strings verbatim).

## Component 2: `Sheet` — bottom-side hardening

**File:** `frontend/src/components/ui/sheet.tsx` (modified)

- `side="bottom"` gains `max-h-[92dvh] overflow-y-auto rounded-t-2xl` and `pb-[env(safe-area-inset-bottom)]` in its default classes (consumer `className` still merges after).
- New `showGrabber?: boolean` prop on `SheetContent` (default `true` when `side === "bottom"`): renders the same grabber as `Modal`. `transaction-details-drawer.tsx` drops its hand-rolled grabber div and relies on this.
- `z-50` unchanged for overlay and content.

## Component 3: `Dialog` / `AlertDialog` — mobile bottom anchoring

**Files:** `frontend/src/components/ui/dialog.tsx`, `frontend/src/components/ui/alert-dialog.tsx` (modified)

- Overlay and content move to `z-[70]` (above Modal at 60) so confirmations always stack on top.
- Below `md` (pure CSS, no JS branch): content anchors to the bottom — `bottom-0 left-0 right-0 top-auto translate-x-0 translate-y-0 w-full max-w-full rounded-t-2xl rounded-b-none border-x-0 border-b-0 pb-[max(1.5rem,env(safe-area-inset-bottom))]` with `slide-in-from-bottom` / `slide-out-to-bottom`; at `md:` and up the existing centred classes apply verbatim. `DialogFooter` / `AlertDialogFooter` already stack `flex-col-reverse` below `sm` — buttons become full-width there (`[&>*]:w-full sm:[&>*]:w-auto`).
- `ConfirmationDialog` and `DeleteConfirmationDialog` inherit this with no change.

## Component 4: z-index scale + panel hardening

- `frontend/src/components/layout/mobile-nav.tsx`: nav `z-50` → `z-40`.
- `frontend/src/components/transactions/transaction-quick-actions-panel.tsx`: root `z-40` → `z-[55]`; add `role="dialog" aria-modal="true" aria-label="Transaction actions"`; Escape key closes (document listener in an effect, cleaned up); scrim `bg-black/55` unchanged.
- `frontend/src/app/globals.css`: a comment block near the top documenting the scale (nav 40 · sheet 50 · quick-actions panel 55 · modal 60 · dialog/alert 70 · toast).
- `frontend/src/components/transactions/action-tile-grid.tsx`: `ActionTile.key` widened to `TransactionActionType | "edit" | "select"` (final-review M1) and the panel's Edit/Select tiles use those keys.

## Fold-ins from the Slice 1 final review (Minor, cheap)

- M2 `transaction-card-list.tsx`: remove `space-y-1.5` from the per-day row wrapper so the 1px dividers abut; keep `mb-3` between day groups.
- M4 `transaction-filters.tsx` mobile branch: when `hasActiveFilters`, append a `Clear` chip (X icon + "Clear") at the end of the horizontally-scrolling chip row that calls `onClearFilters`.

## Out of scope (later slices)

Content/layout of the 13 modals themselves; category/tag pickers (Popover/Command) on mobile; the Import workflow sheet's internals; pages other than Transactions.

## Verification (manual; no test runner in this repo)

Mobile = browser pane at 375×812; desktop = explicit 1280×800 (the "desktop" preset is under the breakpoint). **Never save/submit any form during verification — open, inspect, cancel.** No transaction, budget, category, tag, or participant may be created, edited, or deleted.

1. Transactions → tap a row → drawer: grabber present (from `Sheet`), no duplicate grabber.
2. From the drawer: Shared, Split, Group, Recurring, Links each open as a bottom sheet (`sm`) or full-screen form (`lg`) *above* the nav, with visible grabber / sticky header, scrollable body, footer buttons full-width; scrim tap + X + Escape dismiss; nothing renders under the nav.
3. Header `+` → Add Transaction (`md`) is a bottom sheet with its footer fully visible above the safe area.
4. Selection mode → Edit → Bulk Edit (`lg`) is full-screen; Delete → confirmation anchors to the bottom above everything (z-70).
5. Budgets → Add Budget (`sm`) is a bottom sheet (cancel without saving).
6. Long-press a row: panel scrim covers the nav; Escape closes it.
7. Filters: with a filter active, a `Clear` chip is reachable at the end of the chip row.
8. Rows: dividers touch (no 6px gap).
9. `document.documentElement.scrollWidth === 375` on Transactions, Budgets, Analytics after each overlay closes (no leaked overflow); body scroll works again after closing a Modal that was opened over an open Sheet.
10. Desktop 1280×800: every modal/dialog above is centred exactly as before (compare against `git stash` if in doubt); nav is the sidebar; no visual change.
