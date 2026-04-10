"""Tests for workflow SSE improvements: token refresh singleton, per-account events, rich summary."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.services.orchestrator.statement_workflow import StatementWorkflow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _patch_workflow_init():
    """Context managers to patch all heavy __init__ dependencies."""
    return [
        patch("src.services.orchestrator.statement_workflow.EmailClient"),
        patch("src.services.orchestrator.statement_workflow.GoogleCloudStorageService"),
        patch("src.services.orchestrator.statement_workflow.DocumentExtractor"),
        patch("src.services.orchestrator.statement_workflow.TransactionStandardizer"),
        patch("src.services.orchestrator.statement_workflow.PDFUnlocker"),
        patch("src.services.orchestrator.statement_workflow.BankPasswordManager"),
        patch("src.services.orchestrator.statement_workflow.SplitwiseService"),
        patch("src.services.orchestrator.statement_workflow.StatementExtractorHelper"),
        patch("src.services.orchestrator.statement_workflow.SplitwiseProcessorHelper"),
        patch("src.services.orchestrator.statement_workflow.DataStandardizerHelper"),
    ]


# ---------------------------------------------------------------------------
# Task 1 — Gmail token refresh singleton
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_token_refresh_skips_already_refreshed_account():
    """_refresh_all_tokens must not re-refresh an account already done in this run."""
    init_patches = _patch_workflow_init()
    started = [p.start() for p in init_patches]
    try:
        with patch("src.services.orchestrator.statement_workflow.TokenManager") as MockTM, \
             patch("src.services.orchestrator.statement_workflow.build"):
            mock_creds = MagicMock()
            MockTM.return_value.get_valid_credentials.return_value = mock_creds

            workflow = StatementWorkflow(account_ids=["primary"])
            # First call — should refresh
            await workflow._refresh_all_tokens()
            first_call_count = MockTM.return_value.get_valid_credentials.call_count

            # Second call in same run — should be a no-op for "primary"
            await workflow._refresh_all_tokens()
            second_call_count = MockTM.return_value.get_valid_credentials.call_count

            assert first_call_count == 1
            assert second_call_count == 1  # no additional call
    finally:
        for p in init_patches:
            p.stop()


@pytest.mark.asyncio
async def test_token_refresh_runs_for_new_account_id():
    """A second account_id not yet refreshed must still be refreshed."""
    init_patches = _patch_workflow_init()
    started = [p.start() for p in init_patches]
    try:
        with patch("src.services.orchestrator.statement_workflow.TokenManager") as MockTM, \
             patch("src.services.orchestrator.statement_workflow.build"):
            mock_creds = MagicMock()
            MockTM.return_value.get_valid_credentials.return_value = mock_creds

            workflow = StatementWorkflow(account_ids=["primary", "secondary"])
            # Pre-seed: mark primary as already refreshed
            workflow._refreshed_accounts.add("primary")

            await workflow._refresh_all_tokens()
            # Only secondary should have been attempted (1 call, not 2)
            assert MockTM.return_value.get_valid_credentials.call_count == 1
    finally:
        for p in init_patches:
            p.stop()
