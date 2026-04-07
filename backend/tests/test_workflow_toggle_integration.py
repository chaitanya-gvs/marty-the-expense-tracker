"""Tests for workflow toggle integration."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.apis.routes.workflow_routes import _MODE_PRESETS, _resolve_toggles
from src.apis.schemas.workflow import WorkflowRunRequest, WorkflowMode
from src.services.orchestrator.statement_workflow import StatementWorkflow


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


@pytest.mark.asyncio
async def test_email_ingestion_called_when_enabled():
    """AlertIngestionService.run() is called when include_email_ingestion=True."""
    mock_result = {"processed": 5, "inserted": 3, "skipped": 2, "errors": 0, "accounts": []}

    with patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        instance = MockSvc.return_value
        instance.run = AsyncMock(return_value=mock_result)

        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()
        workflow._refresh_all_tokens = AsyncMock()

        result = await workflow.run_complete_workflow(
            include_email_ingestion=True,
            include_statement=False,
            include_splitwise=False,
        )

    instance.run.assert_called_once()
    assert result["email_ingestion"]["inserted"] == 3


@pytest.mark.asyncio
async def test_email_ingestion_skipped_when_disabled():
    """AlertIngestionService is never instantiated when include_email_ingestion=False."""
    with patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()

        await workflow.run_complete_workflow(
            include_email_ingestion=False,
            include_statement=False,
            include_splitwise=False,
        )

    MockSvc.assert_not_called()


@pytest.mark.asyncio
async def test_statement_senders_not_queried_when_statement_disabled():
    """AccountOperations.get_all_statement_senders is not called when include_statement=False."""
    with patch(
        "src.services.orchestrator.statement_workflow.AccountOperations.get_all_statement_senders",
        new_callable=AsyncMock,
    ) as mock_senders, patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        MockSvc.return_value.run = AsyncMock(
            return_value={"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}
        )

        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()

        await workflow.run_complete_workflow(
            include_email_ingestion=True,
            include_statement=False,
            include_splitwise=False,
        )

    mock_senders.assert_not_called()
