from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.apis.routes.transaction_routes import router as transaction_router
from src.apis.routes.settlement_routes import router as settlement_router
from src.apis.routes.participant_routes import router as participant_router
from src.utils.logger import get_logger
from src.utils.settings import get_settings


logger = get_logger(__name__)
settings = get_settings()

app = FastAPI(title="Expense Tracker Backend")

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


app.include_router(transaction_router, prefix="/api")
app.include_router(settlement_router, prefix="/api")
app.include_router(participant_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting {settings.APP_NAME} server...")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
