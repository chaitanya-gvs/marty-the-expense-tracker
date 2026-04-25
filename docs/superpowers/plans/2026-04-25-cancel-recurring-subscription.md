# Cancel Recurring Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users stop the budget from projecting a cancelled subscription as "Upcoming" by clicking ✕ on its row in the expanded budget card — which bulk-unmarks all past transactions for that recurring key.

**Architecture:** Two new backend endpoints (`GET .../count` and `PATCH .../cancel`) bulk-operate on transactions by `recurring_key`. The frontend adds an ✕ button to each Upcoming row in the budget card; clicking it fetches the affected count then shows an inline confirmation band. Confirming fires the mutation and invalidates budget + transaction caches. No changes to the budget service — it already filters `is_recurring = true`, so unmarked transactions naturally disappear from projections.

**Tech Stack:** FastAPI + SQLAlchemy raw SQL (backend), React + TanStack Query + Tailwind CSS v4 + Lucide React (frontend)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/services/database_manager/operations/transaction_operations.py` | Add `cancel_recurring_by_key()` and `count_recurring_by_key()` static methods |
| `backend/src/apis/routes/transaction_write_routes.py` | Add two new route handlers under `/transactions/recurring/{recurring_key}` |
| `backend/tests/test_cancel_recurring.py` | New test file for the two endpoints |
| `frontend/src/lib/api/client.ts` | Add `cancelRecurring()` and `getRecurringCount()` methods |
| `frontend/src/hooks/use-budgets.ts` | Add `useCancelRecurring()` mutation hook and `useRecurringCount()` query hook |
| `frontend/src/components/budgets/budget-card.tsx` | Add ✕ button + inline confirmation band to Upcoming rows |

---

## Task 1: Backend DB operations

**Files:**
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py`

### Context
`TransactionOperations` is a class of `@staticmethod` async methods in `backend/src/services/database_manager/operations/transaction_operations.py`. Each method opens its own session via `get_session_factory()` and uses `text()` for raw SQL. The existing `set_recurring` method (around line 2084) is the closest pattern to follow.

- [ ] **Step 1: Write the failing test for count_recurring_by_key**

Create `backend/tests/test_cancel_recurring.py`:

```python
"""
Tests for cancel-recurring-by-key endpoints.
Run from backend/ with: poetry run pytest tests/test_cancel_recurring.py -v
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from main import app
from src.utils.auth_deps import get_current_user


def override_auth():
    return "test_user"


app.dependency_overrides[get_current_user] = override_auth


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_count_recurring_unknown_key_returns_zero(client):
    """GET /api/transactions/recurring/{key}/count with a key that has no transactions returns count=0."""
    resp = client.get("/api/transactions/recurring/nonexistent-key-xyz/count")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert body["data"]["count"] == 0


def test_cancel_recurring_unknown_key_returns_404(client):
    """PATCH /api/transactions/recurring/{key}/cancel with no matching transactions returns 404."""
    resp = client.patch("/api/transactions/recurring/nonexistent-key-xyz/cancel")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run the test to verify it fails (routes don't exist yet)**

```bash
cd backend && poetry run pytest tests/test_cancel_recurring.py -v
```

Expected: Both tests fail with connection errors or 404/405 (routes not yet defined).

- [ ] **Step 3: Add `count_recurring_by_key` and `cancel_recurring_by_key` to TransactionOperations**

Open `backend/src/services/database_manager/operations/transaction_operations.py`. After the `set_recurring` method (search for `async def set_recurring`), add these two methods inside the `TransactionOperations` class:

```python
    @staticmethod
    async def count_recurring_by_key(recurring_key: str) -> int:
        """Return count of non-deleted transactions with the given recurring_key."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT COUNT(*) AS cnt
                FROM transactions
                WHERE recurring_key = :recurring_key
                  AND is_deleted = false
            """), {"recurring_key": recurring_key})
            row = result.mappings().first()
            return int(row["cnt"]) if row else 0

    @staticmethod
    async def cancel_recurring_by_key(recurring_key: str) -> int:
        """
        Unmark all non-deleted transactions with the given recurring_key as recurring.
        Sets is_recurring=false, recurring_key=null, recurrence_period=null.
        Returns the number of rows updated.
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                UPDATE transactions
                SET is_recurring = false,
                    recurring_key = NULL,
                    recurrence_period = NULL,
                    updated_at = now()
                WHERE recurring_key = :recurring_key
                  AND is_deleted = false
            """), {"recurring_key": recurring_key})
            await session.commit()
            return result.rowcount
```

- [ ] **Step 4: Run lint to check for issues**

```bash
cd backend && poetry run ruff check src/services/database_manager/operations/transaction_operations.py
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/database_manager/operations/transaction_operations.py backend/tests/test_cancel_recurring.py
git commit -m "feat: add count_recurring_by_key and cancel_recurring_by_key DB operations"
```

---

## Task 2: Backend API endpoints

**Files:**
- Modify: `backend/src/apis/routes/transaction_write_routes.py`

### Context
Routes are defined with `@router.patch(...)` / `@router.get(...)` decorators. The existing `set_transaction_recurring` route at the bottom of the file (around line 693) is the pattern to follow. `handle_database_operation` wraps DB calls and handles exceptions. `ApiResponse` is the standard response envelope — `ApiResponse(data={...})`.

Important: The new routes must be placed **before** any catch-all routes. Add them just after the existing `set_transaction_recurring` route at line ~693. The route paths are `/recurring/{recurring_key}/count` and `/recurring/{recurring_key}/cancel` — note these are under `/transactions`, so the full paths are `/api/transactions/recurring/{recurring_key}/count` and `/api/transactions/recurring/{recurring_key}/cancel`.

- [ ] **Step 1: Add the two route handlers to transaction_write_routes.py**

Open `backend/src/apis/routes/transaction_write_routes.py`. After the `set_transaction_recurring` function (after line ~723), add:

```python

@router.get("/recurring/{recurring_key}/count", response_model=ApiResponse)
async def get_recurring_count(recurring_key: str):
    """Return how many non-deleted transactions share the given recurring_key."""
    try:
        count = await handle_database_operation(
            TransactionOperations.count_recurring_by_key,
            recurring_key=recurring_key,
        )
        return ApiResponse(data={"count": count})
    except Exception:
        logger.error("Failed to count recurring key=%s", recurring_key, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/recurring/{recurring_key}/cancel", response_model=ApiResponse)
async def cancel_recurring_by_key(recurring_key: str):
    """
    Bulk-unmark all transactions with the given recurring_key as non-recurring.
    Sets is_recurring=false, recurring_key=null, recurrence_period=null.
    Returns 404 if no matching transactions exist.
    """
    logger.info("Cancelling recurring key=%s", recurring_key)
    try:
        updated_count = await handle_database_operation(
            TransactionOperations.cancel_recurring_by_key,
            recurring_key=recurring_key,
        )
        if updated_count == 0:
            raise HTTPException(status_code=404, detail=f"No transactions found for recurring_key '{recurring_key}'")
        logger.info("Cancelled recurring key=%s updated_count=%d", recurring_key, updated_count)
        return ApiResponse(data={"updated_count": updated_count})
    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to cancel recurring key=%s", recurring_key, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
```

- [ ] **Step 2: Run the tests to verify both pass**

```bash
cd backend && poetry run pytest tests/test_cancel_recurring.py -v
```

Expected:
```
tests/test_cancel_recurring.py::test_count_recurring_unknown_key_returns_zero PASSED
tests/test_cancel_recurring.py::test_cancel_recurring_unknown_key_returns_404 PASSED
```

- [ ] **Step 3: Run lint**

```bash
cd backend && poetry run ruff check src/apis/routes/transaction_write_routes.py
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/apis/routes/transaction_write_routes.py
git commit -m "feat: add GET recurring/{key}/count and PATCH recurring/{key}/cancel endpoints"
```

---

## Task 3: Frontend API client methods

**Files:**
- Modify: `frontend/src/lib/api/client.ts`

### Context
`apiClient` is a singleton class in `frontend/src/lib/api/client.ts`. All backend calls go through `this.request(path, options)`. The existing `setRecurring` method (around line 394) is the pattern to follow:

```typescript
async setRecurring(
  transactionId: string,
  payload: { is_recurring: boolean; recurrence_period?: string | null; recurring_key?: string | null }
): Promise<ApiResponse<{ updated: boolean; recurring_key: string | null }>> {
  return this.request(`/transactions/${transactionId}/recurring`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
```

Add the two new methods adjacent to `setRecurring`.

- [ ] **Step 1: Add `getRecurringCount` and `cancelRecurring` to the API client**

Open `frontend/src/lib/api/client.ts`. Find `setRecurring` and add these two methods immediately after it:

```typescript
  async getRecurringCount(
    recurringKey: string
  ): Promise<{ data: { count: number } }> {
    return this.request(`/transactions/recurring/${encodeURIComponent(recurringKey)}/count`);
  }

  async cancelRecurring(
    recurringKey: string
  ): Promise<{ data: { updated_count: number } }> {
    return this.request(`/transactions/recurring/${encodeURIComponent(recurringKey)}/cancel`, {
      method: "PATCH",
    });
  }
```

- [ ] **Step 2: Run the frontend linter**

```bash
cd frontend && npm run lint
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api/client.ts
git commit -m "feat: add getRecurringCount and cancelRecurring API client methods"
```

---

## Task 4: Frontend hooks

**Files:**
- Modify: `frontend/src/hooks/use-budgets.ts`

### Context
`use-budgets.ts` already has a `// ── Recurring ─────────────────────────────────────────────────────────────────` section with `useSetRecurring`. Add two new exports after it.

`useRecurringCount` is a query that's only enabled when `recurringKey` is non-null. `useCancelRecurring` is a mutation that on success invalidates both `["budgets"]` and `["transactions"]` query keys.

- [ ] **Step 1: Add `useRecurringCount` and `useCancelRecurring` hooks**

Open `frontend/src/hooks/use-budgets.ts`. At the end of the file (after `useSetRecurring`), add:

```typescript
export function useRecurringCount(recurringKey: string | null) {
  return useQuery({
    queryKey: ["recurring-count", recurringKey],
    queryFn: () => apiClient.getRecurringCount(recurringKey!),
    enabled: recurringKey !== null,
    staleTime: 0,
  });
}

export function useCancelRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringKey: string) => apiClient.cancelRecurring(recurringKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
```

- [ ] **Step 2: Run the frontend linter**

```bash
cd frontend && npm run lint
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-budgets.ts
git commit -m "feat: add useRecurringCount and useCancelRecurring hooks"
```

---

## Task 5: Budget card UI — ✕ button and inline confirmation

**Files:**
- Modify: `frontend/src/components/budgets/budget-card.tsx`

### Context
`budget-card.tsx` already has the Upcoming items section (search for `upcomingItems.map`). The current Upcoming row looks like:

```tsx
<div
  key={item.recurring_key ?? i}
  className="flex items-center gap-3 py-2 opacity-50 border-b border-border/20 last:border-0"
>
  <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border whitespace-nowrap">
    Upcoming
  </span>
  <span className="shrink-0 text-xs text-muted-foreground w-12 tabular-nums">
    —
  </span>
  <span className="flex-1 text-sm text-muted-foreground italic truncate">
    {item.description}
  </span>
  <span className="shrink-0 text-sm font-mono tabular-nums text-muted-foreground">
    {formatCurrency(item.amount)}
  </span>
</div>
```

You need to:
1. Import `useRecurringCount`, `useCancelRecurring` from `@/hooks/use-budgets` and `XCircle` from `lucide-react`
2. Add `confirmingKey: string | null` state to the component (tracks which row has its confirmation band open)
3. Call `useRecurringCount(confirmingKey)` at component top level (enabled only when non-null)
4. Call `useCancelRecurring()` mutation at component top level
5. Modify each Upcoming row to add ✕ button + conditional confirmation band below it

- [ ] **Step 1: Add imports**

Open `frontend/src/components/budgets/budget-card.tsx`. Find the existing import line:

```tsx
import { Replace, Edit2, Trash2, ChevronDown } from "lucide-react";
```

Change it to:

```tsx
import { Replace, Edit2, Trash2, ChevronDown, XCircle } from "lucide-react";
```

Find the existing import line:

```tsx
import { useTransactions } from "@/hooks/use-transactions";
```

Add a new import line after it:

```tsx
import { useRecurringCount, useCancelRecurring } from "@/hooks/use-budgets";
```

- [ ] **Step 2: Add state and hooks inside BudgetCard**

Inside the `BudgetCard` component function, after the existing `const [isExpanded, setIsExpanded] = useState(false);` line, add:

```tsx
const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
const { data: countData, isLoading: countLoading } = useRecurringCount(confirmingKey);
const cancelRecurring = useCancelRecurring();
```

- [ ] **Step 3: Replace the Upcoming rows rendering**

Find the section that renders `upcomingItems.map(...)`. Replace the entire `upcomingItems.map(...)` block with:

```tsx
{upcomingItems.map((item, i) => {
  const key = item.recurring_key ?? String(i);
  const isConfirming = confirmingKey === key;
  return (
    <div key={key}>
      <div
        className={cn(
          "flex items-center gap-3 py-2 border-b border-border/20 last:border-0",
          isConfirming ? "opacity-100" : "opacity-50",
        )}
      >
        <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border whitespace-nowrap">
          Upcoming
        </span>
        <span className="shrink-0 text-xs text-muted-foreground w-12 tabular-nums">
          —
        </span>
        <span className="flex-1 text-sm text-muted-foreground italic truncate">
          {item.description}
        </span>
        <span className="shrink-0 text-sm font-mono tabular-nums text-muted-foreground">
          {formatCurrency(item.amount)}
        </span>
        <button
          className="shrink-0 text-muted-foreground/40 hover:text-red-400 transition-colors"
          title="Stop tracking this subscription"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmingKey(isConfirming ? null : key);
          }}
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
      {isConfirming && (
        <div className="flex items-center justify-between gap-3 px-2 py-2 mb-1 rounded-md bg-red-500/10 border border-red-500/20">
          <span className="text-[11px] text-red-400">
            {countLoading
              ? "Loading…"
              : `Unmark ${countData?.data.count ?? "?"} past transaction${(countData?.data.count ?? 0) !== 1 ? "s" : ""} as recurring — stops future projections.`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => { e.stopPropagation(); setConfirmingKey(null); }}
            >
              Cancel
            </button>
            <button
              className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
              disabled={cancelRecurring.isPending || countLoading}
              onClick={async (e) => {
                e.stopPropagation();
                if (!item.recurring_key) return;
                await cancelRecurring.mutateAsync(item.recurring_key);
                setConfirmingKey(null);
              }}
            >
              {cancelRecurring.isPending ? "Stopping…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Verify the frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no TypeScript errors. (Warnings about `any` or unused vars are OK as long as build passes.)

- [ ] **Step 5: Manual smoke test**

1. Open http://localhost:3000/budgets (or whichever port the dev server is on)
2. Expand a budget card that has Upcoming items
3. Confirm each Upcoming row now has a small ✕ icon on the right
4. Click ✕ on one — confirm the red band appears with the count message
5. Click Cancel — confirm the band disappears
6. Click ✕ again, then Confirm — confirm the row disappears and the card re-fetches

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/budgets/budget-card.tsx
git commit -m "feat: add stop-tracking action to budget card upcoming rows"
```

---

## Task 6: Push to remote

- [ ] **Step 1: Push all commits**

```bash
git push
```

Expected: All 5 feature commits pushed to origin/main.
