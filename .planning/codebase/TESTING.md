# Testing Patterns

**Analysis Date:** 2026-08-09

## Backend Testing

### Test Framework

**Runner:** pytest v8.2.0
- Config: `pyproject.toml` (pytest section)
- Async support: pytest-asyncio v0.23.7 with `asyncio_mode = "auto"`

**Assertion Library:** Built-in `assert` statements (no external assertion library)

**Run Commands:**
```bash
poetry run pytest tests/                     # Run all tests
poetry run pytest tests/test_api_integration.py  # Run single file
poetry run pytest tests/ -v                  # Verbose output
poetry run pytest tests/ -x                  # Stop on first failure
poetry run pytest tests/ -k test_name        # Run tests matching pattern
```

**Configuration (`pyproject.toml`):**
```toml
[tool.pytest.ini_options]
pythonpath = ["."]
asyncio_mode = "auto"
```

- `pythonpath = ["."]` — Allows import of `src.*` from test files
- `asyncio_mode = "auto"` — Automatically marks async test methods as async without needing `@pytest.mark.asyncio`

### Test File Organization

**Location:**
- All tests in `backend/tests/` directory
- Test files named `test_*.py` (pytest discovery pattern)

**Structure:**
```
backend/
├── tests/
│   ├── test_api_integration.py          # API route tests
│   ├── test_workflow_orchestrator.py    # Workflow logic tests
│   ├── test_dedup_service.py            # Deduplication service tests
│   ├── test_settlement_calculations.py  # Settlement math tests
│   ├── test_statement_dedup_integration.py  # Integration tests
│   ├── test_workflow_sse.py             # SSE streaming tests
│   ├── test_complete_workflow.py        # End-to-end workflow
│   ├── test_statement_log_operations.py
│   ├── test_transaction_standardizer.py
│   ├── test_data_standardizer_helper.py
│   └── ... (18 total test files)
```

### Test Structure & Patterns

**Basic test class structure:**
```python
"""
Brief description of what this module tests.
"""

import pytest
from unittest.mock import AsyncMock, patch
from datetime import date
from decimal import Decimal

from src.services.email_ingestion.dedup_service import DeduplicationService


class TestDeduplicationService:
    """Test class for deduplication logic"""
    
    def setup_method(self):
        """Set up test fixtures before each test method."""
        self.service = DeduplicationService()
    
    @pytest.mark.asyncio
    async def test_tier1_match_by_reference_number(self):
        """Test that tier-1 matching works by reference number."""
        # Arrange
        stmt = make_stmt_tx(ref="UTR999")
        candidates = [make_email_tx(ref="UTR999")]
        
        # Act
        result = self.service._match_tier1(stmt, candidates)
        
        # Assert
        assert result.tier == 1
        assert result.matched_id == "abc-123"
    
    def test_no_match_returns_tier_none(self):
        """Test that no match returns tier None."""
        stmt = make_stmt_tx(amount=999.0, ref=None)
        candidates = [make_email_tx(amount=100.0, ref=None)]
        result = self.service._match_tier2(stmt, candidates, date(2026, 4, 1))
        assert result.tier is None
```

**Naming:**
- Test methods: `test_<what_is_being_tested>()` (e.g., `test_tier1_match_by_reference_number`)
- Test classes: `Test<ClassBeingTested>` (e.g., `TestDeduplicationService`)
- Descriptive docstrings explaining what the test validates

**Arrange-Act-Assert (AAA) pattern:**
```python
@pytest.mark.asyncio
async def test_date_range_calculation_smoke(self):
    """End-to-end smoke test: default call returns valid date range."""
    # Arrange — set up fixtures and mocks
    with patch(
        "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
        new_callable=AsyncMock,
        return_value={"min_last_statement_date": None, "account_count": 0, "null_count": 0},
    ):
        workflow = StatementWorkflow()
        
        # Act — execute the code being tested
        start_date, end_date = await workflow._calculate_date_range()
    
    # Assert — verify results
    assert len(start_date.split('/')) == 3
    assert len(end_date.split('/')) == 3
```

### Test Data & Fixtures

**Helper functions for test data:**
```python
# Define at module level
def make_stmt_tx(amount=100.0, account="Test Account", ref="UTR123",
                 tx_date=date(2026, 4, 1), direction="debit"):
    """Factory function for statement transaction test data."""
    return {
        "amount": Decimal(str(amount)),
        "account": account,
        "reference_number": ref,
        "transaction_date": tx_date,
        "direction": direction
    }


def make_email_tx(tx_id="abc-123", amount=100.0, account="Test Account",
                  ref="UTR123", tx_date=date(2026, 4, 1), direction="debit"):
    """Factory function for email transaction test data."""
    return {
        "id": tx_id,
        "amount": Decimal(str(amount)),
        "account": account,
        "reference_number": ref,
        "transaction_date": tx_date,
        "direction": direction
    }


# Usage in tests
@pytest.mark.asyncio
async def test_tier2_single_match_by_amount_and_date():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref=None)
    candidates = [make_email_tx(ref=None, tx_date=date(2026, 4, 2))]
    result = svc._match_tier2(stmt, candidates, date(2026, 4, 1))
    assert result.tier == 2
```

**`setup_method`:**
- Called before each test method in the class
- Use for common fixture initialization
- Example: `self.client = TestClient(app)`, `self.service = DeduplicationService()`

**No pytest fixtures or conftest used** — factories and direct initialization are preferred.

### Async Testing

**Marker:** `@pytest.mark.asyncio` (required for async test methods)

**Syntax:**
```python
@pytest.mark.asyncio
async def test_async_operation(self):
    """Test an async function."""
    result = await some_async_function()
    assert result == expected_value


@pytest.mark.asyncio
async def test_with_async_mocks(self):
    """Test with mocked async dependencies."""
    with patch('module.AsyncFunc', new_callable=AsyncMock, return_value={"key": "value"}):
        result = await orchestrator._calculate_date_range()
        assert result is not None
```

**AsyncMock pattern:**
```python
from unittest.mock import AsyncMock, patch

# Mock async function with return value
with patch(
    "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
    new_callable=AsyncMock,
    return_value={"min_last_statement_date": date(2026, 6, 28), ...},
):
    workflow = StatementWorkflow()
    start_date, end_date = await workflow._calculate_date_range()
```

### Mocking

**Framework:** `unittest.mock` (standard library)

**Patterns:**

1. **Mock function return value:**
```python
@patch('src.services.database_manager.operations.TransactionOperations.get_all_transactions')
def test_get_transactions(self, mock_get_transactions):
    mock_get_transactions.return_value = [
        {'id': '1', 'amount': 100.0, 'direction': 'debit', ...}
    ]
    response = self.client.get("/api/transactions/")
    assert response.status_code == 200
```

2. **Mock async function:**
```python
with patch(
    "src.services.orchestrator.AccountOperations.get_statement_account_date_stats",
    new_callable=AsyncMock,
    return_value={"min_last_statement_date": None},
):
    result = await workflow._calculate_date_range()
```

3. **Patch in context manager (preferred for clarity):**
```python
def test_some_operation(self):
    with patch('module.SomeClass.some_method') as mock_method:
        mock_method.return_value = "mocked_value"
        result = call_code_using_mock()
        assert result == expected
        mock_method.assert_called_once()
```

**What to mock:**
- External service calls (Gmail API, Splitwise API, GCS)
- Database operations (inject mocked `get_session_factory()`)
- Time-dependent operations (`datetime.now()`)
- File I/O

**What NOT to mock:**
- Core business logic (actual algorithms should be tested)
- Internal service methods (test the service, not its dependencies)
- Simple data transformations (test with real data)

### Coverage

**Tool:** Built-in pytest coverage (no separate config)
- Generate: `poetry run pytest tests/ --cov=src --cov-report=html`
- View: Open `htmlcov/index.html`

**Requirements:** None enforced in CI/CD currently (no coverage threshold)

**Current gaps:** No systematic coverage measurement — relies on developer discretion

### Test Types

**Unit Tests:**
- Test individual functions/methods in isolation
- Example: `test_tier1_match_by_reference_number()` — tests `_match_tier1()` method directly
- Mock all external dependencies
- Location: `backend/tests/test_*.py`

**Integration Tests:**
- Test multiple components working together
- Example: `test_statement_dedup_integration.py` — tests email ingestion + dedup + DB insert
- May use real DB (if available) or heavily mocked
- Example: `test_complete_workflow.py` — tests full statement processing pipeline

**API Tests:**
- Use `TestClient` from FastAPI
- Test HTTP endpoints with mocked services
- Example: `test_api_integration.py`

**Example (API test):**
```python
from fastapi.testclient import TestClient
from main import app

class TestTransactionRoutes:
    def setup_method(self):
        self.client = TestClient(app)
    
    @patch('src.services.database_manager.operations.TransactionOperations.get_all_transactions')
    def test_get_transactions(self, mock_get_transactions):
        mock_get_transactions.return_value = [
            {'id': '1', 'amount': 100.0, ...}
        ]
        response = self.client.get("/api/transactions/")
        assert response.status_code == 200
        assert "data" in response.json()
```

### Common Test Patterns

**Testing with date/datetime:**
```python
from datetime import date as d, datetime as dt

@pytest.mark.asyncio
async def test_date_range_data_driven(self):
    """Test with specific dates."""
    with patch(..., return_value={"min_last_statement_date": d(2026, 6, 28)}):
        workflow = StatementWorkflow()
        start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))
    
    assert start_date == "2026/06/25"  # 3 days before 6/28
    assert end_date == "2026/08/08"
```

**Testing error conditions:**
```python
@pytest.mark.asyncio
async def test_invalid_account_raises_error(self):
    """Test that invalid account raises appropriate error."""
    with pytest.raises(ValueError, match="Account not found"):
        await operations.get_account_by_email("nonexistent@example.com")
```

**Testing database operations:**
```python
@patch('src.services.database_manager.connection.get_session_factory')
@pytest.mark.asyncio
async def test_get_transactions_queries_db(self, mock_session_factory):
    """Test database query is executed."""
    mock_session = AsyncMock()
    mock_result = AsyncMock()
    mock_result.fetchall.return_value = [...]
    mock_session.execute.return_value = mock_result
    mock_session_factory.return_value.__aenter__.return_value = mock_session
    
    result = await TransactionOperations.get_all_transactions()
    
    mock_session.execute.assert_called_once()
    assert len(result) > 0
```

---

## Frontend Testing (TypeScript/React)

### Test Framework

**Status:** No automated tests currently configured
- No Jest, Vitest, or React Testing Library setup
- `package.json` has no test scripts
- `tsconfig.json` does not include test files

### Recommendations for Frontend Testing

If tests are added, use:
- **Test Runner:** Vitest (recommended for Vite/Turbopack projects) or Jest with Next.js preset
- **Testing Library:** React Testing Library (for component testing)
- **Mocking:** Vitest's mocking capabilities or `jest.mock()`

**Suggested structure (if implemented):**
```typescript
// src/components/transactions/transaction-filters.test.tsx

import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransactionFilters } from './transaction-filters';
import type { TransactionFilters as TransactionFiltersType } from '@/lib/types';

describe('TransactionFilters', () => {
  const mockFilters: TransactionFiltersType = { /* ... */ };
  const mockOnFiltersChange = jest.fn();
  const mockOnClearFilters = jest.fn();

  it('should render filter inputs', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TransactionFilters
          filters={mockFilters}
          onFiltersChange={mockOnFiltersChange}
          onClearFilters={mockOnClearFilters}
        />
      </QueryClientProvider>
    );

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('should call onFiltersChange when search input changes', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TransactionFilters {...props} />
      </QueryClientProvider>
    );

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'coffee' } });

    // Wait for debounce (500ms)
    setTimeout(() => {
      expect(mockOnFiltersChange).toHaveBeenCalled();
    }, 600);
  });
});
```

---

## Running Tests Locally

### Backend

**All tests:**
```bash
cd backend
poetry run pytest tests/
```

**Single test file:**
```bash
poetry run pytest tests/test_dedup_service.py -v
```

**Single test:**
```bash
poetry run pytest tests/test_dedup_service.py::TestDeduplicationService::test_tier1_match_by_reference_number -v
```

**With debugging:**
```bash
poetry run pytest tests/ -vv --tb=long  # Verbose with long tracebacks
poetry run pytest tests/ -s              # Show print statements
poetry run pytest tests/ --pdb           # Drop to pdb on failure
```

### Frontend

**No test suite currently** — would use `npm test` if Jest/Vitest configured.

---

## Mock Data Patterns

### Backend Mock Builders

```python
# Transaction data factory
def make_transaction(
    id="tx-1",
    amount=100.0,
    date=date(2026, 4, 1),
    direction="debit",
    account="Axis Credit Card",
    description="Coffee",
    category="Food & Dining"
):
    return {
        "id": id,
        "amount": Decimal(str(amount)),
        "transaction_date": date,
        "direction": direction,
        "account": account,
        "description": description,
        "category": category,
        "is_shared": False,
        "split_breakdown": None,
    }


# Account data factory
def make_account(
    nickname="Axis CC",
    account_type="credit_card",
    statement_sender="statements@axis.bank.in",
    statement_password="password123"
):
    return {
        "id": str(uuid4()),
        "nickname": nickname,
        "account_type": account_type,
        "statement_sender": statement_sender,
        "statement_password": statement_password,
        "is_active": True,
    }
```

### API Response Mocks

```python
# Mock successful response
mock_transactions = {
    "data": [
        {"id": "1", "amount": 100.0, "description": "Coffee", ...},
        {"id": "2", "amount": 50.0, "description": "Lunch", ...},
    ],
    "pagination": {"page": 1, "limit": 50, "total": 2}
}

# Mock error response
mock_error = {
    "detail": "Account not found",
    "status": 404
}
```

---

## Test Isolation & Cleanup

**Database isolation:**
- Tests should not depend on a real PostgreSQL database
- All DB operations should be mocked via `patch()` on `get_session_factory()`
- No `setup_db()` or teardown SQL execution needed

**State isolation:**
- Each test class has `setup_method()` to reinitialize fixtures
- No global state shared between tests
- Mock patches are scoped to individual test methods

**No cleanup required:**
- Pytest handles cleanup automatically
- Mock patches are automatically reverted after each test
- No explicit teardown needed (though `teardown_method()` can be added if needed)

---

*Testing analysis: 2026-08-09*
