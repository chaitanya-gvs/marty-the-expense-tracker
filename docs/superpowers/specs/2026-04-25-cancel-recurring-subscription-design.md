# Cancel Recurring Subscription Design

## Goal

Allow a user to stop the budget system from projecting a recurring subscription as "Upcoming" — for example, after cancelling a service like Cursor or Netflix. Past transaction history is preserved; only future projections are removed.

## Problem

The budget system identifies projected recurring items by scanning past transactions with `is_recurring = true`. There is no concept of a subscription "ending," so cancelled subscriptions continue appearing as Upcoming projections indefinitely.

## Chosen Approach

**Keep history, unmark as recurring.** When the user stops tracking a subscription, all past transactions sharing that `recurring_key` are bulk-updated: `is_recurring = false`, `recurring_key = null`, `recurrence_period = null`. Historical transactions remain in the database as normal debit transactions. The budget service's projected query already filters `is_recurring = true`, so unmarked transactions naturally disappear from projections — no budget service changes needed.

To re-enable tracking later (e.g. re-subscribing), the user simply marks a new transaction as recurring again, starting fresh.

## Entry Point

The action is surfaced exclusively on the **Upcoming rows inside the expanded budget card**. Each projected item row gets an ✕ button on the right. This is where the user notices the problem (seeing a cancelled subscription projected as Upcoming) and where the fix is most discoverable.

No changes to the recurring modal in the transaction list for this iteration.

## UX Flow

1. User expands a budget card and sees a cancelled subscription in the Upcoming section.
2. User clicks ✕ on that row.
3. An **inline confirmation band** appears beneath the row (red-tinted), showing: *"Unmark N past transactions as recurring — stops future projections."* with **Confirm** and **Cancel** buttons.
4. The count `N` is fetched from the backend when ✕ is clicked (via `GET /api/transactions/recurring/{key}/count`).
5. User clicks Confirm → mutation fires → on success, `["budgets"]` and `["transactions"]` query caches are invalidated → card re-fetches → the Upcoming row disappears.
6. Only one confirmation band can be open at a time per card (clicking ✕ on a second row closes the first).

## Backend

### New endpoint: cancel recurring key
```
PATCH /api/transactions/recurring/{recurring_key}/cancel
```
- Bulk-updates all non-deleted transactions where `recurring_key = :key`:
  - `is_recurring = false`
  - `recurring_key = null`
  - `recurrence_period = null`
- Returns `{ updated_count: N }`.
- 404 if no matching transactions found.

### New endpoint: count recurring transactions
```
GET /api/transactions/recurring/{recurring_key}/count
```
- Returns `{ count: N }` — the number of non-deleted transactions with that `recurring_key`.
- Used to populate the confirmation message before the user commits.

### Location
Both endpoints live in `backend/src/apis/routes/transaction_write_routes.py`. DB operations go in `backend/src/services/database_manager/operations/transaction_operations.py`.

## Frontend

### `frontend/src/lib/api/client.ts`
Two new methods:
- `getRecurringCount(recurringKey: string): Promise<{ count: number }>`
- `cancelRecurring(recurringKey: string): Promise<{ updated_count: number }>`

### `frontend/src/hooks/use-budgets.ts`
New mutation hook:
```ts
useCancelRecurring()
```
On success: invalidates `["budgets"]` and `["transactions"]` query keys.

A separate query hook (or inline `useQuery`) fetches the count when a confirmation band is open:
```ts
useRecurringCount(recurringKey: string | null)
```
Enabled only when `recurringKey` is non-null (i.e. ✕ has been clicked).

### `frontend/src/components/budgets/budget-card.tsx`
- Upcoming rows gain an ✕ button (`XCircle` icon, `text-muted-foreground/40 hover:text-red-400`).
- Component tracks `confirmingKey: string | null` state — the `recurring_key` of the row currently showing its confirmation band.
- Clicking ✕ sets `confirmingKey` to that row's key (closes any other open band).
- When `confirmingKey` matches a row, an inline red band renders beneath it showing the count (loading skeleton while fetching) and Confirm/Cancel.
- Clicking Cancel sets `confirmingKey = null`.
- Clicking Confirm calls `cancelRecurring(confirmingKey)`, then resets state on success.

## What Does Not Change

- `budget_service.py` — no changes. The existing `projected_rows` query filters `is_recurring = true`; unmarked transactions are automatically excluded.
- Transaction history — records remain, amounts unchanged, just no longer flagged as recurring.
- The recurring modal on individual transactions — unchanged for this iteration.
