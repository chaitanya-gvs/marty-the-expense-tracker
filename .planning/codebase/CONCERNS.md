# Codebase Concerns

**Analysis Date:** 2026-03-27

---

## Tech Debt

**All-rows-in-memory filtering for paginated endpoint:**
- Issue: `GET /api/transactions/` fetches up to 1,000,000 rows from the database and filters/paginates them in Python instead of pushing predicates into SQL. The `has_filters` branch in `transaction_read_routes.py` explicitly sets `limit=1000000`.
- Files: `backend/src/apis/routes/transaction_read_routes.py` lines 91-108 and 289-303
- Impact: Memory usage scales linearly with transaction count. A single filter query already fetches and deserializes the entire transactions table plus JOINs. The endpoint also executes a second full-table scan just to get `total_count` even when no filters apply (lines 289-303).
- Fix approach: Move all filter conditions (account, category, tag, direction, search, participant, is_flagged, etc.) into parameterised SQL WHERE clauses inside `TransactionOperations`. Return `(rows, total_count)` from a single query using a window function or `COUNT(*) OVER()`.

**`order_by` parameter interpolated directly into SQL strings:**
- Issue: `get_all_transactions` and `get_transactions_by_date_range` accept an `order_by: str` parameter that is inserted into SQL via an f-string (`ORDER BY t.transaction_date {order_by}`). The callers only ever pass `"ASC"` or `"DESC"`, but the value is never validated before reaching the database.
- Files: `backend/src/services/database_manager/operations/transaction_operations.py` lines 195, 209, 258, 273
- Impact: Low risk in current single-user context, but technically allows SQL injection if the parameter origin ever changes.
- Fix approach: Validate `order_by` against an allowlist `{"ASC", "DESC"}` before interpolation, or use SQLAlchemy's `asc()`/`desc()` column expressions.

**Duplicate `extract_search_pattern_from_csv_filename` function:**
- Issue: The same function body exists in two places: `statement_workflow.py` (module-level function) and `data_standardizer_helper.py` (module-level function `_extract_search_pattern_from_csv_filename`).
- Files: `backend/src/services/orchestrator/statement_workflow.py` lines 49-75, `backend/src/services/orchestrator/data_standardizer_helper.py` lines 16-38
- Impact: Risk of drift — bug fixes to one copy may not be applied to the other.
- Fix approach: Remove the copy in `statement_workflow.py` and import the helper's version.

**`_deduplicate_grouped_expense_collapsed` workaround in memory:**
- Issue: The method exists specifically to fix duplicate `is_grouped_expense = TRUE` rows that appeared after a migration. The comment says "fixes duplicate display from migration". This is a workaround for a data quality issue rather than a structural fix.
- Files: `backend/src/services/database_manager/operations/transaction_operations.py` lines 63-83
- Impact: Applied on every read path that calls `_process_transactions`. If the underlying data issue (multiple collapsed rows per group) can be fully resolved by data cleanup, this loop becomes dead weight on every query.
- Fix approach: Run a one-time data migration to soft-delete extra collapsed rows per group, verify, then remove the in-memory deduplication.

**Splitwise API client uses synchronous `requests` in async FastAPI context:**
- Issue: `SplitwiseAPIClient` uses the blocking `requests` library with `requests.get()`. This is called from async service code inside `asyncio` tasks (the workflow background task).
- Files: `backend/src/services/splitwise_processor/client.py` lines 50, 75, 103, 160
- Impact: Each Splitwise API call blocks the asyncio event loop thread for the duration of the HTTP round-trip. During bulk expense fetches with pagination this can cause noticeable delays and prevent other async work from running.
- Fix approach: Replace `requests` with `httpx.AsyncClient` and make all methods `async`.

**`sys.path.insert` scattered across source files:**
- Issue: Production source files (`document_extractor.py`, `pdf_page_filter.py`) use `sys.path.insert(0, str(backend_path))` to patch the import path at module load time. This is a script-oriented workaround that conflicts with the package being installed via `poetry`.
- Files: `backend/src/services/statement_processor/document_extractor.py` line 24, `backend/src/services/statement_processor/pdf_page_filter.py` line 24
- Impact: Makes import resolution non-deterministic when modules are imported in different contexts.
- Fix approach: Remove `sys.path.insert` from library modules; only scripts in `backend/scripts/` and tests need it.

**Alembic `sqlalchemy.url` hard-codes user and database name:**
- Issue: `alembic.ini` contains `sqlalchemy.url = postgresql://chaitanya:@localhost:5432/expense_tracker`. The `Settings` model defaults to `DB_NAME = "expense_tracker"` but the CLAUDE.md documentation references `expense_db`. If the database is ever renamed the alembic URL will diverge from the application URL.
- Files: `backend/alembic.ini` line 59, `backend/src/utils/settings.py` line 33
- Impact: Running `alembic upgrade head` against a different database than the running app would create migrations on the wrong schema.
- Fix approach: Follow the Alembic docs pattern of reading `DATABASE_URL` from the same `Settings` object in `migrations/env.py` so there is a single source of truth.

---

## Security Considerations

**CORS set to `allow_origins=["*"]`:**
- Risk: The FastAPI app accepts cross-origin requests from any domain. Credentials are also allowed (`allow_credentials=True`). Any website visited by the user on the same machine can make authenticated requests to the API.
- Files: `backend/main.py` lines 29-35
- Current mitigation: Personal tool running on localhost; not publicly exposed.
- Recommendations: Restrict `allow_origins` to `["http://localhost:3000"]` or read from an env var. If deploying to Oracle Free / Hetzner, set the production frontend origin.

**No API-level authentication on any route:**
- Risk: All FastAPI routes have no authentication middleware, token validation, or session checks. Any process with network access to port 8000 can read, create, update, or delete all financial data.
- Files: `backend/main.py`, all `backend/src/apis/routes/` files
- Current mitigation: Personal tool on localhost only.
- Recommendations: Add a static API key or HTTP Basic Auth as a minimum before any external deployment. This is a blocker for the planned Oracle Free / Hetzner migration.

**`statement_password` stored in plaintext in the `accounts` table:**
- Risk: Bank statement unlock passwords are stored as plaintext strings in the PostgreSQL `accounts` table and read via `BankPasswordManager.get_password_for_sender_async()`.
- Files: `backend/src/utils/password_manager.py`, `backend/src/services/database_manager/operations/account_operations.py`
- Current mitigation: Database is localhost-only.
- Recommendations: Encrypt at rest using a key stored in env (e.g. Fernet/AES) or use OS keychain/Vault before any deployment.

**Gmail OAuth refresh tokens stored in plaintext env file:**
- Risk: `configs/secrets/.env` contains `GOOGLE_REFRESH_TOKEN` (and `_2` variant). The `TokenManager.save_refreshed_tokens()` method writes updated tokens back to this file as plaintext.
- Files: `backend/src/services/email_ingestion/token_manager.py` lines 169-212
- Current mitigation: File is not committed to git (gitignored).
- Recommendations: Acceptable for local dev; must be addressed before deployment (use Secret Manager, Vault, or encrypted file).

---

## Performance Bottlenecks

**Double full-table scan on every paginated transaction read without filters:**
- Problem: The no-filter path in `GET /transactions/` fetches the paginated page (correct) but then immediately fetches all transactions again with `limit=1000000` just to compute `total_count` (lines 289-303). This means every un-filtered page load hits the database twice.
- Files: `backend/src/apis/routes/transaction_read_routes.py` lines 285-304
- Cause: `total_count` needs to span the whole dataset, not just the current page. The workaround was to re-fetch all.
- Improvement path: Add `SELECT COUNT(*) FROM transactions WHERE is_deleted = false AND <visibility_filter>` as a dedicated count query, or use `COUNT(*) OVER()` window function in the existing query.

**Settlement calculations done entirely in Python over all shared transactions:**
- Problem: `settlement_routes.py` pulls every shared transaction (with no date or amount bounds when called from the summary endpoint) and loops over them in Python to compute net balances.
- Files: `backend/src/apis/routes/settlement_routes.py` lines 150-430
- Cause: The `split_breakdown` JSONB structure makes SQL-level aggregation non-trivial.
- Improvement path: For the summary-only view, a PostgreSQL `jsonb_array_elements` query can aggregate per-participant directly in the database.

**LLM extraction blocks during workflow; no streaming result buffering:**
- Problem: `DocumentExtractor` calls `agentic-doc`'s `parse()` synchronously wrapped in `asyncio.to_thread()`. For multi-page PDFs, the entire parse result is held in memory before any CSV is written.
- Files: `backend/src/services/statement_processor/document_extractor.py`
- Cause: `agentic-doc` API is synchronous and page-at-a-time streaming is not exposed.
- Improvement path: This is mostly a library limitation. Ensure statement PDFs are filtered to transaction pages only (already done via `PDFPageFilter`) to minimize document size sent to the API.

---

## Fragile Areas

**In-memory workflow job store lost on server restart:**
- Files: `backend/src/apis/routes/workflow_routes.py` lines 72-73 (`_jobs: Dict`, `_active_job_id`)
- Why fragile: Any running workflow job is orphaned when the server process restarts. The SSE stream subscribers receive no signal and the client hangs. The `_active_job_id` guard also persists across restarts in the absence of a restart, so a crashed run cannot be restarted without a fresh process.
- Safe modification: The comment "single-user personal tool — no Redis needed" is correct for current use; document the known behaviour clearly. Before deployment, consider storing job state in a `workflow_jobs` PostgreSQL table.
- Test coverage: No tests for SSE streaming or job state persistence.

**Bank schema registry is a manual dictionary requiring code changes to add accounts:**
- Files: `backend/src/services/statement_processor/schemas.py` (BANK_STATEMENT_MODELS dict), `backend/src/services/statement_processor/document_extractor.py` (`_map_nickname_to_schema`)
- Why fragile: Adding a new bank card requires: (1) a new Pydantic model in `schemas.py`, (2) a new entry in `BANK_STATEMENT_MODELS`, (3) a new entry in `PAGE_FILTER_CONFIGS`, (4) a case in `_map_nickname_to_schema` in `document_extractor.py`. Missing any step silently falls back to no extraction schema and the statement is skipped.
- Safe modification: Add a new entry to all four locations together. When adding, validate against a sample PDF before committing.
- Test coverage: None for schema dispatch logic.

**`StatementWorkflow.__init__` constructs `EmailClient` eagerly:**
- Files: `backend/src/services/orchestrator/statement_workflow.py` lines 113-116
- Why fragile: Gmail credentials are validated and an HTTP call is made on construction (in `_get_credentials()`). If credentials are not configured, the constructor raises before any workflow logic runs. This means `StatementWorkflow(enable_secondary_account=True)` will fail hard at construction if the secondary account env vars are absent.
- Safe modification: Lazy-initialize clients, or catch credential errors per-account and mark that account as unavailable rather than aborting construction.
- Test coverage: `test_complete_workflow.py` mocks at a high level; no unit tests for partial-credential construction.

**Duplicate-detection key in bulk insert is fuzzy and can miss real duplicates:**
- Files: `backend/src/services/database_manager/operations/transaction_operations.py` lines 1082-1095
- Why fragile: The composite key includes `source_file` and `str(raw_data)`. Two identical transactions from the same bank imported from slightly different CSVs (e.g. one with a GCS path, one from a temp path) produce different keys and both get inserted.
- Safe modification: The key should use only `(transaction_date, amount, account, description)`. `source_file` and `raw_data` introduce unnecessary entropy.
- Test coverage: No dedicated unit tests for the composite key collision logic.

**`_deduplicate_grouped_expense_collapsed` uses string comparison of UUIDs for ordering:**
- Files: `backend/src/services/database_manager/operations/transaction_operations.py` lines 74-76
- Why fragile: `t_id < group_collapsed[group_id]` compares UUID strings lexicographically to pick the "smallest" ID. UUIDs are not lexicographically ordered by creation time (v4 UUIDs are random). The intent is "keep the oldest row" but the mechanism is wrong — it keeps the lexicographically-first UUID which is arbitrary.
- Safe modification: Compare by `created_at` timestamp instead of UUID string. Requires fetching `created_at` in the same query.
- Test coverage: None.

---

## Missing Critical Features

**Budgets feature has no backend implementation:**
- Problem: The frontend exposes a full `/budgets` page with `BudgetsOverview` and `BudgetsList` components. `use-budgets.ts` calls `apiClient.getBudgets()`, `createBudget()`, `updateBudget()`, and `deleteBudget()`. These endpoints hit `/api/budgets` which does not exist in the backend — there is no budget model, migration, or router mounted in `main.py`.
- Blocks: Every budget API call returns a network error. The entire Budgets page is non-functional.
- Files: `frontend/src/app/budgets/page.tsx`, `frontend/src/hooks/use-budgets.ts`, `frontend/src/lib/api/client.ts` lines 338-361

**Review queue page has no dedicated backend endpoint:**
- Problem: `frontend/src/app/review/page.tsx` renders a `ReviewQueue` component. There is no `GET /api/review` or equivalent route in the backend. Review/flagged transactions are surfaced via the standard `GET /transactions/?is_flagged=true` parameter, but there is no backend concept of a "review queue" with dedicated status management.
- Blocks: Any review workflow beyond filtering by `is_flagged` cannot be built without a backend model for review state.
- Files: `frontend/src/components/review/review-queue.tsx`

---

## Test Coverage Gaps

**Statement pipeline has no integration tests against real or fixture PDFs:**
- What's not tested: `DocumentExtractor._get_schema_from_filename()`, `PDFPageFilter`, `PDFUnlocker`, the full `StatementWorkflow.run_complete_workflow()` path.
- Files: `backend/tests/test_complete_workflow.py` (mocks the entire workflow at a high level), `backend/src/services/statement_processor/document_extractor.py`
- Risk: Silent extraction failures when a bank changes its PDF format; schema dispatch bugs go undetected.
- Priority: High

**Transaction operation methods have no unit tests:**
- What's not tested: `bulk_insert_transactions`, `_filter_duplicate_transactions`, `_prepare_transaction_for_insert`, `get_expense_analytics`, `soft_delete_splitwise_by_expense_ids`.
- Files: `backend/src/services/database_manager/operations/transaction_operations.py` (1,977 lines, zero test file coverage of internal methods)
- Risk: Duplicate-detection regressions, data corruption on bulk inserts, and analytics calculation errors go undetected until visible in the UI.
- Priority: High

**Settlement calculation logic is lightly tested:**
- What's not tested: `_infer_paid_by`, edge cases for multi-participant custom splits, the `has_discrepancy` threshold calculation, and the `get_participant_settlement` endpoint.
- Files: `backend/tests/test_settlement_calculations.py` (94 lines), `backend/src/apis/routes/settlement_routes.py` (614 lines)
- Risk: Net balance rounding errors or participant name normalization bugs surface silently.
- Priority: Medium

**Frontend has no test files at all:**
- What's not tested: All React components, all hooks, all API client methods.
- Files: `frontend/src/` — no `*.test.*` or `*.spec.*` files found
- Risk: UI regressions after component refactors are only caught manually.
- Priority: Medium

---

## Scaling Limits

**In-memory job store:**
- Current capacity: One concurrent job, unbounded history in `_jobs` dict.
- Limit: `_jobs` is never pruned; long-running instances accumulate job objects indefinitely.
- Scaling path: Prune completed jobs older than N hours, or move to a database-backed store.

**Transaction table has no index on `(account, transaction_date)`:**
- Current capacity: Not measured, but repeated `WHERE account = X AND transaction_date BETWEEN` queries (settlement, analytics, duplicate detection) rely on sequential scans unless PostgreSQL's planner picks a partial index.
- Limit: Query time degrades as transaction count grows beyond ~100k rows.
- Scaling path: Add composite indexes on `(account, transaction_date)` and `(transaction_date, is_deleted)` via Alembic migration.

---

*Concerns audit: 2026-03-27*
