"""
Database initialization script run by entrypoint.sh before uvicorn starts.

- Fresh database: creates schema from models and stamps Alembic at head.
- Existing database: runs pending Alembic migrations.
"""

import os
import subprocess
import sys

import psycopg2


def is_db_initialized() -> bool:
    try:
        conn = psycopg2.connect(
            host=os.environ["DB_HOST"],
            port=os.environ.get("DB_PORT", 5432),
            dbname=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ.get("DB_PASSWORD", ""),
        )
        cur = conn.cursor()
        cur.execute("SELECT to_regclass('public.alembic_version')")
        result = cur.fetchone()[0]
        conn.close()
        return result is not None
    except Exception:
        return False


def create_schema() -> None:
    sys.path.insert(0, "/app")
    from src.services.database_manager.connection import Base
    from src.services.database_manager.models import (  # noqa: F401 — imports register models on Base
        Account,
        Category,
        StatementProcessingLog,
        Tag,
        Transaction,
        TransactionTag,
    )
    from src.utils.settings import get_settings
    from sqlalchemy import create_engine

    settings = get_settings()
    db_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    engine.dispose()


if __name__ == "__main__":
    if is_db_initialized():
        print("Existing database detected — running Alembic migrations...")
        subprocess.run(["alembic", "upgrade", "head"], check=True)
    else:
        print("Fresh database detected — creating schema from models and stamping at head...")
        create_schema()
        subprocess.run(["alembic", "stamp", "head"], check=True)
        print("Schema created successfully.")
