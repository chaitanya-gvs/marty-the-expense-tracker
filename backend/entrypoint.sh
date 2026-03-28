#!/bin/bash
set -e

echo "Checking database state..."
python scripts/init_db.py

echo "Starting uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
