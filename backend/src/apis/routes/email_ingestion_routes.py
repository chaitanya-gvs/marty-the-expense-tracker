from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.apis.schemas.email_ingestion import EmailIngestionRunRequest, EmailIngestionRunResponse
from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/email-ingestion", tags=["email-ingestion"])


@router.post("/run", response_model=EmailIngestionRunResponse)
async def run_email_ingestion(request: EmailIngestionRunRequest = EmailIngestionRunRequest()):
    """Trigger email alert ingestion. Optionally pass since_date for backfill."""
    try:
        service = AlertIngestionService()
        result = await service.run(
            since_date=request.since_date,
            account_ids=request.account_ids,
        )
        return EmailIngestionRunResponse(**result)
    except Exception as e:
        logger.error("Email ingestion run failed", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
