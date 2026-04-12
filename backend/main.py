import uvicorn
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.apis.routes.auth_routes import router as auth_router
from src.apis.routes.transaction_read_routes import router as transaction_read_router
from src.apis.routes.transaction_write_routes import router as transaction_write_router
from src.apis.routes.transaction_split_routes import router as transaction_split_router
from src.apis.routes.settlement_routes import router as settlement_router
from src.apis.routes.participant_routes import router as participant_router
from src.apis.routes.workflow_routes import router as workflow_router
from src.apis.routes.splitwise_routes import router as splitwise_router
from src.apis.routes.email_ingestion_routes import router as email_ingestion_router
from src.apis.routes.review_queue_routes import router as review_queue_router
from src.utils.auth_deps import get_current_user
from src.utils.logger import get_logger, setup_logging
from src.utils.settings import get_settings

settings = get_settings()
logger = get_logger(__name__)

limiter = Limiter(key_func=get_remote_address)

_scheduler: AsyncIOScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    # Re-run after all imports complete so agentic_doc's basicConfig(force=True)
    # does not wipe our RotatingFileHandler.
    setup_logging()

    _scheduler = AsyncIOScheduler()

    async def _scheduled_ingestion():
        from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService
        try:
            result = await AlertIngestionService().run()
            logger.info("Scheduled email ingestion complete: %s", result)
        except Exception:
            logger.error("Scheduled email ingestion failed", exc_info=True)

    interval_hours = settings.EMAIL_INGESTION_INTERVAL_HOURS
    _scheduler.add_job(
        _scheduled_ingestion,
        "interval",
        hours=interval_hours,
        id="email_ingestion",
        replace_existing=True,
        # Delay first fire by the full interval so a container restart
        # doesn't immediately re-run ingestion that just completed.
        next_run_time=datetime.now() + timedelta(hours=interval_hours),
    )
    _scheduler.start()
    logger.info(
        "APScheduler started — first run in %dh, then every %dh",
        interval_hours, interval_hours,
    )

    yield

    _scheduler.shutdown(wait=False)


app = FastAPI(title="Expense Tracker Backend", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# Auth routes — public (no auth dependency)
app.include_router(auth_router, prefix="/api")

# All other routes — protected
_auth = [Depends(get_current_user)]
app.include_router(transaction_read_router, prefix="/api", dependencies=_auth)
app.include_router(transaction_write_router, prefix="/api", dependencies=_auth)
app.include_router(transaction_split_router, prefix="/api", dependencies=_auth)
app.include_router(settlement_router, prefix="/api", dependencies=_auth)
app.include_router(participant_router, prefix="/api", dependencies=_auth)
app.include_router(workflow_router, prefix="/api", dependencies=_auth)
app.include_router(splitwise_router, prefix="/api/splitwise", dependencies=_auth)
app.include_router(email_ingestion_router, prefix="/api", dependencies=_auth)
app.include_router(review_queue_router, prefix="/api", dependencies=_auth)


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
