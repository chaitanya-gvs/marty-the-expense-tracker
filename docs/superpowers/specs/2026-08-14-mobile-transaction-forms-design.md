# Mobile Transaction Forms — Design (Phase 2b)

## Goal

With Phase 1 (overlay housing) and Phase 2a (pickers) in place, the three forms a user actually fills in day-to-day on a phone — **Add Transaction**, the **details drawer's edit form**, and **Bulk Edit** — still have desktop-shaped internals: three-column grids that overflow 375px, 14px inputs that make iOS zoom on focus, 20px-tall segmented buttons, raw HTML `<input>`/`<select>`/checkbox elements in the drawer that ignore the design system. This slice makes each form comfortable to use one-handed, without changing what it does or how it looks at ≥768px.

## Decisions (autonomous; alternatives noted)

1. **Amount first on mobile.** Add Transaction leads with a large mono amount field and a full-width Debit/Credit segmented control; Date, Account, Description, Category, Tags follow, stacked. Every finance app the user is likely to compare against (bank apps, Splitwise) leads with amount; the desktop 3-column row is preserved at `md:` via grid + `order-*`. Rejected: keeping desktop order on mobile (date first is a mouse-and-keyboard habit, not a thumb one).
2. **16px inputs on mobile, 14px on desktop.** `text-base md:text-sm` on every text/number/date input in these forms. iOS Safari auto-zooms on focus below 16px; that zoom is the single most common "this feels broken" moment on mobile web forms. Desktop typography unchanged.
3. **44px touch rows, 40–44px controls.** Segmented mode buttons in Bulk Edit grow to `min-h-9 px-3` on mobile (they are secondary, inside a row that itself is `min-h-11`); Switch rows, list rows and select triggers are `min-h-11`. Desktop sizes unchanged via `md:`.
4. **Drawer edit form uses the design system.** Raw `<input>`, `<select>`, `<input type=checkbox>` are replaced by `Input`, `Select`, and `Switch` from `components/ui`, with a small local `Field` label wrapper. This is the repo's own convention (`frontend/CLAUDE.md`: "always use these, don't add raw HTML form elements") and gives focus rings, disabled states and dark-theme tokens for free. The drawer is only ever rendered by the mobile card list, so there is no desktop path to preserve here.
5. **`inputMode="decimal"` for amounts.** Brings up the numeric keypad with a decimal point on both platforms; no effect on desktop.
6. **No new components beyond the local `Field` helper.** The forms keep their state, validation, mutations and copy exactly as they are.

## Current state (verified)

- `frontend/src/components/transactions/add-transaction-modal.tsx`: row 1 is `grid grid-cols-[auto_1fr_160px] gap-3 items-end` (Date · Amount · Direction), row 4 is `grid grid-cols-2 gap-3` (Category · Tags); all inputs `text-sm`; direction toggle `h-9`.
- `frontend/src/components/transactions/bulk-edit-modal.tsx`: three field cards each with a `Switch` + label row and a segmented mode control built from `px-2 py-0.5 text-xs` buttons; inputs `h-10`; selected-transactions list rows `p-2 text-xs`.
- `frontend/src/components/transactions/transaction-details-drawer.tsx` edit branch (lines ~389–533): raw `<input>`/`<select>`/checkbox elements styled by hand; Advanced section uses `grid-cols-2` for Date/Account and Direction/Amount; Cancel/Save buttons already `flex-1`.
- Modal (`sm`/`md` → sheet, `lg` → fullscreen on mobile) and pickers (bottom sheets) are already mobile-aware.

## Component 1: Add Transaction

**File:** `add-transaction-modal.tsx` (modified; logic untouched)

- Row 1 wrapper → `grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_160px] md:items-end`; children ordered `Amount (order-1 md:order-2)`, `Direction (order-2 md:order-3)`, `Date (order-3 md:order-1)`.
- Amount input: `pl-7 font-mono tabular-nums text-xl h-12 md:text-sm md:h-9`, `inputMode="decimal"`; the `₹` prefix scales with `text-base md:text-sm`.
- Direction control: `h-11 md:h-9`, segment labels `text-sm md:text-xs`.
- Date input: `w-full md:w-auto text-base md:text-sm h-11 md:h-9`.
- Account (`FieldAutocomplete`) and Description inputs: `text-base md:text-sm h-11 md:h-9` (pass `className` to `FieldAutocomplete`, which already forwards it to its root; if it does not reach the inner `Input`, leave it — the picker slice may revisit).
- Row 4 wrapper → `grid grid-cols-1 gap-3 md:grid-cols-2`.
- Footer buttons: unchanged (Modal footer already stretches them on mobile).

## Component 2: Bulk Edit

**File:** `bulk-edit-modal.tsx` (modified; logic untouched)

- Each field card's header row: `flex items-center gap-3 min-h-11 md:min-h-0`.
- Segmented mode buttons: `px-3 py-1.5 text-xs md:px-2 md:py-0.5` (all nine buttons); the segmented container stays.
- Inputs: `h-11 md:h-10 text-base md:text-sm`.
- Selected-transactions rows: `p-2.5 md:p-2 min-h-11 md:min-h-0 text-sm md:text-xs`.
- The "N selected transactions" disclosure button: `min-h-11 md:min-h-0`.

## Component 3: Drawer edit form

**File:** `transaction-details-drawer.tsx` (edit branch rewritten; state, effects, `handleSave`, `handleCancel`, tag buffers unchanged)

- Local `Field` helper: `({ label, children })` → `<div><Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">{label}</Label>{children}</div>`.
- Description → `<Input className="h-11 text-base" />`.
- Category, Tags, unresolved-tag chips, Notes: unchanged controls, wrapped in `Field`.
- Advanced: Date `<Input type="date" className="h-11 text-base" />` and Account `<Input className="h-11 text-base" />` stacked (`grid-cols-1`); Direction via ui `Select` (`SelectTrigger className="h-11 text-base"`, items "Debit (money out)" / "Credit (money in)"); Amount `<Input type="number" inputMode="decimal" className="h-11 text-base font-mono tabular-nums" />`; Direction and Amount side-by-side (`grid-cols-2`).
- Flags: three `Switch` rows (`flex items-center justify-between min-h-11`), labels Shared / Refund / Transfer.
- Advanced disclosure button: `min-h-11`.
- Buttons: unchanged.

## Out of scope

Split / Shared / Group / Group Transfer modal internals (Phase 2c); Email Links, PDF viewer, Related Transactions, Recurring, Import sheet (2d); Budgets forms (3b); the `Button` primitive's tactile `active:` state (Phase 4 polish, one global change).

## Verification (once browser access is restored; never submit a form)

375×812: `+` → Add Transaction: amount field is first, large, numeric keypad with decimal; Debit/Credit control is full-width and 44px; no horizontal overflow (`scrollWidth === 375`); focusing any input does not zoom the page; Cancel. Drawer → Edit: all fields are design-system controls, Advanced shows Date/Account stacked, Direction/Amount side by side, three Switch rows; Cancel. Selection → Edit (Bulk Edit): mode buttons are comfortably tappable, list rows ≥44px; Cancel.
1280×800: Add Transaction row 1 is Date · Amount · Direction in one row, inputs 14px, exactly as before; Bulk Edit segmented buttons and inputs at their previous sizes.
