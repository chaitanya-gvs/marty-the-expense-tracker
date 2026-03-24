# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Directory Rules

- **Always run backend commands from `backend/`** (where `pyproject.toml` lives)
- **Always run frontend commands from `frontend/`** (where `package.json` lives)
- Both dev servers support hot reload — **do not restart them** unless explicitly asked or after config file changes

## Commands

### Backend (run from `backend/`)
```bash
poetry install                                    # Install dependencies
poetry run uvicorn main:app --reload             # Dev server at http://localhost:8000
poetry run pytest tests/                         # All tests
poetry run pytest tests/test_api_integration.py  # Single test file
poetry run ruff check .                          # Lint
poetry run alembic upgrade head                  # Apply migrations
poetry run alembic revision --autogenerate -m "description"  # New migration
```

### Frontend (run from `frontend/`)
```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:3000 (Turbopack)
npm run build        # Production build
npm run lint         # ESLint
```

### Environment
- Backend config: `backend/configs/.env`
- PostgreSQL required at `localhost:5432` (db: `expense_db`)
- API docs available at `http://localhost:8000/docs`

## Architecture Overview

This is a personal expense tracker with LLM-powered transaction ingestion from bank statements, Gmail, and Splitwise.

### Stack
- **Backend**: FastAPI + SQLAlchemy 2.0 async + PostgreSQL + Alembic
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + TanStack Query
- **LLM**: LangChain + OpenAI for PDF/OCR transaction extraction
- **External**: Gmail API, Google Cloud Storage, Splitwise API

### Backend Layer Structure

```
main.py → APIs (routes + schemas) → Services (business logic) → DB
```

**`src/apis/routes/`** — FastAPI route handlers:
- `transaction_routes.py` — CRUD, filtering, suggestions
- `settlement_routes.py` — Who owes whom calculations
- `participant_routes.py` — Split participants
- `workflow_routes.py` — Statement processing jobs with SSE streaming

**`src/services/`** — Core business logic:
- `database_manager/` — SQLAlchemy models, async connection pool (`connection.py`), all DB operations (`operations.py`)
- `orchestrator/statement_workflow.py` — Main pipeline orchestration
- `email_ingestion/` — Gmail OAuth + statement email fetching
- `statement_processor/` — PDF unlocking, OCR, LLM-based extraction
- `splitwise_processor/` — Splitwise API sync
- `cloud_storage/gcs_service.py` — GCS upload/download

**`src/utils/settings.py`** — Pydantic settings (all config from `.env`)

### Statement Processing Pipeline

```
Gmail → Download PDF → Unlock PDF (password) → OCR + LLM → Standardize → PostgreSQL
                                                                          → GCS Upload
```

Triggered via `POST /api/workflow/run`; progress streamed via SSE on `GET /api/workflow/{job_id}/stream`.

### Frontend Structure

**`src/app/`** — Next.js App Router pages: `transactions`, `settlements`, `analytics`, `budgets`, `review` (statement workflow UI), `settings`

**`src/lib/api/client.ts`** — Axios API client (all backend calls go through here)

**`src/lib/types/index.ts`** — Canonical TypeScript interfaces (`Transaction`, `Category`, `Tag`, `Participant`, etc.)

**`src/store/`** — Global state; **`src/hooks/`** — Custom React hooks

### Key Database Models

- **Transaction** — Core record with `split_breakdown` (JSONB), `related_mails` (ARRAY), `transaction_source` enum, soft-delete fields
- **Account** — Bank/card accounts with statement sender email + password for auto-ingestion
- **Category** — Hierarchical (self-referencing `parent_id`), with `transaction_type` filter
- **StatementProcessingLog** — Tracks per-statement pipeline status with `normalized_filename` as unique key
- **Participant** — People in splits, optionally linked to Splitwise via `splitwise_id`

Migrations are in `src/services/database_manager/migrations/versions/` and are applied automatically on startup.
