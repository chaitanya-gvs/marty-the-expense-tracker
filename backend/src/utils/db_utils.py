"""
Database utility helpers shared across route modules.
"""

from __future__ import annotations

import asyncpg
from src.services.database_manager.connection import refresh_connection_pool
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def handle_database_operation(operation_func, *args, **kwargs):
    """
    Handle database operations with automatic retry on InvalidCachedStatementError
    """
    max_retries = 2

    for attempt in range(max_retries):
        try:
            return await operation_func(*args, **kwargs)
        except asyncpg.exceptions.InvalidCachedStatementError as e:
            logger.warning(f"InvalidCachedStatementError on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                # Refresh connection pool and retry
                await refresh_connection_pool()
                logger.info("Refreshed connection pool, retrying operation")
                continue
            else:
                # Final attempt failed
                logger.error(f"Database operation failed after {max_retries} attempts", exc_info=True)
                raise e
        except Exception as e:
            # For other exceptions, don't retry
            raise e
