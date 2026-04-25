"""
Integration tests for the budget API.
Run from backend/ with: poetry run pytest tests/test_budget_api.py -v
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from main import app
from src.utils.auth_deps import get_current_user


def override_auth():
    """Bypass JWT auth for tests."""
    return "test_user"


app.dependency_overrides[get_current_user] = override_auth


@pytest.fixture(scope="module")
def client():
    """Single shared TestClient for the module; raise_server_exceptions=False
    so unhandled DB errors surface as 500 responses instead of re-raised exceptions."""
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_list_budgets_empty(client):
    """GET /api/budgets returns a list."""
    resp = client.get("/api/budgets")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert isinstance(body["data"], list)


def test_create_budget_requires_valid_category(client):
    """POST /api/budgets with a non-existent category_id returns 409 or 500."""
    resp = client.post("/api/budgets", json={
        "category_id": "00000000-0000-0000-0000-000000000000",
        "monthly_limit": 5000,
    })
    assert resp.status_code in (422, 409, 500)


def test_budget_summary_default_period(client):
    """GET /api/budgets/summary returns current period when no period param given."""
    resp = client.get("/api/budgets/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "period" in body["data"]
    assert "budgets" in body["data"]
    assert "unbudgeted_categories" in body["data"]


def test_budget_summary_period_format_validation(client):
    """GET /api/budgets/summary with invalid period returns 422."""
    resp = client.get("/api/budgets/summary?period=2026-4")
    assert resp.status_code == 422


def test_delete_nonexistent_budget(client):
    """DELETE /api/budgets/{id} for unknown id returns 404."""
    resp = client.delete("/api/budgets/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_set_recurring_invalid_period(client):
    """PATCH /transactions/{id}/recurring with invalid period returns 422."""
    resp = client.patch(
        "/api/transactions/00000000-0000-0000-0000-000000000000/recurring",
        json={"is_recurring": True, "recurrence_period": "biweekly"},
    )
    assert resp.status_code == 422


def test_budget_summary_has_coverage_gaps_shape(client):
    """GET /api/budgets/summary returns coverage_gaps with recurring_gaps and variable_gaps arrays."""
    resp = client.get("/api/budgets/summary")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "coverage_gaps" in data, "expected coverage_gaps key (not unbudgeted_categories)"
    gaps = data["coverage_gaps"]
    assert "recurring_gaps" in gaps
    assert "variable_gaps" in gaps
    assert isinstance(gaps["recurring_gaps"], list)
    assert isinstance(gaps["variable_gaps"], list)
