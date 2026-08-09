# External Integrations

**Analysis Date:** 2026-08-09

## APIs & External Services

**Email & Messaging:**
- Gmail API (Google) - Statement email fetching + parsing
  - SDK/Client: `google-api-python-client` 2.136.0 + `googleapiclient.discovery.build()`
  - Implementation: `backend/src/services/email_ingestion/`
  - Auth: OAuth 2.0 with refresh tokens
  - Primary account env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
  - Secondary account: `GOOGLE_CLIENT_ID_2`, `GOOGLE_CLIENT_SECRET_2`, `GOOGLE_REFRESH_TOKEN_2`
  - Config file: `backend/configs/secrets/client_secret.json` (JSON OAuth credentials)
  - Multi-account support: Primary (`account_id="primary"`) + Secondary (`account_id="secondary"`)
  - Endpoint: `gmail.v1` API
  - Token manager: `backend/src/services/email_ingestion/token_manager.py` (refresh token handling)

**LLM & AI Extraction:**
- OpenAI API - Transaction extraction from documents via LLM
  - SDK/Client: `openai` 1.37.1 (direct) + `langchain-openai` 0.1.8 (via LangChain)
  - Implementation: `backend/src/services/statement_processor/document_extractor.py`
  - Auth: API key
  - Env var: `OPENAI_API_KEY`
  - Used for: Extracting structured transaction data from bank statements

**Document Extraction (Vision API):**
- LandingAI Agentic Document Extraction (ADE) - PDF transaction extraction
  - SDK/Client: `landingai-ade` >=1.12.0
  - Implementation: `backend/src/services/statement_processor/document_extractor.py`
  - Auth: API key
  - Env var: `VISION_AGENT_API_KEY`
  - Purpose: Bank-specific statement parsing (alternative to pure LLM)
  - Schema mapping: Account nicknames map to Pydantic models (e.g., "Axis Atlas Credit Card" → `AxisAtlasCreditCardStatement`)
  - Output: Structured transaction CSV

**Cloud Storage:**
- Google Cloud Storage (GCS) - Statement and extracted data storage
  - SDK/Client: `google-cloud-storage` 3.3.1
  - Implementation: `backend/src/services/cloud_storage/gcs_service.py`
  - Auth: Service account key file
  - Env vars: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS` (path to `serviceAccountKey.json`)
  - Bucket structure: `{YYYY-MM}/{type}/{filename}`
  - Stored artifacts: Unlocked PDFs, extracted CSVs, processed statements
  - Methods: Upload, download, list, delete

**Split Expense Tracking:**
- Splitwise API - Syncing shared expenses with Splitwise group
  - SDK/Client: Custom HTTP client in `backend/src/services/splitwise_processor/client.py` (via `requests`)
  - Implementation: `backend/src/services/splitwise_processor/service.py` (high-level operations)
  - Auth: Bearer token (API key)
  - Env var: `SPLITWISE_API_KEY`
  - Base URL: `https://secure.splitwise.com/api/v3.0`
  - Endpoints: `/get_current_user`, `/get_expenses`, `/get_friends`, `/get_groups`
  - Sync modes:
    - Date-range: Fetches expenses between start and end dates (full month scan)
    - Cursor-based: Fetches only expenses updated since last sync (incremental)
  - Cursor storage: `backend/src/services/database_manager/operations.py` → `get_splitwise_cursor()` / `update_splitwise_cursor()`
  - Data synced:
    - Expense transactions (with split breakdown)
    - Friend data + balances
    - Expense categories
  - Reconciliation: Soft deletes transactions when Splitwise expense is deleted (tracks `deleted_expense_ids`)

## Data Storage

**Primary Database:**
- PostgreSQL 12+
  - Connection: `postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}`
  - Default location: `localhost:5432` / database `expense_tracker` (or `expense_db` in settings)
  - Async driver: asyncpg 0.29.0 (primary for async operations)
  - Fallback driver: psycopg2-binary 2.9.9 (for compatibility)
  - Connection pool: SQLAlchemy async pool (size=10, max_overflow=20)
  - ORM: SQLAlchemy 2.0.30
  - Schema management: Alembic 1.13.2 (migrations in `backend/src/services/database_manager/migrations/versions/`)

**Database Schema & Key Tables:**
- `transactions` — Core transaction records with JSONB `split_breakdown`, soft deletes
- `accounts` — Bank/card accounts with statement sender email + password
- `categories` — Hierarchical transaction categories (self-referencing `parent_id`)
- `tags` — User-defined transaction tags
- `transaction_tags` — Many-to-many join table
- `participants` — Split transaction participants (optionally linked to Splitwise)
- `statement_processing_log` — Per-file pipeline status tracking (prevents re-processing)
- Indexes: On `account`, `category_id`, `transaction_date`, `direction`, `type`, `email_message_id`, `reference_number`, `recurring_key`

**File Storage (Backend):**
- Local filesystem (development):
  - `backend/data/statements/locked_statements/` — Downloaded PDFs (encrypted)
  - `backend/data/statements/unlocked_statements/` — Decrypted PDFs (post-unlock)
  - `backend/data/extracted_data/` — CSV output from extraction
  - `backend/data/standardized_transactions.csv` — Final standardized CSV
  - `backend/logs/` — Rotating log files (via `logging.handlers.RotatingFileHandler`)

- Cloud storage (production):
  - Google Cloud Storage bucket (see integrations section above)
  - Organized by `{YYYY-MM}/{type}/{filename}`

**Caching:**
- Not detected (no Redis or Memcached)
- Frontend: TanStack React Query in-memory caching (1-minute stale time, 30s for analytics)
- Backend: Python function-level caching via `@lru_cache` (e.g., `get_settings()`)

## Authentication & Identity

**API Authentication (Backend):**
- JWT (JSON Web Tokens)
  - Implementation: `python-jose` 3.5.0 (cryptography backend)
  - Signing: HS256 algorithm
  - Storage: HTTP-only cookie (FastAPI + Depends)
  - Config: `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `JWT_EXPIRY_DAYS` (default 7)
  - Validation: `src/utils/auth_deps.py` → `get_current_user()` dependency
  - Login endpoint: `POST /api/auth/login` (in `src/apis/routes/auth_routes.py`)
  - Password hashing: bcrypt via `passlib[bcrypt]`

**Third-Party Auth (OAuth 2.0):**
- Google OAuth 2.0 (for Gmail access)
  - Flow: Authorization Code Grant with refresh tokens
  - Implementation: `backend/src/services/email_ingestion/auth.py`
  - Token management: `backend/src/services/email_ingestion/token_manager.py` (auto-refresh)
  - Scopes: `gmail.readonly` (or subset thereof)
  - Multi-account support: Primary + Secondary Gmail accounts independently
  - Credentials file: `backend/configs/secrets/client_secret.json`

**Authentication in Frontend:**
- Cookie-based JWT (same as backend)
  - Credentials: `include` in all fetch requests (via `apiClient` in `src/lib/api/client.ts`)
  - Cookie attributes: HTTPOnly, SameSite (configurable via `COOKIE_SAMESITE_NONE`)
  - Login redirects to `GET /auth/login` (OAuth flow)

## Monitoring & Observability

**Error Tracking:**
- Sentry (optional)
  - Env var: `SENTRY_DSN` (if not set, no error tracking)
  - Not detected in active use (no Sentry imports in codebase)

**Logging:**
- Backend: `src/utils/logger.py`
  - Custom logger: `get_logger(name)` returns `CustomLogger` with job ID tracking
  - Rotating file logs: `backend/logs/` directory
  - Console output: Enabled
  - Log levels: Configurable via `LOG_LEVEL` env var (default: INFO)
  - Structured logging: Extra fields for job_id, task_name, etc.

- Frontend: Browser console
  - No centralized logging detected
  - Development logging via React Query DevTools (if installed)

**Metrics & Health:**
- Health endpoint: `GET /healthz` (returns `{"status": "ok"}`)
- No Prometheus or StatsD detected

## CI/CD & Deployment

**Hosting:**
- Development: `localhost:8000` (backend), `localhost:3000` (frontend)
- Production hostname: `expenses.chaitanya-gvs.com` (inferred from `frontend/next.config.ts` rewrites)
- Container implied (Docker) but not explicitly configured in codebase

**Environment-Based Config:**
- Backend: `APP_ENV` var (dev vs production)
- Frontend: `NEXT_PUBLIC_APP_ENV` var (development enables API rewrites to production backend)
- Separate `.env` files for secrets (`configs/secrets/.env`) and defaults (`configs/.env`)

**API Proxy (Frontend Dev):**
- Next.js rewrite: In development mode (`NEXT_PUBLIC_APP_ENV=development`), `/api/*` requests are proxied to `https://expenses.chaitanya-gvs.com/api/:path*`
- Purpose: Allows localhost dev frontend to access production backend while maintaining same-origin for auth cookies

**CI/CD Pipeline:**
- Not detected in codebase (no GitHub Actions, GitLab CI, or similar)

## Environment Configuration

**Required Environment Variables (Backend):**

*Database:*
- `DB_HOST` (default: localhost)
- `DB_PORT` (default: 5432)
- `DB_NAME` (default: expense_tracker)
- `DB_USER` (default: chaitanya)
- `DB_PASSWORD` (default: empty)

*Auth:*
- `JWT_SECRET_KEY` (required, random string)
- `AUTH_USERNAME` (default: admin)
- `AUTH_PASSWORD_HASH` (required, bcrypt hash)

*Google APIs (Gmail primary):*
- `GOOGLE_CLIENT_ID` (required)
- `GOOGLE_CLIENT_SECRET` (required)
- `GOOGLE_REFRESH_TOKEN` (required)
- `GOOGLE_PROJECT_ID` (required)
- `GOOGLE_REDIRECT_URI` (required)
- `GOOGLE_CLIENT_SECRET_FILE` (path to client_secret.json)

*Google APIs (Gmail secondary, optional):*
- `GOOGLE_CLIENT_ID_2`
- `GOOGLE_CLIENT_SECRET_2`
- `GOOGLE_REFRESH_TOKEN_2`
- `GOOGLE_CLIENT_SECRET_FILE_2`

*Google Cloud Storage:*
- `GOOGLE_CLOUD_PROJECT_ID` (required)
- `GOOGLE_CLOUD_BUCKET_NAME` (required)
- `GOOGLE_APPLICATION_CREDENTIALS` (path to service account key, required)

*AI & Extraction:*
- `OPENAI_API_KEY` (required for LLM extraction)
- `VISION_AGENT_API_KEY` (required for LandingAI ADE)
- `SPLITWISE_API_KEY` (required for Splitwise sync)

*Settlement Logic:*
- `CURRENT_USER_NAMES` (comma-separated names, default: "me,chaitanya gvs,chaitanya")

*Scheduling:*
- `EMAIL_INGESTION_INTERVAL_HOURS` (default: 4, hours between scheduled email checks)
- `STATEMENT_SEARCH_DAY` (default: 25, day of month to start searching for statements)

*App Config:*
- `APP_ENV` (dev or production)
- `LOG_LEVEL` (default: INFO)
- `FRONTEND_URL` (default: http://localhost:3000, CORS origin)
- `COOKIE_SAMESITE_NONE` (default: false, set true for cross-site cookies)

**Required Environment Variables (Frontend):**

*Backend Connection:*
- `NEXT_PUBLIC_API_URL` (default: http://localhost:8000/api)
- `NEXT_PUBLIC_APP_ENV` (development or production, affects API rewrites)

**Secrets Location:**
- Backend: `backend/configs/secrets/.env` (overrides `backend/configs/.env`)
- Backend: `backend/configs/secrets/client_secret.json` (Google OAuth credentials)
- Backend: `backend/configs/secrets/gcs_service_account_key.json` (Google Cloud service account)
- Frontend: `.env.local` (Next.js convention, git-ignored)

## Webhooks & Callbacks

**Incoming:**
- Not detected (system is pull-based only)
- Email fetching: Scheduled polling (APScheduler, 4-hour intervals by default)
- Splitwise sync: On-demand or scheduled

**Outgoing:**
- Not detected
- No callback URLs or webhook registrations in codebase

**Server-Sent Events (SSE):**
- Workflow status streaming: `GET /api/workflow/{job_id}/stream` (real-time progress)
- Implementation: `backend/src/apis/routes/workflow_routes.py` → SSE endpoint
- Frontend consumer: `src/hooks/use-workflow.ts` → `useWorkflowStream()`
- Event format: JSON events with task name, status, and metadata
- Auto-close: Frontend closes stream on component unmount or job completion

---

*Integration audit: 2026-08-09*
