from __future__ import annotations

import hashlib
import io
from decimal import Decimal

import pandas as pd
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.database_manager.models import Expense, ProcessedItem, SourceType


class ExpenseIngestionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _mark_processed(self, item_type: str, external_id: str) -> bool:
        """Return True if newly marked, False if already processed."""
        exists = await self.db.execute(
            select(ProcessedItem).where(
                and_(ProcessedItem.item_type == item_type, ProcessedItem.external_id == external_id)
            )
        )
        if exists.scalars().first():
            return False
        self.db.add(ProcessedItem(item_type=item_type, external_id=external_id))
        await self.db.flush()
        return True

    async def ingest_file(self, filename: str, content_type: str | None, data: bytes) -> dict[str, int]:
        file_hash = hashlib.sha256(data).hexdigest()
        if not await self._mark_processed("file", file_hash):
            return {"created": 0, "skipped": 0}

        created = 0
        skipped = 0

        if filename.lower().endswith(".csv") or (content_type and "csv" in content_type):
            created, skipped = await self._ingest_csv(data, source_id=file_hash)
        elif filename.lower().endswith(".pdf"):
            # TODO: OCR + LLM parse from PDF
            raise NotImplementedError("PDF ingestion not implemented yet")
        else:
            # Assume image -> OCR + LLM later
            raise NotImplementedError("Image ingestion not implemented yet")

        return {"created": created, "skipped": skipped}

    async def _ingest_csv(self, data: bytes, source_id: str) -> tuple[int, int]:
        buf = io.BytesIO(data)
        df = pd.read_csv(buf)
        required_cols = {"date", "amount", "merchant"}
        if not required_cols.issubset({c.lower() for c in df.columns}):
            raise ValueError("CSV must contain date, amount, merchant columns")

        created = 0
        skipped = 0
        for _, row in df.iterrows():
            expense = Expense(
                date=pd.to_datetime(row["date"]).date(),
                amount=Decimal(str(row["amount"])),
                currency=str(row.get("currency", "USD")),
                merchant=str(row["merchant"]),
                category=str(row.get("category")) if not pd.isna(row.get("category")) else None,
                description=str(row.get("description")) if not pd.isna(row.get("description")) else None,
                source_type=SourceType.FILE,
                source_id=source_id,
            )

            # Dedup: date + amount + merchant + source_id
            existing = await self.db.execute(
                select(Expense).where(
                    and_(
                        Expense.date == expense.date,
                        Expense.amount == expense.amount,
                        Expense.merchant == expense.merchant,
                        Expense.source_id == source_id,
                    )
                )
            )
            if existing.scalars().first():
                skipped += 1
                continue

            self.db.add(expense)
            created += 1

        await self.db.flush()
        return created, skipped

    async def ingest_gmail_recent(self) -> dict[str, int]:
        # TODO: Implement Gmail API fetch + LLM parse
        return {"created": 0, "skipped": 0}


