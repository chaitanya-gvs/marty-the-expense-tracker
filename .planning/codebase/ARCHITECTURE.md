# Architecture

**Analysis Date:** 2026-03-27

## Pattern Overview

**Overall:** Full-stack monorepo with a Python backend (FastAPI) and a TypeScript frontend (Next.js), communicating via a JSON REST API. The backend follows a layered architecture (Routes → Services → DB). The frontend follows a hook-driven data layer (API Client → Hooks → Pages → Components).

**Key Characteristics:**
- Single-user personal tool — no auth, no multi-tenancy
- Async throughout: SQLAlchemy 2.0 async, FastAPI async handlers, asyncio for background jobs
- Server-sent events (SSE) for real-time workflow progress streaming
- No message queue or Redis — in-process asyncio queues manage job state
- Migrations applied automatically on startup via Alembic

## Backend Layers

**Routes (`backend/src/apis/routes/`):**
- Purpose: HTTP entry points — request parsing, validation, response serialization
- Location: `backend/src/apis/routes/`
- Contains: FastAPI `APIRouter` instances, Pydantic request/response models via schemas
- Depends on: Services layer, schemas
- Used by: FastAPI app in `backend/main.py`
- Split by domain: `transaction_read_routes.py`, `transaction_write_routes.py`, `transaction_split_routes.py`, `settlement_routes.py`, `participant_routes.py`, `workflow_routes.py`, `splitwise_routes.py`

**Schemas (`backend/src/apis/schemas/`):**
- Purpose: Pydantic models for request/response typing
- Location: `backend/src/apis/schemas/`
- Contains: `transactions.py`, `settlements.py`, `participants.py`, `workflow.py`, `common.py` (`ApiResponse`)
- Depends on: Nothing in the app (pure Pydantic)

**Services (`backend/src/services/`):**
- Purpose: All business logic, external integrations, data processing
- Location: `backend/src/services/`
- Sub-services: `database_manager/`, `orchestrator/`, `email_ingestion/`, `statement_processor/`, `splitwise_processor/`, `cloud_storage/`, `ocr_engine/`

**Database Manager (`backend/src/services/database_manager/`):**
- Purpose: All database interactions
- `connection.py` — Async engine (pool size 10, max_overflow 20), `get_db_session()` FastAPI dependency, `get_session_factory()` for use outside request context
- `models/` — SQLAlchemy ORM models: `transaction.py`, `account.py`, `category.py`, `tag.py`, `participant.py`, `statement_processing_log.py`, `transaction_tag.py`
- `operations/` — Static method classes per entity: `TransactionOperations`, `AccountOperations`, `CategoryOperations`, `TagOperations`, `ParticipantOperations`, `SuggestionOperations`, `StatementLogOperations` — all imported and re-exported from `operations/__init__.py`
- `schemas.py` — Internal DB-level Pydantic schemas (separate from API schemas)
- `migrations/versions/` — Alembic migration files

**Utilities (`backend/src/utils/`):**
- Purpose: Cross-cutting concerns
- `settings.py` — Pydantic `BaseSettings` singleton via `get_settings()` with `@lru_cache`
- `logger.py` — `get_logger(name)` factory, rotating file + console output, `job_id` in log extras
- `db_utils.py` — `handle_database_operation()` wrapper for consistent error handling
- `transaction_utils.py` — `_convert_db_transaction_to_response()`, `_convert_db_tag_to_response()`
- `filename_utils.py` — `nickname_to_filename_prefix()` for GCS path construction
- `password_manager.py` — `BankPasswordManager.get_password_for_sender_async(email)`

## Frontend Layers

**API Client (`frontend/src/lib/api/client.ts`):**
- Purpose: Single point of contact for all backend HTTP calls
- Pattern: Class `ApiClient`, exported as singleton `apiClient`
- Uses native `fetch` (not axios)
- Never call `fetch` directly in components or hooks — always use `apiClient`

**Hooks (`frontend/src/hooks/`):**
- Purpose: TanStack React Query wrappers around `apiClient` methods
- Pattern: `useQuery` for reads, `useMutation` for writes with `queryClient.invalidateQueries` on success
- Special cases: `useInfiniteTransactions` (infinite scroll), `useWorkflowStream` (EventSource SSE), `useWorkflowStatus` (polls every 3s for non-terminal jobs)

**Pages (`frontend/src/app/`):**
- Purpose: Next.js App Router route definitions — thin shells only
- Pattern: Each `page.tsx` wraps a single feature component inside `<MainLayout>`
- Root `/` redirects to `/transactions`

**Feature Components (`frontend/src/components/{feature}/`):**
- Purpose: Domain-specific UI — tables, modals, drawers, filters
- Contains all real rendering logic; pages are just wrappers

**UI Primitives (`frontend/src/components/ui/`):**
- Purpose: Radix UI + Tailwind primitive wrappers (button, dialog, sheet, etc.)
- Custom modal: `components/ui/modal/index.tsx` and `primitives.tsx` — use this, not Radix Dialog directly (per memory)

**Providers (`frontend/src/components/providers.tsx`):**
- Wraps app with: `QueryClientProvider` (1-min stale time, 1 retry), `ThemeProvider` (next-themes), `Toaster` (sonner, top-right)

## Data Flow

**Standard API Request (Frontend):**
1. Component calls a mutation or query from a hook (e.g., `useUpdateTransaction()`)
2. Hook calls `apiClient.updateTransaction(id, updates)` in `src/lib/api/client.ts`
3. `apiClient` sends `PATCH /api/transactions/{id}` to backend
4. Backend: `transaction_write_routes.py` handler receives request
5. Backend: Handler calls `TransactionOperations.update_transaction(session, id, updates)`
6. Backend: Returns updated transaction as `ApiResponse<Transaction>`
7. Hook's `onSuccess` calls `queryClient.invalidateQueries(["transactions"])` to refresh UI

**Standard API Request (Backend):**
1. `main.py` receives request, routes to correct `APIRouter`
2. Route handler parses query params / body, creates DB session via `get_db_session()` dependency
3. Handler calls appropriate `Operations` class static method with the session
4. Operations class executes raw SQL (via `text()`) or SQLAlchemy ORM query
5. Result is converted via `_convert_db_transaction_to_response()` and returned as `ApiResponse`

**Statement Processing Pipeline (Workflow):**
1. `POST /api/workflow/run` creates `_JobState`, spawns `asyncio.create_task(_run_workflow_task(...))`
2. `_run_workflow_task` instantiates `StatementWorkflow` with `event_callback` that pushes to `asyncio.Queue`
3. `StatementWorkflow.run_complete_workflow()` in `orchestrator/statement_workflow.py`:
   a. `email_ingestion/service.py` → Gmail API → downloads PDF attachments
   b. `statement_processor/pdf_unlocker.py` → unlocks password-protected PDFs
   c. `statement_processor/pdf_page_filter.py` → filters relevant pages
   d. `statement_processor/document_extractor.py` → agentic-doc (LandingAI) LLM extraction → CSV
   e. `cloud_storage/gcs_service.py` → uploads unlocked PDFs and CSVs to GCS
   f. `orchestrator/transaction_standardizer.py` → normalizes CSV rows to unified schema
   g. `database_manager/operations/transaction_operations.py` → bulk insert to PostgreSQL
   h. `database_manager/operations/statement_log_operations.py` → marks `normalized_filename` as `db_inserted`
4. Splitwise sync runs in parallel: `splitwise_processor/service.py` → Splitwise API → `split_breakdown` JSONB
5. Frontend connects to `GET /api/workflow/{job_id}/stream` → `StreamingResponse` with SSE
6. `workflow-tasks.ts` builds hierarchical task tree from flat SSE events for display

**Settlement Calculation:**
1. `GET /api/settlements/summary` triggers in-route Python computation (no stored aggregates)
2. Route queries shared transactions with `split_breakdown` JSONB
3. Normalizes participant names to title case
4. Identifies "current user" via `CURRENT_USER_NAMES` setting
5. Infers payer from `paid_by` field or account type (bank account → current user; Splitwise → other)
6. Computes `net_balance` per participant and returns summary

**State Management (Frontend):**
- All server state: TanStack React Query (stale time 1 min global)
- UI state: `useState` local to components
- Persistent UI state: `localStorage` for transaction filter preferences
- No Redux or Zustand

## Key Abstractions

**`StatementWorkflow` (Orchestrator):**
- Purpose: Coordinates the full email-to-DB pipeline
- Location: `backend/src/services/orchestrator/statement_workflow.py`
- Pattern: Class with helper modules `statement_extractor_helper.py`, `splitwise_processor_helper.py`, `data_standardizer_helper.py`
- Three modes: `full`, `resume` (skip extraction, re-standardize from existing CSVs), `splitwise_only`

**Operations Classes:**
- Purpose: All database queries in static method classes, never raw SQL in routes
- Examples: `backend/src/services/database_manager/operations/transaction_operations.py`, `category_operations.py`
- Pattern: `class TransactionOperations: @staticmethod async def get_transactions(session, ...) -> List[Dict]`
- Accept `AsyncSession` as first parameter

**`ApiClient` Singleton:**
- Purpose: Central HTTP client — all frontend→backend calls
- Location: `frontend/src/lib/api/client.ts`
- Pattern: Class with method groups per domain; exported as `export const apiClient = new ApiClient()`

**`_JobState` (Workflow Job):**
- Purpose: In-memory workflow job tracking (not persisted to DB)
- Location: `backend/src/apis/routes/workflow_routes.py`
- Pattern: `__slots__` class with `asyncio.Queue` for SSE events; module-level `_jobs: Dict[str, _JobState]` dict; only one job active at a time enforced by `_active_job_id` global

**Canonical TypeScript Types:**
- Purpose: Single source of truth for all frontend data shapes
- Location: `frontend/src/lib/types/index.ts`
- Key types: `Transaction`, `SplitBreakdown`, `SplitEntry`, `TransactionFilters`, `SettlementSummary`, `ApiResponse<T>`, `ExpenseAnalytics`

## Entry Points

**Backend:**
- Location: `backend/main.py`
- Triggers: `uvicorn main:app --reload` or `uvicorn.run()` in `__main__`
- Responsibilities: Creates `FastAPI` app, attaches CORS middleware, registers all routers at `/api`, sets up lifespan for logging

**Frontend:**
- Location: `frontend/src/app/layout.tsx`
- Triggers: Next.js App Router
- Responsibilities: Root HTML structure, font loading (DM Sans, DM Mono), `<Providers>` wrapper

**Frontend Root Route:**
- Location: `frontend/src/app/page.tsx`
- Behaviour: Immediately `redirect("/transactions")`

## Error Handling

**Strategy:** Errors bubble up to route handlers; routes catch and return HTTP errors. Operations classes do not catch — they let exceptions propagate.

**Backend Patterns:**
- Route handlers wrap operations in `try/except`, return `HTTPException` with appropriate status codes
- `handle_database_operation()` in `backend/src/utils/db_utils.py` provides a consistent wrapper for DB calls
- Workflow errors are caught in `_run_workflow_task`, set `job.status = failed`, emit an error event to SSE queue
- Logger always uses `exc_info=True` on error-level log calls

**Frontend Patterns:**
- `apiClient.request()` throws `Error` on non-OK responses
- TanStack Query surfaces errors via `error` state in hooks
- Toast notifications (`sonner`) are triggered in mutation `onError` callbacks

## Cross-Cutting Concerns

**Logging:**
- `backend/src/utils/logger.py` — `get_logger(name)` returns `CustomLogger`
- Log format includes `job_id` extra when in workflow context: `logger.info("msg", extra={"job_id": job_id})`
- Rotating file handler writes to `backend/logs/`; console handler for dev output
- `agentic_doc` overrides `basicConfig(force=True)` so logger setup is deferred to lifespan in `main.py`

**Configuration:**
- `backend/src/utils/settings.py` — `get_settings()` returns cached `Settings` (Pydantic BaseSettings)
- Env file loading order: `configs/secrets/.env` (overrides) then `configs/.env`
- Frontend: `NEXT_PUBLIC_API_URL` in `.env.local`

**Database Sessions:**
- Route handlers use `get_db_session()` FastAPI dependency (yields `AsyncSession`)
- Non-route code (workflow, scheduled tasks) uses `get_session_factory()()` as async context manager

---

*Architecture analysis: 2026-03-27*
