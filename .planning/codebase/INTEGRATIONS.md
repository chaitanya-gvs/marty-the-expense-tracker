# External Integrations

**Analysis Date:** 2026-03-27

## APIs & External Services

**OpenAI / LLM:**
- OpenAI API — LLM-based transaction extraction from bank statements
  - SDK: `openai ^1.37.1`, `langchain-openai ^0.1.8`
  - Auth env var: `OPENAI_API_KEY` (in `backend/configs/secrets/.env`)
  - Used in: `backend/src/services/statement_processor/` via LangChain chains

**LandingAI Agentic-Doc:**
- LandingAI Vision Agent API — AI-powered PDF document parsing for structured data extraction
  - SDK: `agentic-doc ^0.3.3`
  - Auth env var: `VISION_AGENT_API_KEY` (in `backend/configs/secrets/.env`)
  - Used in: `backend/src/services/statement_processor/document_extractor.py`
  - `DocumentExtractor` calls `agentic_doc.parse.parse()` with bank-specific Pydantic schemas from `backend/src/services/statement_processor/schemas.py`

**Splitwise:**
- Splitwise REST API v3.0 (`https://secure.splitwise.com/api/v3.0`) — Expense sync and friend balance lookup
  - SDK installed: `splitwise ^3.0.0` (not used; direct `requests` calls in `SplitwiseAPIClient`)
  - Auth env var: `SPLITWISE_API_KEY` (read via `os.getenv` in `backend/src/services/splitwise_processor/client.py`)
  - Endpoints called: `GET /get_current_user`, `GET /get_friends`, `GET /get_expenses`
  - Service layer: `backend/src/services/splitwise_processor/service.py`
  - Routes exposed at: `backend/src/apis/routes/splitwise_routes.py` (prefix `/api/splitwise`)

## Data Storage

**Databases:**
- PostgreSQL — Primary datastore; all transactions, accounts, categories, budgets, settlements
  - Connection env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
  - Default: `postgresql+asyncpg://chaitanya:@localhost:5432/expense_tracker`
  - Async client: `asyncpg` via SQLAlchemy 2.0 async engine (`backend/src/services/database_manager/connection.py`)
  - Sync client: `psycopg2-binary` used by Alembic only
  - ORM: SQLAlchemy 2.0 declarative models, all in `backend/src/services/database_manager/`
  - Migrations: Alembic; config at `backend/alembic.ini`; scripts at `backend/src/services/database_manager/migrations/versions/`

**File Storage:**
- Google Cloud Storage — Bank statement PDFs (locked and unlocked)
  - SDK: `google-cloud-storage ^3.3.1`
  - Auth env var: `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON)
  - Project env var: `GOOGLE_CLOUD_PROJECT_ID`
  - Bucket env var: `GOOGLE_CLOUD_BUCKET_NAME` (production: `marty-the-expense-tracker`)
  - Service: `backend/src/services/cloud_storage/gcs_service.py` (`GoogleCloudStorageService`)
  - Bucket layout: `unlocked-statements/{YYYY-MM}/{filename}.pdf`

**Caching:**
- None — No Redis or in-memory cache layer; settings use `@lru_cache(maxsize=1)` in `backend/src/utils/settings.py`
- Workflow job state stored in-process dict (`_jobs` in `backend/src/apis/routes/workflow_routes.py`); not persistent

## Authentication & Identity

**Gmail OAuth2 (Primary Account):**
- Google OAuth2 for Gmail read access (bank statement emails)
  - SDK: `google-auth`, `google-auth-oauthlib`, `google-auth-httplib2`
  - Client config env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_PROJECT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET_FILE`
  - Token management: `backend/src/services/email_ingestion/token_manager.py`
  - Auth flow: `backend/src/services/email_ingestion/auth.py`
  - Scopes: Gmail read (fetches bank statement attachments)

**Gmail OAuth2 (Secondary Account — Optional):**
- Second Gmail account for multi-account statement fetching
  - Env vars: `GOOGLE_CLIENT_ID_2`, `GOOGLE_CLIENT_SECRET_2`, `GOOGLE_REFRESH_TOKEN_2`, `GOOGLE_CLIENT_SECRET_FILE_2`
  - Enable via: `ENABLE_SECONDARY_ACCOUNT=true` env var (read in `backend/src/services/orchestrator/statement_workflow.py`)
  - Same `EmailClient` class with `account_id="secondary"` parameter

**App Authentication:**
- None — Personal single-user tool; no auth middleware on FastAPI; CORS set to `allow_origins=["*"]`

## Monitoring & Observability

**Error Tracking:**
- Sentry — Config present but optional
  - Env var: `SENTRY_DSN` (in `backend/src/utils/settings.py`, defaults to `None`)
  - Not wired into middleware in `backend/main.py` in current codebase state

**Logs:**
- Custom rotating file logger at `backend/src/utils/logger.py`
- Format: `%(asctime)s - %(levelname)s - %(name)s - %(job_id)s - %(message)s`
- Output: both file (`backend/logs/app.log` via `RotatingFileHandler`) and console (`StreamHandler`)
- Log level controlled by `LOG_LEVEL` env var (default: `INFO`)
- `job_id` injected into every log record via `CustomLogger._log()` override

## CI/CD & Deployment

**Hosting:**
- Target: Oracle Free Tier or Hetzner VPS (personal project migration; no Docker yet)
- No CI pipeline configured

**CI Pipeline:**
- None detected

## Backend Workflow Streaming

**Server-Sent Events (SSE):**
- Workflow progress streamed in real-time via SSE
  - Backend endpoint: `GET /api/workflow/{job_id}/stream` — `StreamingResponse` with `text/event-stream`
  - Frontend consumer: `streamWorkflowEvents(jobId)` in `frontend/src/lib/api/client.ts` creates `EventSource`
  - Hook: `frontend/src/hooks/use-workflow.ts`
  - Events: `WorkflowEvent` schema defined in `backend/src/apis/schemas/workflow.py`

## Environment Configuration

**Required backend env vars (backend/configs/.env):**
- `APP_ENV` — `dev` or `prod`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — PostgreSQL connection
- `LOG_LEVEL` — Logging verbosity
- `CURRENT_USER_NAMES` — Comma-separated names for settlement "me" detection

**Required backend secrets (backend/configs/secrets/.env):**
- `OPENAI_API_KEY` — OpenAI LLM access
- `VISION_AGENT_API_KEY` — LandingAI agentic-doc access
- `SPLITWISE_API_KEY` — Splitwise REST API Bearer token
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` — Gmail OAuth2 primary
- `GOOGLE_CLOUD_PROJECT_ID` / `GOOGLE_CLOUD_BUCKET_NAME` / `GOOGLE_APPLICATION_CREDENTIALS` — GCS

**Required frontend env vars (frontend/.env.local):**
- `NEXT_PUBLIC_API_URL` — Backend API base URL (default: `http://localhost:8000/api`)
- `NEXT_PUBLIC_APP_ENV` — Environment label

**Secrets location:**
- Backend secrets: `backend/configs/secrets/` directory (gitignored)
- GCS service account JSON: path set by `GOOGLE_APPLICATION_CREDENTIALS`

## Webhooks & Callbacks

**Incoming:**
- None — No webhook endpoints registered

**Outgoing:**
- None — All external calls are request/response or polling

---

*Integration audit: 2026-03-27*
