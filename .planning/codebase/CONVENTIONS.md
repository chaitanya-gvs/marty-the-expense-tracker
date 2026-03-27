# Coding Conventions

**Analysis Date:** 2026-03-27

---

## Backend (Python / FastAPI)

### Naming Patterns

**Files:**
- Snake_case for all Python files: `transaction_read_routes.py`, `category_operations.py`, `statement_workflow.py`
- Descriptive compound names reflecting responsibility: `transaction_write_routes.py`, `transaction_split_routes.py`

**Classes:**
- PascalCase: `TransactionOperations`, `CategoryOperations`, `StatementWorkflow`, `ApiResponse`, `TransactionCreate`
- Operation classes suffixed with `Operations`: `TransactionOperations`, `CategoryOperations`, `TagOperations`
- Schema classes suffixed with their role: `TransactionCreate`, `TransactionUpdate`, `BulkTransactionUpdate`

**Functions / Methods:**
- Snake_case everywhere: `get_all_categories()`, `handle_database_operation()`, `_normalize_participant_name()`
- Private helpers prefixed with `_`: `_normalize_participant_name()`, `_is_current_user()`, `_calculate_participant_share()`
- Route handlers use verb-noun style: `get_transactions()`, `create_transaction()`, `bulk_update_transactions()`

**Variables:**
- Snake_case: `session_factory`, `transaction_id`, `split_breakdown`
- Constants UPPER_SNAKE_CASE: `BALANCE_DISCREPANCY_THRESHOLD`, `CURRENT_USER_NAMES`, `LOG_DIRECTORY`

**Type Hints:**
- All functions have full type annotations
- `from __future__ import annotations` used in all source files
- `Optional[X]` for nullable params (not `X | None` in function signatures, but both appear in settings)

### Module Structure

**Route files pattern:**
```python
from src.utils.logger import get_logger
logger = get_logger(__name__)
router = APIRouter(prefix="/transactions", tags=["transactions"])
```

**Operations classes pattern (all-static methods):**
```python
class CategoryOperations:
    """Operations for managing transaction categories"""

    @staticmethod
    async def get_all_categories(transaction_type: Optional[str] = None) -> List[dict]:
        """Docstring with Args block when non-trivial."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
```

All operation methods are `@staticmethod` — no instance state, no `self`.

**Settings singleton pattern:**
```python
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
```
Always import via `get_settings()`, never instantiate `Settings()` directly.

### Import Organization

**Order:**
1. `from __future__ import annotations` (always first in service/route files)
2. Standard library (`os`, `json`, `typing`, `datetime`, `pathlib`)
3. Third-party (`fastapi`, `sqlalchemy`, `pydantic`)
4. Internal (`src.apis.*`, `src.services.*`, `src.utils.*`)

**Path style:** All internal imports use absolute paths from `src.*`. Relative imports (`..connection`) appear only within the `database_manager` subpackage.

### Error Handling

**Route layer pattern (consistent across all routes):**
```python
try:
    result = await handle_database_operation(SomeOperations.do_thing, ...)
    return ApiResponse(data=result, message="Success message")
except HTTPException:
    raise  # Re-raise 404s without wrapping
except Exception:
    logger.error("Descriptive failure message", exc_info=True)
    raise HTTPException(status_code=500, detail="Internal server error")
```

Key rules:
- Always re-raise `HTTPException` before catching generic `Exception`
- Always use `exc_info=True` on `logger.error()` calls
- 404s raised inline: `raise HTTPException(status_code=404, detail="Transaction not found")`
- Generic 500s use the literal string `"Internal server error"`

**DB retry utility:**
Wrap calls to `TransactionOperations` / `CategoryOperations` etc. with `handle_database_operation()` from `src/utils/db_utils.py`. This handles `asyncpg.InvalidCachedStatementError` with automatic pool refresh and retry.

### Logging

**Framework:** Python standard `logging` via `CustomLogger` in `src/utils/logger.py`

**Usage pattern:**
```python
from src.utils.logger import get_logger
logger = get_logger(__name__)

# Info: before + after successful operation
logger.info("Creating transaction: amount=%s, account=%s", tx.amount, tx.account)
logger.info("Created transaction id=%s", transaction_id)

# Warning: non-fatal unexpected states (category not found, tag already exists)
logger.warning("Category not found: %s", value)

# Error: always with exc_info=True
logger.error("Failed to create transaction", exc_info=True)
```

- Use `%s` style formatting (not f-strings) in logger calls
- Log at entry (`info`) and exit (`info`) of significant operations
- `job_id` is tracked via `extra={"job_id": job_id}` in workflow-related logging; `CustomLogger` defaults `job_id` to `"N/A"` automatically
- Do NOT log redundant intermediate steps

### Schemas / Validation

- All API request/response models inherit `pydantic.BaseModel`
- Request schemas in `src/apis/schemas/`: `TransactionCreate`, `TransactionUpdate`, `BulkTransactionUpdate`
- Use `Field(..., pattern="^(debit|credit)$")` for enum-like string validation
- Use `Optional[X] = None` for all nullable fields (not `X | None`)
- Response always wrapped: `ApiResponse(data=..., message="...")`

---

## Frontend (TypeScript / Next.js)

### Naming Patterns

**Files:**
- Kebab-case components: `transaction-edit-modal.tsx`, `category-autocomplete.tsx`, `inline-tag-editor.tsx`
- Kebab-case hooks: `use-transactions.ts`, `use-categories.ts`, `use-debounce.ts`
- Kebab-case utilities: `format-utils.ts`, `workflow-tasks.ts`

**Components:**
- PascalCase named exports: `TransactionEditModal`, `AddTransactionModal`, `CategorySelector`
- Props interfaces named `{ComponentName}Props`: `TransactionEditModalProps`, `AddTransactionModalProps`

**Hooks:**
- `use` prefix, camelCase: `useTransactions`, `useInfiniteTransactions`, `useCreateTransaction`
- Mutation hooks named after action: `useCreateTransaction`, `useUpdateTransaction`, `useDeleteTransaction`

**Types:**
- PascalCase interfaces in `src/lib/types/index.ts`: `Transaction`, `SplitBreakdown`, `SplitEntry`, `ApiResponse<T>`
- Local type aliases with `type`: `type TransactionTypeFilter = "all" | "debit" | "credit"`

**Constants:**
- UPPER_SNAKE_CASE for module-level constants: `_TAG_COLORS` (leading underscore signals private-ish)

### Code Style

**Formatting:**
- ESLint with `next/core-web-vitals` + `next/typescript` rules (`frontend/eslint.config.mjs`)
- No Prettier config — formatting is ESLint-driven
- Run: `npm run lint` from `frontend/`

**Linting:**
- Next.js TypeScript strict ruleset
- Ignores: `node_modules/`, `.next/`, `out/`, `build/`

### Import Organization

**Order:**
1. React / framework: `import React, { useState, useEffect } from "react"`
2. Third-party libraries: `import { useQuery } from "@tanstack/react-query"`, `import { toast } from "sonner"`
3. Internal path-aliased: `import { apiClient } from "@/lib/api/client"`, `import { cn } from "@/lib/utils"`
4. Relative (rare, only within close sibling files)

**Path aliases:**
- `@/*` maps to `src/*` — use this everywhere, never relative paths outside immediate directory
- Example: `import { Transaction } from "@/lib/types"` not `"../../lib/types"`

### Component Patterns

**Client components:** Top of file `"use client";` directive before imports — required for any component using state, effects, or event handlers.

**Props interface always defined above the component:**
```typescript
interface TransactionEditModalProps {
  transactionId: string;
  isOpen: boolean;
  onClose: () => void;
}
```

**Modals:** Use `Dialog` (Radix `@/components/ui/dialog`) for modals, `Sheet` for side drawers. Use custom `Modal` (`@/components/ui/modal`) for the add-transaction flow.

**Conditional classnames:** Always use `cn()` from `@/lib/utils` (combines `clsx` + `tailwind-merge`). Never string-interpolate Tailwind classes directly.

**Forms:** Use uncontrolled `useState` per field for simple forms (no React Hook Form, no Zod — not present in this codebase). Example from `add-transaction-modal.tsx`:
```typescript
const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
const [account, setAccount] = useState<string>("");
```

### Hooks Pattern

**Query hook:**
```typescript
export function useTransactions(filters?: TransactionFilters, sort?: TransactionSort, pagination?: PaginationParams) {
  return useQuery({
    queryKey: ["transactions", filters, sort, pagination],
    queryFn: () => apiClient.getTransactions(filters, sort, pagination),
  });
}
```

**Mutation hook with optimistic update:**
```typescript
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => apiClient.updateTransaction(id, updates),
    onMutate: async ({ id, updates }) => { /* snapshot + optimistic apply */ },
    onError: (err, variables, context) => { /* rollback */ },
    onSuccess: (data, variables) => { /* apply server truth */ },
  });
}
```

**Mutation hook with cache invalidation (simpler ops):**
```typescript
return useMutation({
  mutationFn: (id: string) => apiClient.deleteTransaction(id),
  onSuccess: () => {
    queryClient.removeQueries({ queryKey: ["transactions"] });
    queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
  },
});
```

Two cache strategies exist — `removeQueries` (force full refetch) vs `setQueriesData` (surgical update). Use `setQueriesData` for updates where server response is available; use `removeQueries` for creates/deletes.

### Utilities

**Currency:** Always `formatCurrency(amount)` from `@/lib/format-utils.ts`. Never manual `₹` formatting. SSR-safe.

**Dates:** Always `formatDate(dateString)` from `@/lib/format-utils.ts` for display. Use `format(date, "yyyy-MM-dd")` from `date-fns` for form values.

**Icons:** Lucide React (`lucide-react` package) — `import { X, Save, Loader2 } from "lucide-react"`

**Toasts:** `import { toast } from "sonner"` — used in mutation `onSuccess`/`onError` handlers.

### API Client

- Singleton `apiClient` exported from `src/lib/api/client.ts`
- All backend calls go through this — never use `fetch` or `axios` directly in components or hooks
- Internal `request<T>()` method wraps `fetch` with JSON headers and error throwing
- Filter arrays are joined as comma-separated query params before sending

---

*Convention analysis: 2026-03-27*
