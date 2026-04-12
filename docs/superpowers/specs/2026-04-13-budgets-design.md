# Budgets Feature — Design Spec
**Date:** 2026-04-13
**Status:** Approved for implementation planning

---

## Overview

A category-based budgeting system with automatic committed spend detection from recurring transactions. Users set monthly budget templates per category, optionally override limits for specific months, and see a clear split between committed (recurring) spend and variable (one-off) spend — with real-time headroom.

---

## Goals

- Give the user a clear view of how much of each month's budget is already "spoken for" by recurring expenses
- Automatically compute committed spend from transactions already marked recurring — no manual linking required
- Surface threshold alerts at 50%, 75%, 95% utilisation so the user can act before overspending
- Allow browsing historical months to review past budget performance

---

## Non-Goals (punted to future)

- Rollover of unspent budget to next month
- `budget_committed_items` table for declaring future subscriptions not yet transacted
- Push/email notifications (in-app alerts only for now)
- Multi-currency budget normalisation (budgets are in INR; forex transactions like Claude are tracked at their INR equivalent as-transacted)

---

## Data Model

### 1. Transactions — new fields

Three new columns on the existing `transactions` table:

| Column | Type | Notes |
|---|---|---|
| `is_recurring` | `BOOLEAN` default `false` | Marks this transaction as a standing recurring commitment |
| `recurrence_period` | `TEXT` nullable | `monthly` · `quarterly` · `yearly` · `custom` |
| `recurring_key` | `TEXT` nullable | Normalised slug grouping same-subscription instances (e.g. `netflix`, `claude-pro`) |

`recurring_key` is auto-generated on save by normalising the description (lowercase, strip punctuation, trim merchant suffixes). The user can edit it manually if needed.

### 2. `budgets` table (new)

```sql
id              UUID PK   default gen_random_uuid()
category_id     UUID FK → categories.id   NOT NULL
monthly_limit   NUMERIC   NOT NULL
name            TEXT      nullable  -- display override; falls back to category name
created_at      TIMESTAMPTZ default now()
updated_at      TIMESTAMPTZ default now()

UNIQUE(category_id)  -- one template per category
```

### 3. `budget_overrides` table (new)

```sql
id              UUID PK   default gen_random_uuid()
budget_id       UUID FK → budgets.id   ON DELETE CASCADE
period          TEXT   NOT NULL   -- 'YYYY-MM' format
monthly_limit   NUMERIC   NOT NULL
created_at      TIMESTAMPTZ default now()

UNIQUE(budget_id, period)  -- one override per budget per month
```

---

## Spend Computation

All spend is computed dynamically — nothing is stored. For a given `budget_id` and `period` (YYYY-MM):

### Effective limit
```
effective_limit = override.monthly_limit  (if override exists for this period)
               OR budget.monthly_limit    (template fallback)
```

### Committed spend
1. Find all `is_recurring=true, is_deleted=false, direction='debit'` transactions in this category
2. Deduplicate using `DISTINCT ON (recurring_key)`, ordered by `transaction_date DESC` → one row per unique recurring item, using most recent known amount
3. Amortise by period:
   - `monthly` → amount × 1
   - `quarterly` → amount ÷ 3
   - `yearly` → amount ÷ 12
   - `custom` → amount × 1 (treated as monthly equivalent)
4. Sum all amortised amounts = `committed_spend`

**Before this month's charge arrives:** the most recent past transaction's amount is used as a projection (shown with a subtle "projected" indicator in the UI).

**After this month's charge arrives and is marked recurring:** the projection is replaced by the actual amount automatically.

### Variable spend
```
variable_spend = SUM(amount)
  WHERE is_recurring = false
    AND is_deleted = false
    AND direction = 'debit'
    AND category_id = budget.category_id
    AND transaction_date BETWEEN start_of_period AND end_of_period
```

### Headroom
```
headroom = effective_limit − committed_spend − variable_spend
```

Headroom can go negative (over budget). This is surfaced in red.

---

## Recurring Transaction UX

### In the transaction table (action icons row)

Each transaction row already has action icons on the right (share, group, split, email, flag, delete). A **↻ icon** is added to this set:

- **Not recurring:** ↻ icon is faint grey, visible on row hover. Click → period picker popover
- **Recurring:** ↻ icon is highlighted purple + a small period badge appears (`Monthly`, `Quarterly`, etc.)

**Period picker popover** (appears on click):
```
○ Monthly
○ Quarterly
○ Yearly
○ Custom
────────────
✕ Remove recurring
```

### In the edit modal

A `Recurring` checkbox is added inline with the existing `Shared` and `Refund` flags. When checked, a period selector appears to the right. Saving the modal updates `is_recurring`, `recurrence_period`, and auto-generates `recurring_key`.

### Recurring key assignment

On marking a transaction recurring:
1. `recurring_key` is auto-generated: `normalize(description)` (lowercase, strip numbers/punctuation, trim)
2. System checks for existing recurring transactions with the same `category_id` and a similar key
3. **If a close match exists** (existing recurring transaction in the same category whose `recurring_key` shares ≥ 80% of characters with the new key, using Levenshtein distance or similar — implementation detail): a one-time disambiguation prompt appears:
   > *"Looks like this might be the same as: Netflix (↻ Monthly, ₹199). Link them?"*
   > **Yes** / **No, it's different**
4. **If no ambiguity:** key is set silently. No prompt.
5. All transactions sharing a `recurring_key` within the same category = one committed slot in the budget.

---

## Budget Page UX

### Period navigation
A month picker at the top of the Budgets page. Defaults to current month. Allows browsing any past month to review historical budget performance. Future months are disabled.

### Overview strip (top of page)
Four summary cards:
- **Total Budget** — sum of effective limits across all budgets this month
- **Total Committed** — sum of committed spend across all budgets
- **Total Variable** — sum of variable spend across all budgets
- **Total Headroom** — total remaining (can be negative)

### Threshold alerts panel
Displayed below the overview strip when any budget is at or near its limit. Shows a list of budgets that have crossed a threshold, ordered by severity:

| Utilisation | Colour | Label |
|---|---|---|
| ≥ 95% | Red | Over budget / Critical |
| ≥ 75% | Orange | Warning |
| ≥ 50% | Yellow | Heads up |

The nav icon for Budgets also shows a badge when any budget is ≥ 75%.

### No-budget warning
If a category has `is_recurring=true` transactions but no budget template, a soft warning card appears:
> *"You have recurring expenses in [Category] (₹X/month) but no budget set up. [Create budget →]*"

### Budget cards (list below overview)

Each card displays:
- **Category name** + effective limit for this month
- **Stacked progress bar:**
  - Committed block (purple/indigo)
  - Variable spend block (green → yellow → orange → red based on utilisation)
  - Remaining headroom (dark/empty)
- **Inline legend:** `● Committed ₹X` · `● Variable ₹X` · `● Headroom ₹X`
- **Committed items breakdown** (collapsible): one line per `recurring_key` showing name + amortised monthly amount + period badge. Items not yet transacted this month show a "projected" label.
- **Over budget indicator:** if headroom < 0, shows "Over budget by ₹X" in red

Color coding follows the same threshold scheme (green/yellow/orange/red) applied to the variable spend block and the card's accent colour.

### Budget CRUD
- **Create:** "Add Budget" button → modal with category picker + monthly limit
- **Edit:** inline edit on the card or via modal — updates template limit
- **Monthly override:** "Override this month" action on a card → sets a `budget_overrides` row for the current period
- **Delete:** deletes the template + all overrides (confirmation required)

---

## Backend — API Routes

All routes under `/api/budgets`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/budgets` | List all budget templates |
| `POST` | `/api/budgets` | Create a budget template |
| `PUT` | `/api/budgets/{id}` | Update template (limit / name) |
| `DELETE` | `/api/budgets/{id}` | Delete template + overrides |
| `GET` | `/api/budgets/summary?period=YYYY-MM` | All budgets with computed spend for a period |
| `GET` | `/api/budgets/{id}/summary?period=YYYY-MM` | Single budget full breakdown |
| `POST` | `/api/budgets/{id}/overrides` | Create or update a monthly override |
| `DELETE` | `/api/budgets/{id}/overrides/{period}` | Remove a monthly override |

### Transaction recurring endpoint (new, on existing transaction routes)

```
PATCH /api/transactions/{id}/recurring
body: {
  is_recurring: bool,
  recurrence_period: "monthly" | "quarterly" | "yearly" | "custom" | null,
  recurring_key: string | null  -- optional override; auto-generated if omitted
}
```

### Backend layer structure

Follows the existing pattern:

```
budget_routes.py  →  budget_service.py  →  budget_operations.py
                                        →  transaction_operations.py (existing)
```

`budget_service.py` owns the spend computation logic. `budget_operations.py` owns DB reads/writes for budgets and overrides.

---

## Frontend — Component Structure

### New components
- `BudgetsOverview` — overview strip (4 summary cards)
- `BudgetThresholdAlerts` — alerts panel for budgets near/over limit
- `BudgetCard` — individual category budget with stacked bar + committed breakdown
- `BudgetCreateModal` — create/edit budget template
- `BudgetOverrideModal` — set a monthly limit override
- `RecurringPeriodPopover` — period picker popover used in transaction table
- `NoBudgetWarning` — soft warning for recurring-but-no-budget categories

### Modified components
- `transaction-columns.tsx` — add ↻ icon to action icons row
- `transaction-edit-modal.tsx` — add Recurring checkbox + period selector to flags section
- `budgets/page.tsx` — wire month picker + real data (replace placeholder components)

### Hooks
- `useBudgetsSummary(period)` — fetches all budgets with computed spend for a period
- `useBudgetDetail(id, period)` — fetches single budget breakdown
- `useCreateBudget` / `useUpdateBudget` / `useDeleteBudget` — CRUD mutations
- `useSetBudgetOverride` / `useDeleteBudgetOverride` — override mutations
- `useSetRecurring(transactionId)` — mutation for the recurring PATCH endpoint

### Types to update
The existing `Budget` type is replaced:

```typescript
// Drop: category (string), current_spend (number)
// Add:
interface Budget {
  id: string
  category_id: string
  category_name: string      // joined from categories
  monthly_limit: number
  name?: string
  created_at: string
  updated_at: string
}

interface BudgetOverride {
  id: string
  budget_id: string
  period: string             // 'YYYY-MM'
  monthly_limit: number
}

interface BudgetSummary extends Budget {
  effective_limit: number    // override or template limit
  committed_spend: number
  variable_spend: number
  headroom: number
  utilisation_pct: number    // (committed + variable) / effective_limit * 100
  committed_items: CommittedItem[]
  has_override: boolean
}

interface CommittedItem {
  recurring_key: string
  description: string        // most recent transaction description
  amount: number             // most recent transaction amount
  recurrence_period: string
  amortised_monthly: number
  is_projected: boolean      // true if no transaction yet this month
}

// Transaction type additions:
// is_recurring: boolean
// recurrence_period: 'monthly' | 'quarterly' | 'yearly' | 'custom' | null
// recurring_key: string | null
```

---

## Implementation Notes

- **New git branch:** all work for this feature is done on a dedicated branch (e.g. `feature/budgets`). Do not commit directly to `main`.
- **Migrations:** two new Alembic migrations — one for transaction columns (`is_recurring`, `recurrence_period`, `recurring_key`), one for `budgets` + `budget_overrides` tables.
- **Spend computation is always live** — no caching in v1. For a personal tracker with hundreds of transactions, query performance is not a concern.
- **Color palette for thresholds:** use the app's existing Tailwind color tokens — green-500, yellow-500, orange-500, red-500. The specific indigo/purple for the committed block matches the existing primary color.
- **The existing `BudgetsOverview` and `BudgetsList` components** are placeholders — they are replaced entirely by the new components described above.
- **`current_spend` field** in the existing `Budget` type is dropped — spend is never stored, always computed.

---

## Future Considerations

- `budget_committed_items` table: declare future committed spend for subscriptions not yet transacted (e.g. a new plan starting next month)
- Budget rollover with a configurable cap
- Per-account budget filtering (e.g. "only count HDFC CC transactions toward this budget")
- Recurring transaction auto-detection on ingestion (flag during statement processing if description matches a known `recurring_key`)
- Push/email notifications when thresholds are crossed
