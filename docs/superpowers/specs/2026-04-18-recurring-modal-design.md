# Recurring Transaction Modal — Design Spec

**Date:** 2026-04-18  
**Branch:** feature/budgets  
**Status:** Approved  

---

## Overview

Replace the plain Radix `Popover` used for marking transactions as recurring with a proper centred `Modal` matching the app's existing modal design system. No backend changes required — the `PATCH /api/transactions/{id}/recurring` endpoint and `useSetRecurring` hook are already fully implemented.

---

## Problem

The current `RecurringPeriodPopover` renders a basic dropdown that:
- Uses Radix `Popover` instead of the app's `Modal` component
- Has inconsistent visual styling vs all other action button modals
- Lacks sublabels on period options
- Has no destructive "Remove Recurring" path when already recurring
- Shows the trigger as a rectangular pill instead of the consistent `rounded-full` button (already fixed in a prior commit)

---

## Solution

Rename `recurring-period-popover.tsx` → `recurring-modal.tsx` and rewrite it using the app's `Modal` component (`src/components/ui/modal/index.tsx`). Update the import in `transaction-columns.tsx`.

---

## Modal Design

### Trigger
The trigger remains the existing `rounded-full` button in the action icons row (already fixed). Clicking it opens the modal.

### Header
- **Icon pill:** indigo `RefreshCw` icon — `bg-[#6366f1]/20 text-[#6366f1]` (same pattern as split modal)
- **Title:** "Set Recurring" (not yet recurring) / "Edit Recurring" (already recurring)
- **Subtitle:** `{description} · {formatCurrency(amount)} · {category}` — gives transaction context without scrolling
- **Close button:** top-right ✕

### Body

**Section 1 — Recurrence Period**  
Label: `RECURRENCE PERIOD` (uppercase, muted)  
A 2×2 grid of selectable option tiles. Each tile has:
- A coloured dot indicator (indigo when active, muted when inactive)
- Primary label (`Monthly`, `Quarterly`, `Yearly`, `Custom`)
- Sublabel (`Every month`, `Every 3 months`, `Once a year`, `Set interval`)
- Active state: `border-indigo-500 bg-indigo-500/15 text-indigo-300`
- Inactive state: `border-border bg-muted/40` with hover highlight

**Section 2 — Recurring Key**  
Label: `RECURRING KEY` (uppercase, muted)  
A read-only display row showing the auto-generated slug (e.g. `claude-pro`).  
- Tap/click the key badge to switch to an inline text input for manual override
- Helper text: "Used to group the same subscription across months"
- Key is auto-generated from transaction description if not manually set

### Footer

**Not yet recurring:**
- Right-aligned: `Cancel` (ghost) + `Mark Recurring` (indigo primary with ↻ icon)

**Already recurring:**
- Left: `✕ Remove Recurring` (destructive ghost — `text-destructive border border-destructive/30`)
- Right: `Cancel` (ghost) + `Save Changes` (indigo primary with ✓ icon)

---

## States

| State | Condition | Title | Footer |
|-------|-----------|-------|--------|
| New | `transaction.is_recurring !== true` | Set Recurring | Cancel + Mark Recurring |
| Edit | `transaction.is_recurring === true` | Edit Recurring | Remove + Cancel + Save |
| Loading | mutation in flight | — | Buttons disabled, spinner on primary |

---

## Component API

```tsx
interface RecurringModalProps {
  transaction: Transaction;
  open: boolean;
  onClose: () => void;
}
```

The trigger button (`RecurringModalTrigger`) remains a separate thin component exported from the same file so `transaction-columns.tsx` can render it inline in the action bar.

```tsx
// transaction-columns.tsx usage (unchanged pattern)
<RecurringModalTrigger transaction={transaction} />
```

`RecurringModalTrigger` owns the `open` state internally — it renders the `rounded-full` button and passes `open/onClose` to `RecurringModal`.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/transactions/recurring-period-popover.tsx` | Delete |
| `frontend/src/components/transactions/recurring-modal.tsx` | Create — new Modal-based component |
| `frontend/src/components/transactions/transaction-columns.tsx` | Update import: `RecurringPeriodPopover` → `RecurringModalTrigger` |

---

## What Does NOT Change

- Backend: no changes
- `useSetRecurring` hook: no changes
- `transaction-edit-modal.tsx` recurring checkbox: no changes
- All other action buttons: no changes

---

## Acceptance Criteria

- [ ] Clicking the ↻ button opens a centred modal with backdrop blur
- [ ] Modal uses `Modal` component (`sm` size = 420px)
- [ ] Period tiles are selectable with indigo active state
- [ ] Recurring key is displayed and editable inline
- [ ] "Mark Recurring" saves and closes modal; toast confirms
- [ ] "Remove Recurring" clears the recurring fields; toast confirms
- [ ] Buttons are disabled and primary shows spinner during mutation
- [ ] Escape key and backdrop click close the modal
- [ ] Already-recurring transactions open in edit state with current values pre-filled
