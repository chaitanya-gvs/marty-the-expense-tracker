# Settlements — Splitwise Tab Design

## Goal

Add a top-level **Splitwise** tab (default) to the Settlements page that shows live Splitwise balances and transactions per friend, alongside the existing **Manual Computation** tab.

## Architecture

The page splits into two isolated tab components. `page.tsx` becomes a thin shell. A new backend route file proxies the Splitwise API directly — no DB cache involved for the Splitwise tab. The Manual tab is the current implementation moved into its own component with Splitwise cross-reference UI stripped out.

**Tech stack:** Next.js App Router, shadcn/ui Tabs, TanStack React Query pattern (custom hooks), FastAPI, existing `SplitwiseAPIClient`.

---

## Component Tree

```
src/app/settlements/page.tsx                  ← thin shell: top-level Splitwise/Manual tabs + shared header
src/components/settlements/
  splitwise-tab.tsx                           ← NEW: Splitwise tab (live API, own state)
  manual-tab.tsx                              ← NEW: current page content, Splitwise UI stripped
  settlement-filters.tsx                      ← unchanged, only mounted by manual-tab
src/hooks/use-settlements.ts                  ← add useSplitwiseFriends(), useSplitwiseFriendExpenses()
src/lib/api/client.ts                         ← add getSplitwiseFriends(), getSplitwiseFriendExpenses()
src/lib/types/index.ts                        ← add SplitwiseFriend, SplitwiseFriendExpense
backend/src/apis/routes/splitwise_routes.py   ← NEW: two live-proxy endpoints
backend/main.py                               ← mount splitwise_router at /api/splitwise
```

---

## Backend

### New file: `backend/src/apis/routes/splitwise_routes.py`

Two endpoints, both thin proxies to the existing `SplitwiseAPIClient`:

**`GET /api/splitwise/friends`**
- Calls `SplitwiseAPIClient.get_friends_with_balances()`
- Returns list of `{ id, first_name, last_name, net_balance }`
- Sorted: non-zero balances first (abs descending), zero-balance entries last

**`GET /api/splitwise/friend/{splitwise_id}/expenses`**
- Calls `SplitwiseAPIClient.get_expenses()` (all expenses, paginated)
- Filters locally to expenses where `splitwise_id` appears in `expense.users`
- Returns list of `{ id, description, cost, date, group_name, category, users[] }`
- Sorted: date descending

No new DB tables or columns. No schema changes to existing settlement endpoints.

### `backend/main.py`

```python
from src.apis.routes.splitwise_routes import router as splitwise_router
app.include_router(splitwise_router, prefix="/api/splitwise")
```

---

## Frontend

### Types (`src/lib/types/index.ts`)

```typescript
export interface SplitwiseFriend {
  id: number;
  first_name: string;
  last_name: string;
  net_balance: number;          // positive = they owe you, negative = you owe them
}

export interface SplitwiseFriendExpense {
  id: number;
  description: string;
  cost: number;
  date: string;
  group_name: string | null;
  category: string | null;
  users: { name: string; paid_share: number; owed_share: number }[];
}
```

### API Client (`src/lib/api/client.ts`)

```typescript
getSplitwiseFriends(): Promise<ApiResponse<SplitwiseFriend[]>>
getSplitwiseFriendExpenses(splitwiseId: number): Promise<ApiResponse<SplitwiseFriendExpense[]>>
```

### Hooks (`src/hooks/use-settlements.ts`)

Two new hooks added to the existing file:

- `useSplitwiseFriends()` — fetches `/api/splitwise/friends`; exposes `friends`, `loading`, `error`, `refetch`
- `useSplitwiseFriendExpenses(splitwiseId: number | null)` — fetches when id is non-null; exposes `expenses`, `loading`, `error`

### `src/components/settlements/splitwise-tab.tsx` (new)

**Overview sub-tab:**
- Calls `useSplitwiseFriends()` on mount
- Stats row (4 cards, tab-aware): total owed to me (sum of positive net_balance), total I owe (sum of abs negative), net total, people count
- Card grid: non-zero balance friends sorted by abs(net_balance) descending
- Below grid: collapsed "Settled (N)" accordion listing zero-balance friends
- Clicking any card → sets `selectedFriendId` state, switches to Details sub-tab
- "Sync Now" button (top-right of tab): fires `POST /api/workflow/run { mode: "splitwise_only" }`, disabled while running, calls `refetch()` on completion

**Details sub-tab:**
- Calls `useSplitwiseFriendExpenses(selectedFriendId)` when a friend is selected
- Balance header: friend name + `net_balance` from friends list
- Expense list grouped by `group_name` (same accordion pattern as current manual detail view)
- "No Group" section for expenses with null `group_name`
- Each expense row: date, description, total cost, user shares breakdown

**Filters:** Hidden entirely on the Splitwise tab (filter bar not rendered).

### `src/components/settlements/manual-tab.tsx` (new)

Current `page.tsx` inner component moved here with these removals:
- `splitwise_balance` display row removed from `SettlementCard`
- `has_discrepancy` / ⚠ Simplified badge removed from cards
- Splitwise balance comparison section removed from detail view
- `balance_synced_at` display removed

Otherwise identical to current behaviour.

### `src/app/settlements/page.tsx` (refactored)

Thin shell only:
- Shared page header (title, subtitle, last-synced line)
- `<Tabs defaultValue="splitwise">`
- `<TabsTrigger value="splitwise">Splitwise</TabsTrigger>`
- `<TabsTrigger value="manual">Manual Computation</TabsTrigger>`
- `<TabsContent value="splitwise"><SplitwiseTab /></TabsContent>`
- `<TabsContent value="manual"><ManualTab /></TabsContent>`

---

## Data Flow

```
Splitwise tab load
  → useSplitwiseFriends()
  → GET /api/splitwise/friends
  → SplitwiseAPIClient.get_friends_with_balances()
  → Splitwise API GET /get_friends
  → render friend cards

Click friend card
  → selectedFriendId set
  → useSplitwiseFriendExpenses(id)
  → GET /api/splitwise/friend/{id}/expenses
  → SplitwiseAPIClient.get_expenses() → filter to friend
  → render expense list grouped by group_name

Sync Now click
  → POST /api/workflow/run { mode: "splitwise_only" }
  → on complete → refetch friends
```

---

## What Does NOT Change

- `settlement_routes.py` — no changes
- `settlements.py` schemas — no changes
- `participants` table — no changes
- Manual tab behaviour and calculation logic — no changes
- Alembic migrations — none needed

---

## Out of Scope

- Pagination for the Splitwise expense list (Splitwise API already paginates internally in the client)
- Persisting selected tab across page reloads
- Editing or categorising Splitwise expenses from this view
