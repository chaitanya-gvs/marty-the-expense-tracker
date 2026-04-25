"""
Tests for cancel-recurring-by-key endpoints.
Run from backend/ with: poetry run pytest tests/test_cancel_recurring.py -v
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from src.utils.auth_deps import get_current_user


def override_auth():
    return "test_user"


app.dependency_overrides[get_current_user] = override_auth


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_count_recurring_unknown_key_returns_zero(client):
    """GET /api/transactions/recurring/{key}/count with a key that has no transactions returns count=0."""
    resp = client.get("/api/transactions/recurring/nonexistent-key-xyz/count")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert body["data"]["count"] == 0


def test_cancel_recurring_unknown_key_returns_404(client):
    """PATCH /api/transactions/recurring/{key}/cancel with no matching transactions returns 404."""
    resp = client.patch("/api/transactions/recurring/nonexistent-key-xyz/cancel")
    assert resp.status_code == 404
