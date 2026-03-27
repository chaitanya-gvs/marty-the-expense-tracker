---
phase: 01-containerization
plan: 01
subsystem: infra
tags: [docker, caddy, postgres, fastapi, nextjs, compose, hetzner, uvicorn]

# Dependency graph
requires: []
provides:
  - backend/Dockerfile multi-stage python:3.11-slim-bookworm with tesseract, poppler, libmagic, libgl1
  - frontend/Dockerfile multi-stage Next.js standalone image with HOSTNAME=0.0.0.0
  - docker-compose.yml complete dev/base service definitions with named volumes
  - docker-compose.prod.yml production override adding Caddy, pgbackups, removing host ports
  - caddy/Caddyfile IP-based HTTP routing /api/* and /healthz to backend, catch-all to frontend
  - .env.example root-level all-vars documentation for server deployment
  - Makefile ops commands (up, down, deploy, migrate, backup, logs, shell-backend, shell-db, caddy-reload)
  - scripts/migrate-data.sh pg_dump + scp + pg_restore procedure
  - scripts/server-setup.sh Hetzner Ubuntu 22.04 bootstrap with Docker and UFW
affects:
  - 02-deployment
  - domain-tls
  - ci-cd

# Tech tracking
tech-stack:
  added:
    - Docker (multi-stage builds, python:3.11-slim-bookworm, node:20-alpine)
    - Caddy 2 (reverse proxy, future TLS-ready)
    - prodrigestivill/postgres-backup-local (automated daily backups)
    - postgres:16-alpine
  patterns:
    - base + override compose pattern (docker-compose.yml + docker-compose.prod.yml)
    - secrets via bind-mount (:ro) not baked into image
    - dev volumes mount source files individually (not ./backend:/app wholesale) with named venv_data volume
    - NEXT_PUBLIC_* vars baked at build time via ARG/ENV

key-files:
  created:
    - backend/Dockerfile
    - backend/entrypoint.sh
    - backend/.dockerignore
    - frontend/Dockerfile
    - frontend/.dockerignore
    - docker-compose.yml
    - docker-compose.prod.yml
    - caddy/Caddyfile
    - .env.example
    - backend/.env.example
    - Makefile
    - scripts/migrate-data.sh
    - scripts/server-setup.sh
  modified:
    - frontend/next.config.ts (added output: 'standalone')
    - backend/src/utils/settings.py (added VISION_AGENT_API_KEY field)
    - .gitignore (added .env as standalone line)

key-decisions:
  - "docker-compose.prod.yml is a partial override, not standalone — always used with both -f flags"
  - "Dev backend volumes mount src/, main.py, alembic.ini, configs/ separately with venv_data named volume to preserve .venv"
  - "handle (not handle_path) in Caddyfile preserves full URI when proxying /api/* to backend"
  - "ports: [] pattern in prod override removes host bindings from base file — only Caddy on 80/443"
  - "VISION_AGENT_API_KEY added explicitly to Settings rather than silently passing via pydantic extra=ignore"
  - "GOOGLE_CLIENT_SECRET_FILE_2 hardcoded in compose (not passthrough) to /app/configs/secrets/client_secret_2.json"

patterns-established:
  - "Makefile COMPOSE variable always references both compose files"
  - "Secrets are bind-mounted :ro at runtime, never baked into image"
  - "server-setup.sh + migrate-data.sh as documentation-as-code for ops procedures"

requirements-completed:
  - CONTAINERIZE-01
  - CONTAINERIZE-02
  - CONTAINERIZE-03
  - CONTAINERIZE-04
  - CONTAINERIZE-05
  - CONTAINERIZE-06
  - CONTAINERIZE-07
  - CONTAINERIZE-08

# Metrics
duration: 4min
completed: 2026-03-27
---

# Phase 01 Plan 01: Containerization Summary

**Complete Docker containerization with Caddy reverse proxy, automated pg backups, and one-command `make deploy` for Hetzner VPS migration from local Mac**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T07:04:37Z
- **Completed:** 2026-03-27T07:08:50Z
- **Tasks:** 7
- **Files modified:** 16 (13 created, 3 modified)

## Accomplishments

- Multi-stage Dockerfiles for both backend (python:3.11-slim-bookworm with tesseract/poppler/libmagic/libgl1) and frontend (node:20-alpine standalone output)
- Production compose stack: postgres, backend, frontend, Caddy (80/443), pgbackups (daily + on-start)
- Makefile provides full ops toolkit (up/down/deploy/migrate/backup/logs/shell targets)
- Complete .env.example documentation covering all 25+ production environment variables

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend Dockerfile, entrypoint, and .dockerignore** - `ce6db20` (feat)
2. **Task 2: Frontend Dockerfile, next.config.ts update, and .dockerignore** - `71428b8` (feat)
3. **Task 3: Docker Compose files (base + prod override)** - `8d437a0` (feat)
4. **Task 4: Caddy configuration and caddy/ directory** - `353b205` (feat)
5. **Task 5: Environment configuration, .gitignore, and settings.py** - `d022e87` (feat)
6. **Task 6: Makefile with ops targets** - `1757103` (feat)
7. **Task 7: Data migration script and server setup script** - `33f0e80` (feat)

## Files Created/Modified

- `backend/Dockerfile` - Multi-stage builder (Poetry) + runtime (tesseract/poppler/libmagic/libgl1)
- `backend/entrypoint.sh` - Alembic migrations then uvicorn with 2 workers
- `backend/.dockerignore` - Excludes secrets, venv, tests, data dirs
- `frontend/Dockerfile` - Three-stage (deps/builder/runner) with HOSTNAME=0.0.0.0
- `frontend/.dockerignore` - Excludes node_modules, .next, .env files
- `frontend/next.config.ts` - Added `output: 'standalone'` for Docker build
- `docker-compose.yml` - Complete base: postgres/backend/frontend, named volumes
- `docker-compose.prod.yml` - Prod override: caddy/pgbackups, ports:[], restart policies
- `caddy/Caddyfile` - IP-based routing: /api/* and /healthz -> backend, catch-all -> frontend
- `.env.example` - All production vars documented (SERVER_IP, POSTGRES_*, GOOGLE_*, SPLITWISE_*, etc.)
- `backend/.env.example` - Local dev var layout for configs/.env and configs/secrets/.env
- `.gitignore` - Added `.env` as standalone line for server secret protection
- `backend/src/utils/settings.py` - Added `VISION_AGENT_API_KEY: str | None = None`
- `Makefile` - Ops commands with COMPOSE referencing both compose files
- `scripts/migrate-data.sh` - pg_dump + scp + pg_restore with psql -l verification step
- `scripts/server-setup.sh` - Docker install (official repo), UFW 22/80/443, deploy directory

## Decisions Made

- **Base + override compose pattern**: docker-compose.prod.yml is a partial override, never standalone. Makefile COMPOSE variable always uses both `-f` flags. This keeps dev and prod in sync while allowing targeted overrides.
- **Dev volume granularity**: Backend volumes mount `src/`, `main.py`, `alembic.ini`, `configs/` individually (not `./backend:/app` wholesale) to avoid overwriting the container's `.venv`. A `venv_data` named volume preserves the venv across restarts.
- **Caddy `handle` vs `handle_path`**: Using `handle` preserves the full URI (e.g., `/api/transactions` proxied as-is to `backend:8000/api/transactions`), matching FastAPI's `/api` prefix router mounts.
- **VISION_AGENT_API_KEY**: Added explicitly to `Settings` class rather than relying on `extra="ignore"` to pass it through silently. Makes the field discoverable in settings.py.
- **GOOGLE_CLIENT_SECRET_FILE_2**: Hardcoded path in compose environment (`/app/configs/secrets/client_secret_2.json`) rather than env var passthrough — value never changes in production.

## Deviations from Plan

### Docker daemon not available for build verification

- **Found during:** Task 1 verification
- **Issue:** Docker daemon not running in the execution environment — `docker build` commands returned "Cannot connect to the Docker daemon"
- **Fix:** Verified all files via content assertions (`grep` checks for key strings) and bash syntax validation instead of live builds. All 17 content assertions from the plan passed.
- **Impact:** Docker builds will need to be verified on the actual server after cloning the repo. The `make deploy` command will perform the first real build.

---

**Total deviations:** 1 (environment limitation — no Docker daemon)
**Impact on plan:** All files created as specified. Build verification deferred to server deployment.

## Issues Encountered

- Docker daemon unavailable for smoke tests — all content assertions verified via grep instead. Files follow the plan exactly and all bash scripts have valid syntax.

## User Setup Required

None — all required steps are documented in `scripts/server-setup.sh` and `.env.example`.

## Next Phase Readiness

- All containerization files are in place for Hetzner VPS deployment
- Run `bash scripts/server-setup.sh` on a fresh Ubuntu 22.04 VPS to bootstrap
- Clone repo, copy `.env.example` to `.env`, fill in secrets, copy `backend/configs/secrets/*.json`, then `make deploy`
- Caddy is TLS-ready: replace `:80 {` with `yourdomain.com {` in `caddy/Caddyfile` when domain is available

---
*Phase: 01-containerization*
*Completed: 2026-03-27*
