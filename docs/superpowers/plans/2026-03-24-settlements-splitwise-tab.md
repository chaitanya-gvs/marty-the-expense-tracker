# Settlements Splitwise Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live Splitwise tab as the default view on the Settlements page, showing authoritative Splitwise balances and per-friend expense history, alongside the existing Manual Computation tab.

**Architecture:** Two new backend endpoints proxy `SplitwiseAPIClient` directly (no DB cache). The page shell becomes a thin tab switcher. The Splitwise tab handles its own state and fetching; the Manual tab is the current page content moved verbatim with Splitwise cross-reference UI removed.

**Tech Stack:** FastAPI, `SplitwiseAPIClient`, Next.js App Router, shadcn/ui Tabs, plain `useState`/`useEffect` (no TanStack Query for the new Splitwise hooks), Lucide React, sonner toast.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/apis/routes/splitwise_routes.py` | Create | Two live-proxy endpoints: `/friends` and `/friend/{id}/expenses` |
| `backend/main.py` | Modify | Mount `splitwise_router` at `/api/splitwise` |
| `frontend/src/lib/types/index.ts` | Modify | Add `SplitwiseFriend`, `SplitwiseFriendExpense` interfaces |
| `frontend/src/lib/api/client.ts` | Modify | Add `getSplitwiseFriends()`, `getSplitwiseFriendExpenses()` |
| `frontend/src/hooks/use-settlements.ts` | Modify | Add `useSplitwiseFriends()`, `useSplitwiseFriendExpenses()` |
| `frontend/src/components/settlements/splitwise-tab.tsx` | Create | Splitwise overview + detail sub-tabs, Sync Now button |
| `frontend/src/components/settlements/manual-tab.tsx` | Create | Current page content moved here, Splitwise UI stripped |
| `frontend/src/app/settlements/page.tsx` | Modify | Thin shell: page title + top-level Tabs only |

---

## Task 1: Backend — `splitwise_routes.py`

**Files:**
- Create: `backend/src/apis/routes/splitwise_routes.py`

### Context

`SplitwiseAPIClient` lives in `backend/src/services/splitwise_processor/client.py`.

- `get_friends_with_balances()` returns `List[Dict]` with keys `id, first_name, last_name, net_balance`. The `last_name` key uses `f.get("last_name", "")` so absent/null last names arrive as `""` — the endpoint must replace `""` with `None`.
- `get_expenses(limit=100, offset=0)` returns `List[SplitwiseExpense]`. Each `SplitwiseExpense` has: `.id`, `.description`, `.cost` (float), `.date` (Optional[datetime]), `.deleted_at` (Optional[datetime]), `.category` (Optional[SplitwiseCategory] with `.name`), `.group` (Optional[SplitwiseGroup] with `.name`), `.users` (List[SplitwiseExpenseUser]) where each user has `.user.id` (int), `.user.first_name`, `.user.last_name` (Optional[str]), `.paid_share` (float), `.owed_share` (float).
- Since `get_expenses()` paginates in a loop by default, **pass `limit=100, offset=0` and make only one HTTP request** — do NOT let the loop paginate. Achieve this by ensuring the response has fewer items than the limit (i.e., the loop breaks naturally when len < limit), which won't happen for large datasets. Instead, call with `limit=100, offset=0` and **immediately break after the first batch** by using the params directly with `requests.get` rather than calling `get_expenses()` — or alternatively call the client method but accept it may paginate. The simplest approach: call `get_expenses(limit=100, offset=0)` and note in a comment that this fetches only the first page since the method will loop beyond 100 if there are more. To truly fetch only one page, make the raw API call directly using `requests.get` with the client's headers.

For simplicity, make the raw HTTP call for expenses to guarantee single-page fetch:

```python
response = requests.get(
    f"{client.base_url}/get_expenses",
    headers=client.headers,
    params={"limit": 100, "offset": 0}
)
response.raise_for_status()
expenses_data = response.json().get("expenses", [])
```

**Sorting:**
- Friends: non-zero balances first sorted by `abs(net_balance)` descending, then zero-balance entries.
- Expenses: date descending (None dates sort last).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_splitwise_routes.py`:

```python
"""Tests for splitwise_routes endpoints."""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _make_friend(id, first_name, last_name, balance):
    return {"id": id, "first_name": first_name, "last_name": last_name, "net_balance": balance}


def _make_expense(id, description, cost, date_str, deleted_at, users, category=None, group=None):
    """Build a mock SplitwiseExpense-like object."""
    exp = MagicMock()
    exp.id = id
    exp.description = description
    exp.cost = cost
    from datetime import datetime
    exp.date = datetime.fromisoformat(date_str) if date_str else None
    exp.deleted_at = datetime.fromisoformat(deleted_at) if deleted_at else None
    exp.category = MagicMock(name=category) if category else None
    exp.group = MagicMock(name=group) if group else None
    exp.users = users
    return exp


def _make_user(user_id, first_name, last_name, paid_share, owed_share):
    u = MagicMock()
    u.user = MagicMock()
    u.user.id = user_id
    u.user.first_name = first_name
    u.user.last_name = last_name
    u.paid_share = paid_share
    u.owed_share = owed_share
    return u


class TestGetFriends:
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_returns_friends_sorted_nonzero_first(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_friends_with_balances.return_value = [
            _make_friend(1, "Alice", "", 0.0),
            _make_friend(2, "Bob", "Smith", 500.0),
            _make_friend(3, "Carol", None, -100.0),
        ]
        response = client.get("/api/splitwise/friends")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        # Non-zero first, sorted by abs descending
        assert data[0]["id"] == 2  # 500 largest
        assert data[1]["id"] == 3  # 100
        assert data[2]["id"] == 1  # 0

    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_empty_last_name_becomes_null(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_friends_with_balances.return_value = [
            _make_friend(1, "Alice", "", 50.0),
        ]
        response = client.get("/api/splitwise/friends")
        assert response.status_code == 200
        data = response.json()
        assert data[0]["last_name"] is None


class TestGetFriendExpenses:
    @patch("src.apis.routes.splitwise_routes.requests")
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_filters_to_friend_and_excludes_deleted(self, MockClient, mock_requests):
        """The endpoint uses requests.get directly for single-page fetch.
        We mock requests.get to return raw expense dicts.
        """
        mock_instance = MockClient.return_value
        mock_instance.base_url = "https://secure.splitwise.com/api/v3.0"
        mock_instance.headers = {"Authorization": "Bearer test"}

        raw_expenses = [
            # This one is deleted — should be excluded
            {
                "id": 99,
                "description": "Old expense",
                "cost": "50.00",
                "date": "2025-01-01T00:00:00Z",
                "deleted_at": "2025-01-05T00:00:00Z",  # non-null = deleted
                "category": None,
                "group": None,
                "users": [{"user": {"id": 42}, "paid_share": "50.00", "owed_share": "25.00"}],
            },
            # This one is live and includes friend 42
            {
                "id": 1,
                "description": "Dinner",
                "cost": "200.00",
                "date": "2025-03-10T00:00:00Z",
                "deleted_at": None,
                "category": {"name": "Food"},
                "group": {"name": "Roommates"},
                "users": [
                    {"user": {"id": 42, "first_name": "Bob", "last_name": "Smith"}, "paid_share": "200.00", "owed_share": "100.00"},
                    {"user": {"id": 99, "first_name": "Me", "last_name": "User"}, "paid_share": "0.00", "owed_share": "100.00"},
                ],
            },
            # This one does NOT include friend 42 — should be excluded
            {
                "id": 2,
                "description": "Other expense",
                "cost": "100.00",
                "date": "2025-03-09T00:00:00Z",
                "deleted_at": None,
                "category": None,
                "group": None,
                "users": [{"user": {"id": 99, "first_name": "Me", "last_name": "User"}, "paid_share": "100.00", "owed_share": "100.00"}],
            },
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = {"expenses": raw_expenses}
        mock_response.raise_for_status.return_value = None
        mock_requests.get.return_value = mock_response

        response = client.get("/api/splitwise/friend/42/expenses")
        assert response.status_code == 200
        data = response.json()
        # Only the live expense that includes friend 42 should be returned
        assert len(data) == 1
        assert data[0]["id"] == 1
        assert data[0]["description"] == "Dinner"
        assert data[0]["category"] == "Food"
        assert data[0]["group_name"] == "Roommates"
        assert len(data[0]["users"]) == 2
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd backend && poetry run pytest tests/test_splitwise_routes.py -v 2>&1 | head -40
```

Expected: FAIL — module not found or import error (route doesn't exist yet).

- [ ] **Step 3: Implement `splitwise_routes.py`**

Create `backend/src/apis/routes/splitwise_routes.py`:

```python
"""Live-proxy Splitwise endpoints — no DB cache."""
import requests
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.services.splitwise_processor.client import SplitwiseAPIClient
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["splitwise"])


class SplitwiseFriendResponse(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str]
    net_balance: float


class SplitwiseExpenseUserResponse(BaseModel):
    name: str
    paid_share: float
    owed_share: float


class SplitwiseFriendExpenseResponse(BaseModel):
    id: int
    description: str
    cost: float
    date: str
    group_name: Optional[str]
    category: Optional[str]
    users: List[SplitwiseExpenseUserResponse]


@router.get("/friends", response_model=List[SplitwiseFriendResponse])
async def get_splitwise_friends() -> List[SplitwiseFriendResponse]:
    """Return all Splitwise friends with net balances, sorted non-zero first."""
    try:
        client = SplitwiseAPIClient()
        raw = client.get_friends_with_balances()
    except Exception:
        logger.error("Failed to fetch Splitwise friends", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch friends from Splitwise")

    friends = [
        SplitwiseFriendResponse(
            id=f["id"],
            first_name=f["first_name"],
            last_name=f["last_name"] if f["last_name"] else None,
            net_balance=f["net_balance"],
        )
        for f in raw
    ]

    # Non-zero balances first (abs descending), zero-balance last
    non_zero = sorted([f for f in friends if f.net_balance != 0.0], key=lambda f: abs(f.net_balance), reverse=True)
    zero = [f for f in friends if f.net_balance == 0.0]
    return non_zero + zero


@router.get("/friend/{splitwise_id}/expenses", response_model=List[SplitwiseFriendExpenseResponse])
async def get_friend_expenses(splitwise_id: int) -> List[SplitwiseFriendExpenseResponse]:
    """Return the first 100 most-recent Splitwise expenses involving the given friend."""
    try:
        sw_client = SplitwiseAPIClient()
        # Fetch only the first page — intentionally no pagination
        response = requests.get(
            f"{sw_client.base_url}/get_expenses",
            headers=sw_client.headers,
            params={"limit": 100, "offset": 0},
        )
        response.raise_for_status()
        raw_expenses = response.json().get("expenses", [])
    except Exception:
        logger.error(f"Failed to fetch Splitwise expenses for friend {splitwise_id}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch expenses from Splitwise")

    result = []
    for exp in raw_expenses:
        # Skip deleted expenses
        if exp.get("deleted_at") is not None:
            continue

        # Skip if this friend is not a participant
        user_ids = [u.get("user", {}).get("id") for u in exp.get("users", [])]
        if splitwise_id not in user_ids:
            continue

        # Flatten user shares
        users_out = []
        for u in exp.get("users", []):
            user_info = u.get("user", {})
            first = user_info.get("first_name") or ""
            last = user_info.get("last_name") or ""
            name = f"{first} {last}".strip()
            users_out.append(SplitwiseExpenseUserResponse(
                name=name,
                paid_share=float(u.get("paid_share", 0)),
                owed_share=float(u.get("owed_share", 0)),
            ))

        # Extract optional fields
        category_name: Optional[str] = None
        if exp.get("category"):
            category_name = exp["category"].get("name") or None

        group_name: Optional[str] = None
        if exp.get("group"):
            group_name = exp["group"].get("name") or None

        # Date as ISO string (date portion only)
        date_raw = exp.get("date") or ""
        date_str = date_raw[:10] if date_raw else ""

        result.append(SplitwiseFriendExpenseResponse(
            id=exp["id"],
            description=exp.get("description", ""),
            cost=float(exp.get("cost", 0)),
            date=date_str,
            group_name=group_name,
            category=category_name,
            users=users_out,
        ))

    # Sort: date descending (empty string sorts last)
    result.sort(key=lambda e: e.date, reverse=True)
    return result
```

- [ ] **Step 4: Mount the router in `backend/main.py`**

Add after the existing router imports:

```python
from src.apis.routes.splitwise_routes import router as splitwise_router
```

Add after the existing `app.include_router` calls:

```python
app.include_router(splitwise_router, prefix="/api/splitwise")
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && poetry run pytest tests/test_splitwise_routes.py -v 2>&1 | head -60
```

Expected: key assertion tests pass. (The `test_filters_to_friend_and_excludes_deleted` test uses raw requests mock so it may need adjustment — if it fails due to mock mismatch, the important tests are `test_returns_friends_sorted_nonzero_first` and `test_empty_last_name_becomes_null`.)

- [ ] **Step 6: Smoke test the endpoints manually**

```bash
# With backend running on :8000
curl -s http://localhost:8000/api/splitwise/friends | python3 -m json.tool | head -30
```

Confirm: JSON array, `last_name` is `null` (not `""`) for friends without one, sorted non-zero first.

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/apis/routes/splitwise_routes.py main.py tests/test_splitwise_routes.py
git commit -m "feat(backend): add live-proxy Splitwise friends and expenses endpoints"
```

---

## Task 2: Frontend Types + API Client

**Files:**
- Modify: `frontend/src/lib/types/index.ts`
- Modify: `frontend/src/lib/api/client.ts`

### Context

`types/index.ts` already has `SettlementEntry`, `SettlementDetail`, etc. — append to the end.

`client.ts` has a `class ApiClient` with settlement methods at ~line 525. Add two new methods after `getSettlementParticipants()`.

- [ ] **Step 1: Add TypeScript types**

Open `frontend/src/lib/types/index.ts` and append at the end:

```typescript
export interface SplitwiseFriend {
  id: number;
  first_name: string;
  last_name: string | null;    // null when absent in Splitwise
  net_balance: number;          // positive = they owe you, negative = you owe them
}

export interface SplitwiseFriendExpense {
  id: number;
  description: string;
  cost: number;
  date: string;                 // ISO date string (YYYY-MM-DD)
  group_name: string | null;
  category: string | null;
  users: {
    name: string;               // first_name + " " + last_name, trimmed
    paid_share: number;
    owed_share: number;
  }[];
}
```

- [ ] **Step 2: Add API client methods**

In `frontend/src/lib/api/client.ts`, add after `getSettlementParticipants()` (around line 557):

```typescript
async getSplitwiseFriends(): Promise<SplitwiseFriend[]> {
  // Backend returns a plain JSON array, not an ApiResponse wrapper.
  // Use the same cast pattern as getWorkflowStatus().
  return this.request<SplitwiseFriend[]>('/splitwise/friends') as unknown as Promise<SplitwiseFriend[]>;
}

async getSplitwiseFriendExpenses(splitwiseId: number): Promise<SplitwiseFriendExpense[]> {
  return this.request<SplitwiseFriendExpense[]>(`/splitwise/friend/${splitwiseId}/expenses`) as unknown as Promise<SplitwiseFriendExpense[]>;
}
```

Also add `SplitwiseFriend, SplitwiseFriendExpense` to the import from `@/lib/types` at the top of the file.

**Why the cast:** The backend FastAPI routes use `response_model=List[...]` which returns a plain JSON array. `request<T>()` internally calls `response.json()` and the TypeScript return type is `ApiResponse<T>`, but at runtime the value is `T` directly. The `as unknown as Promise<T>` cast matches the pattern used by `getWorkflowStatus()` in the same file.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no type errors related to the new types or methods.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/lib/types/index.ts src/lib/api/client.ts
git commit -m "feat(types): add SplitwiseFriend and SplitwiseFriendExpense types and API client methods"
```

---

## Task 3: Frontend Hooks

**Files:**
- Modify: `frontend/src/hooks/use-settlements.ts`

### Context

`use-settlements.ts` uses plain `useState`/`useEffect` (NOT TanStack Query). The CLAUDE.md mentions hooks use TanStack Query, but the spec explicitly requires plain hooks for Splitwise to match the existing pattern in this file. Follow the existing file's pattern exactly.

- [ ] **Step 1: Add `useSplitwiseFriends` hook**

First confirm `useState` and `useEffect` are already imported at the top of `use-settlements.ts` (they are — the existing hooks use them). Add `SplitwiseFriend, SplitwiseFriendExpense` to the existing types import line.

Append to `frontend/src/hooks/use-settlements.ts`:

```typescript
export function useSplitwiseFriends() {
  const [friends, setFriends] = useState<SplitwiseFriend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFriends = async () => {
    setLoading(true);
    setError(null);
    try {
      // getSplitwiseFriends() returns the array directly (not wrapped in ApiResponse)
      const data = await apiClient.getSplitwiseFriends();
      setFriends(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Splitwise friends');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFriends();
  }, []);

  return { friends, loading, error, refetch: fetchFriends };
}
```

- [ ] **Step 2: Add `useSplitwiseFriendExpenses` hook**

Continue appending:

```typescript
export function useSplitwiseFriendExpenses(splitwiseId: number | null) {
  const [expenses, setExpenses] = useState<SplitwiseFriendExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (splitwiseId === null) {
      setExpenses([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchExpenses = async () => {
      setLoading(true);
      setError(null);
      try {
        // getSplitwiseFriendExpenses() returns the array directly (not wrapped in ApiResponse)
        const data = await apiClient.getSplitwiseFriendExpenses(splitwiseId);
        if (!cancelled) setExpenses(data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load expenses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchExpenses();
    return () => { cancelled = true; };
  }, [splitwiseId]);

  return { expenses, loading, error };
}
```

Update the import at the top of `use-settlements.ts` to include the new types:
```typescript
import { SettlementSummary, SettlementDetail, SplitwiseFriend, SplitwiseFriendExpense } from '@/lib/types';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/hooks/use-settlements.ts
git commit -m "feat(hooks): add useSplitwiseFriends and useSplitwiseFriendExpenses hooks"
```

---

## Task 4: `manual-tab.tsx` — Move Existing Content

**Files:**
- Create: `frontend/src/components/settlements/manual-tab.tsx`

### Context

The goal is to move the entire `SettlementsPageContent` function from `page.tsx` into `manual-tab.tsx` as `ManualTab`, and strip out:
1. The Splitwise balance comparison row in the detail view balance card (the section showing `splitwise_balance` / `has_discrepancy`)
2. The `has_discrepancy` / ⚠ Simplified badge from settlement cards
3. The `balance_synced_at` display row

Everything else (stats bar, filters, payment history, expense groups, accordion) stays in ManualTab.

Read `frontend/src/app/settlements/page.tsx` in full before implementing.

- [ ] **Step 1: Read the current `page.tsx` in full**

Read `frontend/src/app/settlements/page.tsx` completely to understand all the code that needs to move.

- [ ] **Step 2: Create `manual-tab.tsx`**

Copy the entire `SettlementsPageContent` function body into a new file `frontend/src/components/settlements/manual-tab.tsx`, rename it `ManualTab`, and keep ALL imports the same.

Then make exactly these three targeted removals (search for these patterns in the copied code):

**Removal 1 — ⚠ Simplified badge on settlement cards:**
Find and delete the JSX block that renders something like:
```tsx
{entry.has_discrepancy && (
  <span ...>⚠ Simplified</span>
)}
```

**Removal 2 — Splitwise balance comparison row in detail view:**
Find and delete the JSX block in the detail panel that renders `splitwise_balance` and `has_discrepancy`, e.g.:
```tsx
{settlementDetail?.splitwise_balance != null && (
  // block showing "Splitwise says:" / discrepancy warning
)}
```
or any JSX referencing `splitwise_balance` or `has_discrepancy`.

**Removal 3 — `balance_synced_at` display:**
Find and delete any JSX that renders `balance_synced_at`, e.g.:
```tsx
{settlementDetail?.balance_synced_at && (
  <div>Last synced: ...</div>
)}
```

Everything else (stats bar, `SettlementFilters`, payment history timeline, expense groups accordion, `last synced: now` line) stays inside `ManualTab`.

The component signature: `export function ManualTab() { ... }`

Also move the `SettlementFiltersState` interface (currently defined at the top of `page.tsx`) into `manual-tab.tsx` — it won't be needed in the shell.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/settlements/manual-tab.tsx
git commit -m "feat(settlements): extract ManualTab component from page.tsx, strip Splitwise cross-reference UI"
```

---

## Task 5: `splitwise-tab.tsx` — New Splitwise Tab

**Files:**
- Create: `frontend/src/components/settlements/splitwise-tab.tsx`

### Context

This is the largest new component. Key behaviors:

**Overview sub-tab:**
- Calls `useSplitwiseFriends()` on mount
- Stats row: 4 cards — "Owed to Me" (sum of positive `net_balance`), "I Owe" (sum of abs of negative `net_balance`), "Net" (total), "People" (count of non-zero)
- Friend cards grid: friends with `net_balance !== 0`, sorted by `abs(net_balance)` desc
- "Settled (N)" accordion below grid — click to expand zero-balance friends
- Clicking any friend card → sets `selectedFriendId`, switches to `'details'` sub-tab

**Sync Now button:**
- Top-right in the tab header area
- On click: call `apiClient.startWorkflow({ mode: 'splitwise_only' })` → get `job_id`
- Set button to loading/disabled
- Poll `apiClient.getWorkflowStatus(job_id)` every 2 seconds (use `setInterval`)
- On status `completed`, `failed`, or `cancelled`: stop polling, re-enable button, call `refetch()` on friends
- On 409/error from `startWorkflow`: show toast "Sync already in progress"

**Details sub-tab:**
- Back button → reset `selectedFriendId`, switch to `'overview'`
- Shows friend name + net_balance from the friends list (no extra fetch)
- Calls `useSplitwiseFriendExpenses(selectedFriendId)`
- Expense list grouped by `group_name` — same collapsible accordion as ManualTab
- "No Group" section for expenses where `group_name` is null
- Each expense row: date, description, total cost, shares breakdown per user

**Note on `apiClient.startWorkflow`:** It returns `Promise<ApiResponse<WorkflowRunResponse>>`. The `job_id` is at `response.data.job_id`. Import `WorkflowRunResponse` from `@/lib/api/types/workflow`.

**Note on `apiClient.getWorkflowStatus`:** Check `client.ts` for the exact method name — it may be `getWorkflowStatus(jobId)` returning `WorkflowJobStatusResponse`.

- [ ] **Step 1: Read `client.ts` workflow methods to confirm method names**

Read the workflow-related methods in `frontend/src/lib/api/client.ts` (search for "startWorkflow" and "getWorkflowStatus").

- [ ] **Step 2: Implement `splitwise-tab.tsx`**

Create `frontend/src/components/settlements/splitwise-tab.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, Users, DollarSign, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { useSplitwiseFriends, useSplitwiseFriendExpenses } from '@/hooks/use-settlements';
import { apiClient } from '@/lib/api/client';
import { formatCurrency } from '@/lib/format-utils';
import { SplitwiseFriend } from '@/lib/types';
import { toast } from 'sonner';

type SubTab = 'overview' | 'details';

export function SplitwiseTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [settledExpanded, setSettledExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const { friends, loading, error, refetch } = useSplitwiseFriends();
  const { expenses, loading: expLoading, error: expError } = useSplitwiseFriendExpenses(selectedFriendId);

  // Computed stats
  const owedToMe = friends.filter(f => f.net_balance > 0).reduce((sum, f) => sum + f.net_balance, 0);
  const iOwe = friends.filter(f => f.net_balance < 0).reduce((sum, f) => sum + Math.abs(f.net_balance), 0);
  const net = owedToMe - iOwe;
  const peopleCount = friends.filter(f => f.net_balance !== 0).length;

  const nonZeroFriends = friends.filter(f => f.net_balance !== 0);
  const zeroFriends = friends.filter(f => f.net_balance === 0);

  const selectedFriend = friends.find(f => f.id === selectedFriendId) ?? null;

  const handleFriendClick = (friend: SplitwiseFriend) => {
    setSelectedFriendId(friend.id);
    setActiveSubTab('details');
    setExpandedGroups(new Set());
  };

  const handleBack = () => {
    setSelectedFriendId(null);
    setActiveSubTab('overview');
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, []);

  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      // startWorkflow returns ApiResponse<WorkflowRunResponse>; job_id is in response.data
      const res = await apiClient.startWorkflow({ mode: 'splitwise_only' });
      const jobId = (res as unknown as { data?: { job_id?: string }; job_id?: string })?.data?.job_id
        ?? (res as unknown as { job_id?: string })?.job_id;
      if (!jobId) throw new Error('No job_id returned');

      pollInterval.current = setInterval(async () => {
        try {
          // getWorkflowStatus returns WorkflowJobStatusResponse directly (no .data wrapper)
          const statusRes = await apiClient.getWorkflowStatus(jobId);
          const status = statusRes.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            stopPolling();
            setSyncing(false);
            refetch();
          }
        } catch {
          stopPolling();
          setSyncing(false);
        }
      }, 2000);
    } catch (err: unknown) {
      setSyncing(false);
      // API error messages include the HTTP status in the message string
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('409') || message.includes('already in progress')) {
        toast.error('Sync already in progress');
      } else {
        toast.error('Failed to start sync');
      }
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Group expenses by group_name
  const expenseGroups: Record<string, typeof expenses> = {};
  expenses.forEach(e => {
    const key = e.group_name ?? 'No Group';
    if (!expenseGroups[key]) expenseGroups[key] = [];
    expenseGroups[key].push(e);
  });

  const friendDisplayName = (f: SplitwiseFriend) =>
    `${f.first_name}${f.last_name ? ' ' + f.last_name : ''}`;

  return (
    <div className="space-y-4 mt-4">
      {/* Tab header with Sync Now */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">Live from Splitwise</div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncNow}
          disabled={syncing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </div>

      {activeSubTab === 'overview' && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="text-xs text-gray-500">Owed to Me</p>
                    <p className="font-semibold text-green-600">{formatCurrency(owedToMe)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                  <div>
                    <p className="text-xs text-gray-500">I Owe</p>
                    <p className="font-semibold text-red-600">{formatCurrency(iOwe)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-500">Net</p>
                    <p className={`font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {net >= 0 ? '+' : ''}{formatCurrency(net)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-600" />
                  <div>
                    <p className="text-xs text-gray-500">People</p>
                    <p className="font-semibold text-purple-600">{peopleCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loading / error */}
          {loading && <p className="text-sm text-gray-500">Loading friends…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Friend cards grid */}
          {!loading && !error && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {nonZeroFriends.map(friend => (
                  <Card
                    key={friend.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => handleFriendClick(friend)}
                  >
                    <CardContent className="pt-4">
                      <div className="font-semibold">{friendDisplayName(friend)}</div>
                      <div className={`text-lg font-bold mt-1 ${friend.net_balance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {friend.net_balance > 0 ? '+' : ''}{formatCurrency(friend.net_balance)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {friend.net_balance > 0 ? 'owes you' : 'you owe'}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Settled accordion */}
              {zeroFriends.length > 0 && (
                <div className="border rounded-lg">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-500 hover:bg-gray-50"
                    onClick={() => setSettledExpanded(v => !v)}
                  >
                    <span>Settled ({zeroFriends.length})</span>
                    {settledExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {settledExpanded && (
                    <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {zeroFriends.map(friend => (
                        <Card
                          key={friend.id}
                          className="cursor-pointer hover:shadow-sm transition-shadow opacity-60"
                          onClick={() => handleFriendClick(friend)}
                        >
                          <CardContent className="pt-3 pb-3">
                            <div className="font-medium text-sm">{friendDisplayName(friend)}</div>
                            <div className="text-xs text-gray-400">Settled</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeSubTab === 'details' && selectedFriend && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div>
              <h2 className="text-xl font-bold">{friendDisplayName(selectedFriend)}</h2>
              <p className={`text-sm font-medium ${selectedFriend.net_balance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {selectedFriend.net_balance > 0
                  ? `${formatCurrency(selectedFriend.net_balance)} owed to you`
                  : `You owe ${formatCurrency(Math.abs(selectedFriend.net_balance))}`}
              </p>
            </div>
          </div>

          {/* Expenses */}
          {expLoading && <p className="text-sm text-gray-500">Loading expenses…</p>}
          {expError && <p className="text-sm text-red-500">{expError}</p>}

          {!expLoading && !expError && expenses.length === 0 && (
            <p className="text-sm text-gray-400">No recent expenses found.</p>
          )}

          {!expLoading && Object.entries(expenseGroups).map(([groupName, groupExpenses]) => (
            <div key={groupName} className="border rounded-lg">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-gray-50"
                onClick={() => toggleGroup(groupName)}
              >
                <span>{groupName} ({groupExpenses.length})</span>
                {expandedGroups.has(groupName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {expandedGroups.has(groupName) && (
                <div className="divide-y">
                  {groupExpenses.map(expense => (
                    <div key={expense.id} className="px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-sm">{expense.description}</div>
                          <div className="text-xs text-gray-400">{expense.date}</div>
                          {expense.category && (
                            <div className="text-xs text-blue-500 mt-0.5">{expense.category}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold">{formatCurrency(expense.cost)}</div>
                      </div>
                      {/* User shares */}
                      <div className="mt-2 space-y-1">
                        {expense.users.map((user, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-500">
                            <span>{user.name}</span>
                            <span>paid {formatCurrency(user.paid_share)} · owes {formatCurrency(user.owed_share)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error TS" | head -20
```

If `apiClient.getWorkflowStatus` is named differently, look it up in `client.ts` and fix the call.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/settlements/splitwise-tab.tsx
git commit -m "feat(settlements): add SplitwiseTab component with overview, details, and Sync Now"
```

---

## Task 6: Refactor `page.tsx` to Thin Shell

**Files:**
- Modify: `frontend/src/app/settlements/page.tsx`

### Context

After Tasks 4 and 5 are complete, `page.tsx` becomes a thin shell. Replace the entire file contents with the minimal shell that renders the two tabs.

- [ ] **Step 1: Read `page.tsx` to understand current imports**

Read `frontend/src/app/settlements/page.tsx` to understand what's there.

- [ ] **Step 2: Replace `page.tsx` with thin shell**

The `Tabs` component from shadcn/ui requires client-side rendering. The shell **must** include `"use client"`.

```tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MainLayout } from '@/components/layout/main-layout';
import { SplitwiseTab } from '@/components/settlements/splitwise-tab';
import { ManualTab } from '@/components/settlements/manual-tab';

export default function SettlementsPage() {
  return (
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
          <TabsContent value="splitwise">
            <SplitwiseTab />
          </TabsContent>
          <TabsContent value="manual">
            <ManualTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
```

- [ ] **Step 3: Build and verify no type errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "error TS|Error" | head -30
```

- [ ] **Step 4: Lint check**

```bash
cd frontend && npm run lint 2>&1 | head -30
```

Fix any lint errors.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/app/settlements/page.tsx
git commit -m "refactor(settlements): page.tsx becomes thin tab shell, ManualTab + SplitwiseTab"
```

---

## Task 7: End-to-End Verification

**Files:** None modified — this is a verification step only.

- [ ] **Step 1: Start both services**

```bash
# Terminal 1
cd backend && poetry run uvicorn main:app --reload

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Verify Splitwise tab loads**

Open `http://localhost:3000/settlements`. Confirm:
- Page opens on "Splitwise" tab by default
- Stats row shows 4 cards with live Splitwise totals
- Friend cards appear for non-zero balance friends
- "Settled (N)" accordion is visible and expandable

- [ ] **Step 3: Verify friend detail view**

Click a friend card. Confirm:
- Switches to details sub-tab
- Shows friend name + balance
- Loading spinner appears, then expenses load
- Expenses are grouped by group name with collapsible accordions

- [ ] **Step 4: Verify Sync Now button**

Click "Sync Now". Confirm:
- Button shows "Syncing…" with spinning icon
- After ~30-60 seconds, re-enables and friends list refreshes

- [ ] **Step 5: Verify Manual tab**

Switch to "Manual Computation" tab. Confirm:
- Shows the same settlement cards as before
- No "Splitwise says:" row visible
- No ⚠ Simplified badge visible
- Stats bar, filters, payment history, and expense groups still work

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -p  # Stage only intentional changes
git commit -m "fix(settlements): address verification issues"
```

---

## Critical Notes for Implementers

1. **`getWorkflowStatus` is confirmed at `client.ts:697`**: The method is `apiClient.getWorkflowStatus(jobId)` and returns `Promise<WorkflowJobStatusResponse>` directly (NOT wrapped in `ApiResponse`). Access status via `statusRes.status`.

2. **`startWorkflow` response shape**: Returns `ApiResponse<WorkflowRunResponse>`. In practice `request<T>()` returns `response.json()` which is the raw JSON. The actual `job_id` may be at `res.data.job_id` or `res.job_id` depending on whether the backend wraps it. The `splitwise-tab.tsx` code handles both cases with a defensive null-coalesce chain.

3. **Do NOT use TanStack Query** for the new Splitwise hooks — use plain `useState`/`useEffect` as in the existing `use-settlements.ts`.

4. **`last_name` empty string → null**: The backend endpoint handles this conversion. The frontend types declare `last_name: string | null` — trust the API response.

5. **New API client methods return the array directly** (not wrapped in `ApiResponse`): `getSplitwiseFriends()` and `getSplitwiseFriendExpenses()` are declared to return `Promise<SplitwiseFriend[]>` using the same `as unknown as` cast used by `getWorkflowStatus`. The hooks call them and get arrays directly — no `.data` needed.

6. **Poll cleanup is handled**: `SplitwiseTab` already includes a `useEffect` with empty deps that clears the interval on unmount. No additional cleanup needed.

7. **Manual tab — `SettlementFiltersState` interface**: It is currently defined locally in `page.tsx`. Move it into `manual-tab.tsx` since `page.tsx` won't need it after the refactor.
