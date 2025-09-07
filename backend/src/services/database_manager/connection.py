from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.utils.settings import get_settings


class Base(DeclarativeBase):
    """Base class for all database models"""
    pass


# Global variables for engine and session factory
_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine() -> AsyncEngine:
    """Get or create the database engine"""
    global _engine, _session_factory
    
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=False,  # Set to True for SQL query logging
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20
        )
        _session_factory = async_sessionmaker(
            bind=_engine,
            expire_on_commit=False,
            class_=AsyncSession
        )
    
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get the session factory for creating database sessions"""
    if _session_factory is None:
        get_engine()
    
    assert _session_factory is not None
    return _session_factory


async def close_engine():
    """Close the database engine and clean up resources"""
    global _engine, _session_factory
    
    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None


# Context manager for database sessions
async def get_db_session() -> AsyncSession:
    """Get a database session"""
    session_factory = get_session_factory()
    return session_factory()


