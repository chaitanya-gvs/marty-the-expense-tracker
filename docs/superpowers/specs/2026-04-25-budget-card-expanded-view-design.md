# Budget Card Expanded View — Design Spec

## Goal

Replace the current two-block expanded state (always-visible recurring items + separate inline transactions) with a single **unified timeline** that surfaces both actual transactions and upcoming projected items in one scannable list.

## Current State Problems

- The "Recurring" block is always visible, making cards tall even when collapsed
- Actual transactions appear as a separate second block below — feels disconnected
- No visual distinction between recurring-paid and variable transactions in the transaction list

## Approved Design: Unified Timeline (Option B)

### Collapsed state

Shows only: card header row, progress bar, legend. The committed items block is **removed** from the collapsed state — it only appears when expanded.

### Expanded state

A single list replacing both the old committed items block and the old transaction list. Three row types:

#### 1. Recurring (paid)

Actual transactions where `transaction.is_recurring === true`.

```
[Recurring pill] [date]  [description]            [amount in indigo]
```

- Pill: small indigo rounded pill — `bg-indigo-500/20 text-indigo-400 border border-indigo-500/40`
- Date: short format — "18 Apr"
- Amount: indigo (`text-indigo-400`)
- Sorted chronologically descending with variable rows

#### 2. Variable

Actual transactions where `transaction.is_recurring !== true`.

```
[Variable pill]  [date]  [description]            [amount]
```

- Pill: neutral muted — `bg-muted text-muted-foreground border border-border`
- Date: short format
- Amount: default foreground (`text-foreground`)
- Interleaved with recurring rows in date order

#### 3. Upcoming (projected)

Items from `budget.committed_items` where `is_projected === true`. Rendered **after** a dashed divider at the bottom of the list. Not fetched from API — already present in `BudgetSummary`.

```
[Upcoming pill]  [—]     [description]            [amount dimmed]
```

- Pill: neutral gray — `bg-muted text-muted-foreground`
- Date column shows `—`
- Row dimmed to ~55% opacity
- Only rendered when `committed_items.some(i => i.is_projected)`

### Dashed divider

Separates actual transactions (above) from upcoming projected items (below). Only rendered when there are projected items.

```html
<div class="border-t border-dashed border-border/40 my-1" />
```

### Empty state

If no transactions and no projected items: `"No transactions this period."` centered, muted.

### Loading state

4 skeleton rows (pulse animation) while `txLoading === true`.

### Footer total

Below the list: transaction count on the left, total debit spend (sum of non-credit transactions) on the right in semibold mono. Same as current implementation.

---

## Data Sources

| Row type  | Source                                       | Filter                              |
|-----------|----------------------------------------------|-------------------------------------|
| Recurring | `useTransactions(...)` API response          | `tx.is_recurring === true`          |
| Variable  | `useTransactions(...)` API response          | `tx.is_recurring !== true`          |
| Upcoming  | `budget.committed_items` (already in props)  | `item.is_projected === true`        |

API call filters: `{ categories: [budget.category_name], date_range: { start, end } }` — same as current implementation. No new API calls needed.

---

## Component Changes

### `budget-card.tsx`

- **Remove**: the always-visible committed items block (the `{budget.committed_items.length > 0 && ...}` section)
- **Replace**: current inline transaction list with the unified timeline described above
- **Add**: `pill` helper function that returns pill class strings based on row type
- **Add**: `shortDate()` already present — reuse for date column
- **Keep**: all other card content unchanged (header, progress bar, legend, action buttons)

No new files. No new hooks. No API changes.

---

## Visual Reference

Approved mockup: `.superpowers/brainstorm/1212-1777063554/content/expanded-designs.html` — Option B
