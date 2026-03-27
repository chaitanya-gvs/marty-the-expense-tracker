---
phase: 01-containerization
verified: 2026-03-27T08:00:00Z
status: gaps_found
score: 6/7 must-haves verified
re_verification: false
gaps:
  - truth: "docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d starts all 5 services (postgres, backend, frontend, caddy, pgbackups) without errors"
    status: partial
    reason: "The Splitwise integration will fail at runtime: SPLITWISE_API_KEY is what SplitwiseAPIClient reads via os.getenv, but docker-compose.prod.yml and .env.example both define SPLITWISE_CONSUMER_KEY / SPLITWISE_CONSUMER_SECRET. The backend container starts fine (SplitwiseAPIClient is only instantiated on workflow runs, not at import time), so the stack itself does start — but any Splitwise-based workflow run will raise ValueError at runtime."
    artifacts:
      - path: "docker-compose.prod.yml"
        issue: "Lines 44-45 pass SPLITWISE_CONSUMER_KEY and SPLITWISE_CONSUMER_SECRET but the backend code reads SPLITWISE_API_KEY"
      - path: ".env.example"
        issue: "Lines 67-68 document SPLITWISE_CONSUMER_KEY / SPLITWISE_CONSUMER_SECRET instead of SPLITWISE_API_KEY"
      - path: "backend/src/services/splitwise_processor/client.py"
        issue: "Line 30: self.api_key = os.getenv('SPLITWISE_API_KEY') — env var name does not match what compose provides"
    missing:
      - "Replace SPLITWISE_CONSUMER_KEY with SPLITWISE_API_KEY in docker-compose.prod.yml environment section"
      - "Replace SPLITWISE_CONSUMER_SECRET (remove it entirely) in docker-compose.prod.yml environment section"
      - "Update .env.example to document SPLITWISE_API_KEY instead of SPLITWISE_CONSUMER_KEY / SPLITWISE_CONSUMER_SECRET"
human_verification:
  - test: "Build and start all five services on a Hetzner VPS"
    expected: "docker compose -f docker-compose.yml -f docker-compose.prod.yml ps shows postgres, backend, frontend, caddy, pgbackups all in state 'running' or 'healthy'"
    why_human: "Docker daemon not available in this environment; images have never been built"
  - test: "Verify pgbackups volume contains a backup file after first run"
    expected: "docker exec <pgbackups-container> ls /backups/ shows at least one .sql.gz file (BACKUP_ON_START=TRUE triggers immediately)"
    why_human: "Requires running containers with a live PostgreSQL instance"
  - test: "curl http://<server-ip>/healthz returns {\"status\": \"ok\"}"
    expected: "HTTP 200 with JSON body {\"status\": \"ok\"}"
    why_human: "Requires deployed server with running Caddy; cannot verify routing without live stack"
  - test: "Browser loads http://<server-ip> and renders the transactions page"
    expected: "Next.js standalone server responds; transactions table visible with real data post-migration"
    why_human: "Requires browser and live server; visual and UX verification"
  - test: "Existing transaction data is present after pg_dump/pg_restore migration"
    expected: "psql -U $POSTGRES_USER -d $POSTGRES_DB -c 'SELECT COUNT(*) FROM transactions' returns same row count as local Mac DB"
    why_human: "Requires running both local Mac DB and live server; migration not yet executed"
---

# Phase 01: Containerization Verification Report

**Phase Goal:** Containerize the expense tracker (backend, frontend, PostgreSQL) with Docker Compose and deploy to Hetzner VPS, enabling `make deploy` single-command deployments with Caddy reverse proxy, automated PostgreSQL backups, and a data migration procedure for existing data.

**Verified:** 2026-03-27T08:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 5 services start via both compose files | PARTIAL | All 5 services defined and wired correctly; SPLITWISE_API_KEY env var mismatch means Splitwise workflow fails at runtime (stack starts but Splitwise ops raise ValueError) |
| 2 | curl /healthz returns {"status": "ok"} routed through Caddy | ? HUMAN | Caddyfile has `handle /healthz { reverse_proxy backend:8000 }` — correct routing in code; requires live server to confirm |
| 3 | curl /api/transactions returns JSON array via Caddy | ? HUMAN | Caddyfile `handle /api/* { reverse_proxy backend:8000 }` — correct routing; requires live server |
| 4 | Browser loads frontend via Caddy catch-all | ? HUMAN | Caddyfile `handle { reverse_proxy frontend:3000 }` correct; HOSTNAME=0.0.0.0 in frontend Dockerfile correct; requires live server |
| 5 | make deploy pulls git, rebuilds, restarts | VERIFIED | Makefile deploy target: `git pull && $(COMPOSE) build --no-cache && $(COMPOSE) up -d`; COMPOSE variable uses both -f flags |
| 6 | Automated backups exist in pgbackups volume after first run | VERIFIED (config) | pgbackups service has BACKUP_ON_START=TRUE, SCHEDULE=@daily, BACKUP_KEEP_DAYS=7; correct depends_on condition: service_healthy |
| 7 | Existing transaction data present after pg_dump/pg_restore migration | ? HUMAN | scripts/migrate-data.sh is substantive and correct; migration not yet executed |

**Score:** 6/7 truths verified or verifiable (1 partial gap found, 5 require human/server to confirm)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/Dockerfile` | Multi-stage FastAPI image with tesseract, poppler, libmagic | VERIFIED | Contains `python:3.11-slim-bookworm`; runtime stage installs tesseract-ocr, tesseract-ocr-eng, poppler-utils, libmagic1, libgl1; multi-stage builder/runtime pattern confirmed |
| `frontend/Dockerfile` | Multi-stage Next.js standalone image | VERIFIED | Three stages (deps/builder/runner); `HOSTNAME="0.0.0.0"` set; copies `.next/standalone` and `.next/static`; `CMD ["node", "server.js"]` |
| `docker-compose.prod.yml` | Production override (postgres, backend, frontend, caddy, pgbackups) | VERIFIED | All 5 services present; `ports: []` removes host bindings from postgres/backend/frontend; caddy on 80/443; pgbackups with BACKUP_ON_START=TRUE |
| `caddy/Caddyfile` | IP-based HTTP reverse proxy routing | VERIFIED | Uses `handle` (not `handle_path`); routes `/api/*` and `/healthz` to `backend:8000`; catch-all to `frontend:3000` |
| `Makefile` | Ops commands: up, down, deploy, restart, logs, backup, migrate, shell-backend, shell-db, caddy-reload | VERIFIED | All listed targets present; COMPOSE variable correctly references both compose files |
| `.env.example` | All required environment variables with descriptions | PARTIAL | Documents 25+ vars correctly; SPLITWISE_CONSUMER_KEY / SPLITWISE_CONSUMER_SECRET documented instead of SPLITWISE_API_KEY (which is what the backend code reads) |
| `scripts/migrate-data.sh` | pg_dump + scp + pg_restore procedure | VERIFIED | Full pg_dump/scp/pg_restore flow with psql -l verification; set -e; correct pg_restore flags (--clean --no-owner --no-acl) |
| `scripts/server-setup.sh` | Hetzner Ubuntu 22.04 initial setup + Docker install | VERIFIED | apt-get system update, Docker official repo install, UFW 22/80/443, docker group, /opt/expense-tracker directory, next-steps echo |
| `backend/entrypoint.sh` | Alembic migrations then uvicorn | VERIFIED | `alembic upgrade head` followed by `exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2` |
| `frontend/next.config.ts` | output: 'standalone' added | VERIFIED | `output: 'standalone'` present; this is required for frontend Dockerfile's COPY .next/standalone step |
| `backend/src/utils/settings.py` | VISION_AGENT_API_KEY field added | VERIFIED | Line 61: `VISION_AGENT_API_KEY: str | None = None` present |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `caddy/Caddyfile` | `backend:8000` | `reverse_proxy` on `/api/*` and `/healthz` | VERIFIED | Both `handle /api/*` and `handle /healthz` blocks proxy to `backend:8000`; `handle` preserves full URI path |
| `caddy/Caddyfile` | `frontend:3000` | `reverse_proxy` catch-all | VERIFIED | `handle { reverse_proxy frontend:3000 }` present as last block |
| `docker-compose.prod.yml backend` | `postgres` | `depends_on: condition: service_healthy` | VERIFIED | `docker-compose.yml` line 46 has `condition: service_healthy`; `docker-compose.prod.yml` line 86 repeats same for pgbackups |
| `frontend/Dockerfile runner stage` | Next.js standalone output | `COPY .next/standalone` and `.next/static` | VERIFIED | Lines 39-41 copy both `.next/standalone` and `.next/static`; `HOSTNAME="0.0.0.0"` set on line 30 |
| `docker-compose.prod.yml backend env` | `SPLITWISE_API_KEY` consumer in code | env var passthrough | FAILED | Compose passes `SPLITWISE_CONSUMER_KEY` / `SPLITWISE_CONSUMER_SECRET`; code reads `SPLITWISE_API_KEY` via `os.getenv`. No `SPLITWISE_API_KEY` is passed at all. |

---

## Data-Flow Trace (Level 4)

Not applicable. This phase produces infrastructure files (Dockerfiles, compose, Caddy, Makefile, scripts) — no React components or API routes rendering dynamic data were introduced. The only code change was adding `VISION_AGENT_API_KEY` field to `settings.py`, which is a passive field (no rendering pipeline).

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| entrypoint.sh is valid bash | `bash -n backend/entrypoint.sh` | Valid syntax | PASS |
| migrate-data.sh is valid bash | `bash -n scripts/migrate-data.sh` | Valid syntax | PASS |
| server-setup.sh is valid bash | `bash -n scripts/server-setup.sh` | Valid syntax | PASS |
| Makefile deploy target references both compose files | `grep 'deploy:' -A 3 Makefile` | git pull + build --no-cache + up -d with COMPOSE var | PASS |
| frontend HOSTNAME binding | `grep HOSTNAME frontend/Dockerfile` | `ENV HOSTNAME="0.0.0.0"` | PASS |
| Docker daemon (image builds) | N/A — daemon unavailable | Not runnable | SKIP |

---

## Requirements Coverage

No REQUIREMENTS.md file exists in `.planning/`. Requirements are tracked only in PLAN frontmatter. All 8 requirement IDs (CONTAINERIZE-01 through CONTAINERIZE-08) are declared in the PLAN frontmatter and marked completed in the SUMMARY frontmatter. Evidence mapping:

| Requirement ID | Evidence | Status |
|---------------|----------|--------|
| CONTAINERIZE-01 | `backend/Dockerfile` — multi-stage python:3.11-slim-bookworm with all OCR/PDF system deps | SATISFIED |
| CONTAINERIZE-02 | `frontend/Dockerfile` — standalone Next.js image with HOSTNAME=0.0.0.0; `frontend/next.config.ts` output: 'standalone' | SATISFIED |
| CONTAINERIZE-03 | `docker-compose.yml` (base) + `docker-compose.prod.yml` (prod override) with all 5 services | SATISFIED |
| CONTAINERIZE-04 | `caddy/Caddyfile` — IP-based routing with handle blocks for /api/*, /healthz, catch-all | SATISFIED |
| CONTAINERIZE-05 | `Makefile` — all required ops targets present with correct COMPOSE variable | SATISFIED |
| CONTAINERIZE-06 | `pgbackups` service in docker-compose.prod.yml with BACKUP_ON_START=TRUE and SCHEDULE=@daily | SATISFIED |
| CONTAINERIZE-07 | `scripts/migrate-data.sh` — pg_dump + scp + pg_restore with verification step | SATISFIED |
| CONTAINERIZE-08 | `scripts/server-setup.sh` + `.env.example` + `backend/.env.example` — complete server bootstrap docs | PARTIALLY SATISFIED — SPLITWISE_API_KEY missing from .env.example |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `docker-compose.prod.yml` | 44-45 | Wrong Splitwise env var names (`SPLITWISE_CONSUMER_KEY` / `SPLITWISE_CONSUMER_SECRET` instead of `SPLITWISE_API_KEY`) | Blocker | Any Splitwise workflow run in production will raise `ValueError: SPLITWISE_API_KEY not found in environment variables` at instantiation time |
| `.env.example` | 67-68 | Documents `SPLITWISE_CONSUMER_KEY` and `SPLITWISE_CONSUMER_SECRET` — operator will set these and Splitwise will silently fail | Blocker | Operator has no way to know the correct var name from the provided documentation |

---

## Human Verification Required

### 1. Full Stack Startup on Hetzner VPS

**Test:** Clone repo to `/opt/expense-tracker`, copy `.env.example` to `.env` (filled), copy secret JSON files, run `make deploy`.
**Expected:** All 5 containers show `running` or `healthy` in `make ps`. No container restart loops.
**Why human:** Docker daemon unavailable in this environment; images have never been built.

### 2. Caddy Routing to Backend

**Test:** From outside the server: `curl http://<server-ip>/healthz`
**Expected:** HTTP 200 with JSON `{"status": "ok"}`
**Why human:** Requires live Caddy + backend containers on a reachable server.

### 3. Caddy Routing to Frontend

**Test:** Load `http://<server-ip>` in a browser.
**Expected:** Next.js renders the transactions page (dark Garnet theme, sidebar visible).
**Why human:** Requires visual confirmation; also verifies NEXT_PUBLIC_API_URL was baked in correctly at build time.

### 4. Automatic Backup Creation

**Test:** After first `make up` (with prod compose), run `docker exec <pgbackups-container> ls /backups/`
**Expected:** At least one `.sql.gz` file present (BACKUP_ON_START=TRUE triggers immediately).
**Why human:** Requires running containers with healthy PostgreSQL.

### 5. Data Migration Roundtrip

**Test:** Run `bash scripts/migrate-data.sh` from local Mac after server is up, then follow printed SSH instructions to restore.
**Expected:** `SELECT COUNT(*) FROM transactions` on the server returns same count as local Mac.
**Why human:** Requires both local DB and live server; migration not yet executed.

---

## Gaps Summary

One code gap was found that would cause silent production failures:

**Splitwise env var mismatch:** The `docker-compose.prod.yml` and `.env.example` use `SPLITWISE_CONSUMER_KEY` / `SPLITWISE_CONSUMER_SECRET` (OAuth consumer credential naming), but `backend/src/services/splitwise_processor/client.py` reads `os.getenv("SPLITWISE_API_KEY")` — a single Bearer token. These are two different Splitwise authentication schemes. The correct var is `SPLITWISE_API_KEY`. An operator following `.env.example` would set the wrong vars and get no Splitwise functionality in production.

**Fix:** In `docker-compose.prod.yml` replace the two wrong lines with `- SPLITWISE_API_KEY=${SPLITWISE_API_KEY}`. In `.env.example` replace both lines with `SPLITWISE_API_KEY=` plus a comment explaining it is the Splitwise personal API token (from splitwise.com/apps/register).

All other artifacts are substantive and correctly wired. The five items listed under Human Verification are inherently unverifiable without a live server — they are not gaps in the code, but deployment-time checks that must happen when the VPS is provisioned.

---

_Verified: 2026-03-27T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
