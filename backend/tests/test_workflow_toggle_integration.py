"""Tests for workflow toggle integration."""
from src.apis.schemas.workflow import WorkflowRunRequest, WorkflowMode


def test_toggle_defaults_are_none():
    """All three new fields should default to None (use mode preset)."""
    req = WorkflowRunRequest()
    assert req.include_email_ingestion is None
    assert req.include_statement is None
    assert req.include_splitwise is None


def test_explicit_toggle_false_stored():
    """Explicit False must be preserved (not coerced to None)."""
    req = WorkflowRunRequest(
        mode=WorkflowMode.full,
        include_email_ingestion=False,
        include_statement=True,
        include_splitwise=False,
    )
    assert req.include_email_ingestion is False
    assert req.include_statement is True
    assert req.include_splitwise is False


def test_existing_fields_unchanged():
    """Ensure existing fields still work after schema change."""
    req = WorkflowRunRequest(
        mode=WorkflowMode.resume,
        override=True,
        start_date="2025-01-01",
        end_date="2025-01-31",
    )
    assert req.mode == WorkflowMode.resume
    assert req.override is True
    assert req.start_date == "2025-01-01"
