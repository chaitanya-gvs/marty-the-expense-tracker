# Phase 1: Containerization & VPS Migration - Research

**Researched:** 2026-03-27
**Domain:** Docker, Docker Compose, Caddy, PostgreSQL migration, Hetzner VPS
**Confidence:** HIGH (core patterns verified against official docs; gotchas from cross-referenced sources)

---

## Summary

This phase containerizes a FastAPI + Next.js 15 + PostgreSQL personal expense tracker and migrates it from a local Mac to a Hetzner VPS running Ubuntu 22.04. The application requires system-level OCR dependencies (tesseract, poppler-utils, libmagic) in the backend container, and the frontend requires Next.js standalone mode to produce a minimal production image. Caddy acts as the reverse proxy; because no domain is configured yet, it runs HTTP-only using the server IP.

The standard approach is: multi-stage Dockerfiles to minimise image size, a single `docker-compose.prod.yml` that overrides the dev compose, Caddy in the same compose network using service names as upstream addresses, and `prodrigestivill/postgres-backup-local` for automated pg_dump rotation. Secrets stay in a `.env` file on the server (never committed). The data migration path is `pg_dump -Fc` on the Mac, `pg_restore` into the fresh Docker PostgreSQL container.

**Primary recommendation:** Use `python:3.11-slim-bookworm` for the backend (not Alpine — Alpine's musl libc is incompatible with some Python binary wheels including asyncpg and PyMuPDF), `node:20-alpine` for the Next.js runner stage, and `caddy:2-alpine` for the proxy. All services on a single internal bridge network; only Caddy exposes ports 80/443 to the host.

---

## Project Constraints (from CLAUDE.md)

- Always run backend commands from `backend/` (pyproject.toml location)
- Always run frontend commands from `frontend/` (package.json location)
- Backend config: `backend/configs/.env` and `backend/configs/secrets/.env`
- PostgreSQL at `localhost:5432`, db name `expense_db` (but settings.py shows `expense_tracker` as default — verify with actual .env)
- Poetry 2.1.3 is the local package manager (on dev machine)

---

## Standard Stack

### Core
| Component | Version/Image | Purpose | Why Standard |
|-----------|--------------|---------|--------------|
| python:3.11-slim-bookworm | Python 3.11 | Backend base image | Matches pyproject.toml `python = "^3.11"`; Debian Bookworm has current apt packages; slim removes dev tools |
| node:20-alpine | Node 20 LTS | Next.js runner stage | Official Next.js Docker examples use 20-alpine for runner; small Alpine base |
| node:22-alpine | Node 22 LTS | Next.js builder stage | Latest LTS; can use 20 throughout for consistency |
| postgres:16-alpine | PostgreSQL 16 | Database container | LTS release; Alpine variant is minimal |
| caddy:2-alpine | Caddy 2 | Reverse proxy | Auto-TLS, simple Caddyfile, Docker-native |
| prodrigestivill/postgres-backup-local | latest | Automated pg_dump backups | Battle-tested, supports rotation (daily/weekly/monthly) |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| poetry export | built into Poetry 2.x | Export requirements.txt from lock file | In builder stage before pip install |
| Docker Compose V2 | 2.38+ | Orchestration | Already installed on dev machine; use `docker compose` (no hyphen) |
| UFW + ufw-docker | latest | VPS firewall | Required to prevent Docker bypassing UFW iptables rules |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| python:3.11-slim-bookworm | python:3.11-alpine | Alpine's musl libc breaks asyncpg, PyMuPDF prebuilt wheels — do NOT use Alpine for backend |
| prodrigestivill/postgres-backup-local | Custom cron container | More effort, same outcome; prodrigestivill is well-maintained and multi-arch |
| Caddy | Nginx | Caddy auto-TLS is zero-config when adding domain later; Nginx requires certbot integration |
| poetry export + pip | poetry install in container | Poetry adds ~50MB; export to requirements.txt produces a pip-installable file without Poetry in final image |

---

## Architecture Patterns

### Recommended Project Structure
```
expense-tracker/
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── ...
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── ...
├── docker-compose.yml          # Dev overrides (bind mounts, hot reload)
├── docker-compose.prod.yml     # Production (build from Dockerfile, named volumes)
├── caddy/
│   └── Caddyfile               # Caddy config (committed to git, no secrets)
├── Makefile                    # Operational targets
└── .env.example                # Template (committed); actual .env on server only
```

### Pattern 1: Backend Multi-Stage Dockerfile (Python + Poetry)

**What:** Two stages — `builder` installs Poetry and exports dependencies into a venv; `runtime` copies only the venv and app code.
**When to use:** Always. Keeps Poetry out of the production image.

```dockerfile
# Source: Official FastAPI docs + amplify.security best practices article
# backend/Dockerfile

# ---- Builder ----
FROM python:3.11-slim-bookworm AS builder

ENV POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1 \
    POETRY_CACHE_DIR=/tmp/.poetry

# System deps needed at build time (some packages compile C extensions)
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

# System runtime deps (tesseract, poppler, libmagic)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libmagic1 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app
ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

COPY --from=builder /app/.venv /app/.venv
COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

**Key notes:**
- `python:3.11-slim-bookworm` (NOT Alpine) because asyncpg, PyMuPDF, and lxml ship prebuilt manylinux wheels that require glibc (Debian/Ubuntu).
- `tesseract-ocr-eng` is the English language pack — required separately from the tesseract-ocr binary.
- `libmagic1` provides the magic byte library for the `python-magic` / file type detection.
- `libpq5` is the PostgreSQL client library (runtime, not dev headers).
- The `build-essential` and `libpq-dev` are in builder only (for psycopg2-binary compile if needed).

### Pattern 2: Frontend Multi-Stage Dockerfile (Next.js 15 Standalone)

**What:** Three stages — `deps` (npm ci), `builder` (next build), `runner` (node + standalone output only).
**When to use:** Always for Next.js production Docker images.

```dockerfile
# Source: Vercel official Next.js Docker example (with-docker), Next.js docs output page
# frontend/Dockerfile

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next

# Standalone output — server.js + minimal node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets must be copied manually (not included in standalone by default)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

**Critical notes:**
- `output: 'standalone'` must be added to `next.config.ts` BEFORE building.
- `HOSTNAME="0.0.0.0"` is mandatory — without it, server.js binds to 127.0.0.1 and is unreachable from Docker bridge network.
- `.next/static` must be copied manually into `standalone/.next/static`; the standalone folder does NOT include it by default.
- `public/` must also be copied into the runner stage — also not included automatically.
- `libc6-compat` on Alpine is required for some npm packages that use glibc bindings.
- The build uses Turbopack (`npm run build` in package.json already has `--turbopack`); this is fine in Docker.

**next.config.ts change required:**
```typescript
// Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
const nextConfig: NextConfig = {
  output: 'standalone',
};
```

### Pattern 3: Docker Compose Structure

**What:** Base `docker-compose.yml` for dev; `docker-compose.prod.yml` as override for production.
**When to use:** Dev uses bind mounts + hot reload; prod builds from Dockerfiles with named volumes.

```yaml
# docker-compose.prod.yml (production-only services)
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=${POSTGRES_DB}
      - DB_USER=${POSTGRES_USER}
      - DB_PASSWORD=${POSTGRES_PASSWORD}
      - GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcs_key
    volumes:
      - ./backend/configs/secrets/gcs_service_account_key.json:/run/secrets/gcs_key:ro
      - ./backend/configs/secrets/client_secret.json:/app/configs/secrets/client_secret.json:ro
      - backend_logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - internal

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      - NEXT_PUBLIC_API_URL=http://${SERVER_IP}/api
      - NEXT_PUBLIC_APP_ENV=production
    depends_on:
      - backend
    networks:
      - internal

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

networks:
  internal:
    driver: bridge

volumes:
  postgres_data:
  backend_logs:
  caddy_data:
  caddy_config:
  pgbackups:
```

**Key design decisions:**
- Only `caddy` exposes ports to the host. `backend` and `frontend` are reachable only within the `internal` network.
- `depends_on: condition: service_healthy` ensures backend waits for PostgreSQL to be truly ready (not just started).
- GCS key file is bind-mounted read-only at `/run/secrets/gcs_key`; `GOOGLE_APPLICATION_CREDENTIALS` points to that path.
- Named volumes (not bind mounts) for all persistent data in prod: `postgres_data`, `pgbackups`, `caddy_data`.

### Pattern 4: Caddyfile for IP-Based HTTP-Only Reverse Proxy

**What:** Route `/api/*` and `/healthz` to backend:8000; all other traffic to frontend:3000.
**When to use:** IP-only (no domain) setup while server is being configured.

```caddyfile
# caddy/Caddyfile
# Source: https://caddyserver.com/docs/quick-starts/reverse-proxy

# IP-only mode: plain HTTP, no TLS
:80 {
    # Backend routes
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /healthz {
        reverse_proxy backend:8000
    }
    # Frontend — catch-all
    handle {
        reverse_proxy frontend:3000
    }
}
```

**Auto-TLS migration when domain is added (change is 1 line):**
```caddyfile
# Replace ":80 {" with the domain name:
yourdomain.com {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /healthz {
        reverse_proxy backend:8000
    }
    handle {
        reverse_proxy frontend:3000
    }
}
```

Caddy automatically obtains a Let's Encrypt certificate when a real hostname is used. No other changes needed.

**Notes:**
- Service names `backend` and `frontend` work as upstream addresses because all services are on the same Docker bridge network (`internal`).
- Caddy must be on the same network as backend and frontend — verified in the compose structure above.
- To reload config without restart: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`

### Pattern 5: Alembic Migration on Container Startup

**What:** Run `alembic upgrade head` in an entrypoint script before uvicorn starts.
**When to use:** Single-container deployment without a separate migration job.

```bash
#!/bin/bash
# backend/entrypoint.sh
set -e

echo "Running Alembic migrations..."
alembic upgrade head

echo "Starting application..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

Dockerfile CMD becomes:
```dockerfile
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
```

**Alternative:** Use docker-compose `command` override:
```yaml
backend:
  command: bash -c "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"
```

**Important:** `depends_on: condition: service_healthy` handles the wait-for-postgres concern — the backend won't start until PostgreSQL healthcheck passes.

### Anti-Patterns to Avoid
- **Using Alpine for the backend:** musl libc breaks asyncpg (compiled C extension), PyMuPDF prebuilt wheels, and psycopg2-binary. Always use Debian-based images for the backend.
- **Installing Poetry in the runtime stage:** Adds ~50MB with no benefit. Export to venv in builder, copy venv to runtime.
- **Bind-mounting secrets directories:** Bind-mount individual files (`gcs_key.json`) at specific paths, not entire `configs/secrets/` directories. Reduces accidental exposure.
- **Exposing database port to host:** Never add `ports: "5432:5432"` to the postgres service in prod. It should be internal-only.
- **allow_origins=["*"] in production:** The current `main.py` uses `"*"` — this must be restricted to the Caddy-proxied URL in production (or the server IP).
- **Committing .env to git:** The `.env` file with secrets lives only on the server. Commit `.env.example` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Automated pg_dump rotation | Custom cron container | `prodrigestivill/postgres-backup-local` | Handles daily/weekly/monthly rotation, multi-arch, tested |
| Wait-for-postgres | Bash loop in entrypoint | `depends_on: condition: service_healthy` | Native Compose feature; cleaner and more reliable |
| TLS certificate management | Manual certbot | Caddy automatic HTTPS | Zero config when domain is set; handles renewal |
| Python dep management in Docker | `pip install poetry && poetry install` in runtime | `poetry export` in builder + `pip install -r` in runtime | Avoids Poetry overhead in final image |

**Key insight:** The hardest parts (backup rotation, healthcheck-based ordering, TLS) all have well-maintained solutions. Build only the application logic.

---

## Runtime State Inventory

> This is a migration phase — all five categories answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | PostgreSQL `expense_db` on local Mac at `localhost:5432` with all transaction history | `pg_dump -Fc` on Mac → transfer to VPS → `pg_restore` into Docker container (data migration) |
| Live service config | None — no external service config dashboard | None |
| OS-registered state | None — no launchd plists, no PM2 processes registered | None |
| Secrets/env vars | `backend/configs/.env` and `backend/configs/secrets/.env` on Mac; `configs/secrets/gcs_service_account_key.json` and `client_secret.json` | Copy secrets files to VPS server; never commit to git |
| Build artifacts | No egg-info, no compiled binaries in repo | None — clean build from Dockerfile |

**DB name discrepancy to verify:** `backend/configs/.env` shows `expense_db` as the working db name; `settings.py` default is `expense_tracker`; `alembic.ini` mentions `expense_tracker`. Confirm the actual database name before running pg_dump.

---

## Common Pitfalls

### Pitfall 1: Next.js Standalone HOSTNAME Not Set
**What goes wrong:** Container starts, Caddy health check or browser gets connection refused. `server.js` binds to `127.0.0.1` by default.
**Why it happens:** Next.js standalone `server.js` reads the `HOSTNAME` env var to determine the bind address. Default is localhost.
**How to avoid:** Set `ENV HOSTNAME="0.0.0.0"` in the runner stage of the Dockerfile (or in docker-compose environment).
**Warning signs:** `curl http://frontend:3000` from another container fails with connection refused.

### Pitfall 2: Docker Bypasses UFW on Ubuntu
**What goes wrong:** UFW `ufw allow 22` and `ufw default deny incoming`, but port 8000 (backend) is still reachable from the public internet because Docker adds iptables rules before UFW processes them.
**Why it happens:** Docker's iptables manipulation happens in the FORWARD chain before UFW's rules, bypassing them entirely.
**How to avoid:** Use the `ufw-docker` solution (https://github.com/chaifeng/ufw-docker) which adds rules to the DOCKER-USER chain, OR (simpler for this setup) bind Caddy to `0.0.0.0:80` and never publish `backend:8000` or `frontend:3000` to host ports. With the compose structure above (only Caddy has `ports:`), the backend and frontend are never host-reachable.
**Warning signs:** `nmap <server-ip>` from external shows port 8000 or 5432 open.

### Pitfall 3: CORS Origins Not Updated for Production
**What goes wrong:** Browser gets CORS error because `allow_origins=["*"]` works in dev but the frontend now calls the API via `http://<server-ip>/api` (through Caddy), which may differ from what the backend expects.
**Why it happens:** `main.py` currently uses `allow_origins=["*"]` — this actually won't cause CORS errors, but it's a security issue. The real risk is if origins are later restricted incorrectly.
**How to avoid:** Move `allow_origins` to a settings variable (`CORS_ORIGINS` in `settings.py`). In production, set it to the server IP or domain. Keep `["*"]` for dev only.
**Warning signs:** Frontend API calls fail with CORS error in browser console.

### Pitfall 4: Settings.py Hardcoded .env Paths Break in Container
**What goes wrong:** The backend container starts but fails to read settings because `ENV_PATH` in `settings.py` resolves relative to the source file location, not the container working directory.
**Why it happens:** `settings.py` uses `Path(__file__).resolve().parents[2] / "configs/.env"`. This is relative to the Python file, so it will still work correctly in container as long as the directory structure is preserved. However, if you mount env vars via Docker Compose `environment:` keys instead of `.env` files, you don't need to mount any .env files at all — pydantic-settings reads env vars directly.
**How to avoid:** In production, pass all settings as environment variables in docker-compose. The `SettingsConfigDict(env_file=...)` only loads files if they exist; environment variables always take precedence (pydantic-settings priority: env vars > env_file).
**Warning signs:** `ValidationError` on startup about missing required settings.

### Pitfall 5: Tesseract Language Pack Missing
**What goes wrong:** pytesseract raises `TesseractError: Failed loading language 'eng'`.
**Why it happens:** `apt-get install tesseract-ocr` installs the binary but NOT the English data files. Language packs are separate Debian packages.
**How to avoid:** Always install `tesseract-ocr-eng` alongside `tesseract-ocr` in the Dockerfile. For other languages (Hindi bank statements etc.), add `tesseract-ocr-hin` etc.
**Warning signs:** OCR runs but returns empty strings or throws language loading errors.

### Pitfall 6: PostgreSQL Data Migration — DB Name Mismatch
**What goes wrong:** `pg_restore` fails or restores to wrong database.
**Why it happens:** `alembic.ini` and `settings.py` show different default db names (`expense_tracker` vs `expense_db`). The actual running db name is in `configs/secrets/.env`.
**How to avoid:** Check the actual DB name before `pg_dump`. Use `-d expense_db` (or whatever the real name is) explicitly.
**Warning signs:** pg_restore exits with "database does not exist" or tables are missing after restore.

### Pitfall 7: Next.js Build-Time vs Runtime Env Vars
**What goes wrong:** `NEXT_PUBLIC_API_URL` is embedded at build time (it's a `NEXT_PUBLIC_` var). If the image is built without this var set, the frontend will point to `undefined` or localhost in production.
**Why it happens:** Next.js bakes `NEXT_PUBLIC_*` vars into the JavaScript bundle at build time, not at runtime.
**How to avoid:** Pass `NEXT_PUBLIC_API_URL` as a Docker build ARG or set it in the builder stage environment before `npm run build`. Use an ARG + ENV pattern in the Dockerfile.
**Warning signs:** All API calls in the browser go to `localhost:8000` or `undefined/api`.

---

## Code Examples

### Backend .dockerignore
```
# Source: standard Python Docker ignore pattern
__pycache__/
*.pyc
*.pyo
.venv/
.git/
*.md
logs/
data/statements/
data/backups/
.pytest_cache/
tests/
configs/secrets/
```

Note: `configs/secrets/` is excluded from the build context — secrets are bind-mounted at runtime, not baked into the image.

### Frontend .dockerignore
```
# Source: standard Next.js Docker ignore pattern
node_modules/
.next/
.git/
*.md
.env*
```

### Makefile Targets
```makefile
# Makefile at repo root
.PHONY: up down deploy restart logs backup migrate shell-backend shell-db

COMPOSE=docker compose -f docker-compose.prod.yml

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

deploy:
	git pull
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

restart:
	$(COMPOSE) restart

logs:
	$(COMPOSE) logs -f --tail=100

logs-backend:
	$(COMPOSE) logs -f --tail=100 backend

logs-frontend:
	$(COMPOSE) logs -f --tail=100 frontend

backup:
	$(COMPOSE) exec pgbackups /backup.sh

migrate:
	$(COMPOSE) exec backend alembic upgrade head

shell-backend:
	$(COMPOSE) exec backend bash

shell-db:
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER} -d $${POSTGRES_DB}

caddy-reload:
	$(COMPOSE) exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### PostgreSQL Data Migration Commands
```bash
# On Mac (source)
# Verify actual DB name first:
psql -l

# Create custom-format dump (smaller, faster restore, supports pg_restore options)
pg_dump -Fc -U <user> -d expense_db -f expense_db_$(date +%Y%m%d).dump

# Transfer to server
scp expense_db_20260327.dump user@<server-ip>:~/

# On server (after Docker stack is up, postgres container healthy)
# Create the database if it doesn't exist yet
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U ${POSTGRES_USER} -c "CREATE DATABASE expense_db;"

# Restore (--no-owner because local user may differ from container user)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --verbose --clean --no-owner --no-acl \
  -U ${POSTGRES_USER} -d ${POSTGRES_DB} < expense_db_20260327.dump

# Verify
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c "\dt"
```

### Server Setup Commands (Hetzner Ubuntu 22.04)
```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Docker (official repo method)
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 3. Add deploy user to docker group (non-root docker access)
sudo usermod -aG docker $USER
# (logout and back in for group change to take effect)

# 4. Enable Docker on boot
sudo systemctl enable docker

# 5. UFW firewall — allow only SSH, HTTP, HTTPS
# IMPORTANT: Do NOT enable UFW until Docker is configured correctly
# Simple approach: don't expose backend/db ports at all (only Caddy has ports:)
# This makes UFW bypass irrelevant for internal services
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### Next.js Build ARG for NEXT_PUBLIC Vars
```dockerfile
# frontend/Dockerfile (builder stage addition)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time arg for public API URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build
```

In docker-compose.prod.yml:
```yaml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile
    args:
      NEXT_PUBLIC_API_URL: http://${SERVER_IP}/api
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `docker-compose` (V1, Python) | `docker compose` (V2, Go plugin) | Docker 23+ | Use `docker compose` without hyphen; V1 is EOL |
| `FROM python:3.x` (full image) | `FROM python:3.x-slim-bookworm` | Ongoing best practice | ~200MB vs ~900MB base image |
| Poetry in runtime image | Poetry export → pip in builder | 2022-onwards | Eliminates Poetry from prod image |
| Manual certbot + nginx | Caddy 2 auto-TLS | 2020+ | Zero-config HTTPS |
| `depends_on: [service_name]` (start order only) | `depends_on: condition: service_healthy` | Compose 3.9+ | Actually waits for readiness, not just container start |

**Deprecated/outdated:**
- `docker-compose` (V1 Python): EOL July 2023, replaced by `docker compose` plugin
- `tiangolo/uvicorn-gunicorn-fastapi-docker`: Creator himself recommends NOT using it for new projects (single-process uvicorn is preferred in Kubernetes/Docker)
- Next.js `serverless` target: Removed, replaced by `output: 'standalone'`

---

## Open Questions

1. **Actual database name**
   - What we know: `settings.py` default is `expense_tracker`; `configs/.env` is not committed; CLAUDE.md says `expense_db`
   - What's unclear: The authoritative DB name used in the running local instance
   - Recommendation: Run `psql -l` on Mac before pg_dump to confirm; use whatever `configs/secrets/.env` has for `DB_NAME`

2. **NEXT_PUBLIC_API_URL with IP-only setup**
   - What we know: `NEXT_PUBLIC_*` vars are baked at build time
   - What's unclear: Whether to use `http://<server-ip>/api` (routed through Caddy) or `http://backend:8000/api` (direct internal)
   - Recommendation: Use `http://<server-ip>/api` — the browser makes API calls, so it needs the externally-reachable URL (via Caddy port 80), not the internal Docker service name

3. **Gmail OAuth token storage**
   - What we know: `token_manager.py` likely stores OAuth tokens somewhere (filesystem or DB); `client_secret.json` is at `configs/secrets/`
   - What's unclear: Whether OAuth refresh tokens are stored in files that need to be persisted across container restarts
   - Recommendation: Check `email_ingestion/token_manager.py` before planning — may need a named volume for token storage or DB-backed token storage

4. **agentic-doc VISION_AGENT_API_KEY**
   - What we know: `document_extractor.py` uses `agentic-doc` (LandingAI API); requires `VISION_AGENT_API_KEY`
   - What's unclear: Whether this is a separate env var not yet in settings.py
   - Recommendation: Add to settings.py and the production .env.example

5. **Backend log directory**
   - What we know: `src/utils/logger.py` writes to `logs/` directory with RotatingFileHandler
   - What's unclear: Whether `LOG_DIRECTORY` is configurable via env
   - Recommendation: Use a named volume `backend_logs:/app/logs` to persist logs across container restarts

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Container builds | ✓ (dev Mac) | 28.3.2 | — |
| Docker Compose V2 | Orchestration | ✓ (dev Mac) | 2.38.2 | — |
| pg_dump | Data migration | ✓ (dev Mac) | 14.18 (Homebrew) | — |
| Node.js | Frontend builds | ✓ (dev Mac) | v24.3.0 | — |
| Poetry | Backend dep mgmt | ✓ (dev Mac) | 2.1.3 | — |
| Ubuntu 22.04 VPS | Target runtime | Must provision | — | — |
| Docker on VPS | Container runtime | Must install | — | Install via apt (commands above) |
| tesseract-ocr | OCR pipeline | Must install in container | bookworm apt | Install via Dockerfile apt-get |
| poppler-utils | PDF processing | Must install in container | bookworm apt | Install via Dockerfile apt-get |

**Missing dependencies with no fallback:**
- Hetzner VPS (Ubuntu 22.04) must be provisioned before deployment — this is a one-time manual step

**Missing dependencies with fallback:**
- None for core functionality

**Note:** Node.js on dev Mac is v24.3.0 but the frontend Dockerfile uses `node:20-alpine`. This mismatch is acceptable — the container build uses 20-alpine as specified; local `npm run dev` uses v24. No action needed.

---

## Validation Architecture

> Skipped — no existing test infrastructure for Docker/infrastructure; this phase produces Dockerfiles and config files, not application logic. Validation is manual smoke testing (healthcheck endpoints, page load, API response).

**Manual smoke test checklist (post-deploy):**
- [ ] `curl http://<server-ip>/healthz` returns `{"status": "ok"}`
- [ ] `curl http://<server-ip>/api/transactions` returns JSON (or 401 if auth added)
- [ ] Browser loads `http://<server-ip>` and renders the transactions page
- [ ] `docker compose -f docker-compose.prod.yml ps` shows all services as "healthy" or "running"
- [ ] `docker compose -f docker-compose.prod.yml logs backend` shows no startup errors
- [ ] Backup container has created at least one dump: `docker compose exec pgbackups ls /backups/`

---

## Sources

### Primary (HIGH confidence)
- Next.js official docs (output) - https://nextjs.org/docs/app/api-reference/config/next-config-js/output — standalone mode, HOSTNAME/PORT vars, static file copying
- Next.js official docs (deploying) - https://nextjs.org/docs/app/getting-started/deploying — Docker deployment options
- Caddy docs - https://caddyserver.com/docs/quick-starts/reverse-proxy — IP-based config, service-name upstreams, auto-TLS migration
- Docker docs (Ubuntu install) - https://docs.docker.com/engine/install/ubuntu/ — apt repository method
- prodrigestivill/docker-postgres-backup-local - https://github.com/prodrigestivill/docker-postgres-backup-local — backup container config
- FastAPI docs - https://fastapi.tiangolo.com/deployment/docker/ — CMD exec form, proxy headers

### Secondary (MEDIUM confidence)
- amplify.security FastAPI+Poetry Docker article - https://amplify.security/blog/how-to-build-production-ready-docker-images-with-python-poetry-and-fastapi — multi-stage pattern with non-root user
- zarino.co.uk Hetzner+Docker+Caddy - https://zarino.co.uk/post/hetzner-docker-caddy/ — compose structure, network setup, caddy reload command
- PyPI PyMuPDF page + GitHub issues — prebuilt manylinux wheels for linux/amd64, glibc requirement (confirms no Alpine for backend)

### Tertiary (LOW confidence — cross-referenced, treat as directional)
- pythonspeed.com Poetry vs Docker caching - poetry export pattern recommendation
- ufw-docker GitHub - https://github.com/chaifeng/ufw-docker — Docker UFW bypass explanation

---

## Metadata

**Confidence breakdown:**
- Backend Dockerfile pattern: HIGH — verified against official FastAPI docs, amplify.security article, Poetry discussion
- Frontend Dockerfile pattern: HIGH — verified against official Next.js standalone docs and Vercel example
- Caddy configuration: HIGH — verified against official Caddy quick-start docs
- PostgreSQL migration: HIGH — standard pg_dump/pg_restore; commands verified
- Backup container: HIGH — pulled directly from prodrigestivill GitHub README
- Server setup: MEDIUM — Docker install commands from official docs; UFW interaction from cross-referenced sources
- tesseract language pack: MEDIUM — confirmed separate package name from Debian packages page
- NEXT_PUBLIC build-time baking: HIGH — documented Next.js behavior

**Research date:** 2026-03-27
**Valid until:** 2026-06-27 (90 days — Docker/Next.js stable; Caddy config format rarely changes)
