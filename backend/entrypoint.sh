#!/bin/bash
set -e

echo "Checking database state..."
# Check if alembic_version table exists (indicates an initialized database)
DB_INITIALIZED=$(python -c "
import psycopg2, os
try:
    conn = psycopg2.connect(
        host=os.environ['DB_HOST'],
        port=os.environ.get('DB_PORT', 5432),
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ.get('DB_PASSWORD', ''),
    )
    cur = conn.cursor()
    cur.execute(\"SELECT to_regclass('public.alembic_version')\")
    result = cur.fetchone()[0]
    conn.close()
    print('yes' if result else 'no')
except Exception:
    print('no')
" 2>/dev/null)

if [ "$DB_INITIALIZED" = "no" ]; then
    echo "Fresh database detected — creating schema from models and stamping migrations at head..."
    python -c "
import sys
sys.path.insert(0, '/app')
from src.services.database_manager.connection import Base
from src.services.database_manager.models import Account, Category, StatementProcessingLog, Tag, Transaction, TransactionTag
from src.utils.settings import get_settings
from sqlalchemy import create_engine

settings = get_settings()
db_url = settings.DATABASE_URL.replace('+asyncpg', '')
engine = create_engine(db_url)
Base.metadata.create_all(engine)
engine.dispose()
print('Schema created successfully.')
"
    alembic stamp head
else
    echo "Existing database detected — running Alembic migrations..."
    alembic upgrade head
fi

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
