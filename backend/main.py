from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.apis.routes.budget_routes import router as budget_router
from src.apis.routes.expense_routes import router as expense_router
from src.apis.routes.upload_routes import router as upload_router
from src.services.database_manager.base import Base
from src.services.database_manager.connection import get_engine
from src.utils.logger import get_logger
from src.utils.settings import get_settings


logger = get_logger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"Starting app: {settings.APP_NAME}")
    engine = get_engine()
    try:
        async with engine.begin() as conn:
            # Create tables if not present (MVP convenience; prefer Alembic in prod)
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        logger.warning(f"Database not available on startup: {repr(e)}")
    yield
    # Shutdown
    logger.info(f"Shutting down app: {settings.APP_NAME}")


app = FastAPI(title="Expense Tracker Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


app.include_router(expense_router, prefix="/api")
app.include_router(budget_router, prefix="/api")
app.include_router(upload_router, prefix="/api")


