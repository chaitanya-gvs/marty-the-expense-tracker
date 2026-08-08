"""Pytest configuration and fixtures."""
import pytest
import asyncio
from src.services.database_manager.connection import close_engine


@pytest.fixture(scope="session")
def event_loop_policy():
    """Set event loop policy for async tests."""
    if hasattr(asyncio, "DefaultEventLoopPolicy"):
        return asyncio.DefaultEventLoopPolicy()
    return asyncio.get_event_loop_policy()


@pytest.fixture(autouse=True)
async def cleanup_after_test():
    """Clean up database connections after each test."""
    yield
    # Close the engine's connection pool after each test
    try:
        await close_engine()
    except Exception:
        pass  # Ignore errors during cleanup
