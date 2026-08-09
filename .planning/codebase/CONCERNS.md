# Codebase Concerns

**Analysis Date:** 2026-08-09

## Tech Debt

### Monolithic Database Operations File
- **Issue:** `transaction_operations.py` is 2,217 lines, `statement_workflow.py` is 2,080 lines, `email_ingestion/client.py` is 1,457 lines. These files are impossible to test, review, or maintain in isolation.
- **Files:** `src/services/database_manager/operations/transaction_operations.py`, `src/services/orchestrator/statement_workflow.py`, `src/services/email_ingestion/client.py`
- **Impact:** High cognitive load, difficult to add features, hard to locate bugs, slow development velocity
- **Fix approach:** Split these files into smaller, cohesive modules. For `transaction_operations.py`: create separate classes for each entity (TransactionOps, TagOps, etc. are already there but in same file). For `statement_workflow.py`: extract extraction logic, standardization logic, and helpers into separate modules. For `email_ingestion/client.py`: separate Gmail API wrapping from business logic.

### Async/Sync Boundary Violations
- **Issue:** `asyncio.run()` and `asyncio.new_event_loop()` are being used inside async functions, blocking the event loop.
- **Files:** `src/services/email_ingestion/client.py:1399`, `src/services/statement_processor/pdf_unlocker.py:93`
- **Impact:** Blocks async event loop, prevents concurrent operations, poor performance under load
- **Fix approach:** Remove sync boundary violations. `EmailClient._generate_normalized_filename()` should be async, or the calling sync code should await it. For `PDFUnlocker`, make it fully async by refactoring `_get_password_for_bank()`.

### Broad Exception Handling
- **Issue:** Many route handlers catch bare `Exception` without specific error handling, swallowing all errors into generic "Internal server error" responses.
- **Files:** `src/apis/routes/transaction_split_routes.py:53,196,198,276,278,358,360,474,520,522`, `src/apis/routes/transaction_write_routes.py:95,210,230,252,347,349,370,419,468,496,538,556`
- **Impact:** Makes debugging difficult, hides real errors from logs, poor user feedback on what went wrong
- **Fix approach:** Replace with specific exception handlers for expected errors (e.g., `ValueError`, `KeyError`, database errors). Only catch and log truly unexpected exceptions. Return meaningful error details in HTTP responses.

### SQL Injection Risk in Query Construction
- **Issue:** `order_by` parameter is used directly in f-strings with `text()` queries without validation. Users can inject arbitrary SQL if this parameter reaches the query.
- **Files:** `src/services/database_manager/operations/transaction_operations.py:189-210`, `src/apis/routes/transaction_read_routes.py:430,447`
- **Impact:** SQL injection vulnerability allowing unauthorized data access or modification
- **Fix approach:** Validate `order_by` against whitelist of allowed values (e.g., `{"ASC", "DESC"}`) before using in query. Use SQLAlchemy expression language (not `text()`) for dynamic parts when possible, or use parameterized placeholders.

## Known Issues & Limitations

### Unresolved Statement Backlog Scripts
- **Problem:** Two operational scripts in `backend/scripts/` appear to be one-off reconciliation tools:
  - `compare_cashback_sbi_statement.py`: Hardcoded bank password (line 29: `PASSWORD = "<redacted-statement-password>"`), hardcoded dates (April-June 2026), never updated after 2026-05-24
  - `process_statement_only_backlog.py`: One-time processor for retired review-queue type, last modified 2026-08-08
- **Files:** `backend/scripts/compare_cashback_sbi_statement.py`, `backend/scripts/process_statement_only_backlog.py`
- **Blocks:** Cannot validate statement extraction quality or reconcile backlog without manually running these scripts
- **Recommended action:** Document these as one-off tools, move to `/docs/reconciliation/` directory, or implement as proper internal API endpoints if they need to run regularly.

### Backend Restart Required After Code Changes
- **Problem:** Development setup runs backend via Docker Compose without `--reload` flag, so code changes don't auto-reload. Frontend has hot reload via Turbopack, but backend requires manual restart.
- **Impact:** Slow development loop, easy to forget restart and test against stale code
- **Workaround:** Currently documented in CLAUDE.md; users must manually `docker compose restart backend`
- **Fix approach:** Add `--reload` to uvicorn command in docker-compose.yml for development, or provide a dev convenience script.

## Performance Bottlenecks

### Settlement Calculations Done in Python, Not Database
- **Problem:** `settlement_routes.py` queries transactions with splits, then performs all aggregation and balance calculations in Python using loops and dicts.
- **Files:** `src/apis/routes/settlement_routes.py:1-614`
- **Cause:** Complex split_breakdown JSONB structure and participant name normalization aren't easily expressed in SQL
- **Impact:** O(n) memory overhead, slow for large transaction sets (>10k transactions with splits). No query caching on database side.
- **Improvement path:** Create database views or stored procedures for settlement calculations. Cache aggregated balances in a separate `settlement_cache` table updated via triggers or background job.

### N+1 Risk in Email Ingestion and PDF Extraction
- **Problem:** Statement workflow downloads PDFs one at a time in a sequential loop rather than batching operations.
- **Files:** `src/services/orchestrator/statement_workflow.py:557-600` (PDF extraction loop)
- **Impact:** Email API rate limiting, slow statement processing (especially for multiple accounts/months)
- **Improvement path:** Implement concurrent PDF extraction (e.g., with `asyncio.gather()`). Batch email queries where possible.

### Missing Database Indexes for Common Queries
- **Problem:** Transaction table has indexes on single columns (account, date, direction, etc.) but no composite indexes for common filter combinations.
- **Files:** `src/services/database_manager/models/transaction.py:62-72`
- **Impact:** Slow queries on filtered transactions (e.g., account + date range + is_deleted), query planner chooses suboptimal plans
- **Improvement path:** Add composite indexes:
  - `(account, transaction_date, is_deleted)` for account-scoped date-range queries
  - `(category_id, transaction_date, is_deleted)` for category analytics
  - `(email_message_id, is_deleted)` for email dedup

### Connection Pool Size May Be Insufficient
- **Problem:** Connection pool configured with `pool_size=10, max_overflow=20`. Under concurrent workflow + API load, this might exhaust connections.
- **Files:** `src/services/database_manager/connection.py:37-49`
- **Impact:** Potential "connection pool exhausted" errors during peak load
- **Improvement path:** Monitor connection pool utilization in production. Consider increasing to `pool_size=20, max_overflow=40` if concurrent workflows are common.

## Security Considerations

### Hardcoded Passwords in One-Off Scripts
- **Risk:** Bank statement passwords are hardcoded in `compare_cashback_sbi_statement.py`. If this script is committed or shared, passwords are exposed.
- **Files:** `backend/scripts/compare_cashback_sbi_statement.py:28-30`
- **Workaround:** Script is development-only and not in production
- **Recommendations:** Remove hardcoded credentials. Move to database-backed password manager or environment variables. Never commit credentials even in branch.

### JWT Token Validation Missing Expiry Check in Some Paths
- **Problem:** `verify_access_token()` catches all `JWTError` but doesn't explicitly validate exp claim before returning.
- **Files:** `src/utils/jwt_utils.py:18-21`
- **Current mitigation:** PyJWT library validates exp by default
- **Recommendations:** Add explicit check and logging for token expiry events. Consider adding token rotation for long-lived sessions.

### No Rate Limiting on API Endpoints
- **Problem:** No global rate limiter. Endpoints like `/transactions` can be queried unlimited times, `/workflow/run` can spawn unlimited jobs.
- **Impact:** Vulnerability to denial-of-service attacks, API abuse
- **Recommendations:** Implement `slowapi` (already in dependencies) or similar rate limiter. Set sensible limits: 100 req/min for read APIs, 10 req/min for write APIs, 1 active workflow job.

### Credentials Cache in EmailClient May Hold Stale Tokens
- **Problem:** Class-level cache in `EmailClient._credentials_cache` can hold expired tokens if `_is_token_expired()` check fails or token is revoked server-side.
- **Files:** `src/services/email_ingestion/client.py:33-129`
- **Current mitigation:** Cache checks expiry with 5-min proactive window
- **Recommendations:** Add TTL to cached credentials (e.g., 55 min). Implement token revocation detection (e.g., 401 response triggers cache invalidation).

## Fragile Areas

### Statement Processing Workflow State Is In-Memory Only
- **Files:** `src/apis/routes/workflow_routes.py:80-99`
- **Why fragile:** Job state (`_jobs` dict, `_active_job_id` global) is lost on backend restart. Frontend cannot resume interrupted workflows. Long-running workflows are vulnerable to connection loss.
- **Safe modification:** Add database table `workflow_jobs` to persist job state (id, mode, status, started_at, completed_at, events). Update `workflow_routes.py` to load/save state from DB. Implement job resume logic on backend startup.
- **Test coverage:** No tests for job state recovery, multi-job concurrency limits

### Review Queue Dedup Key Is Fragile to Schema Changes
- **Files:** `src/services/database_manager/operations/review_queue_operations.py` (dedup ON CONFLICT index)
- **Why fragile:** Recent migration `n9o0p1q2r3s4_narrow_review_queue_dedup_index.py` changed the index to include `transaction_time` and `normalized_description`. If normalization logic changes, duplicate rows can leak through.
- **Safe modification:** Document the exact normalization steps (title case, trim whitespace) in the model or migration comments. Add integration tests that verify dedup catches intentional duplicates.
- **Test coverage:** `tests/test_review_queue.py` exists but doesn't test all dedup scenarios (e.g., same transaction entered twice in succession)

### Split Transaction Accounting Correctness
- **Files:** `src/apis/routes/transaction_split_routes.py`, `src/services/database_manager/operations/transaction_operations.py` (split_breakdown updates)
- **Why fragile:** `split_breakdown` JSONB structure has no database constraints. Inconsistent splits can be inserted (sum != amount, negative shares, etc.).
- **Safe modification:** Add validation function to verify `split_breakdown` before insert/update:
  - All entries sum to transaction amount (within 1 paisa tolerance for rounding)
  - All amounts are non-negative
  - Participants exist in the database
  - No duplicate participant entries
- **Test coverage:** `tests/test_settlement_calculations.py` tests read-side; no tests for write-side validation

### Soft-Delete Cascade Incomplete
- **Problem:** When a transaction is soft-deleted, related split rows or grouped expense rows are not automatically soft-deleted. This can leave orphaned rows.
- **Files:** `src/apis/routes/transaction_write_routes.py` (delete handler), `src/services/database_manager/operations/transaction_operations.py:delete_transaction()`
- **Impact:** Orphaned rows show up in aggregations, settlement calculations include deleted transactions' splits
- **Safe modification:** Update `delete_transaction()` to soft-delete all rows with matching `transaction_group_id`. Add database trigger to enforce cascade on is_deleted.
- **Test coverage:** No test for soft-delete cascade

### Email Dedup Service Relies on Message ID Uniqueness
- **Problem:** Email dedup uses `email_message_id` as the key. If an email is re-indexed or Gmail returns different message IDs, dedup fails.
- **Files:** `src/services/email_ingestion/dedup_service.py`
- **Impact:** Duplicate transactions from the same email
- **Workaround:** Gmail message IDs are stable per account
- **Recommendations:** Add email subject + date + sender as fallback dedup key. Log mismatches for investigation.

## Scaling Limits

### Single Active Workflow Job
- **Current capacity:** Only 1 workflow job can run at a time (enforced by `_active_job_id` global)
- **Limit:** If you want to run multiple statement ingestions concurrently (e.g., two Gmail accounts simultaneously), this will queue them
- **Scaling path:** Move job state to database with proper locking. Implement queue-based job system (e.g., Celery, RQ, or simple poll-based fetcher). Set max concurrent jobs per account.

### Fixed Email Search Window
- **Current behavior:** Workflow scans statements from 10th of current month to 10th of previous month (~30 days). Hardcoded in `statement_workflow.py`.
- **Scaling limit:** If you add more than ~3 Gmail accounts with daily statements, API rate limiting becomes an issue
- **Scaling path:** Implement incremental sync using `updated_at` from email metadata. Cache last-scanned-date per sender per account. Resume from last known date, not fixed window.

### Splitwise Sync Is Limited to 30 Days or Cursor
- **Problem:** Splitwise service supports two sync modes: (1) past 30 days, (2) cursor-based from updated_at. No full reconciliation mode.
- **Files:** `src/services/splitwise_processor/service.py:37-96`
- **Impact:** Cannot recover from missed transactions older than 30 days without manual intervention
- **Scaling path:** Add full sync mode that walks all expenses via pagination. Store last-sync cursor and allow manual reset. Implement delta detection to avoid re-inserting unchanged transactions.

## Dependencies at Risk

### agentic-doc (LandingAI) Heavy Dependency
- **Risk:** Relies on closed-source `landingai-ade` package for PDF/image extraction. If service goes down or API changes, document extraction breaks.
- **Impact:** Core workflow feature (statement extraction) depends on external AI service
- **Migration plan:** Have fallback to Tesseract OCR + regex parsing. Keep sample PDFs for regression testing. Monitor LandingAI service status.

### langchain Rapid Development Cycle
- **Current:** `langchain ^0.2.6` with many point releases per month
- **Risk:** Breaking changes in minor versions possible
- **Mitigation:** Pin to `langchain ~0.2.6` (not `^`) to avoid auto-upgrade. Implement integration tests for LLM-based features.

## Missing Critical Features / Known Gaps

### No Transaction Reconciliation UI
- **Problem:** Users cannot see a statement PDF side-by-side with extracted transactions to verify correctness. The `compare_cashback_sbi_statement.py` script does this, but it's CLI-only and one-off.
- **Blocks:** Validating statement extraction quality, catching extraction bugs early
- **Recommendation:** Build a review interface that shows statement PDF thumbnail + extracted table + matched transactions in the UI.

### No Bulk Error Recovery
- **Problem:** If a workflow fails mid-way (e.g., at standardization step), there's no way to retry just the failed stage without re-downloading PDFs.
- **Blocks:** Efficient error recovery
- **Recommendation:** Implement `resume` mode that skips download/unlock and re-runs failed stages. Persist intermediate CSVs to GCS for resumption.

### No Audit Trail for Transaction Changes
- **Problem:** When a transaction is edited, created, or deleted, there's no log of who did what and when (beyond soft-delete timestamp).
- **Impact:** Cannot trace data lineage, audit for reconciliation
- **Recommendation:** Add `transaction_audit_log` table with (transaction_id, action, old_value, new_value, changed_by, changed_at). Record all mutations.

### Statement Sender Address Changes Not Tracked
- **Problem:** Recent issue (2026-08-08): Axis Bank and Yes Bank changed statement sender email addresses. Accounts table has old sender addresses, so new statements aren't recognized.
- **Files:** `src/services/database_manager/models/account.py:statement_sender`, `src/services/orchestrator/statement_workflow.py` (sender matching logic)
- **Impact:** Missed statements from accounts with changed sender addresses
- **Status:** Already detected and noted in MEMORY.md; senders fixed 2026-08-08, backlog runs still pending
- **Recommendation:** Add `statement_sender_aliases` array to accounts table. Update workflow to match on any alias. Monitor for future sender changes by logging unmatched senders.

## Test Coverage Gaps

### Email Ingestion Workflow
- **Untested area:** End-to-end Gmail OAuth flow, email search, PDF download, and attachment extraction
- **Files:** `src/services/email_ingestion/`, `src/services/orchestrator/statement_workflow.py` (email search block)
- **Risk:** Changes to Gmail API integration could break silently
- **Recommendation:** Add integration tests with mock Gmail API responses. Test edge cases: empty search results, malformed PDFs, missing attachments, rate limiting.

### Splitwise Sync
- **Untested area:** Splitwise data reconciliation, split_breakdown construction, participant matching
- **Files:** `src/services/splitwise_processor/`
- **Risk:** Splitwise API changes or edge cases (group expenses, payment settlements, deleted expenses) could corrupt data
- **Recommendation:** Add mock-based tests for all Splitwise expense types. Test split_breakdown calculation against known examples.

### Statement Extraction & Standardization
- **Untested area:** LLM-based extraction accuracy, CSV parsing, transaction standardization with edge cases (multi-currency, negative amounts, blank fields)
- **Files:** `src/services/orchestrator/transaction_standardizer.py`, `src/services/statement_processor/document_extractor.py`
- **Risk:** Bad data can be inserted silently if standardizer has bugs
- **Recommendation:** Create unit tests with sample CSVs from each supported bank. Test edge cases: zero amount, null description, malformed date, duplicate reference numbers.

### Settlement Calculation Edge Cases
- **Untested area:** Circular debts, participants entering/leaving groups mid-month, refund scenarios, rounding accuracy
- **Files:** `src/apis/routes/settlement_routes.py`
- **Risk:** Settlement balances could be incorrect, causing misunderstandings between participants
- **Recommendation:** Add property-based tests using hypothesis to generate random transaction/split combinations. Verify settlements balance to zero. Test specific scenarios: refunds, group transfers, one-time vs. recurring.

---

*Concerns audit: 2026-08-09*
