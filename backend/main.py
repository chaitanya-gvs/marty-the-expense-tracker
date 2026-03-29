import uvicorn
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.apis.routes.auth_routes import router as auth_router
from src.apis.routes.transaction_read_routes import router as transaction_read_router
from src.apis.routes.transaction_write_routes import router as transaction_write_router
from src.apis.routes.transaction_split_routes import router as transaction_split_router
from src.apis.routes.settlement_routes import router as settlement_router
from src.apis.routes.participant_routes import router as participant_router
from src.apis.routes.workflow_routes import router as workflow_router
from src.apis.routes.splitwise_routes import router as splitwise_router
from src.utils.auth_deps import get_current_user
from src.utils.logger import setup_logging
from src.utils.settings import get_settings

settings = get_settings()

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Re-run after all imports complete so agentic_doc's basicConfig(force=True)
    # does not wipe our RotatingFileHandler.
    setup_logging()
    yield


app = FastAPI(title="Expense Tracker Backend", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
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


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
