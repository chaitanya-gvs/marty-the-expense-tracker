# Testing Patterns

**Analysis Date:** 2026-03-27

---

## Test Framework

**Runner:**
- pytest 8.2.0+
- Config: `backend/pyproject.toml` (`[tool.pytest.ini_options]`)
- `asyncio_mode = "auto"` — all async tests run automatically without `@pytest.mark.asyncio`
- `pythonpath = ["."]` — project root on path so `from main import app` resolves

**Async Support:**
- `pytest-asyncio 0.23.7`

**HTTP Test Client:**
- `fastapi.testclient.TestClient` (synchronous WSGI wrapper, not httpx AsyncClient)

**Mocking:**
- `unittest.mock`: `patch`, `Mock`, `AsyncMock`, `MagicMock`

**Run Commands:**
```bash
# Run all tests (from backend/)
poetry run pytest tests/

# Run single file
poetry run pytest tests/test_settlement_calculations.py

# Run specific class or test
poetry run pytest tests/test_splitwise_routes.py::TestGetFriends
poetry run pytest tests/test_splitwise_routes.py::TestGetFriends::test_returns_friends_sorted_nonzero_first
```

---

## Test File Organization

**Location:** All tests in `backend/tests/` (separate from source, not co-located)

**Naming:**
- `test_{subject}.py` pattern: `test_api_integration.py`, `test_settlement_calculations.py`, `test_splitwise_routes.py`, `test_workflow_orchestrator.py`

**Current test files:**
```
backend/tests/
├── test_api_integration.py        # Integration tests for main route groups
├── test_settlement_calculations.py # Unit tests for settlement business logic
├── test_splitwise_routes.py       # Integration tests for Splitwise endpoints
└── test_workflow_orchestrator.py  # Unit tests for workflow pipeline helpers
```

No frontend tests exist. No `conftest.py` file is present — no shared fixtures.

---

## Test Structure

**Suite organization:** Class-per-feature, methods per scenario.

```python
class TestCreditPaymentReducesOwed:
    """A credit transaction from participant A should REDUCE what A owes me."""

    def test_credit_with_paid_by_participant_removes_from_settlements(self):
        """Happy path: A pays me 1000 (paid_by=A) → settles the 1000 debt → not in settlements."""
        ...

    def test_credit_with_paid_by_me_reduces_owed_not_increases(self):
        """
        Bug scenario: A pays me 1000, but paid_by = "me" (UI default for all transactions).
        Before fix: amount_i_owe goes to -1000, net_balance increases from 1000 → 2000.
        After fix:  credit direction takes precedence → amount_owed_to_me decreases to 0.
        """
        ...
```

**Route test setup:**
```python
class TestTransactionRoutes:
    """Test transaction API routes."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
```

Some test files also use a module-level client:
```python
# test_splitwise_routes.py pattern
client = TestClient(app)

class TestGetFriends:
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_returns_friends_sorted_nonzero_first(self, MockClient):
        ...
```

---

## Mocking

**Framework:** `unittest.mock` — `patch`, `Mock`, `AsyncMock`, `MagicMock`

**Patching DB operations (integration tests):**
```python
@patch('src.apis.routes.transaction_routes.CategoryOperations.get_all_categories')
def test_get_categories(self, mock_get_categories):
    mock_get_categories.return_value = [
        {'id': '1', 'name': 'Food', ...}
    ]
    response = self.client.get("/api/transactions/categories/")
    assert response.status_code == 200
```

**Patching external service clients:**
```python
@patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
def test_returns_friends_sorted_nonzero_first(self, MockClient):
    mock_instance = MockClient.return_value
    mock_instance.get_friends_with_balances.return_value = [...]
    response = client.get("/api/splitwise/friends")
```

**Patching requests library directly:**
```python
@patch("src.apis.routes.splitwise_routes.requests")
@patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
def test_filters_to_friend_and_excludes_deleted(self, MockClient, mock_requests):
    mock_response = MagicMock()
    mock_response.json.return_value = {"expenses": raw_expenses}
    mock_response.raise_for_status.return_value = None
    mock_requests.get.return_value = mock_response
```

**Nested context manager mocking (workflow dry-run):**
```python
with patch.object(StatementWorkflow, '_download_statements_from_sender') as mock_download:
    mock_download.return_value = []
    with patch.object(StatementWorkflow, '_process_statement_extraction') as mock_extract:
        mock_extract.return_value = {"success": True}
        ...
```

**What to mock:**
- Database operations (`CategoryOperations.*`, `TransactionOperations.*`, etc.)
- External API clients (`SplitwiseAPIClient`, `requests`)
- Workflow steps that call I/O (`_download_statements_from_sender`, `_upload_unlocked_statement_to_cloud`)

**What NOT to mock:**
- Pure business logic functions (settlement calculations tested directly — `_calculate_settlements()` is called without any mocking)
- FastAPI app construction and routing

---

## Test Data / Factories

**Builder function pattern (settlement tests):**
```python
def _tx(
    id: str,
    amount: float,
    direction: str,
    paid_by: str | None,
    participants: list[str],
    account: str = "HDFC Savings",
):
    """Build a minimal transaction dict matching what _get_settlement_transactions returns."""
    n = len(participants) + 1
    entries = [{"participant": p, "amount": amount / n} for p in participants]
    entries.append({"participant": "me", "amount": amount / n})
    return {
        "id": id,
        "date": "2024-01-01",
        "amount": amount,
        "split_breakdown": {"mode": "equal", "entries": entries, "paid_by": paid_by},
        ...
    }
```

**Inline dict fixtures (integration tests):**
Raw dicts assembled inline inside each test. No shared fixtures or factory classes.

**No fixture files or `conftest.py`** — all test data is defined per-test or per-file.

---

## Coverage

**Requirements:** None enforced — no coverage threshold configured in `pyproject.toml`.

**View Coverage:**
```bash
poetry run pytest tests/ --cov=src --cov-report=term-missing
```
(requires `pytest-cov`; not currently listed as a dev dependency — install separately if needed)

---

## Test Types

**Unit Tests:**
- `test_settlement_calculations.py` — Tests `_calculate_settlements()` directly with no I/O
- `test_workflow_orchestrator.py` — Tests date/path helpers on `StatementWorkflow` without real DB or email

**Integration Tests:**
- `test_api_integration.py` — Tests full FastAPI request/response cycle using `TestClient`, with DB operations mocked
- `test_splitwise_routes.py` — Tests Splitwise route logic using `TestClient`, with API client and `requests` mocked

**E2E Tests:** Not present.

---

## Common Patterns

**Async testing:**
```python
# asyncio_mode = "auto" in pyproject.toml means this just works:
async def test_normalized_filename_generation(self):
    workflow = StatementWorkflow()
    with patch('...AccountOperations.get_account_nickname_by_sender') as mock_get_nickname:
        mock_get_nickname.return_value = "test_account"
        filename = await workflow._generate_normalized_filename(...)
        assert filename == "test_account_20250904_locked.pdf"
```

**Assertion style:**
```python
# Status + response structure
assert response.status_code == 200
data = response.json()
assert "data" in data
assert len(data["data"]) == 1

# Business logic invariants with failure messages
assert alice.net_balance <= 0.01, (
    f"Bug: credit payment increased balance instead of reducing it. "
    f"net_balance={alice.net_balance} (expected ≤ 0)"
)

# Floating-point comparisons use a tolerance
assert abs(alice.net_balance) < 0.01
assert bob.amount_i_owe >= -0.01
```

**Optional presence pattern (settlement tests):**
```python
alice = next((s for s in summary.settlements if s.participant == "Alice"), None)
assert alice is None or abs(alice.net_balance) < 0.01, "..."
```
Tests assert invariants even when the entity may not appear in results (filtered-out means settled).

**Documenting bug regressions in test docstrings:**
```python
def test_credit_with_paid_by_me_reduces_owed_not_increases(self):
    """
    Bug scenario: A pays me 1000, but paid_by = "me" (UI default).
    Before fix: amount_i_owe goes to -1000, net_balance increases 1000 → 2000.
    After fix:  credit direction takes precedence → amount_owed_to_me decreases to 0.
    """
```
Bug regressions document the original failure explicitly in the docstring.

---

*Testing analysis: 2026-03-27*
