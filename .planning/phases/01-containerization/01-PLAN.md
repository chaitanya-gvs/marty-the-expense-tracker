---
phase: 01-containerization
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/Dockerfile
  - backend/.dockerignore
  - backend/entrypoint.sh
  - frontend/Dockerfile
  - frontend/.dockerignore
  - frontend/next.config.ts
  - docker-compose.yml
  - docker-compose.prod.yml
  - caddy/Caddyfile
  - .env.example
  - backend/.env.example
  - .gitignore
  - backend/src/utils/settings.py
  - Makefile
  - scripts/migrate-data.sh
  - scripts/server-setup.sh
autonomous: true
requirements:
  - CONTAINERIZE-01
  - CONTAINERIZE-02
  - CONTAINERIZE-03
  - CONTAINERIZE-04
  - CONTAINERIZE-05
  - CONTAINERIZE-06
  - CONTAINERIZE-07
  - CONTAINERIZE-08

must_haves:
  truths:
    - "docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d starts all 5 services (postgres, backend, frontend, caddy, pgbackups) without errors"
    - "curl http://<server-ip>/healthz returns {\"status\": \"ok\"} (routed through Caddy to backend)"
    - "curl http://<server-ip>/api/transactions returns a JSON array (Caddy proxies /api/* to backend:8000)"
    - "Browser loads http://<server-ip> and renders the transactions page (Caddy proxies / to frontend:3000)"
    - "make deploy on the server pulls git, rebuilds images, and restarts containers"
    - "Automated backups exist in the pgbackups volume after first run"
    - "Existing transaction data is present after pg_dump/pg_restore migration"
  artifacts:
    - path: "backend/Dockerfile"
      provides: "Multi-stage FastAPI image with tesseract, poppler, libmagic"
      contains: "python:3.11-slim-bookworm"
    - path: "frontend/Dockerfile"
      provides: "Multi-stage Next.js standalone image"
      contains: "output: standalone"
    - path: "docker-compose.prod.yml"
      provides: "Production override (postgres, backend, frontend, caddy, pgbackups)"
    - path: "caddy/Caddyfile"
      provides: "IP-based HTTP reverse proxy routing"
    - path: "Makefile"
      provides: "Ops commands: up, down, deploy, restart, logs, backup, migrate, shell-backend, shell-db, caddy-reload"
    - path: ".env.example"
      provides: "All required environment variables with descriptions (no secrets)"
    - path: "scripts/migrate-data.sh"
      provides: "pg_dump + scp + pg_restore procedure"
    - path: "scripts/server-setup.sh"
      provides: "Hetzner Ubuntu 22.04 initial setup + Docker install"
  key_links:
    - from: "caddy/Caddyfile"
      to: "backend:8000"
      via: "reverse_proxy on /api/* and /healthz"
      pattern: "reverse_proxy backend:8000"
    - from: "caddy/Caddyfile"
      to: "frontend:3000"
      via: "reverse_proxy catch-all"
      pattern: "reverse_proxy frontend:3000"
    - from: "docker-compose.prod.yml backend service"
      to: "postgres service"
      via: "depends_on: condition: service_healthy"
      pattern: "service_healthy"
    - from: "frontend/Dockerfile runner stage"
      to: "next build standalone output"
      via: "COPY .next/standalone and .next/static"
      pattern: "HOSTNAME.*0.0.0.0"
---

<objective>
Build the complete Docker containerization for the expense tracker — backend Dockerfile, frontend Dockerfile, production compose, Caddy reverse proxy, Makefile ops tooling, data migration scripts, and server setup guide. After executing this plan, the application is deployable to a Hetzner VPS with a single `make deploy` command.

Purpose: Migrate the app from local Mac development to a self-hosted Hetzner VPS running Ubuntu 22.04. The containerized setup enables reproducible deployments, automated database backups, and a clear path to add a custom domain with TLS later.

Output:
- backend/Dockerfile (multi-stage, python:3.11-slim-bookworm, tesseract + poppler system deps)
- frontend/Dockerfile (multi-stage, Next.js standalone mode)
- frontend/next.config.ts (updated with output: 'standalone')
- docker-compose.yml (dev base — complete service definitions)
- docker-compose.prod.yml (production overrides — only what differs from dev)
- caddy/Caddyfile (IP-based HTTP routing)
- .env.example (root-level, all vars documented)
- backend/.env.example (backend-specific vars)
- .gitignore (ensure .env is listed)
- backend/src/utils/settings.py (add VISION_AGENT_API_KEY field)
- Makefile (up/down/deploy/logs/backup/migrate/shell targets)
- scripts/migrate-data.sh (pg_dump → scp → pg_restore procedure)
- scripts/server-setup.sh (Hetzner Ubuntu 22.04 bootstrap)
- backend/entrypoint.sh (alembic upgrade head + uvicorn)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@backend/main.py
@backend/src/utils/settings.py
@backend/configs/.env
@frontend/next.config.ts
@frontend/.env.local.example
@.planning/phases/01-containerization/01-RESEARCH.md
</context>

<interfaces>
<!-- Key facts extracted from the codebase. Use these directly. -->

From backend/src/utils/settings.py:
- Settings reads from TWO env files: configs/secrets/.env (first, takes precedence) then configs/.env
- Pydantic-settings priority: environment variables > env_file — so passing env vars via docker-compose environment: section overrides the files
- DB defaults: DB_HOST=localhost, DB_PORT=5432, DB_NAME=expense_tracker, DB_USER=chaitanya
- GOOGLE_CLIENT_SECRET_FILE defaults to None — set to /app/configs/secrets/client_secret.json in container
- GOOGLE_APPLICATION_CREDENTIALS — set to /run/secrets/gcs_key in container
- VISION_AGENT_API_KEY is NOT in settings.py yet — needs adding as str | None = None (Task 5 handles this)
- SPLITWISE_CONSUMER_KEY and SPLITWISE_CONSUMER_SECRET referenced in configs/.env comment — not in settings.py class, but pydantic extra="ignore" means they won't error, just unused via Settings

From backend/src/utils/logger.py:
- LOG_DIRECTORY defaults to "logs" (relative path, resolved from cwd which is /app in container)
- Writes RotatingFileHandler to logs/expense-tracker.log — needs named volume backend_logs:/app/logs

From backend/src/services/email_ingestion/token_manager.py:
- OAuth tokens are stored as GOOGLE_REFRESH_TOKEN env var (NOT written to token files)
- save_refreshed_tokens() writes to configs/secrets/.env — this file will be bind-mounted :ro, so that method will fail silently in container (acceptable — refresh tokens come from env vars anyway)
- No named volume needed for OAuth tokens (no token files on disk)

From backend/configs/.env (non-secret config):
- REDIS_URL=redis://localhost:6379/0 — Redis is NOT in the compose design; this var exists but is unused by any active code path (no redis client in pyproject.toml); leave in .env.example as commented-out optional
- GOOGLE_CLIENT_SECRET_FILE=configs/secrets/client_secret.json — override in container to /app/configs/secrets/client_secret.json
- GOOGLE_CLOUD_PROJECT_ID=expense-tracker-470706
- GOOGLE_CLOUD_BUCKET_NAME=marty-the-expense-tracker
- ENABLE_SECONDARY_ACCOUNT=true

DB name discrepancy:
- settings.py default: expense_tracker
- CLAUDE.md and configs/.env comment: expense_db
- Resolution: The actual running DB name lives in configs/secrets/.env (not committed)
  The plan instructs executor to confirm with `psql -l` before pg_dump
  Use expense_db as the presumed name in examples; all compose vars use ${POSTGRES_DB}

From backend/main.py:
- allow_origins=["*"] — note this in .env.example as CORS_ORIGINS var to add to settings for future hardening; do NOT change main.py in this plan (separate concern)
- /healthz endpoint exists at root (not /api/healthz) — Caddy routes /healthz directly to backend:8000

Compose file relationship (important):
- docker-compose.yml is the COMPLETE base with all service definitions (used for dev with bind mounts)
- docker-compose.prod.yml is a PARTIAL override — only fields that differ in production
- Production is launched with BOTH files: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
- The Makefile COMPOSE variable must be: docker compose -f docker-compose.yml -f docker-compose.prod.yml
- Running docker-compose.prod.yml alone is INVALID — it is not a standalone compose file
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Backend Dockerfile, entrypoint, and .dockerignore</name>
  <files>
    backend/Dockerfile
    backend/entrypoint.sh
    backend/.dockerignore
  </files>
  <action>
Create three files in backend/:

**backend/Dockerfile** — Two-stage build. Builder installs Poetry 2.1.3 and creates a venv; runtime copies venv + installs system deps.

```dockerfile
# ---- Builder ----
FROM python:3.11-slim-bookworm AS builder

ENV POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1 \
    POETRY_CACHE_DIR=/tmp/.poetry

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==2.1.3

WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN poetry install --no-root --only main

# ---- Runtime ----
FROM python:3.11-slim-bookworm AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libmagic1 \
    libgl1 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

COPY --from=builder /app/.venv /app/.venv
COPY --chown=appuser:appgroup . .

RUN chmod +x /app/entrypoint.sh

USER appuser

EXPOSE 8000
CMD ["/app/entrypoint.sh"]
```

Important: `libgl1` is required by PyMuPDF (OpenCV dependency). `tesseract-ocr-eng` is the English language pack — separate from the binary. `libmagic1` supports python-magic file type detection. `libpq5` is the PostgreSQL runtime client library (not dev headers).

**backend/entrypoint.sh** — Runs migrations then starts the server:

```bash
#!/bin/bash
set -e

echo "Running Alembic migrations..."
alembic upgrade head

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

**backend/.dockerignore** — Excludes build artifacts and secrets from the Docker build context (secrets are bind-mounted at runtime, not baked into the image):

```
__pycache__/
*.pyc
*.pyo
.venv/
.git/
*.md
logs/
data/statements/
data/backups/
data/extracted_data/
.pytest_cache/
tests/
configs/secrets/
```

Note: `configs/secrets/` is excluded so secret files are never in the build context. They are bind-mounted at runtime in docker-compose.prod.yml.
  </action>
  <verify>
    <automated>cd /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker && docker build -t expense-backend-test ./backend && docker run --rm --entrypoint="" expense-backend-test ls -la /app/entrypoint.sh && docker rmi expense-backend-test</automated>
  </verify>
  <done>
    - backend/Dockerfile builds successfully with `docker build ./backend`
    - Image contains tesseract-ocr: `docker run --rm expense-backend-test tesseract --version` shows version output
    - Image contains poppler: `docker run --rm expense-backend-test pdfinfo --version` shows version
    - entrypoint.sh is executable in the image: `docker run --rm --entrypoint="" expense-backend-test ls -la /app/entrypoint.sh` shows `-rwxr-xr-x`
    - configs/secrets/ is not in the image (verified by checking .dockerignore)
  </done>
</task>

<task type="auto">
  <name>Task 2: Frontend Dockerfile, next.config.ts update, and .dockerignore</name>
  <files>
    frontend/Dockerfile
    frontend/.dockerignore
    frontend/next.config.ts
  </files>
  <action>
Create/update three files in frontend/:

**frontend/next.config.ts** — Add `output: 'standalone'`. This is REQUIRED for the multi-stage Docker build. The current file only has an empty config object:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

**frontend/Dockerfile** — Three-stage build: deps (npm ci), builder (next build with build ARG for API URL), runner (standalone output only).

Critical notes embedded as comments:
- `NEXT_PUBLIC_API_URL` MUST be passed as a build ARG — it's baked into the JS bundle at build time by Next.js
- `HOSTNAME=0.0.0.0` MUST be set — without it, server.js binds to 127.0.0.1 and is unreachable from the Docker bridge network
- `.next/static` and `public/` MUST be copied manually — standalone output does NOT include them

```dockerfile
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are baked into the JS bundle at build time.
# This MUST be set before `npm run build` or all API calls will point to undefined.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_ENV=production
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# CRITICAL: Without HOSTNAME=0.0.0.0, server.js binds to 127.0.0.1
# and is unreachable from other containers on the Docker bridge network.
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next

# Standalone output: server.js + minimal node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are NOT included in standalone by default — must copy manually
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

**frontend/.dockerignore**:

```
node_modules/
.next/
.git/
*.md
.env*
```
  </action>
  <verify>
    <automated>cd /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker && docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost/api -t expense-frontend-test ./frontend && docker rmi expense-frontend-test</automated>
  </verify>
  <done>
    - frontend/next.config.ts contains `output: 'standalone'`
    - frontend/Dockerfile builds successfully with `docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost/api ./frontend`
    - Build completes all three stages (deps, builder, runner)
    - Image runs `node server.js` as CMD
  </done>
</task>

<task type="auto">
  <name>Task 3: Docker Compose files (base + prod override)</name>
  <files>
    docker-compose.yml
    docker-compose.prod.yml
  </files>
  <action>
Create two files at the repo root. IMPORTANT: These two files work together as base + override. Production is always launched with BOTH files: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`. Running docker-compose.prod.yml alone will fail — it is not a standalone file.

**docker-compose.yml** — COMPLETE dev/base configuration. Defines the full service topology. In production, docker-compose.prod.yml overrides only what differs.

The dev backend volume bind-mount must NOT mount `./backend:/app` wholesale — that would overwrite the container's .venv with the host directory. Instead, mount only source files and use a named volume for .venv:

```yaml
# docker-compose.yml — Development / Base
# Complete service definitions. Used as-is for local dev with bind mounts and hot reload.
# Production uses BOTH files: docker compose -f docker-compose.yml -f docker-compose.prod.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-expense_db}
      POSTGRES_USER: ${POSTGRES_USER:-chaitanya}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-chaitanya} -d ${POSTGRES_DB:-expense_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    volumes:
      # Mount only source files — avoids overwriting the container's .venv
      - ./backend/src:/app/src
      - ./backend/main.py:/app/main.py
      - ./backend/alembic.ini:/app/alembic.ini
      - ./backend/configs:/app/configs
      # Named volume preserves the container's .venv across restarts
      - venv_data:/app/.venv
      - backend_logs:/app/logs
    environment:
      - APP_ENV=dev
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=${POSTGRES_DB:-expense_db}
      - DB_USER=${POSTGRES_USER:-chaitanya}
      - DB_PASSWORD=${POSTGRES_PASSWORD:-}
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "8000:8000"
    networks:
      - internal

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: http://localhost:8000/api
    environment:
      - NEXT_PUBLIC_APP_ENV=development
    depends_on:
      - backend
    ports:
      - "3000:3000"
    networks:
      - internal

networks:
  internal:
    driver: bridge

volumes:
  postgres_data:
  backend_logs:
  venv_data:
```

**docker-compose.prod.yml** — PARTIAL production override. Only contains fields that differ from docker-compose.yml. Must be used together with docker-compose.yml — never alone. The Makefile COMPOSE variable handles this automatically.

In production: backend and frontend have no host ports (only Caddy is externally reachable). Backend uses image bind-mounts for secrets only (no source files — the image is used as built). Caddy and pgbackups services are added here since they don't exist in the dev base.

```yaml
# docker-compose.prod.yml — Production overrides
# IMPORTANT: This is an OVERRIDE file, not a standalone compose file.
# Always use with the base: docker compose -f docker-compose.yml -f docker-compose.prod.yml
# The Makefile COMPOSE variable handles this automatically.
services:
  postgres:
    restart: unless-stopped
    ports: []  # No host ports in production — postgres is internal-only

  backend:
    restart: unless-stopped
    # In production: no source bind-mounts, use image as built.
    # Only secrets and logs volumes are mounted.
    volumes:
      - ./backend/configs/secrets/gcs_service_account_key.json:/run/secrets/gcs_key:ro
      - ./backend/configs/secrets/client_secret.json:/app/configs/secrets/client_secret.json:ro
      # Secondary Gmail account client secret. If secondary account is unused,
      # create an empty file to avoid mount errors:
      #   touch backend/configs/secrets/client_secret_2.json
      - ./backend/configs/secrets/client_secret_2.json:/app/configs/secrets/client_secret_2.json:ro
      - backend_logs:/app/logs
    environment:
      - APP_ENV=production
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=${POSTGRES_DB}
      - DB_USER=${POSTGRES_USER}
      - DB_PASSWORD=${POSTGRES_PASSWORD}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - VISION_AGENT_API_KEY=${VISION_AGENT_API_KEY}
      - GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs_key
      - GOOGLE_CLOUD_PROJECT_ID=${GOOGLE_CLOUD_PROJECT_ID}
      - GOOGLE_CLOUD_BUCKET_NAME=${GOOGLE_CLOUD_BUCKET_NAME}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN}
      - GOOGLE_PROJECT_ID=${GOOGLE_PROJECT_ID}
      - GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}
      - GOOGLE_CLIENT_SECRET_FILE=/app/configs/secrets/client_secret.json
      - GOOGLE_CLIENT_ID_2=${GOOGLE_CLIENT_ID_2}
      - GOOGLE_CLIENT_SECRET_2=${GOOGLE_CLIENT_SECRET_2}
      - GOOGLE_REFRESH_TOKEN_2=${GOOGLE_REFRESH_TOKEN_2}
      - GOOGLE_CLIENT_SECRET_FILE_2=/app/configs/secrets/client_secret_2.json
      - SPLITWISE_CONSUMER_KEY=${SPLITWISE_CONSUMER_KEY}
      - SPLITWISE_CONSUMER_SECRET=${SPLITWISE_CONSUMER_SECRET}
      - CURRENT_USER_NAMES=${CURRENT_USER_NAMES:-me,chaitanya gvs,chaitanya}
      - SENTRY_DSN=${SENTRY_DSN}
      - ENABLE_SECONDARY_ACCOUNT=${ENABLE_SECONDARY_ACCOUNT:-true}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
    ports: []  # No host ports — only Caddy is externally reachable

  frontend:
    restart: unless-stopped
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: http://${SERVER_IP}/api
        NEXT_PUBLIC_APP_ENV: production
    ports: []  # No host ports — only Caddy is externally reachable

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - internal
    depends_on:
      - backend
      - frontend

  pgbackups:
    image: prodrigestivill/postgres-backup-local
    restart: unless-stopped
    user: postgres:postgres
    volumes:
      - pgbackups:/backups
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - POSTGRES_HOST=postgres
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_EXTRA_OPTS=-Z1 --schema=public --blobs
      - SCHEDULE=@daily
      - BACKUP_ON_START=TRUE
      - BACKUP_KEEP_DAYS=7
      - BACKUP_KEEP_WEEKS=4
      - BACKUP_KEEP_MONTHS=6
    networks:
      - internal

volumes:
  caddy_data:
  caddy_config:
  pgbackups:
```

Note on `ports: []` pattern: In docker-compose.prod.yml overrides, setting `ports: []` on backend and frontend removes the host port bindings from the base file. Only Caddy exposes 80/443 to the host. This means even if UFW is misconfigured, the backend and database are not reachable from outside.
  </action>
  <verify>
    <automated>cd /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker && docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet && echo "Compose config valid"</automated>
  </verify>
  <done>
    - docker-compose.yml is a complete standalone file (parseable alone)
    - docker-compose.prod.yml is a partial override (only overrides what differs from dev)
    - Both files together parse without errors: `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`
    - Production compose has exactly one service with `ports:` (caddy)
    - postgres, backend, frontend all have `networks: internal` or inherit it
    - pgbackups service is present with BACKUP_ON_START=TRUE and daily schedule
    - backend depends_on postgres with condition: service_healthy
    - client_secret_2.json has a volume mount in the backend service in docker-compose.prod.yml
    - GOOGLE_CLIENT_SECRET_FILE_2 is set to /app/configs/secrets/client_secret_2.json (not a raw env var passthrough)
    - dev backend volumes mount src/, main.py, alembic.ini, configs/ separately (not ./backend:/app wholesale)
    - venv_data named volume is declared to preserve .venv in dev
  </done>
</task>

<task type="auto">
  <name>Task 4: Caddy configuration and caddy/ directory</name>
  <files>
    caddy/Caddyfile
  </files>
  <action>
Create caddy/ directory and Caddyfile:

**caddy/Caddyfile** — IP-based HTTP-only reverse proxy. Routes `/api/*` and `/healthz` to backend:8000; everything else to frontend:3000. Service names work as upstream addresses because all services share the `internal` Docker bridge network.

```caddyfile
# caddy/Caddyfile
#
# IP-based HTTP-only configuration (no domain yet).
# To upgrade to HTTPS with a domain, replace ":80 {" with "yourdomain.com {"
# and Caddy will automatically obtain a Let's Encrypt certificate.
# No other changes required.

:80 {
    # Backend: API routes and health check
    handle /api/* {
        reverse_proxy backend:8000
    }

    handle /healthz {
        reverse_proxy backend:8000
    }

    # Frontend: catch-all (must come last)
    handle {
        reverse_proxy frontend:3000
    }
}
```

The `handle` directive (not `handle_path`) preserves the full URI when proxying to the backend — so `/api/transactions` is forwarded as-is to `backend:8000/api/transactions`, matching the FastAPI router mounts in main.py (`app.include_router(..., prefix="/api")`).

Note: When a domain is added, the TLS upgrade is a 1-line change: replace `:80 {` with `yourdomain.com {`. Caddy handles certificate issuance and renewal automatically. Document this clearly in a comment in the file.
  </action>
  <verify>
    <automated>cat /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/caddy/Caddyfile | grep -q "reverse_proxy backend:8000" && cat /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/caddy/Caddyfile | grep -q "reverse_proxy frontend:3000" && echo "Caddyfile routing verified"</automated>
  </verify>
  <done>
    - caddy/Caddyfile exists with three handle blocks: /api/*, /healthz, and catch-all
    - Comment explains the 1-line TLS upgrade path
    - handle (not handle_path) is used to preserve URI for backend proxy
  </done>
</task>

<task type="auto">
  <name>Task 5: Environment configuration, .gitignore, and settings.py VISION_AGENT_API_KEY</name>
  <files>
    .env.example
    backend/.env.example
    .gitignore
    backend/src/utils/settings.py
  </files>
  <action>
Create/update four files:

**backend/src/utils/settings.py** — Add `VISION_AGENT_API_KEY` field to the Settings class. Read the existing file first, then add the field after `SENTRY_DSN`. This makes the field explicit in Settings rather than silently None via pydantic's extra="ignore":

```python
SENTRY_DSN: str | None = None
VISION_AGENT_API_KEY: str | None = None
```

Add only this one line after the SENTRY_DSN field. Do not modify anything else in settings.py.

**.env.example** — Root-level, covers all variables consumed by docker-compose.prod.yml. This is what you copy to `.env` on the server and fill in.

```bash
# .env.example
# Copy to .env on the server and fill in all values.
# DO NOT commit .env to git.

# ============================================================
# Server
# ============================================================
# The public IP of the Hetzner VPS (no http://, no trailing slash)
# Used to bake NEXT_PUBLIC_API_URL into the frontend at build time.
SERVER_IP=

# ============================================================
# Database
# ============================================================
POSTGRES_DB=expense_db
POSTGRES_USER=chaitanya
POSTGRES_PASSWORD=

# ============================================================
# Application
# ============================================================
APP_ENV=production
LOG_LEVEL=INFO
ENABLE_SECONDARY_ACCOUNT=true
CURRENT_USER_NAMES=me,chaitanya gvs,chaitanya

# ============================================================
# OpenAI / LLM
# ============================================================
OPENAI_API_KEY=

# agentic-doc (LandingAI) — used by document_extractor.py
VISION_AGENT_API_KEY=

# ============================================================
# Google Cloud Storage
# ============================================================
GOOGLE_CLOUD_PROJECT_ID=expense-tracker-470706
GOOGLE_CLOUD_BUCKET_NAME=marty-the-expense-tracker
# GOOGLE_APPLICATION_CREDENTIALS is set to /run/secrets/gcs_key in compose
# (the JSON key file is bind-mounted from backend/configs/secrets/)

# ============================================================
# Gmail API — Primary Account
# ============================================================
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_PROJECT_ID=expense-tracker-470706
GOOGLE_REDIRECT_URI=http://localhost:8000/api/mail/oauth/callback
# client_secret.json is bind-mounted from backend/configs/secrets/
# GOOGLE_CLIENT_SECRET_FILE is set to /app/configs/secrets/client_secret.json in compose

# ============================================================
# Gmail API — Secondary Account (optional)
# ============================================================
GOOGLE_CLIENT_ID_2=
GOOGLE_CLIENT_SECRET_2=
GOOGLE_REFRESH_TOKEN_2=
# GOOGLE_CLIENT_SECRET_FILE_2 is set to /app/configs/secrets/client_secret_2.json in compose
# If secondary account is unused, create an empty placeholder:
#   touch backend/configs/secrets/client_secret_2.json

# ============================================================
# Splitwise
# ============================================================
SPLITWISE_CONSUMER_KEY=
SPLITWISE_CONSUMER_SECRET=

# ============================================================
# Observability (optional)
# ============================================================
SENTRY_DSN=

# ============================================================
# Notes
# ============================================================
# REDIS_URL is present in configs/.env but Redis is not used by any active
# code path and is not included in docker-compose. Leave commented out.
# REDIS_URL=redis://localhost:6379/0
```

**backend/.env.example** — Documents what would go in backend/configs/.env and backend/configs/secrets/.env locally. Helpful for local dev onboarding.

```bash
# backend/.env.example
# Local development environment variables.
# Copy to backend/configs/.env (non-sensitive) and backend/configs/secrets/.env (sensitive).
# In production (Docker), these are passed as environment variables via docker-compose.

# --- configs/.env (non-sensitive, can be committed) ---
APP_ENV=dev
APP_NAME=expense-tracker
LOG_LEVEL=INFO
LOG_DIRECTORY=logs
LOG_NAME=expense-tracker.log
LOG_MAX_BYTES=10485760

GOOGLE_REDIRECT_URI=http://localhost:8000/api/mail/oauth/callback
GOOGLE_CLIENT_SECRET_FILE=configs/secrets/client_secret.json
GOOGLE_CLOUD_PROJECT_ID=expense-tracker-470706
GOOGLE_CLOUD_BUCKET_NAME=marty-the-expense-tracker
SPLITWISE_API_BASE_URL=https://secure.splitwise.com/api/v3.0
ENABLE_SECONDARY_ACCOUNT=true

# --- configs/secrets/.env (sensitive, never commit) ---
DB_HOST=localhost
DB_PORT=5432
DB_NAME=expense_db
DB_USER=chaitanya
DB_PASSWORD=

OPENAI_API_KEY=
VISION_AGENT_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_PROJECT_ID=expense-tracker-470706
GOOGLE_CLIENT_ID_2=
GOOGLE_CLIENT_SECRET_2=
GOOGLE_REFRESH_TOKEN_2=

GOOGLE_APPLICATION_CREDENTIALS=configs/secrets/gcs_service_account_key.json

SPLITWISE_CONSUMER_KEY=
SPLITWISE_CONSUMER_SECRET=

CURRENT_USER_NAMES=me,chaitanya gvs,chaitanya
SENTRY_DSN=
```

**.gitignore** — Ensure `.env` is listed at the repo root. Read the existing .gitignore first. If `.env` is not already present as a standalone line (not `.env.example`, not `.env.local`), add it explicitly:

```
# Secrets — never commit the server environment file
.env
```

This is a REQUIRED security step. The actual server `.env` file (copied from `.env.example` and filled with real secrets) must never be committed. Verify the addition with: `grep -q '^\.env$' .gitignore && echo "OK" || echo "MISSING"`
  </action>
  <verify>
    <automated>ls /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/.env.example && ls /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/backend/.env.example && grep -q '^\.env$' /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/.gitignore && echo ".env is in .gitignore" && grep -q 'VISION_AGENT_API_KEY' /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/backend/src/utils/settings.py && echo "VISION_AGENT_API_KEY in settings.py"</automated>
  </verify>
  <done>
    - .env.example at repo root covers all vars consumed by docker-compose.prod.yml (SERVER_IP, POSTGRES_*, OPENAI_API_KEY, VISION_AGENT_API_KEY, all GOOGLE_* vars, SPLITWISE_*)
    - backend/.env.example documents local dev var layout across configs/.env and configs/secrets/.env
    - .env is in .gitignore as a standalone line (grep -q '^\.env$' .gitignore returns 0)
    - backend/src/utils/settings.py has VISION_AGENT_API_KEY: str | None = None field after SENTRY_DSN
  </done>
</task>

<task type="auto">
  <name>Task 6: Makefile with ops targets</name>
  <files>
    Makefile
  </files>
  <action>
Create Makefile at the repo root. All production targets use BOTH compose files (base + override). Tabs are required in Makefile rules (not spaces).

CRITICAL: The `COMPOSE` variable MUST reference both compose files. Using only `-f docker-compose.prod.yml` would fail because docker-compose.prod.yml is a partial override file, not a standalone compose file. The complete base (docker-compose.yml) is always required.

```makefile
# Makefile
# Ops commands for the expense tracker Docker deployment.
# All targets use both compose files: docker-compose.yml (base) + docker-compose.prod.yml (overrides).
# Run from the repo root on the server.

.PHONY: up down deploy restart logs logs-backend logs-frontend \
        backup migrate shell-backend shell-db caddy-reload ps

# IMPORTANT: Both files are required.
# docker-compose.prod.yml is a partial override — it cannot be used alone.
COMPOSE = docker compose -f docker-compose.yml -f docker-compose.prod.yml

# Start all services in detached mode
up:
	$(COMPOSE) up -d

# Stop all services (preserves volumes)
down:
	$(COMPOSE) down

# Full deploy: pull latest code, rebuild images, restart
# This is the primary deployment command used after pushing changes.
deploy:
	git pull
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

# Restart all services (no rebuild)
restart:
	$(COMPOSE) restart

# Tail logs for all services
logs:
	$(COMPOSE) logs -f --tail=100

# Tail logs for individual services
logs-backend:
	$(COMPOSE) logs -f --tail=100 backend

logs-frontend:
	$(COMPOSE) logs -f --tail=100 frontend

logs-caddy:
	$(COMPOSE) logs -f --tail=100 caddy

# Trigger an immediate manual backup (runs the backup script in the pgbackups container)
backup:
	$(COMPOSE) exec pgbackups /backup.sh

# Run Alembic migrations (useful after a schema change without full rebuild)
migrate:
	$(COMPOSE) exec backend alembic upgrade head

# Open a bash shell in the backend container
shell-backend:
	$(COMPOSE) exec backend bash

# Open a psql session in the postgres container
shell-db:
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER} -d $${POSTGRES_DB}

# Reload Caddy config without restarting the container
caddy-reload:
	$(COMPOSE) exec caddy caddy reload --config /etc/caddy/Caddyfile

# Show service status
ps:
	$(COMPOSE) ps
```
  </action>
  <verify>
    <automated>make -n deploy -f /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/Makefile 2>&1 | grep -q "docker compose" && echo "Makefile deploy target valid"</automated>
  </verify>
  <done>
    - Makefile exists at repo root
    - COMPOSE variable is `docker compose -f docker-compose.yml -f docker-compose.prod.yml` (both files, Compose V2)
    - `make deploy` runs: git pull, docker compose build --no-cache, docker compose up -d
    - `make migrate` runs alembic upgrade head in the running backend container
    - `make shell-db` opens psql with env vars from the running compose stack
    - Tabs (not spaces) are used for recipe lines
  </done>
</task>

<task type="auto">
  <name>Task 7: Data migration script and server setup script</name>
  <files>
    scripts/migrate-data.sh
    scripts/server-setup.sh
  </files>
  <action>
Create scripts/ directory and two operational scripts:

**scripts/migrate-data.sh** — Documented procedure for migrating data from the local Mac PostgreSQL to the containerized production database. Run from the Mac before or after deploying.

```bash
#!/bin/bash
# scripts/migrate-data.sh
#
# Migrate existing PostgreSQL data from local Mac to the Docker container on the VPS.
#
# Usage:
#   1. Fill in the variables below (or export them before running)
#   2. Run from your Mac: bash scripts/migrate-data.sh
#
# Prerequisites:
#   - pg_dump installed locally (brew install postgresql@16)
#   - SSH access to the server
#   - Docker stack is running on the server (make up)
#   - postgres container is healthy (make ps)

set -e

# ---- Configure these ----
LOCAL_DB_USER="${LOCAL_DB_USER:-chaitanya}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-expense_db}"     # Verify with: psql -l
SERVER_USER="${SERVER_USER:-root}"
SERVER_IP="${SERVER_IP:?SERVER_IP must be set}"
DUMP_FILE="expense_db_$(date +%Y%m%d_%H%M%S).dump"
REMOTE_DEST="/tmp/${DUMP_FILE}"

echo "=== Step 1: Verify local database name ==="
echo "Local databases:"
psql -l -U "${LOCAL_DB_USER}" 2>/dev/null || psql -l
echo ""
echo "Using DB: ${LOCAL_DB_NAME} — press Ctrl+C to abort if this is wrong"
sleep 3

echo ""
echo "=== Step 2: Create pg_dump (custom format) ==="
pg_dump -Fc -U "${LOCAL_DB_USER}" -d "${LOCAL_DB_NAME}" -f "/tmp/${DUMP_FILE}"
echo "Dump created: /tmp/${DUMP_FILE}"

echo ""
echo "=== Step 3: Transfer dump to server ==="
scp "/tmp/${DUMP_FILE}" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DEST}"
echo "Transferred to ${SERVER_IP}:${REMOTE_DEST}"

echo ""
echo "=== Step 4: Restore into Docker postgres container ==="
echo "Run the following on the server (SSH in first):"
echo ""
echo "  ssh ${SERVER_USER}@${SERVER_IP}"
echo ""
echo "  # Create DB if it doesn't exist yet:"
echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \\"
echo "    psql -U \${POSTGRES_USER} -c 'CREATE DATABASE \${POSTGRES_DB};'"
echo ""
echo "  # Restore:"
echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \\"
echo "    pg_restore --verbose --clean --no-owner --no-acl \\"
echo "    -U \${POSTGRES_USER} -d \${POSTGRES_DB} < ${REMOTE_DEST}"
echo ""
echo "  # Verify tables exist:"
echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec postgres \\"
echo "    psql -U \${POSTGRES_USER} -d \${POSTGRES_DB} -c '\dt'"
echo ""
echo "  # Clean up dump file:"
echo "  rm ${REMOTE_DEST}"
echo ""
echo "=== Done: dump is at ${REMOTE_DEST} on the server ==="
```

**scripts/server-setup.sh** — Run once on a fresh Hetzner Ubuntu 22.04 VPS to install Docker, configure UFW, and set up the deploy directory. Run as root or a user with sudo.

The scp step in the "Next steps" output copies ALL `*.json` files from `backend/configs/secrets/` — this covers both `client_secret.json` and `client_secret_2.json` (and the GCS key). If `client_secret_2.json` doesn't exist yet, create an empty placeholder before running: `touch backend/configs/secrets/client_secret_2.json`.

```bash
#!/bin/bash
# scripts/server-setup.sh
#
# One-time setup for a fresh Hetzner Ubuntu 22.04 VPS.
# Run as root or sudo user:
#   bash scripts/server-setup.sh
#
# After this script completes:
#   1. Clone the repo to /opt/expense-tracker
#   2. Copy .env.example to /opt/expense-tracker/.env and fill in values
#   3. Copy backend/configs/secrets/ files to the server
#   4. cd /opt/expense-tracker && make deploy

set -e

echo "=== 1. System update ==="
apt update && apt upgrade -y

echo ""
echo "=== 2. Install Docker (official repo method) ==="
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ""
echo "=== 3. Enable Docker on boot ==="
systemctl enable docker
systemctl start docker

echo ""
echo "=== 4. Add current user to docker group ==="
# Allows running docker without sudo.
# Effect takes place after logout/login.
if [ -n "${SUDO_USER}" ]; then
    usermod -aG docker "${SUDO_USER}"
    echo "Added ${SUDO_USER} to docker group (logout and back in for effect)"
else
    echo "Run manually: usermod -aG docker <your-username>"
fi

echo ""
echo "=== 5. UFW firewall ==="
# IMPORTANT: Only open SSH, HTTP, HTTPS.
# Docker services that don't publish ports are NOT reachable externally —
# the compose setup only exposes Caddy on 80/443.
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (Caddy)"
ufw allow 443/tcp comment "HTTPS (Caddy future)"
ufw --force enable
ufw status

echo ""
echo "=== 6. Create deploy directory ==="
mkdir -p /opt/expense-tracker
echo "Deploy directory: /opt/expense-tracker"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. git clone <repo-url> /opt/expense-tracker"
echo "  2. cd /opt/expense-tracker"
echo "  3. cp .env.example .env && nano .env  # fill in all values"
echo "  4. mkdir -p backend/configs/secrets"
echo "  5. # Copy ALL secret JSON files from Mac to server:"
echo "     # scp backend/configs/secrets/*.json root@<server-ip>:/opt/expense-tracker/backend/configs/secrets/"
echo "     # This copies: gcs_service_account_key.json, client_secret.json, client_secret_2.json"
echo "     # If client_secret_2.json doesn't exist: touch backend/configs/secrets/client_secret_2.json"
echo "  6. make deploy"
```

Make both scripts executable by including a note in the action — the chmod will be done as part of creating the files. The scripts are documentation-as-code: they can be run directly or used as a step-by-step reference.
  </action>
  <verify>
    <automated>bash -n /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/scripts/migrate-data.sh && bash -n /Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/scripts/server-setup.sh && echo "Both scripts have valid bash syntax"</automated>
  </verify>
  <done>
    - scripts/migrate-data.sh exists, has valid bash syntax (`bash -n`), documents pg_dump + scp + pg_restore steps
    - scripts/server-setup.sh exists, has valid bash syntax, installs Docker via official repo method, configures UFW for ports 22/80/443 only
    - Both scripts have usage comments at the top explaining how to run them
    - migrate-data.sh includes the "verify local DB name with psql -l" step (addresses the DB name discrepancy between settings.py default and actual running DB)
    - migrate-data.sh uses `docker compose -f docker-compose.yml -f docker-compose.prod.yml` (consistent with Makefile COMPOSE variable)
    - server-setup.sh "Next steps" scp instruction uses `*.json` glob to copy all secret files including client_secret_2.json
  </done>
</task>

</tasks>

<verification>
After all tasks complete, verify the full deployment configuration:

1. Docker builds succeed locally:
   ```bash
   cd /path/to/expense-tracker
   docker build -t test-backend ./backend
   docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost/api -t test-frontend ./frontend
   docker rmi test-backend test-frontend
   ```

2. entrypoint.sh is executable in the backend image:
   ```bash
   docker run --rm --entrypoint="" test-backend ls -la /app/entrypoint.sh
   # Should show: -rwxr-xr-x
   ```

3. Compose config parses without errors (both files required):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet && echo "Valid"
   ```

4. File inventory check — all required files exist:
   ```bash
   ls backend/Dockerfile backend/entrypoint.sh backend/.dockerignore \
      frontend/Dockerfile frontend/.dockerignore \
      frontend/next.config.ts \
      docker-compose.yml docker-compose.prod.yml \
      caddy/Caddyfile \
      .env.example backend/.env.example \
      Makefile \
      scripts/migrate-data.sh scripts/server-setup.sh
   ```

5. Key content assertions:
   - `grep -q "python:3.11-slim-bookworm" backend/Dockerfile`
   - `grep -q "tesseract-ocr-eng" backend/Dockerfile`
   - `grep -q "libgl1" backend/Dockerfile` (PyMuPDF dependency)
   - `grep -q "output: 'standalone'" frontend/next.config.ts`
   - `grep -q "HOSTNAME" frontend/Dockerfile`
   - `grep -q "NEXT_PUBLIC_API_URL" frontend/Dockerfile`
   - `grep -q "service_healthy" docker-compose.prod.yml`
   - `grep -q "caddy:2-alpine" docker-compose.prod.yml`
   - `grep -q "prodrigestivill/postgres-backup-local" docker-compose.prod.yml`
   - `grep -q "BACKUP_ON_START=TRUE" docker-compose.prod.yml`
   - `grep -q "reverse_proxy backend:8000" caddy/Caddyfile`
   - `grep -q "git pull" Makefile`
   - `grep -q "docker-compose.yml -f docker-compose.prod.yml" Makefile`
   - `grep -q "client_secret_2.json" docker-compose.prod.yml`
   - `grep -q '^\.env$' .gitignore`
   - `grep -q "VISION_AGENT_API_KEY" backend/src/utils/settings.py`
   - `grep -q "venv_data" docker-compose.yml`

6. Makefile dry-run:
   ```bash
   make -n deploy && make -n migrate && make -n backup
   ```
</verification>

<success_criteria>
This plan is complete when:

- All files exist at the correct paths (Dockerfiles, compose files, Caddyfile, .env.examples, Makefile, scripts)
- `docker build ./backend` succeeds (multi-stage, ~800MB image with tesseract + poppler)
- `docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost/api ./frontend` succeeds (multi-stage, ~200MB standalone image)
- entrypoint.sh shows `-rwxr-xr-x` inside the backend image
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` reports no errors
- `make -n deploy` outputs the expected git pull + build + up sequence using both compose files
- All critical env vars documented in .env.example (SERVER_IP, POSTGRES_*, all GOOGLE_* vars, OPENAI_API_KEY, VISION_AGENT_API_KEY, SPLITWISE_*)
- next.config.ts contains `output: 'standalone'`
- Only caddy has `ports:` in docker-compose.prod.yml
- Makefile COMPOSE variable uses both `-f docker-compose.yml -f docker-compose.prod.yml`
- docker-compose.prod.yml has volume mount for client_secret_2.json in backend service
- GOOGLE_CLIENT_SECRET_FILE_2 is hardcoded to /app/configs/secrets/client_secret_2.json (not a passthrough)
- .env is in root .gitignore as a standalone line
- backend/src/utils/settings.py has VISION_AGENT_API_KEY: str | None = None
- dev docker-compose.yml backend volumes mount src files individually (not ./backend:/app wholesale)
- migrate-data.sh script includes the "check psql -l first" step for DB name verification
- server-setup.sh installs Docker via official repo method and configures UFW for 22/80/443 only
- server-setup.sh "Next steps" scp instruction uses `*.json` to copy all secret files
</success_criteria>

<output>
After completion, create `.planning/phases/01-containerization/01-PLAN-SUMMARY.md` with:
- Files created and their purpose
- Key implementation decisions made
- Any deviations from the plan and why
- Smoke test results (docker build output)
- Next steps for actual server deployment
</output>
