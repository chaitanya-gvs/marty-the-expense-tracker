# Technology Stack

**Analysis Date:** 2026-03-27

## Languages

**Primary:**
- Python 3.11+ (constraint in `pyproject.toml`; system Python 3.13 in use) - Backend API, services, data processing
- TypeScript 5.x - Frontend application, all `.ts` / `.tsx` files

**Secondary:**
- SQL (PostgreSQL dialect) - Database migrations in `backend/src/services/database_manager/migrations/versions/`

## Runtime

**Backend:**
- Python 3.13 (current machine); `pyproject.toml` requires `^3.11`
- Uvicorn ASGI server — `poetry run uvicorn main:app --reload` runs on port 8000

**Frontend:**
- Node.js 24.x (system); package-lock at v3
- Next.js dev server via Turbopack — `npm run dev` runs on port 3000

## Package Managers

**Backend:**
- Poetry — `backend/pyproject.toml`, lockfile `backend/poetry.lock` present

**Frontend:**
- npm — `frontend/package.json`, lockfile `frontend/package-lock.json` present

## Frameworks

**Backend Core:**
- FastAPI `^0.111.0` — REST API framework, routers defined in `backend/src/apis/routes/`
- SQLAlchemy 2.0 async `^2.0.30` — ORM, async engine via `asyncpg`
- Alembic `^1.13.2` — Database migrations; config at `backend/alembic.ini`; versions in `backend/src/services/database_manager/migrations/versions/`
- Pydantic v2 `^2.7.1` — Schema validation; `pydantic-settings ^2.3.4` for env config
- Uvicorn `^0.30.0` — ASGI server

**Frontend Core:**
- Next.js 15.5.3 (App Router) — Pages in `frontend/src/app/`
- React 19.1.0 — UI rendering
- TanStack Query v5 `^5.87.4` — Server state, data fetching, all API calls wired through hooks in `frontend/src/hooks/`
- TanStack Table v8 `^8.21.3` — Transaction table rendering
- TanStack Virtual v3 `^3.13.12` — Virtualised list rendering
- Tailwind CSS 4 — Utility-first styling; config via PostCSS at `frontend/postcss.config.mjs`
- Framer Motion `^12.23.24` — Animations

**Frontend Forms/Validation:**
- React Hook Form `^7.62.0` — Form state
- Zod v4 `^4.1.8` — Schema validation
- `@hookform/resolvers ^5.2.1` — Connects Zod to RHF

**Frontend UI Primitives:**
- Radix UI — `@radix-ui/react-*` components: alert-dialog, checkbox, dialog, dropdown-menu, label, popover, progress, radio-group, select, slider, slot, switch, tabs, toast, tooltip
- shadcn/ui component system — config at `frontend/components.json`; `class-variance-authority`, `clsx`, `tailwind-merge`
- `cmdk ^1.1.1` — Command palette
- `lucide-react ^0.544.0` — Icon set
- `sonner ^2.0.7` — Toast notifications
- `next-themes ^0.4.6` — Theme switching

**Frontend Data Viz:**
- Recharts `^3.2.0` — Charts on analytics page (`frontend/src/app/analytics/`)

**Frontend PDF:**
- `pdfjs-dist ^5.4.394` + `react-pdf ^10.2.0` — PDF viewing in statement review UI (`frontend/src/app/review/`)

## LLM / AI Stack

**Frameworks:**
- LangChain `^0.2.6` + `langchain-core ^0.2.11` + `langchain-community ^0.2.5` — Orchestration and chain building
- `langchain-openai ^0.1.8` — OpenAI adapter
- `openai ^1.37.1` — Direct OpenAI SDK

**Document Extraction:**
- `agentic-doc ^0.3.3` — LandingAI's document parsing library; used in `backend/src/services/statement_processor/document_extractor.py` via `from agentic_doc.parse import parse`; requires `VISION_AGENT_API_KEY`

**OCR:**
- `pytesseract ^0.3.10` — Tesseract OCR wrapper; used in `backend/src/services/ocr_engine/engine.py`
- `Pillow ^10.3.0` — Image processing for OCR input
- `PyMuPDF ^1.24.0` — PDF rendering and page extraction (`fitz`)

## Key Backend Dependencies

**Database:**
- `asyncpg ^0.29.0` — Async PostgreSQL driver (used by SQLAlchemy async engine)
- `psycopg2-binary ^2.9.10` — Sync PostgreSQL driver (used by Alembic for migrations)

**Data Processing:**
- `pandas ^2.2.2` — DataFrame manipulation during statement extraction and standardisation
- `openpyxl ^3.1.2` — Excel file support (xlxs output from extraction)
- `beautifulsoup4 ^4.12.0` + `html5lib ^1.1` + `lxml ^6.0.2` — HTML email body parsing in `email_ingestion/client.py`

**Utilities:**
- `orjson ^3.10.3` — Fast JSON serialisation for FastAPI responses
- `python-multipart ^0.0.9` — Multipart form data (file uploads)
- `python-dotenv ^1.0.1` — `.env` loading
- `greenlet ^3.3.2` — Required by SQLAlchemy async

**Google Integrations:**
- `google-api-python-client ^2.136.0` — Gmail API client
- `google-auth ^2.31.0` + `google-auth-oauthlib ^1.2.0` + `google-auth-httplib2 ^0.2.0` — Google OAuth2
- `google-cloud-storage ^3.3.1` — GCS client

**External:**
- `splitwise ^3.0.0` — Splitwise SDK (installed but `SplitwiseAPIClient` in `backend/src/services/splitwise_processor/client.py` calls the REST API directly via `requests`)

## Dev Dependencies

**Backend:**
- `ruff ^0.5.0` — Linting; run `poetry run ruff check .`
- `pytest ^8.2.0` + `pytest-asyncio ^0.23.7` — Testing; tests in `backend/tests/`; `asyncio_mode = "auto"` in `pyproject.toml`

**Frontend:**
- ESLint 9 — Config at `frontend/eslint.config.mjs`; extends `next/core-web-vitals` + `next/typescript`
- TypeScript strict mode — `"strict": true` in `frontend/tsconfig.json`

## Configuration

**Backend Environment:**
- Primary config: `backend/configs/.env`
- Secrets config: `backend/configs/secrets/.env`
- Both loaded by Pydantic Settings class at `backend/src/utils/settings.py` with `secrets/.env` taking precedence
- Settings accessed app-wide via `get_settings()` (LRU-cached singleton)

**Frontend Environment:**
- `NEXT_PUBLIC_API_URL` — Backend base URL (default: `http://localhost:8000/api`)
- `NEXT_PUBLIC_APP_ENV` — Environment label
- Template: `frontend/.env.local.example`

**Build:**
- `frontend/next.config.ts` — Minimal Next.js config (Turbopack enabled via CLI flags)
- `frontend/tsconfig.json` — TypeScript; path alias `@/*` → `./src/*`
- `frontend/postcss.config.mjs` — PostCSS + Tailwind CSS 4 plugin

## Platform Requirements

**Development:**
- PostgreSQL at `localhost:5432` database `expense_tracker`
- Tesseract OCR installed on host (required by `pytesseract`)
- Python 3.11+
- Node.js 18+ (20+ recommended)

**Production:**
- Target: Oracle Free Tier or Hetzner (per project context)
- No Docker setup yet
- GCS bucket: `marty-the-expense-tracker`

---

*Stack analysis: 2026-03-27*
