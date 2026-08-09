# Backend Quick Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six verified, bounded backend issues found during a codebase audit: three dead-code removals (two of which were originally misdiagnosed as live async/sync bugs — verified to have zero callers before deletion), one SQL-injection landmine, one hardcoded credential, and one missing rate limit.

**Architecture:** No architectural change. Each task is an isolated, self-contained fix in its own file(s), verified independently. Tasks 1-3 are deletions (verified dead via exhaustive `grep` across `src/`, `scripts/`, `tests/` before removal — not guesses). Task 4 adds input validation. Task 5 replaces a hardcoded secret with the existing DB-backed password lookup. Task 6 applies the already-configured `slowapi` limiter (wired in `main.py`, precedent in `auth_routes.py`) to a second route.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, pytest + pytest-asyncio (real Postgres integration tests, no mocking of the DB layer — this repo's existing convention), slowapi (already a dependency).

## Global Constraints

- Run all backend commands from `backend/` (where `pyproject.toml` lives).
- Tests hit a real local Postgres (`localhost:5432`, db `expense_db`) — no DB mocking, matching existing test files like `tests/test_statement_log_operations.py`.
- Do not restart the dev server — not needed for these changes (no server running during plan execution; verification is via `pytest` and `ruff`, not the live app).
- After deleting any function, `grep` the whole repo (`src/`, `scripts/`, `tests/`) to confirm zero remaining references, and remove any import that becomes unused as a result (checked via `poetry run ruff check .`).
- Every task ends with `poetry run pytest tests/ -x` passing and `poetry run ruff check .` clean, then a commit.
- One commit per task, on branch `fix/backend-quick-wins` (already checked out).

---

### Task 1: Remove dead code — `_status_rank()` / `_STATUS_ORDER`

**Files:**
- Modify: `backend/src/services/database_manager/operations/statement_log_operations.py:1-27`
- Test: none new (verified via full suite + grep; this is a pure deletion of unreferenced code)

**Interfaces:**
- Consumes: nothing (this task has no dependency on other tasks)
- Produces: nothing (no other task depends on this one)

- [ ] **Step 1: Confirm zero remaining references**

```bash
cd backend
grep -rn "_status_rank\|_STATUS_ORDER" src/ tests/ scripts/ --include="*.py"
```

Expected: only the two definition lines (the function and the list it uses), nothing else. This confirms the deletion is safe before touching the file.

- [ ] **Step 2: Delete the dead function and its backing list**

In `backend/src/services/database_manager/operations/statement_log_operations.py`, remove lines 12-28 (the comment, `_STATUS_ORDER` list, blank lines, and `_status_rank` function), so the file goes directly from the imports/logger setup to the `StatementLogOperations` class:

```python
from __future__ import annotations

from typing import List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class StatementLogOperations:
```

(Everything from `class StatementLogOperations:` onward is unchanged — only the `_STATUS_ORDER` list and `_status_rank()` function above it are removed. Note the class's own methods already inline the same status-ordering logic directly in SQL via `array_position(ARRAY[...], ...)` — that inlined SQL version is what's actually live and is untouched by this task.)

- [ ] **Step 3: Confirm nothing broke**

```bash
poetry run ruff check src/services/database_manager/operations/statement_log_operations.py
poetry run pytest tests/test_statement_log_operations.py -v
```

Expected: ruff clean, all tests pass (these tests exercise `upsert_log`, `update_status`, etc. — none of which call the deleted function).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/database_manager/operations/statement_log_operations.py
git commit -m "chore: remove dead _status_rank()/_STATUS_ORDER (zero callers, superseded by inline SQL array_position)"
```

---

### Task 2: Remove dead code — `PDFUnlocker.unlock_pdf()` and `_get_password_for_bank()`

**Files:**
- Modify: `backend/src/services/statement_processor/pdf_unlocker.py:1-96`
- Test: none new (verified via full suite + grep)

**Interfaces:**
- Consumes: nothing
- Produces: nothing. **Important for later tasks:** the *live* password-resolution path stays exactly as-is — `unlock_pdf_with_password(pdf_path, password, account_nickname=None)` still takes the password as a parameter, resolved by the caller (`StatementWorkflow._unlock_pdf_async()` via `await self.password_manager.get_password_for_sender_async(sender_email)`, and — after Task 5 — the reconciliation script the same way).

- [ ] **Step 1: Confirm zero remaining references to the methods being deleted**

```bash
cd backend
grep -rn "\.unlock_pdf(" --include="*.py" . | grep -v ".venv\|__pycache__\|unlock_pdf_with_password\|def unlock_pdf"
grep -rn "_get_password_for_bank" src/ tests/ scripts/ --include="*.py"
```

Expected: first command returns nothing (no caller of the plain `unlock_pdf()` method anywhere). Second command returns only the one definition line and its one call site inside `unlock_pdf()` itself (which is being deleted in the same step, so that call site goes with it).

- [ ] **Step 2: Delete `unlock_pdf()` (lines 31-60) and `_get_password_for_bank()` (lines 87-96)**

Remove this method entirely (the plain, no-callers `unlock_pdf`):

```python
    def unlock_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Unlock a password-protected PDF statement.

        Returns a dict with 'success' bool and either 'unlocked_path' or 'error'.
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {"success": False, "error": f"PDF file not found: {pdf_path}"}

            logger.info(f"Unlocking PDF: {pdf_path.name}")

            password = self._get_password_for_bank(pdf_path.name)
            if not password:
                return {"success": False, "error": "No password found for this PDF"}

            logger.info("Password found, proceeding with unlock")

            if self._unlock_pdf_with_password(pdf_path, password):
                saved_path = self._save_unlocked_pdf(pdf_path)
                if saved_path:
                    logger.info(f"Unlocked PDF saved to: {saved_path}")
                    return {"success": True, "unlocked_path": saved_path}
                return {"success": False, "error": "Failed to save unlocked PDF"}
            return {"success": False, "error": "Password authentication failed"}

        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}", exc_info=True)
            return {"success": False, "error": str(e)}
```

And remove this method entirely (its only caller was the one just deleted):

```python
    def _get_password_for_bank(self, filename: str) -> Optional[str]:
        """Resolve sender email from filename and look up the statement password."""
        try:
            sender_email = self._get_sender_email_from_filename(filename)
            if not sender_email:
                return None
            return asyncio.run(self.password_manager.get_password_for_sender_async(sender_email))
        except Exception:
            logger.error("Error getting password", exc_info=True)
            return None
```

**Keep** `_get_sender_email_from_filename()` — it is still used by the live path (`_generate_normalized_unlocked_filename()` → called from `_save_unlocked_pdf()` → called from the still-live `unlock_pdf_with_password()`).

- [ ] **Step 3: Remove the now-unused `import asyncio`**

`asyncio` was only used inside `_get_password_for_bank()`, just deleted. Remove the top-of-file import:

```python
import asyncio
import re
import shutil
```

becomes:

```python
import re
import shutil
```

- [ ] **Step 4: Confirm nothing broke**

```bash
poetry run ruff check src/services/statement_processor/pdf_unlocker.py
poetry run pytest tests/ -k "pdf" -v
poetry run pytest tests/test_complete_workflow.py tests/test_workflow_orchestrator.py -v
```

Expected: ruff clean (confirms no unused-import warning), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/statement_processor/pdf_unlocker.py
git commit -m "chore: remove dead PDFUnlocker.unlock_pdf()/_get_password_for_bank() (zero callers; live path is unlock_pdf_with_password)"
```

---

### Task 3: Remove dead code — `EmailClient` normalized-filename download methods

**Files:**
- Modify: `backend/src/services/email_ingestion/client.py:1-1457` (imports at top + three methods at the end)
- Test: none new (verified via full suite + grep)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Confirm zero remaining references**

```bash
cd backend
grep -rn "download_latest_attachment_with_normalized_name\|_generate_normalized_filename\|_save_attachment_with_normalized_name" --include="*.py" . | grep -v ".venv\|__pycache__"
```

Expected: only the definition lines inside `client.py` itself (each method calling the next), and zero hits anywhere outside this file.

- [ ] **Step 2: Delete the three chained dead methods**

Remove `download_latest_attachment_with_normalized_name()`, `_generate_normalized_filename()`, and `_save_attachment_with_normalized_name()` — these are lines 1266-1456, i.e. everything from (and including) this method:

```python
    def download_latest_attachment_with_normalized_name(self, sender_email: str, file_type: str = "pdf", download_dir: str = "data/statements/locked_statements") -> Optional[dict[str, Any]]:
```

through the end of this method (the last one in the file):

```python
    def _save_attachment_with_normalized_name(self, filename: str, attachment_data: bytes, download_dir: str) -> Optional[str]:
        """Save attachment data to file with normalized filename"""
        try:
            # Create output directory
            download_path = Path(download_dir)
            download_path.mkdir(parents=True, exist_ok=True)
            
            # Create file path
            file_path = download_path / filename
            
            # Write attachment data
            with open(file_path, 'wb') as f:
                f.write(attachment_data)
            
            return str(file_path)
            
        except Exception:
            logger.error("Error saving attachment", exc_info=True)
            return None
```

All three methods form one dead chain (the first calls the second and third; nothing outside the chain calls the first) — delete the whole block, ending the file at the method that comes immediately before `download_latest_attachment_with_normalized_name` in the class.

- [ ] **Step 3: Remove now-unused imports**

`asyncio` and `AccountOperations` were only used inside the deleted methods. At the top of the file:

```python
from __future__ import annotations

import asyncio
import base64
import json
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from src.services.database_manager.operations import AccountOperations
from src.services.email_ingestion.token_manager import TokenManager
from src.utils.logger import get_logger
from src.utils.settings import get_settings
```

becomes:

```python
from __future__ import annotations

import base64
import json
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, List, Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from src.services.email_ingestion.token_manager import TokenManager
from src.utils.logger import get_logger
from src.utils.settings import get_settings
```

(`re` and `datetime` stay — both are used extensively elsewhere in this file.)

- [ ] **Step 4: Confirm nothing broke**

```bash
poetry run ruff check src/services/email_ingestion/client.py
poetry run pytest tests/ -k "email" -v
```

Expected: ruff clean, all email-related tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/email_ingestion/client.py
git commit -m "chore: remove dead EmailClient normalized-filename download chain (zero callers anywhere)"
```

---

### Task 4: Whitelist `order_by` in `TransactionOperations`

**Files:**
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py:185-282` (two functions: `get_all_transactions`, `get_transactions_by_date_range`)
- Test: Create `backend/tests/test_transaction_operations_order_by.py`

**Interfaces:**
- Consumes: nothing
- Produces: a new module-level `_validate_order_by(order_by: str) -> str` helper in `transaction_operations.py`, called from both `TransactionOperations.get_all_transactions(limit, offset, order_by)` and `TransactionOperations.get_transactions_by_date_range(start_date, end_date, limit, offset, order_by)`. Both now raise `ValueError` for any `order_by` value other than `"ASC"`/`"DESC"` (case-insensitive) — previously accepted any string and interpolated it directly into the SQL `ORDER BY` clause.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_transaction_operations_order_by.py`:

```python
"""
Tests for TransactionOperations order_by validation.
Run from backend/ with: poetry run pytest tests/test_transaction_operations_order_by.py -v
"""
import pytest
from datetime import date

from src.services.database_manager.operations.transaction_operations import TransactionOperations


@pytest.fixture(autouse=True)
async def _cleanup_engine():
    """Dispose the shared DB engine after each test — matches the pattern in
    test_statement_log_operations.py to avoid the asyncpg event-loop-closed race."""
    yield
    from src.services.database_manager.connection import close_engine
    try:
        await close_engine()
    except Exception:
        pass


class TestGetAllTransactionsOrderBy:
    async def test_rejects_sql_injection_attempt(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_all_transactions(
                order_by="ASC; DROP TABLE transactions; --"
            )

    async def test_rejects_arbitrary_string(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_all_transactions(order_by="banana")

    async def test_accepts_asc(self):
        # Should not raise; returns a list (possibly empty depending on DB state)
        result = await TransactionOperations.get_all_transactions(order_by="ASC", limit=1)
        assert isinstance(result, list)

    async def test_accepts_desc(self):
        result = await TransactionOperations.get_all_transactions(order_by="DESC", limit=1)
        assert isinstance(result, list)

    async def test_accepts_lowercase(self):
        # Case-insensitive: callers may pass "asc"/"desc"
        result = await TransactionOperations.get_all_transactions(order_by="asc", limit=1)
        assert isinstance(result, list)


class TestGetTransactionsByDateRangeOrderBy:
    async def test_rejects_sql_injection_attempt(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_transactions_by_date_range(
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 31),
                order_by="ASC, (SELECT 1) --",
            )

    async def test_accepts_desc(self):
        result = await TransactionOperations.get_transactions_by_date_range(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            order_by="DESC",
            limit=1,
        )
        assert isinstance(result, list)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
poetry run pytest tests/test_transaction_operations_order_by.py -v
```

Expected: the four `test_rejects_*` tests FAIL (no `ValueError` is currently raised — the malicious string is silently interpolated into SQL instead), and the `test_accepts_*` tests currently PASS (today's code already accepts valid values, since it accepts everything).

- [ ] **Step 3: Add a shared `_validate_order_by` helper**

`get_all_transactions` and `get_transactions_by_date_range` both need the identical check — extract it once instead of duplicating it, so a future third caller (and any reviewer) has one place to look. Add this module-level function in `backend/src/services/database_manager/operations/transaction_operations.py`, placed directly above the `TransactionOperations` class definition (i.e. in the same spot other module-level helpers/constants like `_TRANSACTION_VISIBILITY_FILTER` already live in this file):

```python
def _validate_order_by(order_by: str) -> str:
    """Whitelist order_by before it's interpolated into a SQL ORDER BY clause.

    Raises ValueError for anything other than ASC/DESC (case-insensitive) —
    this string is placed directly into a `text()` query via f-string, so it
    must never be allowed to carry unvalidated user input.
    """
    order_by = order_by.upper()
    if order_by not in ("ASC", "DESC"):
        raise ValueError(f"order_by must be 'ASC' or 'DESC', got: {order_by!r}")
    return order_by
```

- [ ] **Step 4: Call the helper from both `get_all_transactions` and `get_transactions_by_date_range`**

In `backend/src/services/database_manager/operations/transaction_operations.py`, change:

```python
    @staticmethod
    async def get_all_transactions(
        limit: int = 1000,
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get all transactions with configurable sorting"""
        session_factory = get_session_factory()
        async with session_factory() as session:
```

to:

```python
    @staticmethod
    async def get_all_transactions(
        limit: int = 1000,
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get all transactions with configurable sorting"""
        order_by = _validate_order_by(order_by)
        session_factory = get_session_factory()
        async with session_factory() as session:
```

And change:

```python
    @staticmethod
    async def get_transactions_by_date_range(
        start_date: date,
        end_date: date,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get transactions within a date range"""
        session_factory = get_session_factory()
        async with session_factory() as session:
```

to:

```python
    @staticmethod
    async def get_transactions_by_date_range(
        start_date: date,
        end_date: date,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get transactions within a date range"""
        order_by = _validate_order_by(order_by)
        session_factory = get_session_factory()
        async with session_factory() as session:
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
poetry run pytest tests/test_transaction_operations_order_by.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Run the full suite to confirm no existing caller breaks**

```bash
poetry run pytest tests/ -x
poetry run ruff check src/services/database_manager/operations/transaction_operations.py
```

Expected: all pass. Every current caller of these two functions (checked earlier — `transaction_read_routes.py`) already only ever passes the literal `"ASC"` or `"DESC"`, so this is purely additive validation with no behavior change for real traffic.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/database_manager/operations/transaction_operations.py backend/tests/test_transaction_operations_order_by.py
git commit -m "fix: whitelist order_by in TransactionOperations to close SQL injection landmine"
```

---

### Task 5: Remove hardcoded password from `compare_cashback_sbi_statement.py`

**Files:**
- Modify: `backend/scripts/compare_cashback_sbi_statement.py:1-40, 81-96, 186-202`
- Test: Create `backend/tests/test_compare_cashback_sbi_statement_script.py` (static check only — this script needs live Gmail/DB credentials to run end-to-end, which isn't available in the test environment; the automated test locks in "no hardcoded secret" and "password comes from the DB lookup", not full script execution)

**Interfaces:**
- Consumes: `BankPasswordManager.get_password_for_sender_async(sender_email: str) -> Optional[str]` (existing, from `src.utils.password_manager.get_password_manager()`)
- Produces: nothing new (this script has no other consumers)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_compare_cashback_sbi_statement_script.py`:

```python
"""
Static checks for scripts/compare_cashback_sbi_statement.py — confirms the
hardcoded statement password has been replaced with a DB lookup.

Run from backend/ with: poetry run pytest tests/test_compare_cashback_sbi_statement_script.py -v
"""
import ast
from pathlib import Path

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "compare_cashback_sbi_statement.py"


def _source() -> str:
    return SCRIPT_PATH.read_text()


def test_no_hardcoded_password_literal():
    """The old hardcoded password '<redacted-statement-password>' must not appear anywhere in the file."""
    assert "<redacted-statement-password>" not in _source()


def test_no_bare_password_string_assignment():
    """No module-level assignment named PASSWORD to a string literal (the old pattern)."""
    tree = ast.parse(_source())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "PASSWORD":
                    assert not isinstance(node.value, ast.Constant), (
                        "PASSWORD must not be a hardcoded string literal"
                    )


def test_uses_password_manager():
    """The script must resolve the password via the shared BankPasswordManager,
    the same mechanism the production PDF-unlock path uses."""
    source = _source()
    assert "get_password_manager" in source
    assert "get_password_for_sender_async" in source
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
poetry run pytest tests/test_compare_cashback_sbi_statement_script.py -v
```

Expected: `test_no_hardcoded_password_literal` and `test_no_bare_password_string_assignment` FAIL (the literal is still there today). `test_uses_password_manager` also FAILS (script doesn't import it yet).

- [ ] **Step 3: Replace the hardcoded password with a DB lookup**

In `backend/scripts/compare_cashback_sbi_statement.py`, change the imports and constants block:

```python
from src.services.email_ingestion.client import EmailClient
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.services.statement_processor.document_extractor import DocumentExtractor
from src.services.database_manager.operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)

SENDER = "Statements@sbicard.com"
PASSWORD = "<redacted-statement-password>"
NICKNAME = "Cashback SBI Credit Card"
# Search window: April–June 2026 to catch the latest statement
SEARCH_START = "2026/04/01"
SEARCH_END = "2026/06/01"
```

to:

```python
from src.services.email_ingestion.client import EmailClient
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.services.statement_processor.document_extractor import DocumentExtractor
from src.services.database_manager.operations import TransactionOperations
from src.utils.password_manager import get_password_manager
from src.utils.logger import get_logger

logger = get_logger(__name__)

SENDER = "Statements@sbicard.com"
NICKNAME = "Cashback SBI Credit Card"
# Search window: April–June 2026 to catch the latest statement
SEARCH_START = "2026/04/01"
SEARCH_END = "2026/06/01"
```

- [ ] **Step 4: Fetch the password from the DB where it's used (in `main()`), not as a module constant**

Change `unlock_pdf()` to accept the password as a parameter instead of reading the module-level constant:

```python
def unlock_pdf(locked_path: Path) -> Path | None:
    """Unlock the PDF using the account password."""
    import shutil
    print(f"\n[2] Unlocking PDF with password…")
    unlocker = PDFUnlocker()
    result = unlocker.unlock_pdf_with_password(locked_path, PASSWORD, account_nickname=NICKNAME)
    if result.get("success"):
        unlocked_path = Path(result["unlocked_path"])
        print(f"   Unlocked PDF → {unlocked_path}")
        return unlocked_path
    print(f"   Unlock failed ({result.get('error')}), trying as unprotected PDF…")
    fallback_path = locked_path.parent / locked_path.name.removeprefix("locked_")
    shutil.copy(locked_path, fallback_path)
    print(f"   Using as-is → {fallback_path}")
    return fallback_path
```

becomes:

```python
def unlock_pdf(locked_path: Path, password: str) -> Path | None:
    """Unlock the PDF using the account password."""
    import shutil
    print(f"\n[2] Unlocking PDF with password…")
    unlocker = PDFUnlocker()
    result = unlocker.unlock_pdf_with_password(locked_path, password, account_nickname=NICKNAME)
    if result.get("success"):
        unlocked_path = Path(result["unlocked_path"])
        print(f"   Unlocked PDF → {unlocked_path}")
        return unlocked_path
    print(f"   Unlock failed ({result.get('error')}), trying as unprotected PDF…")
    fallback_path = locked_path.parent / locked_path.name.removeprefix("locked_")
    shutil.copy(locked_path, fallback_path)
    print(f"   Using as-is → {fallback_path}")
    return fallback_path
```

And update `main()` to look the password up (the same async lookup `StatementWorkflow` already uses in production) and pass it through:

```python
async def main():
    locked_pdf = download_statement()
    if not locked_pdf:
        sys.exit(1)

    unlocked_pdf = unlock_pdf(locked_pdf)
    if not unlocked_pdf:
        sys.exit(1)

    pdf_rows = extract_transactions(unlocked_pdf)
    db_rows = await get_db_transactions()
    compare(pdf_rows, db_rows)
```

becomes:

```python
async def main():
    locked_pdf = download_statement()
    if not locked_pdf:
        sys.exit(1)

    password = await get_password_manager().get_password_for_sender_async(SENDER)
    if not password:
        print(f"   No password on file for sender {SENDER!r} — check the accounts table.")
        sys.exit(1)

    unlocked_pdf = unlock_pdf(locked_pdf, password)
    if not unlocked_pdf:
        sys.exit(1)

    pdf_rows = extract_transactions(unlocked_pdf)
    db_rows = await get_db_transactions()
    compare(pdf_rows, db_rows)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
poetry run pytest tests/test_compare_cashback_sbi_statement_script.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Run the full suite and lint**

```bash
poetry run pytest tests/ -x
poetry run ruff check scripts/compare_cashback_sbi_statement.py
```

Expected: all pass, ruff clean.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/compare_cashback_sbi_statement.py backend/tests/test_compare_cashback_sbi_statement_script.py
git commit -m "fix: resolve Cashback SBI statement password from DB instead of hardcoding it"
```

Note: this script was untracked before this branch (`?? backend/scripts/compare_cashback_sbi_statement.py` in git status), so this task also brings it under version control for the first time, now with no embedded secret.

---

### Task 6: Rate-limit `POST /api/workflow/run`

**Files:**
- Modify: `backend/src/apis/routes/workflow_routes.py:1-40, 296-297`
- Test: Create `backend/tests/test_workflow_rate_limit.py`

**Interfaces:**
- Consumes: `slowapi.Limiter` (already configured in `main.py` as `app.state.limiter`; existing per-file pattern in `src/apis/routes/auth_routes.py` — instantiate a local `Limiter(key_func=get_remote_address)` in this route file too, matching that precedent).
- Produces: nothing new consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_workflow_rate_limit.py`:

```python
"""
Test that POST /api/workflow/run is rate-limited.
Run from backend/ with: poetry run pytest tests/test_workflow_rate_limit.py -v
"""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from src.utils.jwt_utils import create_access_token


def _authed_client() -> TestClient:
    client = TestClient(app)
    client.cookies.set("access_token", create_access_token())
    return client


@patch("src.apis.routes.workflow_routes._run_workflow_task", new_callable=AsyncMock)
def test_workflow_run_is_rate_limited(mock_run_task):
    """The 6th request within a minute must be rejected with 429, regardless
    of whether earlier requests succeeded (202) or hit the existing
    one-job-at-a-time business rule (409) — both happen before any real
    workflow logic runs since _run_workflow_task is mocked to a no-op."""
    client = _authed_client()
    body = {"mode": "full"}

    statuses = []
    for _ in range(6):
        response = client.post("/api/workflow/run", json=body)
        statuses.append(response.status_code)

    assert statuses[-1] == 429, f"Expected 429 on 6th request, got statuses: {statuses}"
    assert all(s in (202, 409, 429) for s in statuses), f"Unexpected status in: {statuses}"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend
poetry run pytest tests/test_workflow_rate_limit.py -v
```

Expected: FAIL — all 6 requests currently return 202 or 409 (409 after the first, since `_run_workflow_task` is mocked and never marks the job complete, so subsequent calls hit the existing "already running" check), never 429, because no rate limit exists on this route yet.

- [ ] **Step 3: Add the rate limit**

In `backend/src/apis/routes/workflow_routes.py`, add the slowapi imports and a local limiter instance (same pattern as `src/apis/routes/auth_routes.py`). Change:

```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from src.apis.schemas.workflow import (
```

to:

```python
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import text

from src.apis.schemas.workflow import (
```

Then, after the existing `router = APIRouter(...)` line (locate it near the top of the file, immediately after the imports), add:

```python
limiter = Limiter(key_func=get_remote_address)
```

Then change the route handler:

```python
@router.post("/run", response_model=WorkflowRunResponse, status_code=202)
async def start_workflow(req: WorkflowRunRequest):
```

to:

```python
@router.post("/run", response_model=WorkflowRunResponse, status_code=202)
@limiter.limit("5/minute")
async def start_workflow(request: Request, req: WorkflowRunRequest):
```

(`request: Request` is required as the first parameter for slowapi's decorator to identify the caller — same signature shape as `login()` in `auth_routes.py`. It's unused inside the function body otherwise, which is expected and matches the existing `login` precedent.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
poetry run pytest tests/test_workflow_rate_limit.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no regression**

```bash
poetry run pytest tests/ -x
poetry run ruff check src/apis/routes/workflow_routes.py
```

Expected: all pass. Note: if any *other* existing test in the suite calls `POST /api/workflow/run` more than 5 times within the same test process, it could now start seeing 429s it didn't before — check for this specifically:

```bash
grep -rln "workflow/run\|post.*workflow" tests/*.py
```

If any such test exists and makes >5 calls, note it here as a follow-up rather than silently working around it in this task.

- [ ] **Step 6: Commit**

```bash
git add backend/src/apis/routes/workflow_routes.py backend/tests/test_workflow_rate_limit.py
git commit -m "fix: rate-limit POST /api/workflow/run (5/minute) using existing slowapi setup"
```

---

## Self-Review Notes

**Spec coverage:** All 4 "do today" items (dead code, hardcoded password, order_by whitelist, async/sync — resolved as dead-code deletion per user decision) + 1 "do next" item (rate limiting) are covered by Tasks 1-6. The 6th "do next" item (Splitwise/statement-extraction test coverage) was explicitly scoped out at plan-start as a separate, larger initiative needing its own research — not included here.

**Placeholder scan:** No TBD/TODO markers; every step shows exact before/after code or an exact shell command with expected output stated.

**Type consistency:** `order_by: str` stays `str` throughout (now validated, not re-typed to an enum — matches existing call-site usage of raw `"ASC"`/`"DESC"` strings in `transaction_read_routes.py`, no call-site changes needed). `unlock_pdf(locked_path: Path, password: str)` signature change in Task 5 is local to the script — its only caller (`main()`) is updated in the same task.
