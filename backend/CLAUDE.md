# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directory Structure

```
backend/
├── main.py                          # FastAPI app entry point
├── pyproject.toml                   # Poetry dependencies & tool config
├── alembic.ini                      # Migration config
├── configs/
│   └── secrets/                     # client_secret.json, gcs_service_account_key.json
├── data/
│   ├── backups/                     # DB dump files
│   ├── extracted_data/              # CSV output from document extractor
│   ├── statements/
│   │   ├── locked_statements/       # Downloaded PDFs (pre-unlock)
│   │   └── unlocked_statements/     # Decrypted PDFs (post-unlock)
│   └── standardized_transactions.csv
├── logs/                            # Rotating log files
├── scripts/                         # Standalone operational scripts
├── src/
│   ├── apis/
│   │   ├── routes/
│   │   │   ├── participant_routes.py
│   │   │   ├── settlement_routes.py
│   │   │   ├── transaction_routes.py
│   │   │   └── workflow_routes.py
│   │   └── schemas/
│   │       ├── common.py
│   │       ├── participants.py
│   │       ├── settlements.py
│   │       └── workflow.py
│   ├── services/
│   │   ├── cloud_storage/
│   │   │   └── gcs_service.py
│   │   ├── database_manager/
│   │   │   ├── connection.py        # Async engine + session factory
│   │   │   ├── operations.py        # All DB queries (~900 lines)
│   │   │   ├── models/
│   │   │   │   ├── account.py
│   │   │   │   ├── category.py
│   │   │   │   ├── participant.py
│   │   │   │   ├── statement_processing_log.py
│   │   │   │   ├── tag.py
│   │   │   │   ├── transaction.py
│   │   │   │   └── transaction_tag.py
│   │   │   └── migrations/
│   │   │       ├── env.py
│   │   │       └── versions/        # Alembic migration files
│   │   ├── email_ingestion/
│   │   │   ├── auth.py
│   │   │   ├── client.py
│   │   │   ├── service.py
│   │   │   └── token_manager.py
│   │   ├── ocr_engine/
│   │   │   └── engine.py
│   │   ├── orchestrator/
│   │   │   ├── csv_processor.py
│   │   │   ├── statement_workflow.py  # Main pipeline orchestrator
│   │   │   └── transaction_standardizer.py
│   │   ├── splitwise_processor/
│   │   │   ├── client.py
│   │   │   ├── schemas.py
│   │   │   └── service.py
│   │   └── statement_processor/
│   │       ├── document_extractor.py  # agentic-doc + LLM extraction
│   │       ├── pdf_page_filter.py
│   │       ├── pdf_unlocker.py
│   │       └── schemas.py
│   └── utils/
│       ├── filename_utils.py
│       ├── logger.py
│       ├── password_manager.py
│       └── settings.py
└── tests/
```

## Working Directory

**Always run all commands from `backend/`** — this is where `pyproject.toml` lives. Never run Python or Poetry commands from the repo root.

The dev server has hot reload enabled. **Do not restart it** unless explicitly asked or after config file changes.

## Commands

```bash
# Development
poetry install
poetry run uvicorn main:app --reload        # http://localhost:8000 (API docs at /docs)

# Linting
poetry run ruff check .

# Database migrations
poetry run alembic upgrade head                                 # Apply pending
poetry run alembic revision --autogenerate -m "description"    # New migration
poetry run alembic downgrade -1                                 # Rollback one
```

## Configuration

- Primary config: `configs/.env`
- Secret overrides: `configs/secrets/.env` (loaded first, takes precedence)
- Settings singleton: `src/utils/settings.py` → `get_settings()` (lru_cache)
- Key env vars: `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` (primary + `_2` suffix for secondary account), `GOOGLE_CLOUD_BUCKET_NAME`, `CURRENT_USER_NAMES` (comma-separated, used for settlement "me" detection)
- PostgreSQL: `localhost:5432`, db `expense_db` (alembic.ini has its own connection string: `expense_tracker`)

## Architecture

### Entry Point & Routing

`main.py` mounts 4 routers at `/api`:
- `/transactions` → `src/apis/routes/transaction_routes.py`
- `/settlements` → `src/apis/routes/settlement_routes.py`
- `/participants` → `src/apis/routes/participant_routes.py`
- `/workflow` → `src/apis/routes/workflow_routes.py`

### Service Layer

All business logic lives in `src/services/`. Key services:

**`database_manager/`**
- `connection.py` — Async SQLAlchemy engine (pool size 10, max_overflow 20). `get_db_session()` is the FastAPI dependency.
- `operations.py` — All DB queries in one file (~900 lines). Classes: `AccountOps`, `TransactionOps`, `CategoryOps`, `TagOps`, `ParticipantOps`, `StatementLogOps`.
- `models/` — SQLAlchemy ORM models (see Models section below).
- `migrations/versions/` — Alembic migration files.

**`orchestrator/statement_workflow.py`** — The main pipeline (~750+ lines). Orchestrates the full email→DB flow. Has three modes: `full`, `resume` (skip extraction, re-standardize from existing CSVs), `splitwise_only`.

**`statement_processor/document_extractor.py`** — Uses `agentic-doc` (LandingAI) to extract transactions from unlocked PDFs via AI. Requires `VISION_AGENT_API_KEY`. Maps account nicknames to bank-specific schemas.

**`email_ingestion/`** — Gmail API integration. `service.py` supports two Gmail accounts (primary + secondary). Token management in `token_manager.py`.

**`splitwise_processor/service.py`** — Splitwise API sync. Supports both date-range and cursor-based (`updated_at`) sync for incremental updates. Builds `split_breakdown` JSONB from Splitwise expense shares.

**`cloud_storage/gcs_service.py`** — Upload/download to Google Cloud Storage. Unlocked PDFs and extracted CSVs are stored at `{YYYY-MM}/{type}/{filename}`.

### Statement Processing Pipeline

```
Gmail API → Download PDF → Unlock PDF (password from accounts.statement_password)
         → Page filter → agentic-doc extraction → CSV → GCS upload
         → TransactionStandardizer → PostgreSQL insert
         → StatementProcessingLog (tracks per-file status)
```

Workflow jobs are in-memory (not persisted across restarts). Real-time progress via SSE at `GET /workflow/{job_id}/stream`. Only one job runs at a time (enforced via `_active_job_id` global in `workflow_routes.py`).

### Settlement Calculation

`settlement_routes.py` does all calculations in Python (not SQL aggregation):
1. Queries shared transactions with `split_breakdown` JSONB
2. Normalizes participant names to title case; "me" / `CURRENT_USER_NAMES` values are treated as the current user
3. Infers payer: if `paid_by` is null, checks if `account` is a known bank account (→ current user paid) vs Splitwise
4. Computes `amount_owed_to_me` vs `amount_i_owe` per participant, returns `net_balance`

## Database Models

**`transactions`** — Core table. Key fields:
- `split_breakdown` (JSONB) — Structure: `{mode: "equal"|"custom", entries: [{participant, amount, paid_share, net_balance}], paid_by}`
- `related_mails` (ARRAY) — Gmail message IDs
- `transaction_source` — `statement_extraction` | `email_ingestion` | `manual_entry`
- `is_deleted` + `deleted_at` — Soft delete (never hard delete from routes)
- `transaction_group_id` — UUID linking refunds/reversals/transfers to each other
- `is_grouped_expense` — Groups unrelated transactions into one logical expense

**`accounts`** — Bank/card accounts. `statement_sender` (email) and `statement_password` are used for auto-ingestion. The workflow looks up accounts by sender email to find the password.

**`statement_processing_log`** — Tracks per-statement pipeline state. `normalized_filename` (unique key, format: `{account}_{YYYY-MM}`) prevents re-processing. Status values: `downloaded`, `unlocked`, `extracted`, `csv_created`, `db_inserted`, `error`.

**`categories`** — Hierarchical via self-referencing `parent_id`. `transaction_type` field (`debit`/`credit`/null) filters which categories appear for which transaction directions.

**`participants`** — People in split transactions. Optional `splitwise_id` links to Splitwise users.

## Utilities

- `src/utils/logger.py` — `get_logger(name)`. Supports `job_id` tracking via `CustomLogger`. Writes rotating file logs + console.
- `src/utils/filename_utils.py` — `nickname_to_filename_prefix()` strips common suffixes (`_credit_card`, `_account`, `_savings`) to build GCS path prefixes.
- `src/utils/password_manager.py` — `BankPasswordManager.get_password_for_sender_async(email)` queries `accounts` table.
