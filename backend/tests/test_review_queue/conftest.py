"""Pytest configuration for review_queue tests only."""
import pytest
from src.services.database_manager.connection import close_engine


@pytest.fixture(autouse=True)
async def cleanup_after_test():
    """Clean up database connections after each test in this directory only."""
    yield
    # Close the engine's connection pool after each test to prevent event loop issues
    try:
        await close_engine()
    except Exception:
        pass  # Ignore errors during cleanup
