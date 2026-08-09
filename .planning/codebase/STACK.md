# Technology Stack

**Analysis Date:** 2026-08-09

## Languages

**Primary:**
- Python 3.11 (3.11.9 in `.python-version`) - Backend services
- TypeScript 5.x - Frontend (React + Next.js)
- JavaScript - Build/dev tooling

**Secondary:**
- CSS/PostCSS - Styling (Tailwind CSS v4)
- SQL - Database schema (PostgreSQL)

## Runtime

**Backend Environment:**
- Python 3.11.9 (specified in `backend/.python-version`)
- Uvicorn ASGI server 0.30.0

**Frontend Environment:**
- Node.js (version unspecified, likely 18+)
- Turbopack build system (bundled with Next.js 15)

**Package Managers:**
- Backend: Poetry (specified in `backend/pyproject.toml`)
  - Lockfile: `poetry.lock` (Poetry handles this)
  - Install: `poetry install`
  
- Frontend: npm (specified in `frontend/package.json`)
  - Lockfile: `package-lock.json` (managed by npm)
  - Install: `npm install`

## Frameworks

**Backend:**
- FastAPI 0.111.0 - Web framework with automatic API docs
- Uvicorn 0.30.0 - ASGI application server with hot reload
- SQLAlchemy 2.0.30 - ORM for database operations (async-first)
- Alembic 1.13.2 - Database migrations management
- APScheduler 3.10.4 - Task scheduling (email ingestion jobs)

**Frontend:**
- Next.js 15.5.3 - React framework with App Router, SSR, Turbopack
- React 19.1.0 - UI library (ES2017 target)
- Tailwind CSS 4 - Utility-first CSS framework (PostCSS plugin, no `tailwind.config.js`)

**Data & State Management (Frontend):**
- TanStack React Query 5.87.4 - Server state management + caching
- React Hook Form 7.62.0 - Form state management
- Zod 4.1.8 - Runtime schema validation

**Tables & UI (Frontend):**
- TanStack React Table 8.21.3 - Headless table component library
- TanStack React Virtual 3.13.12 - Virtual scrolling for large lists
- Radix UI (multiple packages: dialog, dropdown-menu, select, slider, tabs, toast, etc.) - Unstyled accessible UI primitives
- lucide-react - Icon library

**Forms & Input:**
- @hookform/resolvers 5.2.1 - Schema validation integration with React Hook Form

**Content & Visualization:**
- Recharts 3.2.0 - React charts library (for analytics)
- react-pdf 10.2.0 - PDF viewer component
- pdfjs-dist 5.4.394 - PDF.js library (dependency of react-pdf)

**Animations & Effects:**
- Framer Motion 12.23.24 - Animation library
- Tailwind CSS animations - Simple CSS transitions (via tw-animate-css)

**Utilities & Theming:**
- next-themes 0.4.6 - Dark mode / theme switching
- class-variance-authority 0.7.1 - Component variant management
- clsx 2.1.1 - Utility for conditional class names
- tailwind-merge 3.3.1 - Merges Tailwind class conflicts
- date-fns 4.1.0 - Date formatting and manipulation
- cmdk 1.1.1 - Command/command palette component
- sonner 2.0.7 - Toast notification library
- jose 6.2.2 - JWT token handling

**Testing:**
- pytest 8.2.0 - Testing framework
- pytest-asyncio 0.23.7 - Async support for pytest
- No E2E testing framework detected

## Key Dependencies

**Critical (Backend):**
- asyncpg 0.29.0 - PostgreSQL async driver (raw driver for pool management)
- psycopg2-binary 2.9.9 - PostgreSQL driver (fallback/legacy compatibility)
- pydantic 2.7.1 - Data validation and serialization
- pydantic-settings 2.3.4 - Environment-based settings management
- orjson 3.10.3 - Fast JSON serialization (performance-critical)
- python-multipart 0.0.9 - Multipart form data parsing

**AI & Language Processing (Backend):**
- langchain 0.2.6 - LLM orchestration framework
- langchain-core 0.2.11 - Core LangChain abstractions
- langchain-community 0.2.5 - Community integrations
- langchain-openai 0.1.8 - OpenAI integration for LangChain
- openai 1.37.1 - OpenAI Python client (for direct API calls)

**Google Cloud & APIs (Backend):**
- google-api-python-client 2.136.0 - Google API client library
- google-auth 2.31.0 - Google authentication
- google-auth-oauthlib 1.2.0 - OAuth 2.0 flow support
- google-auth-httplib2 0.2.0 - HTTP transport for Google Auth
- google-cloud-storage 3.3.1 - Google Cloud Storage client

**Document Processing (Backend):**
- PyMuPDF 1.24.0 - PDF unlocking/manipulation (fitz backend)
- landingai-ade >=1.12.0 - LandingAI Agentic Document Extraction (vision API)
- BeautifulSoup4 4.12.0 - HTML parsing
- html5lib 1.1 - HTML5 parser (fallback for BeautifulSoup)
- lxml 5.0 - XML/HTML parsing (performance)

**Data Processing:**
- pandas 2.2.2 - Data manipulation and CSV handling

**Security & Authentication (Backend):**
- passlib[bcrypt] 1.7.4 - Password hashing
- python-jose[cryptography] 3.5.0 - JWT token signing and validation

**Rate Limiting & Scheduling:**
- slowapi 0.1.9 - Rate limiting for FastAPI
- apscheduler 3.10.4 - Background job scheduling (email ingestion)

**Utilities:**
- python-dotenv 1.0.1 - Environment variable loading
- greenlet 3.3.2 - Lightweight coroutine support (dependency of SQLAlchemy)

## Configuration

**Backend Configuration:**
- Primary: `backend/configs/.env` (checked into repo with defaults)
- Secrets override: `backend/configs/secrets/.env` (loaded first, takes precedence)
- Pydantic Settings: `backend/src/utils/settings.py` (lru_cache singleton)
- Settings loaded in this order: `secrets/.env` → `configs/.env` (highest to lowest priority)

**Frontend Configuration:**
- `.env.local` (Next.js convention, not in repo)
- Environment variables prefixed with `NEXT_PUBLIC_` are available in browser
- Base URL: `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000/api`)
- Dev environment: `NEXT_PUBLIC_APP_ENV=development` (enables API rewrites)

**Database Configuration:**
- PostgreSQL connection string: `postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}`
- Alembic config: `backend/alembic.ini` (separate connection string for migrations)
- Pool settings: size=10, max_overflow=20 (SQLAlchemy async engine)
- Database name in alembic.ini: `expense_tracker`; in settings: `expense_db`

**Build Configuration:**
- Backend: Poetry manages Python dependencies and dev commands
  - Config: `backend/pyproject.toml`
  - Test runner: pytest with asyncio mode auto
  
- Frontend: npm manages Node.js dependencies
  - Config: `frontend/package.json`
  - TypeScript: `frontend/tsconfig.json` (ES2017 target, path aliases `@/*` → `src/*`)
  - Next.js: `frontend/next.config.ts` (Turbopack, standalone output)
  - PostCSS: `frontend/postcss.config.mjs` (Tailwind v4 plugin)
  - ESLint: `frontend/eslint.config.mjs` (version 9)
  - Tailwind: No separate `tailwind.config.js` (uses PostCSS plugin defaults)
  - Shadcn/ui: `frontend/components.json` (for component scaffolding)

## Platform Requirements

**Development:**
- Python 3.11.9 (backend)
- PostgreSQL 12+ (localhost:5432 by default)
- Node.js 18+ (frontend, inferred)
- POSIX-compatible shell (bash)

**API Keys Required (Environment):**
- OpenAI: `OPENAI_API_KEY` (LLM for transaction extraction)
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (Gmail primary)
- Google (secondary): `GOOGLE_CLIENT_ID_2`, `GOOGLE_CLIENT_SECRET_2`, `GOOGLE_REFRESH_TOKEN_2` (optional)
- Google Cloud: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS` (path to service account key)
- LandingAI: `VISION_AGENT_API_KEY` (document extraction)
- Splitwise: `SPLITWISE_API_KEY` (split expense sync)

**Authentication:**
- JWT: `JWT_SECRET_KEY`, `JWT_ALGORITHM` (HS256)
- Basic auth fallback: `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`

**Production Deployment:**
- Container runtime (Docker implied by CLAUDE.md references)
- Cloud storage: Google Cloud Storage (mandatory for statement archive)
- Database: PostgreSQL (managed or self-hosted)
- API rate limiting: Built-in via slowapi

---

*Stack analysis: 2026-08-09*
