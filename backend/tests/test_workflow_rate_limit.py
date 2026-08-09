"""
Test that POST /api/workflow/run is rate-limited.
Run from backend/ with: poetry run pytest tests/test_workflow_rate_limit.py -v
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from src.utils.jwt_utils import create_access_token


def _authed_client() -> TestClient:
    client = TestClient(app)
    client.cookies.set("access_token", create_access_token())
    return client


@pytest.fixture(autouse=True)
def _reset_workflow_state():
    yield
    from src.apis.routes import workflow_routes
    workflow_routes._jobs.clear()
    workflow_routes._active_job_id = None


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
