# Architecture

**Analysis Date:** 2026-08-09

## Pattern Overview

**Overall:** Layered REST API with event-driven background workflows.

**Key Characteristics:**
- **Separation of Concerns**: Distinct API, service, data, and utility layers
- **Event-Driven Workflows**: Statement processing pipeline emits SSE events for real-time progress tracking
- **Async/Await**: FastAPI + SQLAlchemy 2.0 async throughout (no blocking I/O)
- **Multi-Account Support**: Gmail integration supports primary + secondary accounts; Splitwise sync is account-agnostic
- **In-Memory Job Orchestration**: Workflow jobs tracked in memory (per-session state, not persisted across restarts)

## Layers

**API Layer:**
- **Location**: `src/apis/routes/` + `src/apis/schemas/`
- **Purpose**: HTTP route handlers and Pydantic request/response schemas
- **Contains**: Route functions with dependency injection, input validation, error handling
- **Depends on**: Service layer (business logic), database operations, utilities
- **Used by**: Client applications (frontend)

**Service Layer:**
- **Location**: `src/services/`
- **Purpose**: Core business logic, orchestration, and external API integrations
- **Contains**:
  - **`orchestrator/`** — Workflow orchestration (statement pipeline, Splitwise sync)
  - **`database_manager/`** — ORM models, connection pooling, and data access
  - **`email_ingestion/`** — Gmail API integration, token management, email parsers
  - **`statement_processor/`** — PDF unlocking, document extraction (LLM-based via agentic-doc)
  - **`splitwise_processor/`** — Splitwise API client and sync service
  - **`cloud_storage/`** — Google Cloud Storage upload/download
  - **`budget_service.py`** — Budget calculation and management
- **Depends on**: Database connection, external APIs (Gmail, Splitwise, GCS, OpenAI), utilities
- **Used by**: API routes, other services

**Data Layer:**
- **Location**: `src/services/database_manager/`
- **Purpose**: Database schema, connection management, and CRUD operations
- **Contains**:
  - **`connection.py`** — Async SQLAlchemy engine with connection pooling (pool_size=10, max_overflow=20)
  - **`models/`** — SQLAlchemy ORM models (Transaction, Account, Category, Participant, etc.)
  - **`operations/`** — Domain-specific operation classes (TransactionOperations, CategoryOperations, etc.)
  - **`migrations/`** — Alembic migration files (Postgres-specific schema changes)
- **Depends on**: PostgreSQL database, SQLAlchemy
- **Used by**: Services and routes (for data access)

**Utility Layer:**
- **Location**: `src/utils/`
- **Purpose**: Cross-cutting concerns and helpers
- **Contains**:
  - **`settings.py`** — Pydantic BaseSettings for environment config (from `.env` + `.env.secrets`)
  - **`logger.py`** — Structured logging with file rotation and optional job_id tracking
  - **`auth_deps.py`** — FastAPI dependency for JWT authentication
  - **`db_utils.py`** — Database helper functions (error handling, common queries)
  - **`password_manager.py`** — Bank password retrieval from database
  - **`transaction_utils.py`** — Transaction data transformation and conversion
  - **`filename_utils.py`** — Cloud storage path building and account nickname normalization
  - **`jwt_utils.py`** — JWT token generation and validation
- **Depends on**: External libraries, configuration
- **Used by**: All layers

## Data Flow

**HTTP Request → Response:**

1. Request arrives at FastAPI endpoint in `src/apis/routes/*.py`
2. FastAPI dependency injection resolves:
   - `get_current_user()` from `auth_deps.py` (validates JWT token)
   - `get_db_session()` from `database_manager/connection.py` (async SQLAlchemy session)
3. Route handler calls service methods (from `src/services/`)
4. Service queries or modifies data via operations classes (e.g., `TransactionOperations.create_transaction()`)
5. Operations execute SQL via async SQLAlchemy session
6. Response built and returned as Pydantic model wrapped in `ApiResponse` schema

**Example: Get Transactions**
```
GET /api/transactions?date_range_start=2026-01-01&categories=groceries
  → transaction_read_routes.get_transactions()
    → TransactionOperations.get_transactions_filtered()
      → SQLAlchemy query with filters, sorting, pagination
        → Return list of transactions
  → Convert to response schema (_convert_db_transaction_to_response)
    → Return ApiResponse(data=[...], pagination={...})
```

**Statement Processing Pipeline:**

```
User triggers: POST /api/workflow/run (with mode: full|resume|splitwise_only)
  ↓
workflow_routes.run_workflow()
  ↓ (starts async task)
StatementWorkflow.run() with phase switches:
  ├── Phase 1: Email Ingestion (if enabled)
  │   ├─ AlertIngestionService.run() — parses bank emails
  │   ├─ Creates transactions for recent account alerts
  │   └─ Updates review queue for dedup conflicts
  │
  ├── Phase 2: Statement Processing (if enabled)
  │   ├─ Scan all accounts' emails for statements
  │   ├─ For each new statement:
  │   │   ├─ Download PDF via Gmail API
  │   │   ├─ Unlock PDF (password from Account.statement_password)
  │   │   ├─ Upload unlocked PDF to GCS
  │   │   ├─ Extract transactions (DocumentExtractor → agentic-doc LLM)
  │   │   ├─ Save extracted CSV to GCS
  │   │   ├─ Update StatementProcessingLog (status tracking)
  │   │   └─ Emit progress events
  │   └─ Aggregate all CSVs into consolidated DataFrame
  │
  ├── Phase 3: Data Standardization
  │   ├─ Normalize transaction descriptions, dates, amounts
  │   ├─ Match with existing categories/tags
  │   ├─ Update StatementProcessingLog (status = 'db_inserted')
  │   └─ Insert into transactions table
  │
  ├── Phase 4: Splitwise Sync (if enabled)
  │   ├─ Query Splitwise API for recent expenses
  │   ├─ Build split_breakdown JSONB from Splitwise expense shares
  │   ├─ Create transactions with split_breakdown
  │   └─ Update review queue for participant name conflicts
  │
  └─ Return summary: {statements_downloaded, db_inserted, splitwise_transactions, ...}

All phases emit SSE events → accumulated in _JobState.events → streamed on GET /api/workflow/{job_id}/stream
```

**Splitwise Sync Sub-Flow:**

```
SplitwiseProcessorHelper._run()
  ├─ Calculate date range: [date(statement_log.original_date) - 3 days, today()]
  ├─ Call SplitwiseService.get_expenses(start_date, end_date)
  │   ├─ Use date_range if not null (full sync)
  │   ├─ Else use updated_at cursor (incremental sync)
  │   └─ Fetch from Splitwise API
  ├─ For each expense:
  │   ├─ Determine payer (simplification: take first in expense.users)
  │   ├─ Build split_breakdown from expense.users.payment + owed_by
  │   ├─ Create Transaction with source='splitwise', split_breakdown, paid_by=payer
  │   └─ If participant name not in DB → queue for review
  └─ Emit "splitwise_sync_done" event with transaction count
```

**Settlement Calculation:**

```
GET /api/settlements → settlement_routes.get_settlement_summary()
  ├─ Query all transactions with is_shared=true or split_breakdown IS NOT NULL
  ├─ For each transaction:
  │   ├─ Infer payer: use paid_by if set, else check if account is a known bank account
  │   ├─ For each participant in split_breakdown:
  │   │   ├─ Normalize name to title case (e.g., "prachi rai" → "Prachi Rai")
  │   │   ├─ Calculate participant's share: split_breakdown.mode == 'equal' ? total/count : amount
  │   │   ├─ Build: {participant: X, paid_for: amount, owes_for: share}
  │   └─ Emit to per-participant accumulator
  │
  ├─ For each participant:
  │   ├─ Sum all paid_for amounts (money they paid)
  │   ├─ Sum all owes_for amounts (money they owe)
  │   ├─ Net: amount_owed_to_me = sum(paid_for) - sum(owes_for)
  │   └─ Return SettlementEntry {participant, amount_owed_to_me, amount_i_owe, ...}
  │
  └─ Return SettlementSummary with entries sorted by net balance
```

**State Management:**

- **Request State**: FastAPI dependency `get_db_session()` provides per-request async session
- **Workflow State**: In-memory `_jobs` dict + `_active_job_id` singleton (workflow_routes.py)
- **Configuration State**: Singleton `get_settings()` from `src/utils/settings.py` (lru_cache)
- **Job State**: `_JobState` class holds job_id, status, events[], summary, task reference

No Redis, no persistent queue. Jobs lost on server restart (acceptable for personal tool).

## Key Abstractions

**Database Operations:**
- **Location**: `src/services/database_manager/operations/`
- **Pattern**: Static method classes per entity (TransactionOperations, CategoryOperations, etc.)
- **Example**: `TransactionOperations.create_transaction()` normalizes input, inserts into DB, returns UUID
- **Motivation**: Single place for all DB queries per entity; easy to find and refactor; avoids tight coupling to ORM

**Workflow Events:**
- **Location**: `src/services/orchestrator/statement_workflow.py`, emitted via `_emit(event_type, step, message, ...)`
- **Pattern**: Callback-driven (event_callback registered on StatementWorkflow.__init__)
- **Types**: `started`, `step_complete`, `phase_complete`, `error`, `warning`, `skipped`
- **Consumer**: workflow_routes.py queues events into SSE stream

**Document Extraction:**
- **Location**: `src/services/statement_processor/document_extractor.py`
- **Pattern**: LLM-based via agentic-doc SDK (LandingAI Vision Agent)
- **Input**: Unlocked PDF file path, bank schema key (from account nickname)
- **Output**: CSV file with extracted transactions
- **Motivation**: Bank PDFs have varying formats; LLM generalizes across them

**Email Parsers:**
- **Location**: `src/services/email_ingestion/parsers/`
- **Pattern**: Base parser + bank-specific subclasses (CashbackSBI, AxisAtlas, etc.)
- **Role**: Parse transaction alerts from email body (not PDF extraction)
- **Used for**: Real-time transaction ingestion (e.g., cashback alerts, card transactions)

**Cloud Storage Abstraction:**
- **Location**: `src/services/cloud_storage/gcs_service.py`
- **Pattern**: Path-based structure `{YYYY-MM}/{type}/{filename}` (type = 'extracted', 'statements', etc.)
- **Role**: Upload/download from Google Cloud Storage; abstraction enables swap to S3 if needed

## Entry Points

**HTTP Server:**
- **Location**: `main.py`
- **Triggers**: `uvicorn main:app` (dev) or container startup
- **Responsibilities**:
  - Initialize FastAPI app with CORS, rate limiting, exception handlers
  - Mount all route routers with auth dependencies
  - Start APScheduler for email ingestion jobs
  - Lifespan context manager for setup/teardown

**Background Email Ingestion:**
- **Location**: `main.py` lifespan + `src/services/email_ingestion/alert_ingestion_service.py`
- **Triggers**: APScheduler job every N hours (default 4h)
- **Responsibilities**: Fetch bank emails, parse transaction alerts, insert into DB

**CLI Entry Points (optional):**
- **Location**: `backend/scripts/` (not part of main app)
- **Example**: `compare_cashback_sbi_statement.py` — standalone script for reconciliation

## Error Handling

**Strategy:** Layered with context propagation.

**Patterns:**

1. **API Route Level:**
   - Wrap in try/except, catch HTTPException and log
   - Return `400 Bad Request` for validation errors (Pydantic catches)
   - Return `404 Not Found` if resource not found
   - Return `500 Internal Server Error` for unexpected exceptions
   - Example: `transaction_read_routes.get_transactions()` has outer try/except wrapping filter logic

2. **Service Level:**
   - Catch exceptions from external APIs (Gmail, Splitwise, GCS)
   - Log with context (job_id, account, statement filename)
   - Propagate as-is or wrap in custom exceptions
   - Example: `StatementWorkflow._download_statements()` catches Gmail errors, emits warning event, continues

3. **Database Level:**
   - SQLAlchemy async errors (connection timeouts, constraint violations)
   - Caught in `db_utils.handle_database_operation()` helper
   - Logs and re-raises for route to handle
   - Example: Duplicate reference_number → IntegrityError → 409 Conflict

4. **Workflow Level:**
   - Errors emitted as SSE events (event_type='error')
   - Accumulated in _JobState.events
   - Summary includes error count and error messages
   - Workflow continues (best-effort processing)

**Logging:**
- Logger from `get_logger(__name__)` supports job_id context via `extra={'job_id': ...}`
- Rotating file handler in `backend/logs/` + console stderr
- Log level from `LOG_LEVEL` env var

## Cross-Cutting Concerns

**Logging:**
- Framework: Python `logging` module via `src/utils/logger.py`
- Pattern: `logger = get_logger(__name__)` then `logger.info(msg, extra=self._log_extra())`
- Job tracking: When processing statement workflow, all logs tagged with job_id (helpful for SSE debugging)

**Validation:**
- Input validation: Pydantic schemas in `src/apis/schemas/` (automatic)
- Business logic validation: In service/operations methods (e.g., check if amount > 0, category exists)
- Error messages: Propagated to API responses or SSE events

**Authentication:**
- Framework: JWT tokens stored in HTTP-only cookies
- Dependency: `get_current_user()` in `src/utils/auth_deps.py`
- All routes (except `/auth`) protected by `dependencies=[Depends(get_current_user)]`
- Token expires after `JWT_EXPIRY_DAYS` (default 7)

**Rate Limiting:**
- Framework: slowapi (decorator-based)
- Current state: Enabled via `app.state.limiter` but routes not decorated yet
- Can be added per-route as `@limiter.limit("100/minute")`

**Database Connection Pooling:**
- Engine config: `pool_size=10, max_overflow=20`
- Strategy: Reuse connections across requests, recycle after idle period
- Settings: `pool_pre_ping=True` ensures stale connections detected, `prepared_statement_cache_size=0` avoids statement cache bugs

---

*Architecture analysis: 2026-08-09*
