# Mobile Modal Internals — Design (Phases 2c + 2d)

## Goal

After Phases 1–2b, every transaction modal has correct mobile housing (full-screen or bottom sheet), sheet-style pickers, and — for Add/Edit/Bulk — mobile-sized fields. The remaining ten surfaces still have desktop-sized internals: 12px tappable text, 32px buttons, hover-revealed controls, 2–3 column field grids, and fixed-width inputs in flex rows. They are:

- 2c (splitting/grouping): `shared-expense-editor.tsx` (609 lines), `split-transaction-modal.tsx` (390), `group-expense-search-modal.tsx` (364), `group-expense-modal.tsx` (271), `group-transfer-modal.tsx` (461)
- 2d (linked data): `email-links-drawer.tsx` (497), `email-card.tsx` (556), `related-transactions-drawer.tsx` (610), `recurring-modal.tsx` (243), `pdf-viewer.tsx` (259), `workflow-sheet.tsx` (1460, the Import sheet)

A verified survey found: almost no CSS grids (three `grid-cols-2/3` total), no tables, two `w-[72px]` fixed inputs, zero existing `md:` variants in any of them, and 70+ `text-xs` tappables. So this is not a layout rewrite; it is a systematic touch/typography pass.

## Decision: a rulebook, applied file by file (autonomous; alternatives noted)

Rather than a bespoke redesign per modal (10× the design effort with no browser to validate against), each file gets the same mechanical, reviewable rules. Every rule is mobile-first with an `md:` counterpart that restores the exact current desktop value, so desktop stays byte-identical and each change is individually auditable in review. Rejected: rewriting these modals as new mobile components (they carry real business logic — split maths, group membership, email linking — that must not be re-implemented without tests); leaving them (they are reachable from the drawer's action grid, so they are now first-class mobile flows).

## The rulebook (binding for every file in scope)

- **R1 Inputs.** Any `Input`, `Textarea`, `SelectTrigger`, or `MoneyInput` whose current height is `h-8`/`h-9`/`h-10` (or unset) gets `h-11 md:h-<current>` (unset → `md:h-9`, the `Input` default) and `text-base md:text-<current>` (unset → `md:text-sm`). Amount/number inputs additionally get `inputMode="decimal"`. Search inputs get `inputMode="search"`.
- **R2 Buttons.** Text buttons (`Button`, `<button>` with a label) get `min-h-11 md:min-h-0`. Icon-only buttons sized `h-6/7/8 w-6/7/8` get `h-11 w-11 md:h-<current> md:w-<current>`; if they are inside a dense row where 44px would break the row, use `h-9 w-9` on mobile instead and note it. Never change a button's variant, colour, or handler.
- **R3 Tappable list rows.** `ResultItem`, candidate rows, participant rows, email rows, split-part rows: `min-h-11 md:min-h-0` and `py-3 md:py-<current>`; row text that is `text-xs` and is the row's primary label becomes `text-sm md:text-xs`.
- **R4 Field grids.** `grid-cols-2` / `grid-cols-3` of form fields → `grid-cols-1 md:grid-cols-<n>`. Grids of *stats* (read-only numbers) may keep 2 columns on mobile if each cell fits in 160px; 3-column stat grids → `grid-cols-2 md:grid-cols-3`.
- **R5 Fixed widths in rows.** A `w-[72px]`-style input in a flex row keeps its width but the row gets `flex-wrap` (mobile) with `md:flex-nowrap`; if the row has ≥3 controls, it becomes `flex-col md:flex-row` with `gap-2`.
- **R6 Hover-only reveals.** `opacity-0 group-hover:opacity-100` (and `invisible group-hover:visible`) → `opacity-100 md:opacity-0 md:group-hover:opacity-100` so controls are always visible on touch devices.
- **R7 Labels and helper text** stay at their current size (`text-xs` labels are fine). Only *tappable* `text-xs` becomes `text-sm md:text-xs`.
- **R8 Horizontal safety.** Any row of chips/badges gets `flex-wrap` or `overflow-x-auto`; any `min-w-[…px]` ≥ 320 gets `min-w-0 md:min-w-[…]`. Nothing may widen the modal beyond the viewport.
- **R9 Sticky footers.** If a file renders its own action bar outside `Modal.Footer` (e.g. a bottom "Save split" row), give it `sticky bottom-0 bg-[var(--modal-panel)] pt-3 md:static md:bg-transparent md:pt-0`.
- **R10 No logic.** No handler, state, prop, copy, colour, or icon changes. `git diff` per file must be className/attribute-only (plus `inputMode`).
- **R11 Workflow sheet exception.** `workflow-sheet.tsx` is a Radix `Sheet` (side-panel on desktop). On mobile it becomes `side="bottom"` with the Phase 1 defaults; its internal progress tree keeps its layout; only R1/R2/R6/R8 apply to its header/action controls. Do not restructure the tree.

## Per-file notes (from the survey)

- `shared-expense-editor.tsx`: two hover-only reveals (R6); participant rows (R3); split-amount inputs (R1).
- `split-transaction-modal.tsx`: `w-[72px]` percentage input in a part row (R5); part rows (R3); `KeepOriginalToggle` untouched.
- `group-expense-search-modal.tsx`: search input (R1 `inputMode="search"`); candidate rows (R3).
- `group-expense-modal.tsx`: `grid-cols-3` (stats or fields? — implementer decides per R4 and states which).
- `group-transfer-modal.tsx`: transfer rows (R3); amount inputs (R1).
- `email-links-drawer.tsx`: `grid-cols-2` (R4); search input (R1); link/unlink buttons (R2).
- `email-card.tsx`: many `text-xs` actions (R7/R2); expandable body — keep.
- `related-transactions-drawer.tsx`: `w-[72px]` (R5); 18 `text-xs` tappables (R7/R2).
- `recurring-modal.tsx`: `grid-cols-2` period picker → keep 2 columns (each cell short) but rows `min-h-11` (R3).
- `pdf-viewer.tsx`: already `w-full sm:max-w-4xl`; toolbar buttons (R2) only.
- `workflow-sheet.tsx`: R11.

## Verification (per file, code-level; browser checks batched for later)

Reviewer checks: every changed class has its `md:` restore; no logic diff; no widening; `npm run type-check`/`lint` clean. Browser list (once logged in, never submit): open each surface from the drawer's action grid at 375×812 — all controls ≥44px, no horizontal overflow, hover-only controls visible, footers reachable above the safe area; at 1280×800 each modal is pixel-identical to before.
