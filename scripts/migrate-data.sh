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
