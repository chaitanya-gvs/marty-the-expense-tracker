"""Tests for workflow toggle integration."""
from src.apis.routes.workflow_routes import _MODE_PRESETS, _resolve_toggles
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


def test_full_preset_all_enabled():
    preset = _MODE_PRESETS[WorkflowMode.full]
    assert preset["email"] is True
    assert preset["statement"] is True
    assert preset["splitwise"] is True
    assert preset["resume"] is False


def test_resume_preset():
    preset = _MODE_PRESETS[WorkflowMode.resume]
    assert preset["email"] is False
    assert preset["statement"] is True
    assert preset["splitwise"] is True
    assert preset["resume"] is True


def test_splitwise_only_preset():
    preset = _MODE_PRESETS[WorkflowMode.splitwise_only]
    assert preset["email"] is False
    assert preset["statement"] is False
    assert preset["splitwise"] is True
    assert preset["resume"] is False


def test_explicit_toggle_overrides_preset():
    req = WorkflowRunRequest(mode=WorkflowMode.full, include_email_ingestion=False)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is False    # explicit override
    assert stmt is True      # from preset
    assert sw is True        # from preset
    assert resume is False   # always from preset


def test_splitwise_only_with_email_override():
    req = WorkflowRunRequest(mode=WorkflowMode.splitwise_only, include_email_ingestion=True)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is True     # explicit override
    assert stmt is False     # from preset
    assert sw is True        # from preset
    assert resume is False


def test_resume_with_splitwise_off():
    req = WorkflowRunRequest(mode=WorkflowMode.resume, include_splitwise=False)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is False    # from preset
    assert stmt is True      # from preset
    assert sw is False       # explicit override
    assert resume is True    # always from preset
