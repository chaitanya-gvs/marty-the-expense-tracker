### Expense Tracker Backend (MVP)

FastAPI backend for an LLM-powered personal expense tracker.

### Quickstart

- Install deps: `poetry install`
- Run dev: `poetry run uvicorn main:app --reload`
- Docs: `http://localhost:8000/docs`

### Env (.env at `backend/configs/.env`)

APP_ENV=dev
APP_NAME=expense-tracker
LOG_LEVEL=INFO
OPENAI_API_KEY=
DB_HOST=localhost
DB_PORT=5432
DB_NAME=expense_db
DB_USER=postgres
DB_PASSWORD=postgres
REDIS_URL=redis://localhost:6379/0
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_PROJECT_ID=
GOOGLE_REDIRECT_URI=http://localhost:8000/api/upload/gmail/oauth/callback
SENTRY_DSN=


