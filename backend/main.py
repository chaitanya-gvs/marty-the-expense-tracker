import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.apis.routes.transaction_routes import router as transaction_router
from src.apis.routes.settlement_routes import router as settlement_router
from src.apis.routes.participant_routes import router as participant_router
from src.utils.settings import get_settings

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
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
