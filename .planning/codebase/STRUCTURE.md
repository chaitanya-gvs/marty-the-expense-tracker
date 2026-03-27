# Codebase Structure

**Analysis Date:** 2026-03-27

## Directory Layout

```
expense-tracker/                      # Monorepo root
├── backend/                          # Python FastAPI backend
│   ├── main.py                       # App entry point (FastAPI + router mounts)
│   ├── pyproject.toml                # Poetry dependencies + ruff/pytest config
│   ├── alembic.ini                   # Alembic migration config
│   ├── configs/
│   │   ├── .env                      # Primary app config (non-secret)
│   │   └── secrets/                  # client_secret.json, gcs_service_account_key.json, secrets/.env
│   ├── data/
│   │   ├── statements/
│   │   │   ├── locked_statements/    # Downloaded PDFs (pre-unlock)
│   │   │   └── unlocked_statements/  # Decrypted PDFs (post-unlock)
│   │   ├── extracted_data/           # CSV output from document extractor
│   │   └── backups/                  # DB dump files
│   ├── logs/                         # Rotating log files (not committed)
│   ├── scripts/                      # Standalone operational scripts
│   ├── tests/                        # Pytest test files
│   └── src/
│       ├── apis/
│       │   ├── routes/               # FastAPI route handlers (one file per domain)
│       │   └── schemas/              # Pydantic request/response schemas
│       ├── services/
│       │   ├── database_manager/
│       │   │   ├── connection.py     # Async engine, session factory
│       │   │   ├── models/           # SQLAlchemy ORM models
│       │   │   ├── operations/       # Static DB operation classes
│       │   │   ├── migrations/       # Alembic env.py + versions/
│       │   │   └── schemas.py        # Internal DB-level Pydantic schemas
│       │   ├── orchestrator/         # Pipeline orchestration + standardization
│       │   ├── email_ingestion/      # Gmail API client + auth
│       │   ├── statement_processor/  # PDF unlock, page filter, LLM extraction
│       │   ├── splitwise_processor/  # Splitwise API client + sync
│       │   ├── cloud_storage/        # GCS upload/download
│       │   └── ocr_engine/           # OCR engine wrapper
│       └── utils/
│           ├── settings.py           # Pydantic settings singleton
│           ├── logger.py             # Custom rotating logger
│           ├── db_utils.py           # DB error handling wrapper
│           ├── transaction_utils.py  # DB→API response converters
│           ├── filename_utils.py     # GCS path helpers
│           └── password_manager.py   # Account password lookup
│
└── frontend/                         # Next.js 15 frontend
    ├── package.json
    ├── next.config.ts
    ├── tsconfig.json                  # Path alias: @/* → src/*
    ├── components.json                # shadcn/ui config
    ├── postcss.config.mjs             # Tailwind CSS v4 PostCSS plugin
    └── src/
        ├── app/                       # Next.js App Router pages
        │   ├── layout.tsx             # Root layout (fonts, Providers)
        │   ├── page.tsx               # Root → redirect to /transactions
        │   ├── globals.css            # Tailwind + OkLCH CSS custom properties
        │   ├── transactions/page.tsx
        │   ├── settlements/page.tsx
        │   ├── analytics/page.tsx
        │   ├── budgets/page.tsx
        │   ├── review/page.tsx
        │   └── settings/page.tsx
        ├── components/
        │   ├── providers.tsx          # QueryClient + ThemeProvider + Toaster
        │   ├── theme-toggle.tsx
        │   ├── layout/                # MainLayout + Navigation (hover-overlay sidebar)
        │   ├── transactions/          # All transaction UI components (table, modals, drawers, inline)
        │   ├── analytics/             # Analytics charts and filters
        │   ├── budgets/               # Budget list and overview
        │   ├── settlements/           # Settlement tabs and filters
        │   ├── settings/              # Category and tag managers
        │   ├── review/                # Review queue for flagged transactions
        │   ├── split-editor/          # Reusable split editor
        │   ├── workflow/              # Workflow SSE progress sheet
        │   └── ui/                    # Radix UI primitives + custom modal
        │       └── modal/             # Custom modal (use over Radix Dialog)
        ├── hooks/                     # TanStack React Query wrappers
        ├── lib/
        │   ├── api/
        │   │   ├── client.ts          # Singleton ApiClient class
        │   │   └── types/workflow.ts  # Workflow-specific request/response types
        │   ├── types/index.ts         # All canonical TypeScript interfaces
        │   ├── format-utils.ts        # formatCurrency(), formatDate()
        │   ├── utils.ts               # cn() class merge helper
        │   └── workflow-tasks.ts      # SSE event → task tree builder
        └── store/                     # Global state (currently unused/minimal)
```

## Directory Purposes

**`backend/src/apis/routes/`:**
- Purpose: HTTP boundary — only request parsing, validation, delegation to services
- Contains: `transaction_read_routes.py`, `transaction_write_routes.py`, `transaction_split_routes.py`, `settlement_routes.py`, `participant_routes.py`, `workflow_routes.py`, `splitwise_routes.py`
- Key pattern: Routes do not contain business logic; they call Operations classes

**`backend/src/apis/schemas/`:**
- Purpose: Pydantic models for API request/response contracts
- Contains: `common.py` (`ApiResponse`), `transactions.py`, `settlements.py`, `participants.py`, `workflow.py`

**`backend/src/services/database_manager/operations/`:**
- Purpose: All SQL/ORM queries, organized by entity
- Key files: `transaction_operations.py` (heaviest), `category_operations.py`, `account_operations.py`, `tag_operations.py`, `participant_operations.py`, `statement_log_operations.py`, `suggestion_operations.py`
- All re-exported via `operations/__init__.py`

**`backend/src/services/database_manager/models/`:**
- Purpose: SQLAlchemy declarative ORM models
- Key files: `transaction.py`, `account.py`, `category.py`, `tag.py`, `participant.py`, `statement_processing_log.py`, `transaction_tag.py`

**`backend/src/services/orchestrator/`:**
- Purpose: Statement processing pipeline coordination
- Key files: `statement_workflow.py` (main orchestrator), `transaction_standardizer.py`, `csv_processor.py`
- Helpers: `statement_extractor_helper.py`, `splitwise_processor_helper.py`, `data_standardizer_helper.py`

**`backend/src/services/statement_processor/`:**
- Purpose: PDF handling and LLM-based extraction
- Key files: `pdf_unlocker.py`, `pdf_page_filter.py`, `document_extractor.py` (agentic-doc), `schemas.py`

**`frontend/src/app/`:**
- Purpose: Next.js App Router pages — one file per route, all are thin wrappers
- Pattern: `page.tsx` imports one feature component and wraps in `<MainLayout>`

**`frontend/src/components/transactions/`:**
- Purpose: Largest component domain — all transaction UI
- Contains: Table, detail drawer, edit modal, add modal, bulk edit, split editor, group expense modals, inline editing, email links, PDF viewer, tag/category selectors, transfer chips

**`frontend/src/components/ui/`:**
- Purpose: Reusable primitives from Radix UI, styled with Tailwind
- Important: `modal/index.tsx` is the custom modal — always use this instead of raw Radix `Dialog` for modal overlays

**`frontend/src/hooks/`:**
- Purpose: One hook file per data domain
- Files: `use-transactions.ts`, `use-categories.ts`, `use-tags.ts`, `use-accounts.ts`, `use-participants.ts`, `use-settlements.ts`, `use-analytics.ts`, `use-budgets.ts`, `use-workflow.ts`, `use-debounce.ts`, `use-local-storage.ts`, `use-transaction-keyboard-nav.ts`

**`frontend/src/lib/`:**
- Purpose: Pure utilities and types — no React
- `api/client.ts` is the only file that imports from external HTTP libraries

## Key File Locations

**Entry Points:**
- `backend/main.py`: FastAPI app creation and router registration
- `frontend/src/app/layout.tsx`: Root Next.js layout (fonts, providers)
- `frontend/src/app/page.tsx`: Root redirect to `/transactions`

**Configuration:**
- `backend/src/utils/settings.py`: All backend config via `get_settings()`
- `backend/configs/.env`: Non-secret env vars
- `frontend/.env.local`: `NEXT_PUBLIC_API_URL` (not committed; see `.env.local.example`)
- `backend/alembic.ini`: Alembic migration connection string

**Core Logic:**
- `backend/src/services/orchestrator/statement_workflow.py`: Statement pipeline orchestrator
- `backend/src/services/database_manager/operations/transaction_operations.py`: All transaction DB queries
- `backend/src/services/database_manager/connection.py`: Async engine + session factory
- `frontend/src/lib/api/client.ts`: All frontend→backend HTTP calls
- `frontend/src/lib/types/index.ts`: All canonical TypeScript interfaces

**Database:**
- `backend/src/services/database_manager/models/transaction.py`: Core transaction model
- `backend/src/services/database_manager/migrations/versions/`: Alembic migration files

**Testing:**
- `backend/tests/test_api_integration.py`: API integration tests
- `backend/tests/test_settlement_calculations.py`: Settlement logic tests
- `backend/tests/test_workflow_orchestrator.py`: Workflow orchestration tests

## Naming Conventions

**Backend Files:**
- Routes: `{domain}_routes.py` (e.g., `transaction_read_routes.py`, `settlement_routes.py`)
- Models: singular noun (e.g., `transaction.py`, `category.py`)
- Operations: `{domain}_operations.py` (e.g., `transaction_operations.py`)
- Services: descriptive module name (e.g., `statement_workflow.py`, `gcs_service.py`)
- Helpers: `{domain}_helper.py` (e.g., `statement_extractor_helper.py`)

**Backend Classes:**
- Operations: `{Domain}Operations` (e.g., `TransactionOperations`, `CategoryOperations`)
- Services: `{Name}Service`, `{Name}Workflow`, `{Name}Client` (e.g., `SplitwiseService`, `StatementWorkflow`, `EmailClient`)

**Frontend Files:**
- Pages: `page.tsx` (Next.js convention)
- Components: `kebab-case.tsx` (e.g., `transactions-table.tsx`, `add-transaction-modal.tsx`)
- Hooks: `use-{domain}.ts` (e.g., `use-transactions.ts`, `use-settlements.ts`)
- Types/utils: `kebab-case.ts` (e.g., `format-utils.ts`, `workflow-tasks.ts`)

**Frontend Directories:**
- Feature components: `src/components/{feature}/` (plural domain name)
- Pages: `src/app/{route}/page.tsx`

## Where to Add New Code

**New Backend API Endpoint:**
1. Add route handler to appropriate file in `backend/src/apis/routes/` (or create `{domain}_routes.py`)
2. Add Pydantic schemas to `backend/src/apis/schemas/{domain}.py`
3. Add DB operation static methods to `backend/src/services/database_manager/operations/{domain}_operations.py`
4. Register new router in `backend/main.py` if it's a new domain
5. Tests: `backend/tests/test_api_integration.py`

**New Frontend Feature:**
1. Create feature components in `frontend/src/components/{feature}/`
2. Create hooks in `frontend/src/hooks/use-{feature}.ts`
3. Add API methods to `frontend/src/lib/api/client.ts`
4. Add TypeScript types to `frontend/src/lib/types/index.ts`
5. Create page at `frontend/src/app/{route}/page.tsx` wrapping main component in `<MainLayout>`

**New Database Model:**
1. Create SQLAlchemy model in `backend/src/services/database_manager/models/{name}.py`
2. Import in `backend/src/services/database_manager/models/__init__.py`
3. Generate migration: `poetry run alembic revision --autogenerate -m "description"` from `backend/`
4. Apply: `poetry run alembic upgrade head`

**New Utility Function:**
- Shared backend helpers: `backend/src/utils/` (pick closest file or create new `{domain}_utils.py`)
- Frontend formatting: `frontend/src/lib/format-utils.ts`
- Frontend class merging: `frontend/src/lib/utils.ts` (`cn()`)

## Special Directories

**`backend/data/`:**
- Purpose: Local file storage for PDFs and extracted CSVs during workflow processing
- Generated: Yes (created by workflow)
- Committed: No (in `.gitignore`)

**`backend/logs/`:**
- Purpose: Rotating log files from `backend/src/utils/logger.py`
- Generated: Yes
- Committed: No

**`backend/configs/secrets/`:**
- Purpose: Google OAuth client secrets and GCS service account key
- Generated: No (manually placed)
- Committed: No (gitignored)

**`backend/src/services/database_manager/migrations/versions/`:**
- Purpose: Alembic migration scripts (one file per schema change)
- Generated: Yes (`alembic revision --autogenerate`)
- Committed: Yes

**`frontend/src/components/ui/`:**
- Purpose: Primitive UI components from shadcn/ui (Radix + Tailwind)
- Generated: Partially (shadcn CLI adds files here)
- Committed: Yes (treated as source code, can be modified)

**`.planning/`:**
- Purpose: GSD planning documents — codebase maps, phase plans
- Generated: Yes (by Claude Code agents)
- Committed: Optionally (project planning artifacts)

---

*Structure analysis: 2026-03-27*
