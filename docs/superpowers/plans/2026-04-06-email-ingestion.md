# Email Alert Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest bank transaction alert emails in real-time, deduplicate against monthly statement OCR, and surface unmatched transactions in a review queue.

**Architecture:** APScheduler embedded in FastAPI polls Gmail per-account using `alert_sender` watermarks. A tiered dedup service (reference number → amount+date window → ambiguous) reconciles email vs statement transactions. Unmatched/ambiguous statement items land in a dedicated `review_queue` table, surfaced in a new tab on `/review`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, APScheduler 3.x, Gmail API (existing `EmailClient`), React 19, TanStack Query, Tailwind CSS 4, shadcn/ui

---

## File Map

**New backend files:**
- `backend/src/services/email_ingestion/parsers/base.py` — `BaseAlertParser` abstract class
- `backend/src/services/email_ingestion/parsers/__init__.py` — `BankParserRegistry`
- `backend/src/services/email_ingestion/parsers/sbi_card.py` — SBI Card CC parser
- `backend/src/services/email_ingestion/parsers/hdfc.py` — HDFC CC parser
- `backend/src/services/email_ingestion/parsers/icici.py` — ICICI CC parser
- `backend/src/services/email_ingestion/parsers/axis_credit.py` — Axis Atlas CC parser
- `backend/src/services/email_ingestion/parsers/axis_savings.py` — Axis Bank Savings parser
- `backend/src/services/email_ingestion/parsers/yes_bank.py` — Yes Bank Savings parser
- `backend/src/services/email_ingestion/dedup_service.py` — tiered dedup logic
- `backend/src/services/email_ingestion/alert_ingestion_service.py` — run orchestrator
- `backend/src/services/database_manager/models/review_queue.py` — `ReviewQueue` ORM model
- `backend/src/services/database_manager/operations/review_queue_operations.py` — queue CRUD
- `backend/src/apis/routes/email_ingestion_routes.py` — POST /email-ingestion/run + GET /email-ingestion/status
- `backend/src/apis/schemas/email_ingestion.py` — request/response schemas
- `backend/scripts/validate_email_dedup.py` — pre-launch validation script

**Modified backend files:**
- `backend/pyproject.toml` — add `apscheduler`
- `backend/src/utils/settings.py` — add `EMAIL_INGESTION_INTERVAL_HOURS`
- `backend/src/services/database_manager/models/account.py` — 2 new columns
- `backend/src/services/database_manager/models/transaction.py` — 2 new columns
- `backend/src/services/database_manager/models/__init__.py` — export `ReviewQueue`
- `backend/src/services/database_manager/operations/__init__.py` — export `ReviewQueueOperations`
- `backend/src/services/database_manager/operations/transaction_operations.py` — 2 new bulk dedup query methods
- `backend/src/services/orchestrator/statement_workflow.py` — add dedup pass post-extraction
- `backend/main.py` — register APScheduler + new router

**New migration files:**
- `backend/src/services/database_manager/migrations/versions/l7m8n9o0p1q2_add_email_ingestion_columns.py`
- `backend/src/services/database_manager/migrations/versions/m8n9o0p1q2r3_add_review_queue_table.py`

**New frontend files:**
- `frontend/src/components/review/statement-review-queue.tsx` — statement-only + ambiguous queue UI
- `frontend/src/hooks/use-review-queue.ts` — TanStack Query hooks for queue

**Modified frontend files:**
- `frontend/src/lib/types/index.ts` — add `ReviewQueueItem`, `EmailIngestionRunResponse`
- `frontend/src/lib/api/client.ts` — add `runEmailIngestion()`, `getReviewQueue()`, `confirmReviewItem()`, `deleteReviewItem()`, `linkReviewItem()`
- `frontend/src/components/review/review-queue.tsx` — add tabs (existing workflow + new statement queue)

---

## Task 1: Create Feature Branch

- [ ] **Step 1: Create and switch to new branch**
```bash
cd D:/dev/personal-projects/marty-the-expense-tracker
git checkout -b feature/email-alert-ingestion
```
- [ ] **Step 2: Verify you are on the new branch**
```bash
git branch --show-current
# Expected: feature/email-alert-ingestion
```

---

## Task 2: Add APScheduler Dependency + Settings

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/src/utils/settings.py`
- Modify: `backend/configs/.env` (add placeholder)

- [ ] **Step 1: Add apscheduler to pyproject.toml**

In `backend/pyproject.toml`, under `[tool.poetry.dependencies]`, add:
```toml
apscheduler = "^3.10.4"
```

- [ ] **Step 2: Install the dependency**
```bash
cd backend
poetry install
```
Expected: `apscheduler` installed with no errors.

- [ ] **Step 3: Add setting to settings.py**

In `backend/src/utils/settings.py`, add inside the `Settings` class after the `FRONTEND_URL` line:
```python
# Email ingestion scheduler
EMAIL_INGESTION_INTERVAL_HOURS: int = 4
```

- [ ] **Step 4: Add placeholder to .env**

In `backend/configs/.env`, add:
```
EMAIL_INGESTION_INTERVAL_HOURS=4
```

- [ ] **Step 5: Commit**
```bash
git add backend/pyproject.toml backend/poetry.lock backend/src/utils/settings.py backend/configs/.env
git commit -m "chore: add apscheduler dependency and EMAIL_INGESTION_INTERVAL_HOURS setting"
```

---

## Task 3: Migration 1 — accounts + transactions columns

**Files:**
- Modify: `backend/src/services/database_manager/models/account.py`
- Modify: `backend/src/services/database_manager/models/transaction.py`
- Create: `backend/src/services/database_manager/migrations/versions/l7m8n9o0p1q2_add_email_ingestion_columns.py`

- [ ] **Step 1: Add columns to Account model**

In `backend/src/services/database_manager/models/account.py`, add after the `updated_at` field:
```python
alert_sender: Mapped[Optional[str]] = mapped_column(String, nullable=True)
alert_last_processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 2: Add columns to Transaction model**

In `backend/src/services/database_manager/models/transaction.py`, add after the `updated_at` field:
```python
email_message_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
statement_confirmed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
```

And in `__table_args__`, add:
```python
Index('idx_transactions_email_message_id', 'email_message_id'),
Index('idx_transactions_reference_number', 'reference_number'),
```

- [ ] **Step 3: Generate migration**
```bash
cd backend
poetry run alembic revision --autogenerate -m "add email ingestion columns to accounts and transactions"
```
Expected: new file in `migrations/versions/` with a hash prefix.

- [ ] **Step 4: Rename migration to match naming convention**

Rename the generated file to `l7m8n9o0p1q2_add_email_ingestion_columns.py`. Open it and verify the `upgrade()` contains:
- `op.add_column('accounts', sa.Column('alert_sender', sa.String(), nullable=True))`
- `op.add_column('accounts', sa.Column('alert_last_processed_at', sa.DateTime(timezone=True), nullable=True))`
- `op.add_column('transactions', sa.Column('email_message_id', sa.Text(), nullable=True))`
- `op.add_column('transactions', sa.Column('statement_confirmed', sa.Boolean(), nullable=True))`
- `op.create_index('idx_transactions_email_message_id', 'transactions', ['email_message_id'])`
- `op.create_index('idx_transactions_reference_number', 'transactions', ['reference_number'])`

- [ ] **Step 5: Apply migration**
```bash
poetry run alembic upgrade head
```
Expected: `Running upgrade ... -> l7m8n9o0p1q2`

- [ ] **Step 6: Commit**
```bash
git add backend/src/services/database_manager/models/account.py \
        backend/src/services/database_manager/models/transaction.py \
        backend/src/services/database_manager/migrations/versions/l7m8n9o0p1q2_add_email_ingestion_columns.py
git commit -m "feat(db): add alert_sender, alert_last_processed_at, email_message_id, statement_confirmed columns"
```

---

## Task 4: Migration 2 — review_queue table

**Files:**
- Create: `backend/src/services/database_manager/models/review_queue.py`
- Modify: `backend/src/services/database_manager/models/__init__.py`
- Create: `backend/src/services/database_manager/migrations/versions/m8n9o0p1q2r3_add_review_queue_table.py`

- [ ] **Step 1: Create ReviewQueue model**

Create `backend/src/services/database_manager/models/review_queue.py`:
```python
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import ARRAY, Boolean, Date, DateTime, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.services.database_manager.connection import Base


class ReviewQueue(Base):
    """Staging table for statement transactions awaiting manual review."""

    __tablename__ = "review_queue"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    review_type: Mapped[str] = mapped_column(Text, nullable=False)  # 'statement_only' | 'ambiguous'
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    account: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(Text, nullable=False)  # 'debit' | 'credit'
    transaction_type: Mapped[str] = mapped_column(Text, nullable=False)
    reference_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    ambiguous_candidate_ids: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 'confirmed' | 'linked' | 'deleted'

    __table_args__ = (
        Index('idx_review_queue_unresolved', 'review_type', postgresql_where=~resolved_at.is_(None)),
    )
```

- [ ] **Step 2: Export from models __init__**

In `backend/src/services/database_manager/models/__init__.py`, add:
```python
from .review_queue import ReviewQueue
```
And add `"ReviewQueue"` to `__all__`.

- [ ] **Step 3: Generate migration**
```bash
cd backend
poetry run alembic revision --autogenerate -m "add review queue table"
```

- [ ] **Step 4: Rename + verify migration**

Rename to `m8n9o0p1q2r3_add_review_queue_table.py`. Verify `upgrade()` creates the `review_queue` table with all columns and the partial index.

- [ ] **Step 5: Apply migration**
```bash
poetry run alembic upgrade head
```
Expected: `Running upgrade l7m8n9o0p1q2 -> m8n9o0p1q2r3`

- [ ] **Step 6: Commit**
```bash
git add backend/src/services/database_manager/models/review_queue.py \
        backend/src/services/database_manager/models/__init__.py \
        backend/src/services/database_manager/migrations/versions/m8n9o0p1q2r3_add_review_queue_table.py
git commit -m "feat(db): add review_queue table for statement reconciliation staging"
```

---

## Task 5: Parser Base Class + Registry

**Files:**
- Create: `backend/src/services/email_ingestion/parsers/base.py`
- Create: `backend/src/services/email_ingestion/parsers/__init__.py`
- Create: `backend/tests/test_email_parsers.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_email_parsers.py`:
```python
import pytest
from src.services.email_ingestion.parsers.base import BaseAlertParser
from src.services.email_ingestion.parsers import BankParserRegistry


def test_base_parser_is_abstract():
    with pytest.raises(TypeError):
        BaseAlertParser()


def test_registry_returns_none_for_unknown_sender():
    registry = BankParserRegistry()
    assert registry.get_parser("unknown@random.com") is None


def test_registry_returns_parser_for_known_sender():
    registry = BankParserRegistry()
    # Will pass once parsers are registered in Task 6+
    parser = registry.get_parser("alerts@sbicard.com")
    assert parser is not None
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd backend
poetry run pytest tests/test_email_parsers.py -v
```
Expected: ImportError or AttributeError (modules don't exist yet).

- [ ] **Step 3: Create base parser**

Create `backend/src/services/email_ingestion/parsers/base.py`:
```python
from __future__ import annotations

import html as html_lib
import re
from abc import ABC, abstractmethod
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional


AMOUNT_REGEXES = [
    re.compile(r"(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.\d{1,2})?)", re.IGNORECASE),
    re.compile(r"([0-9,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr)", re.IGNORECASE),
]

DIRECTION_KEYWORDS = {
    "debit": ["debited", "spent", "withdrawn", "paid", "sent", "purchase", "used", "charged"],
    "credit": ["credited", "received", "refund", "reversed", "cashback"],
}

REFERENCE_REGEXES = [
    re.compile(r"(?:rrn|utr|txn(?:\s*id)?|txnid|reference(?:\s*no)?|ref(?:\.?)?)[:\s#-]*([A-Za-z0-9/-]+)", re.IGNORECASE),
]


class BaseAlertParser(ABC):
    """Abstract base for all bank alert email parsers."""

    EMANDATE_KEYWORDS = ["e-mandate", "emandate", "nach", "auto debit", "standing instruction"]

    def is_emandate(self, text: str) -> bool:
        lower = text.lower()
        return any(kw in lower for kw in self.EMANDATE_KEYWORDS)

    def parse_emandate(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Override in subclasses that need e-mandate handling."""
        return self.parse_regular(email_content)

    @abstractmethod
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse a regular (non-mandate) transaction email."""

    def parse(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        if self.is_emandate(combined):
            return self.parse_emandate(email_content)
        return self.parse_regular(email_content)

    # ── Shared extraction helpers ──────────────────────────────────────────

    def _extract_amount(self, text: str) -> Optional[float]:
        for regex in AMOUNT_REGEXES:
            m = regex.search(text)
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    continue
        return None

    def _detect_direction(self, text_lower: str) -> Optional[str]:
        for direction, keywords in DIRECTION_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                return direction
        return None

    def _extract_reference(self, text: str) -> Optional[str]:
        for regex in REFERENCE_REGEXES:
            m = regex.search(text)
            if m:
                return m.group(1).strip()
        return None

    def _extract_last4(self, text: str) -> Optional[str]:
        for pattern in [
            re.compile(r"(?:xx|[*x]{2,})\s*([0-9]{4})", re.IGNORECASE),
            re.compile(r"(?:a/c|acct|account|ending|card)\D*([0-9]{4})", re.IGNORECASE),
        ]:
            m = pattern.search(text)
            if m:
                return m.group(1)
        return None

    def _extract_datetime(self, text: str):
        """Returns (date_str, time_str) or (None, None)."""
        month_map = {"JAN":"01","FEB":"02","MAR":"03","APR":"04","MAY":"05","JUN":"06",
                     "JUL":"07","AUG":"08","SEP":"09","OCT":"10","NOV":"11","DEC":"12"}
        m = re.search(r"(\d{2})-([A-Z]{3})-(\d{4})\s+(\d{2}:\d{2}:\d{2})", text)
        if m:
            day, mon, year, t = m.groups()
            mo = month_map.get(mon.upper())
            if mo:
                return f"{year}-{mo}-{day}", t
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})", text)
        if m:
            day, mo, year, t = m.groups()
            return f"{year}-{mo}-{day}", t
        m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})", text)
        if m:
            day, mo, year = m.groups()
            year = f"20{year}" if len(year) == 2 else year
            return f"{year}-{mo}-{day}", None
        return None, None

    def _parse_email_date(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            return parsedate_to_datetime(date_str)
        except (TypeError, ValueError):
            return None

    def _clean_text(self, text: str) -> str:
        text = html_lib.unescape(text or "")
        text = re.sub(r"<[^>]+>", " ", text)
        text = text.replace("\u00a0", " ")
        return re.sub(r"\s+", " ", text).strip()

    def _build_result(
        self,
        email_content: Dict[str, Any],
        amount: Optional[float],
        direction: Optional[str],
        description: str,
        transaction_date: Optional[str],
        transaction_time: Optional[str],
        reference_number: Optional[str],
        account_identifier: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Assemble the standard output dict. Returns None if required fields are missing."""
        if amount is None or direction is None:
            return None
        parsed_date = self._parse_email_date(email_content.get("date"))
        if not transaction_date and parsed_date:
            transaction_date = parsed_date.date().isoformat()
        if not transaction_time and parsed_date:
            transaction_time = parsed_date.time().strftime("%H:%M:%S")
        return {
            "transaction_date": transaction_date,
            "transaction_time": transaction_time,
            "amount": amount,
            "direction": direction,
            "description": self._clean_text(description) or email_content.get("subject", "Alert"),
            "reference_number": reference_number,
            "account_identifier": account_identifier,
            "email_message_id": email_content.get("id"),
            "email_sender": email_content.get("sender"),
            "raw_data": {
                "source": "email_alert",
                "sender": email_content.get("sender"),
                "subject": email_content.get("subject"),
                "reference_number": reference_number,
            },
        }
```

- [ ] **Step 4: Create BankParserRegistry**

Create `backend/src/services/email_ingestion/parsers/__init__.py`:
```python
from __future__ import annotations

from typing import Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class BankParserRegistry:
    """Maps alert_sender email addresses to their parser instances.
    Populated lazily on first use so import order doesn't matter.
    """

    def __init__(self):
        self._registry: Dict[str, BaseAlertParser] = {}
        self._built = False

    def _build(self):
        if self._built:
            return
        from src.services.email_ingestion.parsers.sbi_card import SBICardParser
        from src.services.email_ingestion.parsers.hdfc import HDFCParser
        from src.services.email_ingestion.parsers.icici import ICICIParser
        from src.services.email_ingestion.parsers.axis_credit import AxisCreditParser
        from src.services.email_ingestion.parsers.axis_savings import AxisSavingsParser
        from src.services.email_ingestion.parsers.yes_bank import YesBankParser
        # Keys must match exactly the alert_sender values stored in the accounts table
        self._registry = {
            "alerts@sbicard.com": SBICardParser(),
            "alerts@hdfcbank.net": HDFCParser(),
            "alerts@icicibank.com": ICICIParser(),
            "alerts@axisbank.com": AxisCreditParser(),
            "alerts@axisbank.in": AxisSavingsParser(),
            "alerts@yesbank.in": YesBankParser(),
        }
        self._built = True

    def get_parser(self, alert_sender: str) -> Optional[BaseAlertParser]:
        self._build()
        return self._registry.get(alert_sender.lower().strip())

    def all_senders(self):
        self._build()
        return list(self._registry.keys())


# Singleton used by the ingestion service
parser_registry = BankParserRegistry()
```

- [ ] **Step 5: Run first two tests (abstract + unknown sender)**
```bash
cd backend
poetry run pytest tests/test_email_parsers.py::test_base_parser_is_abstract tests/test_email_parsers.py::test_registry_returns_none_for_unknown_sender -v
```
Expected: PASS (third test still fails — parsers not yet written).

- [ ] **Step 6: Commit**
```bash
git add backend/src/services/email_ingestion/parsers/ backend/tests/test_email_parsers.py
git commit -m "feat(parsers): add BaseAlertParser and BankParserRegistry"
```

---

## Task 6: Bank Parsers (6 parsers)

**Files:** One file per parser in `backend/src/services/email_ingestion/parsers/`

- [ ] **Step 1: Create SBI Card parser**

Create `backend/src/services/email_ingestion/parsers/sbi_card.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class SBICardParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["spent", "debited"]) else \
                    "credit" if "credited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_sbi_merchant(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction, description or subject,
                                  date_val, time_val, ref, last4)

    def parse_emandate(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit"
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_sbi_emandate_merchant(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or "E-Mandate Debit", date_val, time_val, ref, last4)

    def _extract_sbi_merchant(self, text: str) -> Optional[str]:
        m = re.search(r"spent\s+on\s+your\s+sbi\s+credit\s+card.*?\s+at\s+([A-Za-z0-9 &./_-]+)",
                      text, re.IGNORECASE)
        if m:
            merchant = m.group(1).strip()
            return re.split(r"\bon\b|\bfrom\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        return None

    def _extract_sbi_emandate_merchant(self, text: str) -> Optional[str]:
        m = re.search(
            r"transaction\s+of\s+rs\.?\s*[\d,]+(?:\.\d{1,2})?\s+at\s+([A-Za-z0-9 &./_-]+?)\s+against\s+e-?mandate",
            text, re.IGNORECASE)
        return m.group(1).strip() if m else None
```

- [ ] **Step 2: Create HDFC parser**

Create `backend/src/services/email_ingestion/parsers/hdfc.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class HDFCParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if "debited" in lower else "credit" if "credited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_hdfc_merchant(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_hdfc_merchant(self, text: str) -> Optional[str]:
        # "towards <merchant> on <date>"
        m = re.search(r"towards\s+(.+?)\s+on\s+", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        return m.group(1).strip() if m else None
```

- [ ] **Step 3: Create ICICI parser**

Create `backend/src/services/email_ingestion/parsers/icici.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class ICICIParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["debited", "spent"]) else \
                    "credit" if "credited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_merchant_at(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_merchant_at(self, text: str) -> Optional[str]:
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if not m:
            return None
        merchant = m.group(1).strip()
        return re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
```

- [ ] **Step 4: Create Axis Credit parser**

Create `backend/src/services/email_ingestion/parsers/axis_credit.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class AxisCreditParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["spent", "debited"]) else \
                    "credit" if "credited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_field_label(combined, "Merchant Name") or \
                      self._extract_merchant_at(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_field_label(self, text: str, label: str) -> Optional[str]:
        idx = text.lower().find(label.lower())
        if idx == -1:
            return None
        tail = text[idx + len(label):].lstrip(" :\t")
        return tail.splitlines()[0].strip() or None

    def _extract_merchant_at(self, text: str) -> Optional[str]:
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if not m:
            return None
        merchant = m.group(1).strip()
        return re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
```

- [ ] **Step 5: Create Axis Savings parser**

Create `backend/src/services/email_ingestion/parsers/axis_savings.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class AxisSavingsParser(BaseAlertParser):
    """Axis Bank savings account — sender domain differs from credit card."""

    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["debited", "withdrawn", "sent"]) else \
                    "credit" if any(k in lower for k in ["credited", "received"]) else None
        date_val, time_val = self._extract_datetime(combined)
        # Savings alerts typically say "to <beneficiary>" or "from <source>"
        description = self._extract_to_from(combined) or subject
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description, date_val, time_val, ref, last4)

    def _extract_to_from(self, text: str) -> Optional[str]:
        m = re.search(r"\bto\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if m:
            return re.split(r"\bon\b|\bvia\b", m.group(1), flags=re.IGNORECASE)[0].strip()
        m = re.search(r"\bfrom\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        return m.group(1).strip() if m else None
```

- [ ] **Step 6: Create Yes Bank parser**

Create `backend/src/services/email_ingestion/parsers/yes_bank.py`:
```python
from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class YesBankParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "credit" if "credited" in lower else \
                    "debit" if "debited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_after(combined, "on account of")
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_after(self, text: str, phrase: str) -> Optional[str]:
        idx = text.lower().find(phrase.lower())
        if idx == -1:
            return None
        return text[idx + len(phrase):].strip().splitlines()[0].strip() or None
```

- [ ] **Step 7: Run all parser tests**
```bash
cd backend
poetry run pytest tests/test_email_parsers.py -v
```
Expected: All 3 tests PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/src/services/email_ingestion/parsers/
git commit -m "feat(parsers): add 6 bank alert parsers with e-mandate variants"
```

---

## Task 7: DeduplicationService

**Files:**
- Create: `backend/src/services/email_ingestion/dedup_service.py`
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py`
- Create: `backend/tests/test_dedup_service.py`

- [ ] **Step 1: Add two bulk query methods to TransactionOperations**

In `backend/src/services/database_manager/operations/transaction_operations.py`, add inside the `TransactionOperations` class:

```python
@staticmethod
async def get_transactions_by_email_message_ids(message_ids: list[str]) -> set[str]:
    """Return set of email_message_ids already present in transactions table."""
    if not message_ids:
        return set()
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("SELECT email_message_id FROM transactions WHERE email_message_id = ANY(:ids)"),
            {"ids": message_ids}
        )
        return {row[0] for row in result.fetchall()}

@staticmethod
async def get_email_transactions_for_dedup(
    account: str,
    date_from: date,
    date_to: date,
) -> list[dict]:
    """Fetch email_ingestion transactions for a date window used in Tier 1/2 dedup."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                SELECT id, transaction_date, amount, direction, reference_number, account
                FROM transactions
                WHERE account = :account
                  AND transaction_source = 'email_ingestion'
                  AND transaction_date BETWEEN :date_from AND :date_to
                  AND is_deleted = false
            """),
            {"account": account, "date_from": date_from, "date_to": date_to}
        )
        return [dict(row._mapping) for row in result.fetchall()]

@staticmethod
async def mark_statement_confirmed(transaction_id: str) -> None:
    """Set statement_confirmed = true on an email_ingestion transaction."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("UPDATE transactions SET statement_confirmed = true, updated_at = now() WHERE id = :id"),
            {"id": transaction_id}
        )
        await session.commit()
```

- [ ] **Step 2: Write failing dedup tests**

Create `backend/tests/test_dedup_service.py`:
```python
import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from src.services.email_ingestion.dedup_service import DeduplicationService, DeduplicationResult


def make_stmt_tx(amount=100.0, account="Test Account", ref="UTR123",
                 tx_date=date(2026, 4, 1), direction="debit"):
    return {"amount": Decimal(str(amount)), "account": account,
            "reference_number": ref, "transaction_date": tx_date, "direction": direction}


def make_email_tx(tx_id="abc-123", amount=100.0, account="Test Account",
                  ref="UTR123", tx_date=date(2026, 4, 1), direction="debit"):
    return {"id": tx_id, "amount": Decimal(str(amount)), "account": account,
            "reference_number": ref, "transaction_date": tx_date, "direction": direction}


@pytest.mark.asyncio
async def test_tier1_match_by_reference_number():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref="UTR999")
    candidates = [make_email_tx(ref="UTR999")]
    result = svc._match_tier1(stmt, candidates)
    assert result.tier == 1
    assert result.matched_id == "abc-123"


@pytest.mark.asyncio
async def test_tier2_single_match_by_amount_and_date():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref=None)  # no reference
    candidates = [make_email_tx(ref=None, tx_date=date(2026, 4, 2))]  # 1 day drift
    result = svc._match_tier2(stmt, candidates)
    assert result.tier == 2
    assert result.matched_id == "abc-123"


@pytest.mark.asyncio
async def test_tier3_ambiguous_when_multiple_amount_matches():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref=None)
    candidates = [
        make_email_tx(tx_id="id-1", ref=None),
        make_email_tx(tx_id="id-2", ref=None),
    ]
    result = svc._match_tier2(stmt, candidates)
    assert result.tier == 3
    assert len(result.candidate_ids) == 2


def test_no_match_returns_tier_none():
    svc = DeduplicationService()
    stmt = make_stmt_tx(amount=999.0, ref=None)
    candidates = [make_email_tx(amount=100.0, ref=None)]
    result = svc._match_tier2(stmt, candidates)
    assert result.tier is None
```

- [ ] **Step 3: Run tests to verify they fail**
```bash
cd backend
poetry run pytest tests/test_dedup_service.py -v
```
Expected: ImportError (module not yet created).

- [ ] **Step 4: Create DeduplicationService**

Create `backend/src/services/email_ingestion/dedup_service.py`:
```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)

DATE_WINDOW_DAYS = 3


@dataclass
class DeduplicationResult:
    tier: Optional[int]           # 1, 2, 3, or None
    matched_id: Optional[str] = None
    candidate_ids: List[str] = field(default_factory=list)

    @property
    def is_confirmed(self) -> bool:
        return self.tier in (1, 2)

    @property
    def is_ambiguous(self) -> bool:
        return self.tier == 3

    @property
    def is_unmatched(self) -> bool:
        return self.tier is None


class DeduplicationService:
    """Tiered deduplication: reference number → amount+date window → ambiguous."""

    def _match_tier1(
        self, stmt_tx: Dict[str, Any], candidates: List[Dict[str, Any]]
    ) -> DeduplicationResult:
        ref = (stmt_tx.get("reference_number") or "").strip()
        if not ref:
            return DeduplicationResult(tier=None)
        for c in candidates:
            c_ref = (c.get("reference_number") or "").strip()
            if c_ref and c_ref == ref:
                return DeduplicationResult(tier=1, matched_id=str(c["id"]))
        return DeduplicationResult(tier=None)

    def _match_tier2(
        self, stmt_tx: Dict[str, Any], candidates: List[Dict[str, Any]]
    ) -> DeduplicationResult:
        stmt_amount = Decimal(str(stmt_tx["amount"]))
        stmt_date: date = stmt_tx["transaction_date"]
        date_min = stmt_date - timedelta(days=DATE_WINDOW_DAYS)
        date_max = stmt_date + timedelta(days=DATE_WINDOW_DAYS)

        matches = [
            c for c in candidates
            if Decimal(str(c["amount"])) == stmt_amount
            and date_min <= c["transaction_date"] <= date_max
        ]
        if len(matches) == 1:
            return DeduplicationResult(tier=2, matched_id=str(matches[0]["id"]))
        if len(matches) > 1:
            return DeduplicationResult(tier=3, candidate_ids=[str(m["id"]) for m in matches])
        return DeduplicationResult(tier=None)

    async def match_statement_transaction(
        self, stmt_tx: Dict[str, Any], has_alert_sender: bool
    ) -> DeduplicationResult:
        """Full tiered match for one statement transaction against email_ingestion candidates."""
        account = stmt_tx["account"]
        stmt_date: date = stmt_tx["transaction_date"]
        date_from = stmt_date - timedelta(days=DATE_WINDOW_DAYS)
        date_to = stmt_date + timedelta(days=DATE_WINDOW_DAYS)

        candidates = await TransactionOperations.get_email_transactions_for_dedup(
            account=account, date_from=date_from, date_to=date_to
        )

        tier1 = self._match_tier1(stmt_tx, candidates)
        if tier1.is_confirmed:
            await TransactionOperations.mark_statement_confirmed(tier1.matched_id)
            return tier1

        tier2 = self._match_tier2(stmt_tx, candidates)
        if tier2.is_confirmed:
            await TransactionOperations.mark_statement_confirmed(tier2.matched_id)
            return tier2
        if tier2.is_ambiguous:
            return tier2

        # No match
        if not has_alert_sender:
            return DeduplicationResult(tier=None)  # caller inserts normally
        return DeduplicationResult(tier=None)  # caller adds to review queue

    async def is_email_already_ingested(
        self, email_message_id: str, reference_number: Optional[str],
        amount: float, account: str, tx_date: date
    ) -> bool:
        """Two-step email-to-email dedup: exact ID then fuzzy."""
        # Step 1: exact Gmail message ID
        existing = await TransactionOperations.get_transactions_by_email_message_ids([email_message_id])
        if email_message_id in existing:
            return True
        # Step 2: fuzzy (different email ID, same transaction data)
        if reference_number:
            date_from = tx_date - timedelta(days=DATE_WINDOW_DAYS)
            date_to = tx_date + timedelta(days=DATE_WINDOW_DAYS)
            candidates = await TransactionOperations.get_email_transactions_for_dedup(
                account=account, date_from=date_from, date_to=date_to
            )
            for c in candidates:
                if (c.get("reference_number") or "").strip() == reference_number.strip():
                    logger.info("Skipping duplicate email (different ID, same ref %s)", reference_number)
                    return True
        return False
```

- [ ] **Step 5: Run dedup tests**
```bash
cd backend
poetry run pytest tests/test_dedup_service.py -v
```
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/src/services/email_ingestion/dedup_service.py \
        backend/src/services/database_manager/operations/transaction_operations.py \
        backend/tests/test_dedup_service.py
git commit -m "feat(dedup): add tiered DeduplicationService with email-to-email and statement-to-email matching"
```

---

## Task 8: ReviewQueue Operations

**Files:**
- Create: `backend/src/services/database_manager/operations/review_queue_operations.py`
- Modify: `backend/src/services/database_manager/operations/__init__.py`

- [ ] **Step 1: Create ReviewQueueOperations**

Create `backend/src/services/database_manager/operations/review_queue_operations.py`:
```python
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ReviewQueueOperations:

    @staticmethod
    async def add_item(
        review_type: str,
        transaction_date: date,
        amount: Decimal,
        description: str,
        account: str,
        direction: str,
        transaction_type: str,
        reference_number: Optional[str] = None,
        raw_data: Optional[Dict[str, Any]] = None,
        ambiguous_candidate_ids: Optional[List[str]] = None,
    ) -> str:
        """Insert a review queue item. Returns the new item's UUID."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    INSERT INTO review_queue
                        (review_type, transaction_date, amount, description, account,
                         direction, transaction_type, reference_number, raw_data, ambiguous_candidate_ids)
                    VALUES
                        (:review_type, :transaction_date, :amount, :description, :account,
                         :direction, :transaction_type, :reference_number, :raw_data::jsonb,
                         :ambiguous_candidate_ids)
                    RETURNING id
                """),
                {
                    "review_type": review_type,
                    "transaction_date": transaction_date,
                    "amount": str(amount),
                    "description": description,
                    "account": account,
                    "direction": direction,
                    "transaction_type": transaction_type,
                    "reference_number": reference_number,
                    "raw_data": __import__("json").dumps(raw_data) if raw_data else None,
                    "ambiguous_candidate_ids": ambiguous_candidate_ids,
                }
            )
            await session.commit()
            return str(result.scalar())

    @staticmethod
    async def get_unresolved(review_type: Optional[str] = None) -> List[Dict[str, Any]]:
        session_factory = get_session_factory()
        async with session_factory() as session:
            where = "WHERE resolved_at IS NULL"
            params: Dict[str, Any] = {}
            if review_type:
                where += " AND review_type = :review_type"
                params["review_type"] = review_type
            result = await session.execute(
                text(f"SELECT * FROM review_queue {where} ORDER BY transaction_date DESC, created_at DESC"),
                params
            )
            return [dict(row._mapping) for row in result.fetchall()]

    @staticmethod
    async def resolve(item_id: str, resolution: str) -> bool:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE review_queue
                    SET resolved_at = now(), resolution = :resolution
                    WHERE id = :id AND resolved_at IS NULL
                """),
                {"id": item_id, "resolution": resolution}
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def bulk_resolve(item_ids: List[str], resolution: str) -> int:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE review_queue
                    SET resolved_at = now(), resolution = :resolution
                    WHERE id = ANY(:ids) AND resolved_at IS NULL
                """),
                {"ids": item_ids, "resolution": resolution}
            )
            await session.commit()
            return result.rowcount
```

- [ ] **Step 2: Export from operations __init__**

In `backend/src/services/database_manager/operations/__init__.py`, add:
```python
from .review_queue_operations import ReviewQueueOperations
```
And add `"ReviewQueueOperations"` to `__all__`.

- [ ] **Step 3: Commit**
```bash
git add backend/src/services/database_manager/operations/review_queue_operations.py \
        backend/src/services/database_manager/operations/__init__.py
git commit -m "feat(db): add ReviewQueueOperations CRUD"
```

---

## Task 9: AlertIngestionService + APScheduler

**Files:**
- Create: `backend/src/services/email_ingestion/alert_ingestion_service.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Create AlertIngestionService**

Create `backend/src/services/email_ingestion/alert_ingestion_service.py`:
```python
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.services.database_manager.operations.account_operations import AccountOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.dedup_service import DeduplicationService
from src.services.email_ingestion.parsers import parser_registry
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class AlertIngestionService:
    """Orchestrates one email ingestion run across all alert-enabled accounts."""

    def __init__(self):
        self.settings = get_settings()
        self.dedup = DeduplicationService()

    async def run(
        self,
        since_date: Optional[datetime] = None,
        account_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Run ingestion. If since_date is provided, use it as watermark (backfill mode).
        Otherwise, use each account's alert_last_processed_at.
        """
        accounts = await AccountOperations.get_all_accounts()
        alert_accounts = [
            a for a in accounts
            if a.get("alert_sender") and a.get("is_active")
            and (not account_ids or str(a["id"]) in account_ids)
        ]

        if not alert_accounts:
            logger.info("No alert-enabled accounts found")
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}

        totals = {"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}

        for account in alert_accounts:
            result = await self._run_for_account(account, since_date)
            totals["processed"] += result["processed"]
            totals["inserted"] += result["inserted"]
            totals["skipped"] += result["skipped"]
            totals["errors"] += result["errors"]
            totals["accounts"].append({"account": account.get("nickname"), **result})

        return totals

    async def _run_for_account(
        self, account: Dict[str, Any], since_date: Optional[datetime]
    ) -> Dict[str, Any]:
        alert_sender = account["alert_sender"]
        nickname = account.get("nickname", alert_sender)
        parser = parser_registry.get_parser(alert_sender)

        if not parser:
            logger.warning("No parser found for sender %s (account: %s)", alert_sender, nickname)
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 1}

        # Determine watermark
        watermark: Optional[datetime] = since_date
        if not watermark:
            lp = account.get("alert_last_processed_at")
            watermark = lp if isinstance(lp, datetime) else None

        try:
            email_client = EmailClient(account_id="primary")
            days_back = 7 if not watermark else None
            messages = email_client.list_recent_alert_emails(
                max_results=200,
                days_back=days_back,
                alert_senders=[alert_sender],
                since=watermark,
            )
        except Exception:
            logger.error("Failed to fetch emails for %s", nickname, exc_info=True)
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 1}

        processed = inserted = skipped = errors = 0
        transactions_to_insert: List[Dict[str, Any]] = []

        # Bulk message ID check
        message_ids = [m["id"] for m in messages if m.get("id")]
        existing_ids = await TransactionOperations.get_transactions_by_email_message_ids(message_ids)

        for message in messages:
            msg_id = message.get("id")
            if not msg_id:
                skipped += 1
                continue
            if msg_id in existing_ids:
                skipped += 1
                continue

            processed += 1
            try:
                content = email_client.get_email_content(msg_id)
                parsed = parser.parse(content)
                if not parsed:
                    skipped += 1
                    continue

                # Email-to-email fuzzy dedup
                from datetime import date as date_type
                tx_date_raw = parsed.get("transaction_date")
                tx_date = (datetime.strptime(tx_date_raw, "%Y-%m-%d").date()
                           if tx_date_raw else datetime.now().date())

                already = await self.dedup.is_email_already_ingested(
                    email_message_id=msg_id,
                    reference_number=parsed.get("reference_number"),
                    amount=parsed["amount"],
                    account=account.get("nickname", ""),
                    tx_date=tx_date,
                )
                if already:
                    skipped += 1
                    continue

                tx = self._build_transaction(parsed, account)
                transactions_to_insert.append(tx)
            except Exception:
                errors += 1
                logger.error("Error processing email %s for %s", msg_id, nickname, exc_info=True)

        # Bulk insert
        if transactions_to_insert:
            try:
                result = await TransactionOperations.bulk_insert_transactions(
                    transactions_to_insert, check_duplicates=False, upsert_splitwise=False
                )
                inserted = result.get("inserted_count", 0)
            except Exception:
                errors += len(transactions_to_insert)
                logger.error("Bulk insert failed for %s", nickname, exc_info=True)

        # Update watermark (skip in backfill mode — watermark set by since_date)
        if not since_date:
            await AccountOperations.update_alert_last_processed_at(str(account["id"]))

        return {"processed": processed, "inserted": inserted, "skipped": skipped, "errors": errors}

    def _build_transaction(self, parsed: Dict[str, Any], account: Dict[str, Any]) -> Dict[str, Any]:
        # auto_categorize hook — no-op until auto-categorization is implemented
        category_id = None  # TODO: call auto_categorize(parsed["description"]) here

        return {
            "transaction_date": parsed["transaction_date"],
            "transaction_time": parsed.get("transaction_time"),
            "amount": parsed["amount"],
            "direction": parsed["direction"],
            "transaction_type": parsed["direction"],  # debit/credit mirrors direction for email
            "description": parsed["description"],
            "account": account.get("nickname", parsed.get("email_sender", "")),
            "email_message_id": parsed["email_message_id"],
            "reference_number": parsed.get("reference_number"),
            "transaction_source": "email_ingestion",
            "category_id": category_id,
            "raw_data": parsed.get("raw_data", {}),
            "related_mails": [parsed["email_message_id"]],
            "statement_confirmed": False,
        }
```

- [ ] **Step 2: Add `update_alert_last_processed_at` to AccountOperations**

In `backend/src/services/database_manager/operations/account_operations.py`, add:
```python
@staticmethod
async def update_alert_last_processed_at(account_id: str) -> bool:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                UPDATE accounts
                SET alert_last_processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = :account_id
            """), {"account_id": account_id}
        )
        await session.commit()
        return result.rowcount > 0
```

- [ ] **Step 3: Register APScheduler in main.py**

Replace the lifespan function in `backend/main.py` with:
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

_scheduler: AsyncIOScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    setup_logging()

    settings = get_settings()
    _scheduler = AsyncIOScheduler()

    async def _scheduled_ingestion():
        from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService
        try:
            result = await AlertIngestionService().run()
            logger.info("Scheduled email ingestion complete: %s", result)
        except Exception:
            logger.error("Scheduled email ingestion failed", exc_info=True)

    _scheduler.add_job(
        _scheduled_ingestion,
        "interval",
        hours=settings.EMAIL_INGESTION_INTERVAL_HOURS,
        id="email_ingestion",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("APScheduler started (interval: %dh)", settings.EMAIL_INGESTION_INTERVAL_HOURS)

    yield

    _scheduler.shutdown(wait=False)
```

Also add `logger = get_logger(__name__)` near the top of `main.py` (after the imports).

- [ ] **Step 4: Verify server starts without errors**
```bash
cd backend
poetry run uvicorn main:app --reload
```
Expected: Server starts, logs `APScheduler started (interval: 4h)` with no errors. Stop with Ctrl+C.

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/email_ingestion/alert_ingestion_service.py \
        backend/src/services/database_manager/operations/account_operations.py \
        backend/main.py
git commit -m "feat(ingestion): add AlertIngestionService and APScheduler"
```

---

## Task 10: Email Ingestion API Routes

**Files:**
- Create: `backend/src/apis/schemas/email_ingestion.py`
- Create: `backend/src/apis/routes/email_ingestion_routes.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Create schemas**

Create `backend/src/apis/schemas/email_ingestion.py`:
```python
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class EmailIngestionRunRequest(BaseModel):
    since_date: Optional[datetime] = None
    account_ids: Optional[List[str]] = None


class AccountIngestionResult(BaseModel):
    account: Optional[str]
    processed: int
    inserted: int
    skipped: int
    errors: int


class EmailIngestionRunResponse(BaseModel):
    processed: int
    inserted: int
    skipped: int
    errors: int
    accounts: List[AccountIngestionResult]
```

- [ ] **Step 2: Create routes**

Create `backend/src/apis/routes/email_ingestion_routes.py`:
```python
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
```

- [ ] **Step 3: Register router in main.py**

In `backend/main.py`, add the import:
```python
from src.apis.routes.email_ingestion_routes import router as email_ingestion_router
```
And register it with auth:
```python
app.include_router(email_ingestion_router, prefix="/api", dependencies=_auth)
```

- [ ] **Step 4: Verify endpoint appears in docs**
```bash
cd backend
poetry run uvicorn main:app --reload
```
Open `http://localhost:8000/docs` — verify `POST /api/email-ingestion/run` is listed.

- [ ] **Step 5: Commit**
```bash
git add backend/src/apis/schemas/email_ingestion.py \
        backend/src/apis/routes/email_ingestion_routes.py \
        backend/main.py
git commit -m "feat(api): add POST /api/email-ingestion/run endpoint"
```

---

## Task 11: Statement Workflow Dedup Integration

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py`
- Create: `backend/tests/test_statement_dedup_integration.py`

- [ ] **Step 1: Write failing integration test**

Create `backend/tests/test_statement_dedup_integration.py`:
```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from decimal import Decimal
from datetime import date


@pytest.mark.asyncio
async def test_dedup_marks_statement_confirmed_on_tier1_match():
    from src.services.email_ingestion.dedup_service import DeduplicationService, DeduplicationResult
    with patch.object(DeduplicationService, "match_statement_transaction",
                      return_value=DeduplicationResult(tier=1, matched_id="tx-1")) as mock_match:
        # Simulate calling dedup on a statement tx from an alert-enabled account
        svc = DeduplicationService()
        result = await svc.match_statement_transaction(
            {"amount": Decimal("100"), "account": "Test", "reference_number": "UTR1",
             "transaction_date": date(2026, 4, 1), "direction": "debit"},
            has_alert_sender=True,
        )
        assert result.is_confirmed
        assert result.matched_id == "tx-1"
```

- [ ] **Step 2: Run test to verify it passes (dedup service already exists)**
```bash
cd backend
poetry run pytest tests/test_statement_dedup_integration.py -v
```
Expected: PASS.

- [ ] **Step 3: Add dedup pass to statement_workflow.py**

In `backend/src/services/orchestrator/statement_workflow.py`, find the method that inserts standardized transactions (likely `_insert_transactions` or similar). Import and call the dedup service after extraction, before insertion:

```python
# Add at the top of statement_workflow.py:
from src.services.email_ingestion.dedup_service import DeduplicationService
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations
```

Find the loop that processes standardized transactions before bulk insert. Replace direct insertion with:

```python
dedup_service = DeduplicationService()
to_insert = []
for tx in standardized_transactions:
    # Determine if this account has an alert_sender configured
    account_info = await AccountOperations.get_account_by_sender_email(sender_email)
    has_alert_sender = bool(account_info and account_info.get("alert_sender"))

    result = await dedup_service.match_statement_transaction(tx, has_alert_sender=has_alert_sender)

    if result.is_confirmed:
        # Already exists as email_ingestion tx — now statement_confirmed
        continue
    elif result.is_ambiguous:
        await ReviewQueueOperations.add_item(
            review_type="ambiguous",
            transaction_date=tx["transaction_date"],
            amount=tx["amount"],
            description=tx["description"],
            account=tx["account"],
            direction=tx["direction"],
            transaction_type=tx.get("transaction_type", tx["direction"]),
            reference_number=tx.get("reference_number"),
            raw_data=tx,
            ambiguous_candidate_ids=result.candidate_ids,
        )
    elif has_alert_sender:
        # No match on alert-enabled account → statement-only review queue
        await ReviewQueueOperations.add_item(
            review_type="statement_only",
            transaction_date=tx["transaction_date"],
            amount=tx["amount"],
            description=tx["description"],
            account=tx["account"],
            direction=tx["direction"],
            transaction_type=tx.get("transaction_type", tx["direction"]),
            reference_number=tx.get("reference_number"),
            raw_data=tx,
        )
    else:
        to_insert.append(tx)

# bulk insert only the non-deduplicated transactions
if to_insert:
    await TransactionOperations.bulk_insert_transactions(to_insert, ...)
```

> **Note:** The exact method name and call site in `statement_workflow.py` must be found by reading the file. Look for where `bulk_insert_transactions` is called after standardization. The dedup loop wraps that call.

- [ ] **Step 4: Run existing workflow tests to confirm no regressions**
```bash
cd backend
poetry run pytest tests/test_workflow_orchestrator.py tests/test_complete_workflow.py -v
```
Expected: All existing tests PASS (new dedup path only fires when email_ingestion transactions exist).

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/orchestrator/statement_workflow.py \
        backend/tests/test_statement_dedup_integration.py
git commit -m "feat(workflow): integrate DeduplicationService into statement processing pipeline"
```

---

## Task 12: Review Queue API Routes

**Files:**
- Modify: `backend/src/apis/schemas/email_ingestion.py`
- Create: `backend/src/apis/routes/review_queue_routes.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Add review queue schemas**

Append to `backend/src/apis/schemas/email_ingestion.py`:
```python
class ReviewQueueItemResponse(BaseModel):
    id: str
    review_type: str
    transaction_date: str
    amount: float
    description: str
    account: str
    direction: str
    transaction_type: str
    reference_number: Optional[str]
    ambiguous_candidate_ids: Optional[List[str]]
    created_at: str
    resolved_at: Optional[str]
    resolution: Optional[str]


class ReviewQueueResponse(BaseModel):
    items: List[ReviewQueueItemResponse]
    total: int


class ConfirmReviewItemRequest(BaseModel):
    edits: Optional[Dict[str, Any]] = None  # optional field overrides before inserting


class LinkReviewItemRequest(BaseModel):
    transaction_id: str  # UUID of the email_ingestion tx to link to


class BulkConfirmRequest(BaseModel):
    item_ids: List[str]
```

- [ ] **Step 2: Create review queue routes**

Create `backend/src/apis/routes/review_queue_routes.py`:
```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.apis.schemas.email_ingestion import (
    ReviewQueueResponse, ReviewQueueItemResponse,
    ConfirmReviewItemRequest, LinkReviewItemRequest, BulkConfirmRequest,
)
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/review-queue", tags=["review-queue"])


@router.get("", response_model=ReviewQueueResponse)
async def get_review_queue(review_type: str | None = None):
    items = await ReviewQueueOperations.get_unresolved(review_type)
    return ReviewQueueResponse(
        items=[ReviewQueueItemResponse(**{**i, "amount": float(i["amount"]),
               "transaction_date": str(i["transaction_date"]),
               "created_at": str(i["created_at"]),
               "resolved_at": str(i["resolved_at"]) if i.get("resolved_at") else None})
               for i in items],
        total=len(items),
    )


@router.post("/{item_id}/confirm")
async def confirm_review_item(item_id: str, request: ConfirmReviewItemRequest = ConfirmReviewItemRequest()):
    """Insert statement-only item as a new transaction_extraction transaction."""
    items = await ReviewQueueOperations.get_unresolved()
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    tx = {**(item.get("raw_data") or {}), **(request.edits or {}),
          "transaction_source": "statement_extraction"}
    await TransactionOperations.bulk_insert_transactions([tx], check_duplicates=False, upsert_splitwise=False)
    await ReviewQueueOperations.resolve(item_id, "confirmed")
    return {"status": "confirmed"}


@router.post("/{item_id}/link")
async def link_review_item(item_id: str, request: LinkReviewItemRequest):
    """Link ambiguous item to a specific email_ingestion transaction."""
    resolved = await ReviewQueueOperations.resolve(item_id, "linked")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    await TransactionOperations.mark_statement_confirmed(request.transaction_id)
    return {"status": "linked"}


@router.delete("/{item_id}")
async def delete_review_item(item_id: str):
    resolved = await ReviewQueueOperations.resolve(item_id, "deleted")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    return {"status": "deleted"}


@router.post("/bulk-confirm")
async def bulk_confirm(request: BulkConfirmRequest):
    """Confirm all statement-only items in batch."""
    items = await ReviewQueueOperations.get_unresolved("statement_only")
    id_set = set(request.item_ids)
    to_confirm = [i for i in items if str(i["id"]) in id_set]
    txs = [{**(i.get("raw_data") or {}), "transaction_source": "statement_extraction"}
           for i in to_confirm]
    if txs:
        await TransactionOperations.bulk_insert_transactions(txs, check_duplicates=False, upsert_splitwise=False)
    count = await ReviewQueueOperations.bulk_resolve(request.item_ids, "confirmed")
    return {"confirmed": count}
```

- [ ] **Step 3: Register router in main.py**
```python
from src.apis.routes.review_queue_routes import router as review_queue_router
# ...
app.include_router(review_queue_router, prefix="/api", dependencies=_auth)
```

- [ ] **Step 4: Verify endpoints in docs**

Open `http://localhost:8000/docs`. Verify these exist:
- `GET /api/review-queue`
- `POST /api/review-queue/{item_id}/confirm`
- `POST /api/review-queue/{item_id}/link`
- `DELETE /api/review-queue/{item_id}`
- `POST /api/review-queue/bulk-confirm`

- [ ] **Step 5: Commit**
```bash
git add backend/src/apis/schemas/email_ingestion.py \
        backend/src/apis/routes/review_queue_routes.py \
        backend/main.py
git commit -m "feat(api): add review queue CRUD endpoints"
```

---

## Task 13: Frontend — Types + API Client

**Files:**
- Modify: `frontend/src/lib/types/index.ts`
- Modify: `frontend/src/lib/api/client.ts`

- [ ] **Step 1: Add new types**

In `frontend/src/lib/types/index.ts`, append:
```typescript
export interface ReviewQueueItem {
  id: string;
  review_type: "statement_only" | "ambiguous";
  transaction_date: string;
  amount: number;
  description: string;
  account: string;
  direction: "debit" | "credit";
  transaction_type: string;
  reference_number?: string | null;
  ambiguous_candidate_ids?: string[] | null;
  created_at: string;
  resolved_at?: string | null;
  resolution?: string | null;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
}

export interface EmailIngestionRunResponse {
  processed: number;
  inserted: number;
  skipped: number;
  errors: number;
  accounts: Array<{
    account: string | null;
    processed: number;
    inserted: number;
    skipped: number;
    errors: number;
  }>;
}
```

- [ ] **Step 2: Add API client methods**

In `frontend/src/lib/api/client.ts`, add the following methods to the `ApiClient` class:
```typescript
async runEmailIngestion(params?: { since_date?: string; account_ids?: string[] }): Promise<EmailIngestionRunResponse> {
  return this.request<EmailIngestionRunResponse>("/email-ingestion/run", {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  }) as Promise<EmailIngestionRunResponse>;
}

async getReviewQueue(review_type?: string): Promise<ReviewQueueResponse> {
  const qs = review_type ? `?review_type=${review_type}` : "";
  return this.request<ReviewQueueResponse>(`/review-queue${qs}`) as Promise<ReviewQueueResponse>;
}

async confirmReviewItem(itemId: string, edits?: Record<string, unknown>): Promise<void> {
  await this.request(`/review-queue/${itemId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ edits: edits ?? null }),
  });
}

async linkReviewItem(itemId: string, transactionId: string): Promise<void> {
  await this.request(`/review-queue/${itemId}/link`, {
    method: "POST",
    body: JSON.stringify({ transaction_id: transactionId }),
  });
}

async deleteReviewItem(itemId: string): Promise<void> {
  await this.request(`/review-queue/${itemId}`, { method: "DELETE" });
}

async bulkConfirmReviewItems(itemIds: string[]): Promise<{ confirmed: number }> {
  return this.request<{ confirmed: number }>("/review-queue/bulk-confirm", {
    method: "POST",
    body: JSON.stringify({ item_ids: itemIds }),
  }) as Promise<{ confirmed: number }>;
}
```

- [ ] **Step 3: Verify TypeScript compiles**
```bash
cd frontend
npm run build
```
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/lib/types/index.ts frontend/src/lib/api/client.ts
git commit -m "feat(frontend): add ReviewQueueItem types and API client methods"
```

---

## Task 14: Frontend — Hook + Review Queue UI

**Files:**
- Create: `frontend/src/hooks/use-review-queue.ts`
- Create: `frontend/src/components/review/statement-review-queue.tsx`
- Modify: `frontend/src/components/review/review-queue.tsx`

- [ ] **Step 1: Create useReviewQueue hook**

Create `frontend/src/hooks/use-review-queue.ts`:
```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export function useReviewQueue(review_type?: string) {
  return useQuery({
    queryKey: ["review-queue", review_type],
    queryFn: () => apiClient.getReviewQueue(review_type),
    staleTime: 30_000,
  });
}

export function useConfirmReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, edits }: { itemId: string; edits?: Record<string, unknown> }) =>
      apiClient.confirmReviewItem(itemId, edits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Transaction confirmed");
    },
    onError: () => toast.error("Failed to confirm transaction"),
  });
}

export function useLinkReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, transactionId }: { itemId: string; transactionId: string }) =>
      apiClient.linkReviewItem(itemId, transactionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Transaction linked");
    },
    onError: () => toast.error("Failed to link transaction"),
  });
}

export function useDeleteReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => apiClient.deleteReviewItem(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Item removed");
    },
  });
}

export function useBulkConfirmReviewItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => apiClient.bulkConfirmReviewItems(itemIds),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(`${data.confirmed} transactions confirmed`);
    },
  });
}

export function useRunEmailIngestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { since_date?: string; account_ids?: string[] }) =>
      apiClient.runEmailIngestion(params),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(`Ingestion complete — ${data.inserted} inserted, ${data.skipped} skipped`);
    },
    onError: () => toast.error("Email ingestion failed"),
  });
}
```

- [ ] **Step 2: Create StatementReviewQueue component**

Create `frontend/src/components/review/statement-review-queue.tsx`:
```typescript
"use client";

import { useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReviewQueue, useConfirmReviewItem, useDeleteReviewItem,
  useBulkConfirmReviewItems, useLinkReviewItem, useRunEmailIngestion,
} from "@/hooks/use-review-queue";
import type { ReviewQueueItem } from "@/lib/types";
import { RefreshCw, CheckCheck, Trash2, Link2 } from "lucide-react";

export function StatementReviewQueue() {
  const { data: statementOnly, isLoading: loadingOnly } = useReviewQueue("statement_only");
  const { data: ambiguous, isLoading: loadingAmbiguous } = useReviewQueue("ambiguous");
  const confirm = useConfirmReviewItem();
  const del = useDeleteReviewItem();
  const bulkConfirm = useBulkConfirmReviewItems();
  const link = useLinkReviewItem();
  const runIngestion = useRunEmailIngestion();
  const [activeTab, setActiveTab] = useState<"statement_only" | "ambiguous">("statement_only");

  const statementOnlyItems = statementOnly?.items ?? [];
  const ambiguousItems = ambiguous?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("statement_only")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "statement_only"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Statement-Only
            {statementOnlyItems.length > 0 && (
              <Badge variant="secondary" className="ml-2">{statementOnlyItems.length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab("ambiguous")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "ambiguous"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Ambiguous
            {ambiguousItems.length > 0 && (
              <Badge variant="destructive" className="ml-2">{ambiguousItems.length}</Badge>
            )}
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => runIngestion.mutate()}
            disabled={runIngestion.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${runIngestion.isPending ? "animate-spin" : ""}`} />
            Fetch Latest
          </Button>
          {activeTab === "statement_only" && statementOnlyItems.length > 0 && (
            <Button
              variant="secondary" size="sm"
              onClick={() => bulkConfirm.mutate(statementOnlyItems.map((i) => i.id))}
              disabled={bulkConfirm.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Confirm All
            </Button>
          )}
        </div>
      </div>

      {/* Statement-Only Tab */}
      {activeTab === "statement_only" && (
        <StatementOnlyList
          items={statementOnlyItems}
          isLoading={loadingOnly}
          onConfirm={(id) => confirm.mutate({ itemId: id })}
          onDelete={(id) => del.mutate(id)}
        />
      )}

      {/* Ambiguous Tab */}
      {activeTab === "ambiguous" && (
        <AmbiguousList
          items={ambiguousItems}
          isLoading={loadingAmbiguous}
          onLink={(itemId, txId) => link.mutate({ itemId, transactionId: txId })}
          onNoneMatch={(itemId) => confirm.mutate({ itemId })}
        />
      )}
    </div>
  );
}

function StatementOnlyList({
  items, isLoading, onConfirm, onDelete,
}: {
  items: ReviewQueueItem[];
  isLoading: boolean;
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (isLoading) return <div className="text-muted-foreground text-sm">Loading...</div>;
  if (items.length === 0) return (
    <div className="text-center py-10 text-muted-foreground text-sm">
      No statement-only transactions — all matched ✓
    </div>
  );

  return (
    <div className="divide-y rounded-md border">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between px-4 py-3 gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.description}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(item.transaction_date)} · {item.account}
            </p>
          </div>
          <span className={`text-sm font-semibold shrink-0 ${
            item.direction === "debit" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
          }`}>
            {item.direction === "debit" ? "-" : "+"}{formatCurrency(item.amount)}
          </span>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={() => onConfirm(item.id)}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AmbiguousList({
  items, isLoading, onLink, onNoneMatch,
}: {
  items: ReviewQueueItem[];
  isLoading: boolean;
  onLink: (itemId: string, txId: string) => void;
  onNoneMatch: (itemId: string) => void;
}) {
  if (isLoading) return <div className="text-muted-foreground text-sm">Loading...</div>;
  if (items.length === 0) return (
    <div className="text-center py-10 text-muted-foreground text-sm">
      No ambiguous matches ✓
    </div>
  );

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(item.transaction_date)} · {item.account} ·{" "}
                <span className={item.direction === "debit" ? "text-red-500" : "text-green-500"}>
                  {formatCurrency(item.amount)}
                </span>
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNoneMatch(item.id)}>
              None of these
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.ambiguous_candidate_ids?.length ?? 0} possible email matches:
          </p>
          <div className="flex flex-wrap gap-2">
            {(item.ambiguous_candidate_ids ?? []).map((txId) => (
              <Button key={txId} size="sm" variant="outline" onClick={() => onLink(item.id, txId)}>
                <Link2 className="h-3.5 w-3.5 mr-1" />
                Link {txId.slice(0, 8)}…
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update existing ReviewQueue component to add tabs**

In `frontend/src/components/review/review-queue.tsx`, read the current content and add a tab structure that hosts both the existing review content and the new `StatementReviewQueue`:

```typescript
// At top of file, add import:
import { StatementReviewQueue } from "@/components/review/statement-review-queue";

// Wrap existing content in a tabbed layout. Add a "Statement Queue" tab
// alongside the existing "Workflow / Flagged" tab.
// Use the same tab pattern already present in /settings (categories + tags tabs).
```

> **Note:** Read the current `review-queue.tsx` content first, then wrap it with a `useState("workflow")` tab switcher. Keep all existing logic untouched in its tab.

- [ ] **Step 4: Verify frontend builds**
```bash
cd frontend
npm run build
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/hooks/use-review-queue.ts \
        frontend/src/components/review/statement-review-queue.tsx \
        frontend/src/components/review/review-queue.tsx
git commit -m "feat(frontend): add statement review queue tab with confirm/link/delete actions"
```

---

## Task 15: Pre-Launch Validation Script

**Files:**
- Create: `backend/scripts/validate_email_dedup.py`

- [ ] **Step 1: Create validation script**

Create `backend/scripts/validate_email_dedup.py`:
```python
"""
Pre-launch validation: parse historical alert emails and check how well
they match against existing statement-extracted transactions in the DB.

Usage:
    poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31
    poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31 --account "Yes Bank Savings"
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, date, timedelta
from decimal import Decimal
from pathlib import Path

# Ensure backend src is on path when run as script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.parsers import parser_registry
from src.services.database_manager.operations.account_operations import AccountOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.services.email_ingestion.dedup_service import DeduplicationService, DATE_WINDOW_DAYS


async def validate(date_from: date, date_to: date, account_filter: str | None):
    accounts = await AccountOperations.get_all_accounts()
    alert_accounts = [
        a for a in accounts
        if a.get("alert_sender") and a.get("is_active")
        and (not account_filter or account_filter.lower() in (a.get("nickname") or "").lower())
    ]

    if not alert_accounts:
        print("No alert-enabled accounts found.")
        return

    dedup = DeduplicationService()
    overall = {"fetched": 0, "parse_fail": 0, "parsed": 0,
               "tier1": 0, "tier2": 0, "tier3": 0, "unmatched": 0}
    per_account = {}
    unmatched_rows = []
    parse_failures = []

    for account in alert_accounts:
        nickname = account.get("nickname", account["alert_sender"])
        parser = parser_registry.get_parser(account["alert_sender"])
        if not parser:
            print(f"  [WARN] No parser for {account['alert_sender']}, skipping.")
            continue

        email_client = EmailClient(account_id="primary")
        since = datetime.combine(date_from, datetime.min.time())
        messages = email_client.list_recent_alert_emails(
            max_results=500,
            days_back=None,
            alert_senders=[account["alert_sender"]],
            since=since,
        )
        # Filter to date range
        messages = [m for m in messages
                    if _email_date(m) and date_from <= _email_date(m) <= date_to]

        stats = {"fetched": len(messages), "parse_fail": 0, "parsed": 0,
                 "tier1": 0, "tier2": 0, "tier3": 0, "unmatched": 0}

        for msg in messages:
            overall["fetched"] += 1
            try:
                content = email_client.get_email_content(msg["id"])
                parsed = parser.parse(content)
                if not parsed:
                    stats["parse_fail"] += 1
                    overall["parse_fail"] += 1
                    parse_failures.append(f"  [{nickname}] \"{content.get('subject', '?')}\" — {content.get('date', '?')} — parse returned None")
                    continue
                stats["parsed"] += 1
                overall["parsed"] += 1

                tx_date = datetime.strptime(parsed["transaction_date"], "%Y-%m-%d").date()
                d_from = tx_date - timedelta(days=DATE_WINDOW_DAYS)
                d_to = tx_date + timedelta(days=DATE_WINDOW_DAYS)
                candidates = await TransactionOperations.get_email_transactions_for_dedup(
                    account=nickname, date_from=d_from, date_to=d_to
                )
                # Simulate tier matching (read-only — no DB writes)
                t1 = dedup._match_tier1(
                    {"reference_number": parsed.get("reference_number"),
                     "amount": Decimal(str(parsed["amount"])),
                     "transaction_date": tx_date},
                    candidates
                )
                if t1.is_confirmed:
                    stats["tier1"] += 1; overall["tier1"] += 1
                    continue
                t2 = dedup._match_tier2(
                    {"reference_number": parsed.get("reference_number"),
                     "amount": Decimal(str(parsed["amount"])),
                     "transaction_date": tx_date},
                    candidates
                )
                if t2.is_confirmed:
                    stats["tier2"] += 1; overall["tier2"] += 1
                elif t2.is_ambiguous:
                    stats["tier3"] += 1; overall["tier3"] += 1
                else:
                    stats["unmatched"] += 1; overall["unmatched"] += 1
                    unmatched_rows.append(
                        f"  {tx_date}  {parsed['amount']:>10.2f}  {nickname:<22}  {parsed['description'][:40]}"
                    )
            except Exception as exc:
                stats["parse_fail"] += 1
                overall["parse_fail"] += 1
                parse_failures.append(f"  [{nickname}] {msg.get('id', '?')} — {exc}")

        per_account[nickname] = stats

    _print_report(date_from, date_to, overall, per_account, unmatched_rows, parse_failures)


def _email_date(msg: dict) -> date | None:
    raw = msg.get("internalDate")
    if raw:
        try:
            return datetime.fromtimestamp(int(raw) / 1000).date()
        except Exception:
            pass
    return None


def _print_report(date_from, date_to, overall, per_account, unmatched_rows, parse_failures):
    pct = lambda n, d: f"({n/d*100:.1f}%)" if d else ""
    print("\n=== EMAIL DEDUP VALIDATION REPORT ===")
    print(f"Period: {date_from} → {date_to}\n")
    print("OVERALL SUMMARY")
    print(f"  Emails fetched:         {overall['fetched']:>5}")
    print(f"  Parse failures:         {overall['parse_fail']:>5}  {pct(overall['parse_fail'], overall['fetched'])}")
    print(f"  Successfully parsed:    {overall['parsed']:>5}")
    print(f"  Tier 1 matched (ref):   {overall['tier1']:>5}  {pct(overall['tier1'], overall['parsed'])}")
    print(f"  Tier 2 matched (amt):   {overall['tier2']:>5}  {pct(overall['tier2'], overall['parsed'])}")
    print(f"  Tier 3 ambiguous:       {overall['tier3']:>5}  {pct(overall['tier3'], overall['parsed'])}")
    print(f"  Unmatched:              {overall['unmatched']:>5}  {pct(overall['unmatched'], overall['parsed'])}")
    print("\nBREAKDOWN BY ACCOUNT")
    for name, s in per_account.items():
        print(f"  {name:<24} — {s['parsed']} parsed, {s['tier1']+s['tier2']} matched, "
              f"{s['tier3']} ambiguous, {s['unmatched']} unmatched, {s['parse_fail']} failures")
    if unmatched_rows:
        print("\nUNMATCHED TRANSACTIONS (forex, EMI, or parser gaps)")
        print(f"  {'Date':<12} {'Amount':>10}  {'Account':<22}  Description")
        for row in unmatched_rows:
            print(row)
    if parse_failures:
        print("\nPARSE FAILURES")
        for row in parse_failures:
            print(row)
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate email dedup accuracy against DB transactions.")
    parser.add_argument("--from", dest="date_from", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--account", dest="account", default=None, help="Filter to one account nickname")
    args = parser.parse_args()
    asyncio.run(validate(
        date.fromisoformat(args.date_from),
        date.fromisoformat(args.date_to),
        args.account,
    ))
```

- [ ] **Step 2: Verify script runs without crashing (dry run with no emails)**
```bash
cd backend
poetry run python scripts/validate_email_dedup.py --from 2026-04-01 --to 2026-04-06
```
Expected: Report prints (may show 0 emails if none have been ingested yet or Gmail auth prompts).

- [ ] **Step 3: Commit**
```bash
git add backend/scripts/validate_email_dedup.py
git commit -m "feat(scripts): add validate_email_dedup.py pre-launch validation script"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Real-time email ingestion for 6 accounts → Tasks 5, 6, 9
- [x] Scheduled + manual + backfill triggers → Tasks 9, 10
- [x] Tiered dedup (Tier 1/2/3 + email-to-email) → Task 7
- [x] review_queue table + operations → Tasks 4, 8
- [x] Statement workflow modified to call dedup → Task 11
- [x] Review queue API routes → Task 12
- [x] Frontend types + hooks + UI → Tasks 13, 14
- [x] Validation script → Task 15
- [x] APScheduler embedded in FastAPI → Task 9
- [x] Auto-categorization hook (no-op) → Task 9 `_build_transaction`
- [x] SBI Savings bypass (no alert_sender) → Tasks 7, 11

**Type consistency check:**
- `DeduplicationResult` defined in Task 7, used in Tasks 11, 12 ✓
- `ReviewQueueOperations.add_item()` signature matches call sites in Task 11 ✓
- `parser_registry` singleton defined in Task 5 `__init__.py`, used in Tasks 9, 15 ✓
- `alert_last_processed_at` column added in Task 3, used in `AccountOperations.update_alert_last_processed_at` in Task 9 ✓
- Frontend `ReviewQueueItem` fields match backend `ReviewQueueItemResponse` schema in Task 12 ✓

**Note on `list_recent_alert_emails` signature:** The existing `EmailClient.list_recent_alert_emails` method in the current codebase may have a different signature than what Tasks 9 and 15 assume (adding a `since` datetime parameter). Before implementing Task 9, read `backend/src/services/email_ingestion/client.py` and adapt the call to match the actual method signature or extend it to accept `since`.
