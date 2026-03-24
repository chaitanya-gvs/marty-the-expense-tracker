# Settlements — Splitwise Tab Design

## Goal

Add a top-level **Splitwise** tab (default) to the Settlements page that shows live Splitwise balances and transactions per friend, alongside the existing **Manual Computation** tab.

## Architecture

The page splits into two isolated tab components. `page.tsx` becomes a thin shell with only the page title and the top-level tab switcher. A new backend route file proxies the Splitwise API directly — no DB cache involved for the Splitwise tab. The Manual tab is the current implementation moved into its own component with Splitwise cross-reference UI stripped out.

The shared stats bar currently above the tab section is **removed from the shell**. Each tab renders its own stats row internally.

**Tech stack:** Next.js App Router, shadcn/ui Tabs, plain `useState`/`useEffect` hooks (matching the existing `use-settlements.ts` pattern — do NOT use TanStack Query), FastAPI, existing `SplitwiseAPIClient`.

---

## Component Tree

```
src/app/settlements/page.tsx                  ← thin shell: page title + top-level tabs only
src/components/settlements/
  splitwise-tab.tsx                           ← NEW: Splitwise tab (live API, own state)
  manual-tab.tsx                              ← NEW: current page content, Splitwise UI stripped
  settlement-filters.tsx                      ← unchanged, only mounted by manual-tab
src/hooks/use-settlements.ts                  ← add useSplitwiseFriends(), useSplitwiseFriendExpenses()
src/lib/api/client.ts                         ← add getSplitwiseFriends(), getSplitwiseFriendExpenses()
src/lib/types/index.ts                        ← add SplitwiseFriend, SplitwiseFriendExpense (no existing types changed)
backend/src/apis/routes/splitwise_routes.py   ← NEW: two live-proxy endpoints
backend/main.py                               ← mount splitwise_router at /api/splitwise
```

---

## Backend

### New file: `backend/src/apis/routes/splitwise_routes.py`

Two endpoints, both thin proxies to the existing `SplitwiseAPIClient`:

**`GET /api/splitwise/friends`**
- Instantiates `SplitwiseAPIClient`, calls `get_friends_with_balances()`
- Returns list of `{ id, first_name, last_name, net_balance }`
- Sorted: non-zero balances first (abs descending), zero-balance entries last
- **Note:** `get_friends_with_balances()` uses `f.get("last_name", "")` which coerces absent/null last names to `""`. The endpoint must replace `""` with `None` before returning so the frontend receives `null` as declared in the TypeScript type.

**`GET /api/splitwise/friend/{splitwise_id}/expenses`**
- Instantiates `SplitwiseAPIClient`, calls `get_expenses(limit=100, offset=0)` — one page only (see latency note below)
- Filters locally to expenses where `splitwise_id` appears in any `expense.users[].user.id`
- **Excludes** expenses where `expense.deleted_at is not None`
- Flattens each expense user's name as `f"{user.first_name} {user.last_name}".strip()`
- Extracts `category` as `expense.category.name` if `expense.category` is not None, else `null`
- Extracts `group_name` as `expense.group.name` if `expense.group` is not None, else `null`
- Returns list of `{ id, description, cost, date, group_name, category, users[] }`
- `users[]` shape: `{ name: str, paid_share: float, owed_share: float }`
- Sorted: date descending

> **Latency note:** `get_expenses()` fetches all expenses in a loop when the result exceeds the page size. To avoid unbounded latency, this endpoint fetches only the first page (`limit=100, offset=0`) and does not paginate further. This is an intentional limitation — if the friend appears in none of the first 100 most-recent expenses, the list will appear empty. This is acceptable for the current scope.

### `backend/main.py`

```python
from src.apis.routes.splitwise_routes import router as splitwise_router
app.include_router(splitwise_router, prefix="/api/splitwise")
```

No schema changes needed — response shapes are new and defined inline in the route file. No Alembic migrations needed.

---

## Frontend

### Types (`src/lib/types/index.ts`)

Add only these two new interfaces. No existing types are modified.

```typescript
export interface SplitwiseFriend {
  id: number;
  first_name: string;
  last_name: string | null;     // may be null from Splitwise API
  net_balance: number;          // positive = they owe you, negative = you owe them
}

export interface SplitwiseFriendExpense {
  id: number;
  description: string;
  cost: number;
  date: string;                 // ISO date string
  group_name: string | null;
  category: string | null;
  users: {
    name: string;               // flattened: first_name + " " + last_name (trimmed)
    paid_share: number;
    owed_share: number;
  }[];
}
```

### API Client (`src/lib/api/client.ts`)

Add two methods to the existing `ApiClient` class:

```typescript
getSplitwiseFriends(): Promise<ApiResponse<SplitwiseFriend[]>>
  // GET /api/splitwise/friends

getSplitwiseFriendExpenses(splitwiseId: number): Promise<ApiResponse<SplitwiseFriendExpense[]>>
  // GET /api/splitwise/friend/{splitwiseId}/expenses
```

### Hooks (`src/hooks/use-settlements.ts`)

Add two hooks using plain `useState`/`useEffect` — same pattern as the existing hooks in this file:

**`useSplitwiseFriends()`**
- State: `friends: SplitwiseFriend[]`, `loading: boolean`, `error: string | null`
- Effect: fetches on mount
- Returns: `{ friends, loading, error, refetch }`

**`useSplitwiseFriendExpenses(splitwiseId: number | null)`**
- State: `expenses: SplitwiseFriendExpense[]`, `loading: boolean`, `error: string | null`
- Effect: fetches when `splitwiseId` is non-null; clears state when `splitwiseId` is null
- Returns: `{ expenses, loading, error }`

### `src/components/settlements/splitwise-tab.tsx` (new)

**State:**
- `selectedFriendId: number | null` — which friend's detail to show
- `activeSubTab: 'overview' | 'details'`
- `settledExpanded: boolean` — whether the "Settled" section is open

**Overview sub-tab:**
- Calls `useSplitwiseFriends()` on mount
- **Stats row (4 cards):** total owed to me (sum of positive `net_balance`), total I owe (sum of abs of negative `net_balance`), net total, people count (non-zero only)
- Card grid: friends with `net_balance !== 0`, sorted by `abs(net_balance)` descending
- Below grid: collapsed `"Settled (N)"` accordion; clicking expands to show zero-balance friends
- Clicking any friend card → sets `selectedFriendId`, sets `activeSubTab = 'details'`
- **"Sync Now" button** (top-right of tab header):
  - On click: calls `apiClient.startWorkflow({ mode: 'splitwise_only' })`, stores returned `job_id`, sets button to disabled/loading state
  - Polls `GET /api/workflow/{job_id}/status` every 2 seconds
  - On status `completed`, `failed`, or `cancelled`: stops polling, re-enables button, calls `refetch()` on friends
  - If a job is already active (API returns 409 or error): shows a brief toast "Sync already in progress"

**Details sub-tab:**
- Back button → resets `selectedFriendId`, switches to `'overview'`
- Shows friend name + `net_balance` from the friends list (no extra fetch needed for the balance)
- Calls `useSplitwiseFriendExpenses(selectedFriendId)`
- Expense list grouped by `group_name` (same collapsible accordion pattern as current manual detail)
- "No Group" section for expenses where `group_name` is null
- Each expense row: date, description, total cost, and a shares breakdown showing each user's `paid_share` / `owed_share`

**Filters:** Not rendered on this tab at all.

### `src/components/settlements/manual-tab.tsx` (new)

The current `SettlementsPageContent` function from `page.tsx` moved here verbatim, with these removals:

- `splitwise_balance` display row removed from `SettlementCard`
- `has_discrepancy` / ⚠ Simplified badge removed from `SettlementCard`
- Splitwise balance comparison section removed from the detail view balance card
- `balance_synced_at` display removed
- The shared stats bar stays **inside** `ManualTab` (not in the shell)
- The "last synced" line stays inside `ManualTab` (uses `new Date()` as before)

`SettlementFilters` component remains mounted only here.

### `src/app/settlements/page.tsx` (refactored)

Thin shell — only:
```tsx
<MainLayout>
  <div className="container mx-auto p-6 space-y-6">
    <div>
      <h1 className="text-3xl font-bold">Settlements & Balances</h1>
      <p className="text-gray-600 mt-1">Track what you owe and what others owe you</p>
    </div>
    <Tabs defaultValue="splitwise">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="splitwise">Splitwise</TabsTrigger>
        <TabsTrigger value="manual">Manual Computation</TabsTrigger>
      </TabsList>
      <TabsContent value="splitwise"><SplitwiseTab /></TabsContent>
      <TabsContent value="manual"><ManualTab /></TabsContent>
    </Tabs>
  </div>
</MainLayout>
```

No stats bar, no filters, no hooks in this file.

---

## Data Flow

```
Splitwise tab load
  → useSplitwiseFriends()
  → GET /api/splitwise/friends
  → SplitwiseAPIClient.get_friends_with_balances()
  → Splitwise API GET /get_friends
  → render friend cards + stats row

Click friend card
  → selectedFriendId set, switch to Details sub-tab
  → useSplitwiseFriendExpenses(id)
  → GET /api/splitwise/friend/{id}/expenses
  → SplitwiseAPIClient.get_expenses(limit=100, offset=0) → filter to friend, exclude deleted
  → render expense list grouped by group_name

Sync Now click
  → apiClient.startWorkflow({ mode: 'splitwise_only' }) → returns job_id
  → poll GET /api/workflow/{job_id}/status every 2s
  → on completed/failed → refetch friends
```

---

## What Does NOT Change

- `settlement_routes.py` — no changes
- `settlements.py` schemas — no changes
- `participants` table — no changes
- Manual tab calculation logic — no changes
- Alembic migrations — none needed

---

## Out of Scope

- Pagination beyond the first 100 expenses in the Splitwise detail view
- Persisting selected tab or friend across page reloads
- Editing or categorising Splitwise expenses from this view
- Handling the case where the current user's Splitwise account has >100 expenses with a single friend
- Refreshing the expense detail list after Sync Now completes (only the friends list is refreshed; the user must re-click the friend to reload their expenses)
