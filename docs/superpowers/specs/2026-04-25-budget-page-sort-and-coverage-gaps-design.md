# Budget Page: Sort Controls & Enhanced Coverage Gap Warning

**Date:** 2026-04-25

**Goal:** Add a sort dropdown to the budget cards list, and upgrade the existing "no budget" warning into a full coverage gap panel with two sections (recurring gaps + variable spend gaps), working "Create budget" shortcuts, and period-aware backend data.

**Architecture:** Pure-frontend sort via `useMemo` in `BudgetsList`. Backend gains a new `get_budget_coverage_gaps(period)` function returning two separate gap arrays. `BudgetCreateModal` is lifted to `budgets/page.tsx` so both the "Add Budget" button and gap-row shortcuts share one modal instance with optional category pre-fill.

**Tech Stack:** FastAPI, SQLAlchemy async raw SQL, Next.js 15 App Router, TanStack React Query, TypeScript, Tailwind CSS 4, Lucide React

---

## Feature 1 — Sort Controls

### UI

A `<select>` dropdown added inline to the `BudgetsList` header row, between the "Monthly Budgets · N active" label and the "Add Budget" button.

**Sort options (value → behaviour):**

| Value | Label | Sort key |
|---|---|---|
| `utilisation_desc` | ↓ Utilisation % | `utilisation_pct` descending |
| `name_asc` | A → Z | `name ?? category_name` ascending, case-insensitive |
| `spend_desc` | ↓ Amount spent | `committed_spend + variable_spend` descending |
| `headroom_asc` | ↑ Headroom | `headroom` ascending (least room first) |

**Default:** `utilisation_desc` — puts the most stressed budgets at the top on page load.

### Implementation

- `BudgetsList` gains a `sortKey` state (`useState<SortKey>("utilisation_desc")`).
- A `useMemo` derives `sortedBudgets` from the `budgets` prop. No backend call; all data is already in memory.
- The select renders with `bg-transparent text-xs text-muted-foreground` styling to match the existing header row aesthetic. No external library needed.

### Files changed

- `frontend/src/components/budgets/budgets-list.tsx` — add sort state, useMemo, select element

---

## Feature 2 — Enhanced Coverage Gap Warning

### What it replaces

The current `NoBudgetWarning` component shows a single yellow panel: *"Recurring expenses without a budget"*, listing categories by `recurring_count`. The "Create budget →" button is a no-op (`onCreateBudget: () => {}`).

### New design

Two sections inside a single panel (each section hidden if its list is empty; entire panel hidden if both empty):

**Section 1 — Recurring without a budget**
Each row: `{category name} — {recurring_count} recurring transaction(s) · ₹{projected_amount}/mo projected`

**Section 2 — Unbudgeted variable spending this month**
Each row: `{category name} — ₹{variable_spend} spent, {transaction_count} transaction(s)`

Each row in both sections has a "Create budget →" button that opens `BudgetCreateModal` pre-filled with that category.

### Backend

**New function:** `get_budget_coverage_gaps(period: str)` in `src/services/database_manager/operations/budget_operations.py`

Returns:
```python
{
    "recurring_gaps": [
        {"id": str, "name": str, "recurring_count": int, "projected_amount": float}
    ],
    "variable_gaps": [
        {"id": str, "name": str, "variable_spend": float, "transaction_count": int}
    ]
}
```

**Recurring gaps query:** Categories that have `is_recurring = true` debit transactions (not deleted, not grouped) but no row in the `budgets` table for that `category_id`. The `projected_amount` is computed by taking the most recent `COALESCE(split_share_amount, amount)` per `recurring_key` via `DISTINCT ON ... ORDER BY transaction_date DESC`, then summing those amounts per category — matching the projection logic in `budget_service.py`.

**Variable gaps query:** Categories that have non-recurring debit transactions in the given period (between `period_start` and `period_end`) but no row in the `budgets` table. Returns `SUM(COALESCE(split_share_amount, amount))` as `variable_spend` and `COUNT(*)` as `transaction_count`. Excludes categories that already have a recurring gap (to avoid double-listing).

**Route change:** `GET /budgets/summary` in `budget_routes.py` passes `period` to `get_budget_coverage_gaps(period)` instead of calling `get_categories_with_recurring_but_no_budget()`. The response key changes from `unbudgeted_categories` to `coverage_gaps` (object with `recurring_gaps` and `variable_gaps` arrays).

**Old function removed:** `get_categories_with_recurring_but_no_budget()` is deleted once the route is updated.

### Frontend — TypeScript types

In `src/lib/types/index.ts`, replace `UnbudgetedCategory` with:

```typescript
export interface RecurringGap {
  id: string;
  name: string;
  recurring_count: number;
  projected_amount: number;
}

export interface VariableGap {
  id: string;
  name: string;
  variable_spend: number;
  transaction_count: number;
}

export interface BudgetCoverageGaps {
  recurring_gaps: RecurringGap[];
  variable_gaps: VariableGap[];
}
```

`BudgetsSummaryResponse` (or the inline type in `useBudgetsSummary`) updates `unbudgeted_categories: UnbudgetedCategory[]` → `coverage_gaps: BudgetCoverageGaps`.

### Frontend — Modal lift

`BudgetCreateModal` moves from `BudgetsList` up to `budgets/page.tsx`. State that moves up:
- `createOpen: boolean`
- `editingBudget: BudgetSummary | null`
- `defaultCategoryId: string | null` — new; passed to modal for pre-fill

`BudgetsList` receives two new props:
- `onAddBudget: () => void` — called by the "Add Budget" button (replaces inline `setCreateOpen`)
- `onEditBudget: (budget: BudgetSummary) => void` — called by budget card edit action

`BudgetCreateModal` receives a new optional prop:
- `defaultCategoryId?: string | null` — if set, pre-selects this category in the category dropdown on open

`NoBudgetWarning` receives:
- `coverageGaps: BudgetCoverageGaps` (replaces `categories: UnbudgetedCategory[]`)
- `onCreateBudget: (categoryId: string) => void` — now wired to open the modal

### Files changed

**Backend:**
- `backend/src/services/database_manager/operations/budget_operations.py` — add `get_budget_coverage_gaps(period)`, remove `get_categories_with_recurring_but_no_budget()`
- `backend/src/apis/routes/budget_routes.py` — update summary endpoint to call new function

**Frontend:**
- `frontend/src/lib/types/index.ts` — replace `UnbudgetedCategory` with `RecurringGap`, `VariableGap`, `BudgetCoverageGaps`
- `frontend/src/app/budgets/page.tsx` — lift modal state up, wire `onCreateBudget`
- `frontend/src/components/budgets/budgets-list.tsx` — add sort controls, accept new props, remove modal state
- `frontend/src/components/budgets/no-budget-warning.tsx` — redesign with two sections, working buttons
- `frontend/src/components/budgets/budget-create-modal.tsx` — accept `defaultCategoryId` prop

---

## Error Handling

- If `get_budget_coverage_gaps` query fails, the route logs the error and returns empty arrays for both gap lists — the warning panel simply won't show. Budgets still load normally.
- If `defaultCategoryId` is set but the category is not found in the dropdown list (e.g. it's a subcategory not eligible for budgets), the modal opens without a pre-selection.

## Testing

- Backend: unit test `get_budget_coverage_gaps` with a period that has both recurring and variable unbudgeted transactions; assert both arrays are populated correctly.
- Backend: assert categories that already have a budget do not appear in either gap list.
- Backend: assert a category with both recurring AND variable spend only appears once (in `recurring_gaps`, not both).
- Frontend: sort order test — given 3 budgets with known `utilisation_pct`, assert `sortedBudgets` order for each sort key.
- Frontend: `NoBudgetWarning` renders both sections when both arrays are non-empty; hides entire panel when both are empty.
