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
