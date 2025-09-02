from __future__ import annotations


from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from src.services.expense_manager.manager import ExpenseIngestionService


router = APIRouter(prefix="/upload", tags=["upload"])


class IngestResponse(BaseModel):
    created: int
    skipped: int


@router.post("/file", response_model=IngestResponse)
async def upload_file(
    file: UploadFile = File(...),
):
    content = await file.read()
    # Lazy import to avoid circular import during app bootstrap
    from src.services.database_manager.operations import get_db_session

    async with get_db_session() as db:
        service = ExpenseIngestionService(db)
        try:
            result = await service.ingest_file(file.filename, file.content_type, content)
            return IngestResponse(**result)
        except NotImplementedError as e:
            raise HTTPException(status_code=501, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


