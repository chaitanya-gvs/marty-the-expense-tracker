# Coding Conventions

**Analysis Date:** 2026-08-09

## Backend (Python) Conventions

### Naming Patterns

**Modules & Functions:**
- `snake_case` for all function and variable names
- Example: `get_transactions()`, `transaction_date`, `statement_sender`
- File names: `snake_case.py` (e.g., `transaction_routes.py`, `account_operations.py`)

**Classes:**
- `PascalCase` for all class names
- Operations classes: `{Entity}Operations` (e.g., `TransactionOperations`, `CategoryOperations`)
- Service classes: `{Feature}Service` (e.g., `DeduplicationService`, `EmailClient`)
- Model classes: `{Entity}` (e.g., `Transaction`, `Account`, `Category`)
- Examples from codebase: `AccountOperations`, `StatementWorkflow`, `CustomLogger`

**Constants:**
- `UPPER_SNAKE_CASE` for configuration constants
- Example: `LOG_MAX_BYTES`, `LOG_DIRECTORY`, `LOG_LEVEL`

**Private/Internal:**
- Prefix with underscore for private functions/methods: `_get_active_job()`, `_resolve_toggles()`

### Type Hints

**Requirements:**
- All function parameters and return types must have type hints
- Use `Optional[T]` for nullable values (not `T | None` per PEP 604 in Python 3.11+, though both are valid — codebase uses `Optional`)
- Use `List`, `Dict`, `Tuple` from `typing` for collections (though `list`, `dict` are valid in 3.9+, codebase uses `typing` module)
- Union types: `AsyncMock | None` syntax used in imports
- Generic types: `AsyncGenerator`, `Dict[str, Any]`, `List[dict]`

**Examples:**
```python
async def get_all_accounts() -> List[dict]:
    """Get all active bank accounts"""
    ...

async def get_account_by_statement_sender(email: str) -> Optional[dict]:
    """Get account by statement sender email."""
    ...

def _resolve_toggles(req: WorkflowRunRequest) -> tuple[bool, bool, bool, bool]:
    """Resolve effective toggles from mode preset."""
    ...

async def _resolve_splitwise_dates(
    req: WorkflowRunRequest,
    job_id: Optional[str] = None,
) -> tuple[Optional[datetime], Optional[datetime]]:
    ...
```

### Import Organization

**Order (required):**
1. `__future__` annotations import (if using `from __future__ import annotations`)
2. Standard library imports (e.g., `import os`, `from datetime import date`)
3. Third-party imports (e.g., `from fastapi import FastAPI`, `from sqlalchemy import text`)
4. Local/relative imports (e.g., `from src.services...`, `from ..models...`)

**Blank lines:** One blank line between each group.

**Example from codebase (`src/apis/routes/transaction_read_routes.py`):**
```python
from __future__ import annotations

from datetime import date as DateType, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text

from src.apis.schemas.common import ApiResponse
from src.apis.schemas.transactions import TransferSuggestion
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger
```

**Path aliases:** None — always use absolute imports from project root (e.g., `from src.services...`).

### Code Style & Formatting

**Tool:** `ruff` (linter + formatter)
- Config: No `.ruffrc` or `pyproject.toml` overrides currently active
- Run: `poetry run ruff check .`

**Key style rules (observed from codebase):**
- Line length: No strict limit enforced, but reasonable (~100-120 chars)
- Indentation: 4 spaces
- Blank lines: 2 blank lines before top-level function/class definitions
- Trailing commas: Used in multiline arguments/lists
- Spaces around operators: `key: value`, `param = default_value`
- String quotes: Double quotes preferred, f-strings for formatting

**Example:**
```python
class AccountOperations:
    """Operations for managing bank accounts"""

    @staticmethod
    async def get_all_accounts() -> List[dict]:
        """Get all active bank accounts"""
        try:
            session_factory = get_session_factory()
            async with session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT * FROM accounts
                        WHERE is_active = true
                        ORDER BY account_type, bank_name
                    """)
                )
                rows = result.fetchall()
                accounts = [dict(row._mapping) for row in rows]
                logger.info("Retrieved %d active accounts", len(accounts))
                return accounts
        except Exception:
            logger.error("Failed to retrieve all accounts", exc_info=True)
            raise
```

### Docstrings

**Format:** Triple-quoted strings, one-liner or multi-line

**When required:**
- All public functions and methods
- All classes
- Complex private functions (optional)

**Style (from codebase):**
```python
def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)

class AccountOperations:
    """Operations for managing bank accounts"""

    @staticmethod
    async def get_all_accounts() -> List[dict]:
        """Get all active bank accounts"""
        ...

    @staticmethod
    async def get_account_by_statement_sender(email: str) -> Optional[dict]:
        """Get account by statement sender email (handles comma-separated senders).

        Matches by exact address after splitting each account's comma-separated
        statement_sender on ',' — NOT a substring LIKE, which would wrongly match
        e.g. "statements@axis.bank.in" against "cc.statements@axis.bank.in".
        """
        ...
```

**Parameters/returns:** Generally not documented in docstring — rely on type hints instead.

### Comments

**When to use:**
- Explain *why* not *what* (code should be self-documenting)
- Mark important sections/transitions with comment blocks above
- Explain business logic or non-obvious decisions
- For complex conditionals or state transitions

**Style:**
```python
# Re-run after all imports complete so agentic_doc's basicConfig(force=True)
# does not wipe our RotatingFileHandler.
setup_logging()

# Check if this group has split children
return txn.get('transaction_group_id') in split_group_ids_with_children

# End of "today" for auto Splitwise range (API uses date strings; IST matches user's calendar day)
_IST = ZoneInfo("Asia/Kolkata")
```

**Don't comment obvious code:**
```python
# BAD:
count = 0  # Initialize count to zero

# GOOD:
logger.info("Retrieved %d active accounts", len(accounts))
```

### Error Handling

**Pattern:**
- Wrap risky operations in `try-except`
- Always log errors with `logger.error(...)` using `exc_info=True` to capture stack trace
- Re-raise or handle gracefully depending on context
- At service level: log and re-raise
- At route level: convert to HTTPException

**Database layer (`src/services/database_manager/operations/account_operations.py`):**
```python
try:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(text(...))
        rows = result.fetchall()
        accounts = [dict(row._mapping) for row in rows]
        logger.info("Retrieved %d active accounts", len(accounts))
        return accounts
except Exception:
    logger.error("Failed to retrieve all accounts", exc_info=True)
    raise
```

**Route layer (`src/apis/routes/workflow_routes.py`):**
```python
try:
    async with get_session_factory()() as session:
        result = await session.execute(text("""..."""))
        row = result.fetchone()
        if row and row.last_date:
            return row.last_date
        return None
except Exception:
    return None  # Graceful fallback; error logged in calling context
```

**API error response:**
```python
if job_id and job_id not in _jobs:
    raise HTTPException(status_code=404, detail="Job not found")
```

### Logging

**Framework:** Standard Python `logging` module via `get_logger(name)`

**Setup:** `src/utils/logger.py` configures:
- Rotating file handler: `logs/app.log` (max 1GB per file, 5 backups)
- Console handler: stdout
- Custom formatter: `"%(asctime)s - %(levelname)s - %(name)s - %(job_id)s - %(message)s"`
- Job ID tracking via `extra={"job_id": job_id}`

**Usage pattern:**
```python
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Info level — normal operations
logger.info("Fetching transactions: page=%d, limit=%d", page, limit)
logger.info("Retrieved %d active accounts", len(accounts))

# Error level — exceptions (always with exc_info=True)
logger.error("Failed to retrieve all accounts", exc_info=True)
logger.error("Scheduled email ingestion failed", exc_info=True)

# With job_id tracking for long-running operations
logger.info(
    "Auto-detected Splitwise range: %s → %s",
    start.date(),
    end.date(),
    extra={"job_id": job_id} if job_id else {},
)
```

### Database & SQL

**Pattern:**
- Use `text()` from `sqlalchemy` for raw SQL with explicit parameterization
- Convert `SQLAlchemy Row` objects to `dict` via `dict(row._mapping)`
- Always use `.fetchall()` or `.fetchone()` appropriately
- Session usage: `async with session_factory() as session:`
- All DB operations in `src/services/database_manager/operations/` classes

**Example:**
```python
result = await session.execute(
    text("""
        SELECT id, nickname, statement_sender, statement_password
        FROM accounts
        WHERE is_active = true
        ORDER BY account_type, bank_name
    """)
)
rows = result.fetchall()
accounts = [dict(row._mapping) for row in rows]
```

**Parameterized queries:**
```python
result = await session.execute(
    text("""
        SELECT * FROM accounts
        WHERE account_type = :account_type AND is_active = true
    """), {"account_type": account_type}
)
```

### Async/Await

**Pattern:**
- All I/O operations (DB, API calls, file reads) are async
- Use `async def` and `await` consistently
- Routes are `async def` and use `await` for all async dependencies
- No mixing blocking and async code without explicit wrappers

**Example:**
```python
async def get_all_accounts() -> List[dict]:
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(...)
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
    except Exception:
        logger.error("...", exc_info=True)
        raise
```

### Configuration & Settings

**Pattern:** Centralized Pydantic v2 settings in `src/utils/settings.py`
- Loaded from `configs/.env` and `configs/secrets/.env` via `python-dotenv`
- Singleton access via `get_settings()` with `@lru_cache(maxsize=1)`
- All env var access goes through settings, never `os.getenv()` in code

**Usage:**
```python
from src.utils.settings import get_settings

settings = get_settings()
backend_url = settings.BACKEND_URL
```

---

## Frontend (TypeScript/React) Conventions

### Naming Patterns

**Files & Directories:**
- `kebab-case` for file/directory names (e.g., `transaction-filters.tsx`, `split-editor.tsx`)
- Page components: match route name (e.g., `src/app/transactions/page.tsx`)
- Feature directories: `{feature}/` (e.g., `components/transactions/`, `hooks/`)

**Functions & Variables:**
- `camelCase` for all function and variable names (e.g., `getTransactions()`, `formatCurrency()`)
- React hooks: `use{Feature}` (e.g., `useTransactions()`, `useCategories()`)
- Helper functions: descriptive camelCase (e.g., `arraysEqual()`, `buildTaskTree()`)

**Types & Interfaces:**
- `PascalCase` for all interface/type names (e.g., `Transaction`, `TransactionFilters`, `SplitBreakdown`)
- Props interfaces: `{ComponentName}Props` (e.g., `TransactionFiltersProps`)
- File location: `src/lib/types/index.ts` (canonical)

**Constants:**
- `camelCase` for runtime constants (e.g., `queryKey: ["transactions"]`)
- `UPPER_CASE` for truly static constants (rarely used)

**Example:**
```typescript
interface TransactionFiltersProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
  onClearFilters: () => void;
}

export function TransactionFilters({
  filters,
  onFiltersChange,
  onClearFilters,
}: TransactionFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: categories = [] } = useCategories();
  
  const updateFilter = (key: keyof TransactionFilters, value: TransactionFilters[keyof TransactionFilters]) => {
    onFiltersChange({ ...filters, [key]: value });
  };
}
```

### Type Hints

**Requirements:**
- All function parameters must have type hints
- All function return types must be explicit (use `React.ReactNode`, `void`, etc.)
- Component props must be typed via interface extending `React.FC<Props>` or as destructured params with type annotation
- No implicit `any` — use `unknown` if type is truly unknown

**Examples:**
```typescript
// Function with return type
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
}

// Hook with return type
export function useTransactions(
  filters?: TransactionFilters,
  sort?: TransactionSort,
  pagination?: PaginationParams,
  options?: { enabled?: boolean }
): UseQueryResult<TransactionResponse> {
  return useQuery({
    queryKey: ["transactions", filters, sort, pagination],
    queryFn: () => apiClient.getTransactions(filters, sort, pagination),
    enabled: options?.enabled !== false,
  });
}

// Component with typed props
interface TransactionFiltersProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
}

export function TransactionFilters({
  filters,
  onFiltersChange,
}: TransactionFiltersProps) {
  // ...
}
```

### Import Organization

**Order (required):**
1. React and React hooks
2. Third-party libraries (UI, utilities, etc.)
3. Path alias imports from `@/` (components, hooks, lib, store)
4. Type imports: `import type { ... }`

**Blank lines:** One blank line between groups.

**Example from codebase:**
```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, RotateCcw, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { TransactionFilters } from "@/lib/types";
import { useCategories } from "@/hooks/use-categories";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
```

**Path aliases:**
- Always use `@/*` for imports (configured in `tsconfig.json`)
- Example: `import { apiClient } from "@/lib/api/client"` (not `import ... from "../../../lib/api/client"`)

### Code Style & Formatting

**Tool:** ESLint (`eslint.config.mjs`)
- Config: Extends `next/core-web-vitals` and `next/typescript`
- Run: `npm run lint` from `frontend/`
- No Prettier — ESLint handles formatting

**Key style rules:**
- Line length: No strict limit, but reasonable (~100 chars)
- Indentation: 2 spaces (Next.js/React convention)
- Semicolons: Required (enforced by Next.js ESLint config)
- Trailing commas: Use in multiline arrays/objects
- String quotes: Double quotes (ESLint enforces)
- Spaces around operators and before braces

**Component structure:**
```typescript
"use client";

import { useState } from "react";
import type { Props } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface MyComponentProps {
  title: string;
  onClick: () => void;
}

export function MyComponent({ title, onClick }: MyComponentProps) {
  const [state, setState] = useState(false);

  return (
    <div>
      <h1>{title}</h1>
      <Button onClick={onClick}>Click me</Button>
    </div>
  );
}
```

### Comments & JSDoc

**When to use:**
- Explain non-obvious logic or business requirements
- Mark important state management or performance considerations
- JSDoc for exported functions/types (optional but encouraged)

**Style:**
```typescript
// Single-line comment for brief explanations
const [expanded, setExpanded] = useState(false);

// Multi-line explanation of complex logic
// Collapse state is persisted in localStorage to survive page reloads
// so users don't lose their filter panel state when navigating
const { data: categories = [] } = useCategories();

/**
 * Debounce text inputs to avoid re-running filters on every keystroke.
 * 500ms delay is typical for search/filter operations to feel responsive
 * without hammering the backend.
 */
const debouncedSearch = useDebounce(searchInput, 500);
```

**Don't over-comment:**
```typescript
// BAD:
const count = 0; // Initialize count to zero
const name = "John"; // Set name to John

// GOOD:
// Map error codes to user-friendly messages for display
const errorMessages: Record<string, string> = { ... };
```

### Forms & Validation

**Pattern:** React Hook Form + Zod
- Define schema inline or in component
- Use `zodResolver(schema)` for validation
- Fields: Always use UI primitives from `@/components/ui/`

**Example:**
```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const transactionSchema = z.object({
  description: z.string().min(1, "Description required"),
  amount: z.number().positive("Amount must be positive"),
  category: z.string().min(1, "Category required"),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

export function TransactionForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<TransactionFormData>({
    resolver: zodResolver(transactionSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input {...register("description")} />
      {errors.description && <span>{errors.description.message}</span>}
    </form>
  );
}
```

### State Management & Hooks

**Server state:** TanStack React Query (queries & mutations)
- Always use `useQuery` for fetching
- Always use `useMutation` for mutations with `onSuccess` invalidation
- Query keys: `["entity", filters, params]` for consistency
- Stale time: 60_000ms (1 min) globally, 30s for volatile data (analytics, workflow)

**UI state:** `useState` at component level
- No Redux or Zustand — React Query is source of truth for server data
- Local UI state only (open/closed, hover, focus, etc.)

**Persistent state:** `localStorage` via custom hooks
- Example: Transaction filter panel state saved across sessions
- Use `useLocalStorage()` hook if available, or custom implementation

**Example:**
```typescript
export function useTransactions(filters?: TransactionFilters) {
  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => apiClient.getTransactions(filters),
    staleTime: 60_000,
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }) => apiClient.updateTransaction(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function TransactionList() {
  const [filters, setFilters] = useState<TransactionFilters>({});
  const { data: transactions, isLoading } = useTransactions(filters);
  const updateMutation = useUpdateTransaction();

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div>
      {transactions?.map(tx => (
        <TransactionRow key={tx.id} transaction={tx} />
      ))}
    </div>
  );
}
```

### API Client Usage

**Pattern:** All backend calls go through singleton `apiClient` instance
- Location: `src/lib/api/client.ts`
- Never use `fetch` or `axios` directly in components
- Wrap all API calls in custom hooks (in `src/hooks/`)
- Hooks wrap calls with TanStack React Query

**Example:**
```typescript
// src/lib/api/client.ts — singleton
export const apiClient = new AxiosClient();

// src/hooks/use-transactions.ts — wrapper
export function useTransactions(filters?: TransactionFilters) {
  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => apiClient.getTransactions(filters),
  });
}

// src/components/transactions/transactions-list.tsx — usage
export function TransactionsList() {
  const { data: transactions } = useTransactions(filters);
  // Use transactions...
}
```

### Utilities & Formatting

**Common helpers (`src/lib/`):**
- `formatCurrency(amount)` — Always use for monetary values; handles INR formatting
- `formatDate(dateString)` — Always use for date display; handles formatting and timezones
- `cn(...inputs)` — Combine Tailwind classes conditionally (uses `clsx` + `tailwind-merge`)

**Example:**
```typescript
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format-utils";

export function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <div className={cn("flex gap-4", transaction.is_flagged && "bg-yellow-100")}>
      <span>{formatDate(transaction.date)}</span>
      <span>{formatCurrency(transaction.amount)}</span>
    </div>
  );
}
```

---

*Convention analysis: 2026-08-09*
