# Budget Page: Sort Controls & Enhanced Coverage Gap Warning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a utilisation-% sort dropdown to the budget cards list, and upgrade the existing "no budget" warning into a two-section coverage gap panel (recurring gaps + variable spend gaps) with period-aware backend data and working "Create budget" shortcuts.

**Architecture:** Pure-frontend sort via `useMemo` in `BudgetsList`. Backend replaces `get_categories_with_recurring_but_no_budget()` with a new period-aware `get_budget_coverage_gaps(period)` returning two gap arrays. `BudgetCreateModal` is lifted from `BudgetsList` to `budgets/page.tsx` and gains a `defaultCategoryId` prop for pre-fill. `NoBudgetWarning` is redesigned to accept `BudgetCoverageGaps` and render two sections.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async raw SQL (`text()`), pytest, Next.js 15 App Router, TanStack React Query, TypeScript, Tailwind CSS 4, Lucide React

---

## File Map

| File | Change |
|---|---|
| `backend/src/services/database_manager/operations/budget_operations.py` | Add `get_budget_coverage_gaps(period)`, remove `get_categories_with_recurring_but_no_budget()` |
| `backend/src/apis/routes/budget_routes.py` | Update summary route to call new function; rename response key |
| `backend/tests/test_budget_api.py` | Update existing test; add new coverage-gap shape test |
| `frontend/src/lib/types/index.ts` | Replace `UnbudgetedCategory` with `RecurringGap`, `VariableGap`, `BudgetCoverageGaps`; update `BudgetsSummaryResponse` |
| `frontend/src/components/budgets/budget-create-modal.tsx` | Add `defaultCategoryId?: string \| null` prop |
| `frontend/src/app/budgets/page.tsx` | Lift modal state up; wire `onCreateBudget` |
| `frontend/src/components/budgets/budgets-list.tsx` | Accept `onAddBudget`/`onEditBudget` props; remove modal state; add sort controls |
| `frontend/src/components/budgets/no-budget-warning.tsx` | Full redesign with two sections and working buttons |

---

## Task 1: Backend — `get_budget_coverage_gaps(period)`

**Files:**
- Modify: `backend/src/services/database_manager/operations/budget_operations.py`
- Test: `backend/tests/test_budget_api.py`

**Context:** The existing `get_categories_with_recurring_but_no_budget()` (line 157) returns categories with recurring transactions but no budget. We're replacing it with a period-aware function that returns two separate gap lists. All DB work uses `text()` raw SQL with `get_session_factory()`, following the pattern of every other method in this file. Run all backend commands from `backend/`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_budget_api.py`:

```python
def test_budget_summary_has_coverage_gaps_shape(client):
    """GET /api/budgets/summary returns coverage_gaps with recurring_gaps and variable_gaps arrays."""
    resp = client.get("/api/budgets/summary")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "coverage_gaps" in data, "expected coverage_gaps key (not unbudgeted_categories)"
    gaps = data["coverage_gaps"]
    assert "recurring_gaps" in gaps
    assert "variable_gaps" in gaps
    assert isinstance(gaps["recurring_gaps"], list)
    assert isinstance(gaps["variable_gaps"], list)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
poetry run pytest tests/test_budget_api.py::test_budget_summary_has_coverage_gaps_shape -v
```

Expected: FAIL — `coverage_gaps` key not present (response has `unbudgeted_categories` today).

- [ ] **Step 3: Add `get_budget_coverage_gaps` to `budget_operations.py`**

Add this method to the `BudgetOperations` class, **before** `get_categories_with_recurring_but_no_budget` (which you'll remove in Step 4):

```python
@staticmethod
async def get_budget_coverage_gaps(period: str) -> dict:
    """
    Return two gap lists for the given period (YYYY-MM):
      - recurring_gaps: categories with recurring transactions but no budget
      - variable_gaps: categories with non-recurring debit spend this period but no budget
                       (categories already in recurring_gaps are excluded)
    """
    import calendar
    from datetime import date

    year, month = int(period[:4]), int(period[5:7])
    last_day = calendar.monthrange(year, month)[1]
    period_start = date(year, month, 1)
    period_end = date(year, month, last_day)

    session_factory = get_session_factory()
    async with session_factory() as session:

        # ── Recurring gaps ──────────────────────────────────────────────────
        # For each category with recurring txns but no budget:
        # - recurring_count = distinct recurring keys
        # - projected_amount = sum of latest known amount per recurring key
        recurring_rows = (await session.execute(text("""
            WITH latest_per_key AS (
                SELECT DISTINCT ON (t.category_id,
                                    COALESCE(t.recurring_key, t.user_description, t.description))
                       t.category_id,
                       COALESCE(t.split_share_amount, t.amount) AS amount
                FROM transactions t
                WHERE t.is_recurring = true
                  AND t.is_deleted = false
                  AND t.direction = 'debit'
                  AND (t.transaction_group_id IS NULL
                       OR t.is_split = true
                       OR t.is_grouped_expense = true)
                ORDER BY t.category_id,
                         COALESCE(t.recurring_key, t.user_description, t.description),
                         t.transaction_date DESC
            ),
            projected AS (
                SELECT category_id, SUM(amount) AS projected_amount
                FROM latest_per_key
                GROUP BY category_id
            )
            SELECT c.id::text AS id,
                   c.name,
                   COUNT(DISTINCT COALESCE(t.recurring_key, t.user_description, t.description))
                       AS recurring_count,
                   COALESCE(p.projected_amount, 0) AS projected_amount
            FROM transactions t
            JOIN categories c ON c.id = t.category_id
            LEFT JOIN projected p ON p.category_id = t.category_id
            WHERE t.is_recurring = true
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND (t.transaction_group_id IS NULL
                   OR t.is_split = true
                   OR t.is_grouped_expense = true)
              AND NOT EXISTS (SELECT 1 FROM budgets b WHERE b.category_id = t.category_id)
            GROUP BY c.id, c.name, p.projected_amount
            ORDER BY c.name
        """))).mappings().all()

        recurring_category_ids = {r["id"] for r in recurring_rows}

        # ── Variable gaps ───────────────────────────────────────────────────
        # Categories with non-recurring debit spend this period but no budget,
        # excluding any category already in recurring_gaps.
        variable_rows = (await session.execute(text("""
            SELECT c.id::text AS id,
                   c.name,
                   COALESCE(SUM(COALESCE(t.split_share_amount, t.amount)), 0)
                       AS variable_spend,
                   COUNT(t.id) AS transaction_count
            FROM transactions t
            JOIN categories c ON c.id = t.category_id
            WHERE (t.is_recurring = false OR t.is_recurring IS NULL)
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date BETWEEN :period_start AND :period_end
              AND (t.transaction_group_id IS NULL
                   OR t.is_split = true
                   OR t.is_grouped_expense = true)
              AND NOT EXISTS (SELECT 1 FROM budgets b WHERE b.category_id = t.category_id)
              AND NOT EXISTS (
                  SELECT 1 FROM transactions t2
                  WHERE t2.category_id = t.category_id
                    AND t2.is_recurring = true
                    AND t2.is_deleted = false
              )
            GROUP BY c.id, c.name
            ORDER BY variable_spend DESC
        """), {"period_start": period_start, "period_end": period_end})).mappings().all()

        return {
            "recurring_gaps": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "recurring_count": int(r["recurring_count"]),
                    "projected_amount": float(r["projected_amount"]),
                }
                for r in recurring_rows
            ],
            "variable_gaps": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "variable_spend": float(r["variable_spend"]),
                    "transaction_count": int(r["transaction_count"]),
                }
                for r in variable_rows
            ],
        }
```

- [ ] **Step 4: Remove the old function**

Delete the entire `get_categories_with_recurring_but_no_budget` method from `BudgetOperations` (lines 157–175 in the current file). It will be replaced by `get_budget_coverage_gaps`.

- [ ] **Step 5: Run existing budget tests to confirm nothing broke**

```bash
poetry run pytest tests/test_budget_api.py -v
```

Expected: `test_budget_summary_has_coverage_gaps_shape` still FAILS (route not updated yet). All other tests should PASS or be unaffected (the route update is Task 2).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/database_manager/operations/budget_operations.py
git add backend/tests/test_budget_api.py
git commit -m "feat(budgets): add get_budget_coverage_gaps with recurring and variable gap arrays"
```

---

## Task 2: Backend — Update `/budgets/summary` route

**Files:**
- Modify: `backend/src/apis/routes/budget_routes.py`
- Modify: `backend/tests/test_budget_api.py`

**Context:** The summary route currently calls `get_categories_with_recurring_but_no_budget()` and returns the result as `unbudgeted_categories`. Change it to call `get_budget_coverage_gaps(period)` and return it as `coverage_gaps`. Also update the existing test that asserts the old key name.

- [ ] **Step 1: Update the route in `budget_routes.py`**

In `get_budgets_summary`, replace:

```python
    # Also include categories with recurring but no budget (for warnings)
    unbudgeted = await BudgetOperations.get_categories_with_recurring_but_no_budget()

    return ApiResponse(data={"budgets": summaries, "unbudgeted_categories": unbudgeted, "period": period})
```

With:

```python
    # Coverage gaps: recurring without a budget + variable spend without a budget
    # Errors here are non-fatal — budgets still load, warnings just won't show
    try:
        coverage_gaps = await BudgetOperations.get_budget_coverage_gaps(period)
    except Exception as e:
        logger.error("Failed to compute coverage gaps for period %s: %s", period, e)
        coverage_gaps = {"recurring_gaps": [], "variable_gaps": []}

    return ApiResponse(data={"budgets": summaries, "coverage_gaps": coverage_gaps, "period": period})
```

- [ ] **Step 2: Update the existing test that checks the old key**

In `backend/tests/test_budget_api.py`, find `test_budget_summary_default_period` and update the assertion:

```python
def test_budget_summary_default_period(client):
    """GET /api/budgets/summary returns current period when no period param given."""
    resp = client.get("/api/budgets/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "period" in body["data"]
    assert "budgets" in body["data"]
    assert "coverage_gaps" in body["data"]          # was: unbudgeted_categories
    assert "unbudgeted_categories" not in body["data"]  # confirm old key is gone
```

- [ ] **Step 3: Run all budget tests**

```bash
poetry run pytest tests/test_budget_api.py -v
```

Expected: ALL tests PASS including `test_budget_summary_has_coverage_gaps_shape`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/apis/routes/budget_routes.py
git add backend/tests/test_budget_api.py
git commit -m "feat(budgets): update summary route to return coverage_gaps replacing unbudgeted_categories"
```

---

## Task 3: Frontend — TypeScript types

**Files:**
- Modify: `frontend/src/lib/types/index.ts`

**Context:** `UnbudgetedCategory` (line 104) and `BudgetsSummaryResponse` (line 98) need updating to match the new backend response shape. The API client (`src/lib/api/client.ts`) uses `BudgetsSummaryResponse` as the return type for `getBudgetsSummary` — updating this interface automatically fixes the client's types. Run frontend commands from `frontend/`.

- [ ] **Step 1: Replace `UnbudgetedCategory` and update `BudgetsSummaryResponse`**

In `frontend/src/lib/types/index.ts`, replace:

```typescript
export interface BudgetsSummaryResponse {
  budgets: BudgetSummary[];
  unbudgeted_categories: UnbudgetedCategory[];
  period: string;
}

export interface UnbudgetedCategory {
  id: string;
  name: string;
  color?: string | null;
  recurring_count: number;
}
```

With:

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

export interface BudgetsSummaryResponse {
  budgets: BudgetSummary[];
  coverage_gaps: BudgetCoverageGaps;
  period: string;
}
```

- [ ] **Step 2: Check for TypeScript errors**

```bash
npm run build 2>&1 | head -40
```

Expected: TypeScript errors about `unbudgeted_categories` in `budgets/page.tsx` and `NoBudgetWarning`. These are expected — they'll be fixed in Tasks 5 and 6.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/index.ts
git commit -m "feat(budgets): replace UnbudgetedCategory type with RecurringGap/VariableGap/BudgetCoverageGaps"
```

---

## Task 4: Frontend — `BudgetCreateModal` `defaultCategoryId` prop

**Files:**
- Modify: `frontend/src/components/budgets/budget-create-modal.tsx`

**Context:** The modal currently resets to empty when `editingBudget` is null. Add a `defaultCategoryId` prop that pre-selects a category when the modal opens from a gap-row "Create budget →" button. The `useEffect` on line 34 controls form reset on open — extend it to handle the new prop.

- [ ] **Step 1: Add the prop and update the `useEffect`**

Replace the interface and `useEffect` in `budget-create-modal.tsx`:

```typescript
interface BudgetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBudget?: BudgetSummary | null;
  defaultCategoryId?: string | null;
}

export function BudgetCreateModal({
  isOpen,
  onClose,
  editingBudget,
  defaultCategoryId,
}: BudgetCreateModalProps) {
```

Replace the existing `useEffect` (currently lines 34–44):

```typescript
  useEffect(() => {
    if (editingBudget) {
      setCategoryId(editingBudget.category_id);
      setMonthlyLimit(String(editingBudget.monthly_limit));
      setName(editingBudget.name ?? "");
    } else if (defaultCategoryId) {
      setCategoryId(defaultCategoryId);
      setMonthlyLimit("");
      setName("");
    } else {
      setCategoryId("");
      setMonthlyLimit("");
      setName("");
    }
  }, [editingBudget, defaultCategoryId, isOpen]);
```

- [ ] **Step 2: Verify the build still compiles**

```bash
npm run build 2>&1 | head -40
```

Expected: Same TypeScript errors as before (in page.tsx and NoBudgetWarning) — no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/budgets/budget-create-modal.tsx
git commit -m "feat(budgets): add defaultCategoryId prop to BudgetCreateModal for pre-fill"
```

---

## Task 5: Frontend — Lift modal state to `budgets/page.tsx` + update `BudgetsList` props

**Files:**
- Modify: `frontend/src/app/budgets/page.tsx`
- Modify: `frontend/src/components/budgets/budgets-list.tsx`

**Context:** `BudgetCreateModal` currently lives inside `BudgetsList`. Moving it to `page.tsx` lets `NoBudgetWarning` (also in `page.tsx`) trigger it with a pre-filled category. `BudgetOverrideModal` stays in `BudgetsList` — it's only triggered from within a budget card.

- [ ] **Step 1: Update `BudgetsList` — remove modal, accept new props**

Replace the full contents of `frontend/src/components/budgets/budgets-list.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, PiggyBank } from "lucide-react";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetOverrideModal } from "@/components/budgets/budget-override-modal";
import { useDeleteBudget } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";

type SortKey = "utilisation_desc" | "name_asc" | "spend_desc" | "headroom_asc";

function sortBudgets(budgets: BudgetSummary[], sortKey: SortKey): BudgetSummary[] {
  const sorted = [...budgets];
  switch (sortKey) {
    case "utilisation_desc":
      return sorted.sort((a, b) => b.utilisation_pct - a.utilisation_pct);
    case "name_asc":
      return sorted.sort((a, b) =>
        (a.name ?? a.category_name).localeCompare(b.name ?? b.category_name),
      );
    case "spend_desc":
      return sorted.sort(
        (a, b) =>
          b.committed_spend + b.variable_spend - (a.committed_spend + a.variable_spend),
      );
    case "headroom_asc":
      return sorted.sort((a, b) => a.headroom - b.headroom);
  }
}

interface BudgetsListProps {
  budgets: BudgetSummary[];
  isLoading: boolean;
  period: string;
  onAddBudget: () => void;
  onEditBudget: (budget: BudgetSummary) => void;
}

export function BudgetsList({
  budgets,
  isLoading,
  period,
  onAddBudget,
  onEditBudget,
}: BudgetsListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("utilisation_desc");
  const [overrideBudget, setOverrideBudget] = useState<BudgetSummary | null>(null);
  const deleteBudget = useDeleteBudget();

  const sortedBudgets = sortBudgets(budgets, sortKey);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this budget and all its overrides?")) return;
    try {
      await deleteBudget.mutateAsync(id);
      toast.success("Budget deleted");
    } catch {
      toast.error("Failed to delete budget");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex-1">
          Monthly Budgets · {budgets.length} active
        </h2>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs bg-transparent text-muted-foreground border border-border rounded-md px-2 py-1 cursor-pointer hover:border-border/80 focus:outline-none"
          aria-label="Sort budgets"
        >
          <option value="utilisation_desc">↓ Utilisation %</option>
          <option value="name_asc">A → Z</option>
          <option value="spend_desc">↓ Amount spent</option>
          <option value="headroom_asc">↑ Headroom</option>
        </select>
        <Button size="sm" onClick={onAddBudget}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
        </Button>
      </div>

      {budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-border/50 bg-card/30">
          <PiggyBank className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <div className="text-center space-y-1">
            <h3 className="font-semibold text-foreground">No budgets yet</h3>
            <p className="text-sm text-muted-foreground">
              Create your first budget to start tracking spending limits.
            </p>
          </div>
          <Button
            size="sm"
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={onAddBudget}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedBudgets.map((b) => (
            <BudgetCard
              key={b.id}
              budget={b}
              period={period}
              onEdit={onEditBudget}
              onDelete={handleDelete}
              onOverride={(b) => setOverrideBudget(b)}
            />
          ))}
        </div>
      )}

      <BudgetOverrideModal
        isOpen={!!overrideBudget}
        onClose={() => setOverrideBudget(null)}
        budget={overrideBudget}
        period={period}
      />
    </>
  );
}
```

- [ ] **Step 2: Update `budgets/page.tsx` — lift modal state**

Replace the full contents of `frontend/src/app/budgets/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { BudgetsOverview } from "@/components/budgets/budgets-overview";
import { BudgetsList } from "@/components/budgets/budgets-list";
import { BudgetThresholdAlerts } from "@/components/budgets/budget-threshold-alerts";
import { NoBudgetWarning } from "@/components/budgets/no-budget-warning";
import { BudgetCreateModal } from "@/components/budgets/budget-create-modal";
import { useBudgetsSummary } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

function getPeriod(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export default function BudgetsPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const period = getPeriod(monthOffset);
  const { data, isLoading } = useBudgetsSummary(period);

  // Modal state (shared between "Add Budget" button and coverage-gap shortcuts)
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetSummary | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);

  const summaryData = data?.data;
  const budgets = summaryData?.budgets ?? [];
  const coverageGaps = summaryData?.coverage_gaps ?? { recurring_gaps: [], variable_gaps: [] };

  const handleAddBudget = () => {
    setEditingBudget(null);
    setDefaultCategoryId(null);
    setCreateOpen(true);
  };

  const handleEditBudget = (budget: BudgetSummary) => {
    setEditingBudget(budget);
    setDefaultCategoryId(null);
    setCreateOpen(true);
  };

  const handleCreateFromGap = (categoryId: string) => {
    setEditingBudget(null);
    setDefaultCategoryId(categoryId);
    setCreateOpen(true);
  };

  const handleModalClose = () => {
    setCreateOpen(false);
    setEditingBudget(null);
    setDefaultCategoryId(null);
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        {/* Header + period nav */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Budgets</h1>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Manage your monthly spending limits and track progress
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMonthOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {formatPeriodLabel(period)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMonthOffset((o) => o + 1)}
              disabled={monthOffset >= 0}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Overview stats */}
        <BudgetsOverview data={summaryData} isLoading={isLoading} />

        {/* Threshold alerts */}
        {budgets.length > 0 && <BudgetThresholdAlerts budgets={budgets} />}

        {/* Coverage gap warnings */}
        <NoBudgetWarning
          coverageGaps={coverageGaps}
          onCreateBudget={handleCreateFromGap}
        />

        {/* Budget cards list */}
        <BudgetsList
          budgets={budgets}
          isLoading={isLoading}
          period={period}
          onAddBudget={handleAddBudget}
          onEditBudget={handleEditBudget}
        />

        {/* Shared create/edit modal */}
        <BudgetCreateModal
          isOpen={createOpen}
          onClose={handleModalClose}
          editingBudget={editingBudget}
          defaultCategoryId={defaultCategoryId}
        />
      </div>
    </MainLayout>
  );
}
```

- [ ] **Step 3: Check the build**

```bash
npm run build 2>&1 | head -40
```

Expected: Only TypeScript errors in `no-budget-warning.tsx` (props changed). No errors in `budgets-list.tsx` or `page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/budgets/page.tsx src/components/budgets/budgets-list.tsx
git commit -m "feat(budgets): lift modal state to page, add sort controls to BudgetsList"
```

---

## Task 6: Frontend — Redesign `NoBudgetWarning`

**Files:**
- Modify: `frontend/src/components/budgets/no-budget-warning.tsx`

**Context:** The current component takes `categories: UnbudgetedCategory[]` and renders one flat list. Replace it with two sections: recurring gaps and variable gaps. Both sections are hidden when empty; the entire panel hides when both are empty. The "Create budget →" button in each row calls `onCreateBudget(categoryId)` which now opens the shared modal in `page.tsx`.

- [ ] **Step 1: Replace the full component**

Replace the full contents of `frontend/src/components/budgets/no-budget-warning.tsx`:

```typescript
"use client";

import { AlertTriangle } from "lucide-react";
import { BudgetCoverageGaps } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface NoBudgetWarningProps {
  coverageGaps: BudgetCoverageGaps;
  onCreateBudget: (categoryId: string) => void;
}

export function NoBudgetWarning({ coverageGaps, onCreateBudget }: NoBudgetWarningProps) {
  const { recurring_gaps, variable_gaps } = coverageGaps;

  if (recurring_gaps.length === 0 && variable_gaps.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Recurring without a budget */}
      {recurring_gaps.length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Recurring expenses without a budget
          </div>
          <div className="space-y-1">
            {recurring_gaps.map((gap) => (
              <div key={gap.id} className="flex items-center justify-between text-xs gap-3">
                <span className="text-muted-foreground min-w-0 truncate">
                  <span className="text-foreground font-medium">{gap.name}</span>
                  {" "}— {gap.recurring_count} recurring transaction{gap.recurring_count !== 1 ? "s" : ""}
                  {" "}· {formatCurrency(gap.projected_amount)}/mo projected
                </span>
                <button
                  type="button"
                  className="shrink-0 text-yellow-400/80 hover:text-yellow-300 transition-colors"
                  onClick={() => onCreateBudget(gap.id)}
                >
                  Create budget →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variable spend without a budget */}
      {variable_gaps.length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Unbudgeted variable spending this month
          </div>
          <div className="space-y-1">
            {variable_gaps.map((gap) => (
              <div key={gap.id} className="flex items-center justify-between text-xs gap-3">
                <span className="text-muted-foreground min-w-0 truncate">
                  <span className="text-foreground font-medium">{gap.name}</span>
                  {" "}— {formatCurrency(gap.variable_spend)} spent,{" "}
                  {gap.transaction_count} transaction{gap.transaction_count !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-yellow-400/80 hover:text-yellow-300 transition-colors"
                  onClick={() => onCreateBudget(gap.id)}
                >
                  Create budget →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the build — expect clean output**

```bash
npm run build 2>&1 | head -40
```

Expected: No TypeScript errors. All previous `unbudgeted_categories` errors are now resolved.

- [ ] **Step 3: Run the linter**

```bash
npm run lint 2>&1 | head -30
```

Expected: No new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/budgets/no-budget-warning.tsx
git commit -m "feat(budgets): redesign NoBudgetWarning with recurring and variable gap sections"
```

---

## Self-Review Checklist

After all tasks are complete, verify:

- [ ] Backend: `get_budget_coverage_gaps` query filters `is_deleted = false`, direction `debit`, excludes grouped transactions consistently with `budget_service.py`
- [ ] Backend: categories in `variable_gaps` are never also in `recurring_gaps` (the `NOT EXISTS` sub-query handles this)
- [ ] Backend: old `get_categories_with_recurring_but_no_budget` is fully removed — no dangling references
- [ ] Frontend: `BudgetCreateModal` `defaultCategoryId` only applies when `editingBudget` is null (edit mode takes precedence)
- [ ] Frontend: sort is stable — `[...budgets]` copy prevents mutation of the prop
- [ ] Frontend: empty state in `BudgetsList` still shows "Add Budget" button (uses `onAddBudget` callback)
- [ ] Frontend: `BudgetOverrideModal` still works (stays inside `BudgetsList`, not lifted)
- [ ] All tests pass: `poetry run pytest tests/test_budget_api.py -v`
- [ ] Build is clean: `npm run build`
