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
    for p in init_patches:
        p.start()
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
    for p in init_patches:
        p.start()
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


@pytest.mark.asyncio
async def test_token_refresh_retries_failed_account_on_next_call():
    """Accounts that fail to refresh must NOT be added to _refreshed_accounts,
    so they are retried on the next call to _refresh_all_tokens."""
    init_patches = [
        patch("src.services.orchestrator.statement_workflow.EmailClient"),
        patch("src.services.orchestrator.statement_workflow.GoogleCloudStorageService"),
        patch("src.services.orchestrator.statement_workflow.DocumentExtractor"),
        patch("src.services.orchestrator.statement_workflow.TransactionStandardizer"),
        patch("src.services.orchestrator.statement_workflow.PDFUnlocker"),
        patch("src.services.orchestrator.statement_workflow.BankPasswordManager"),
        patch("src.services.orchestrator.statement_workflow.SplitwiseService"),
        patch("src.services.orchestrator.statement_workflow.tempfile.mkdtemp", return_value="/tmp/fake"),
    ]
    for p in init_patches:
        p.start()

    try:
        with patch("src.services.orchestrator.statement_workflow.TokenManager") as MockTM, \
             patch("src.services.orchestrator.statement_workflow.build"):
            # First call: credentials returns None (failure)
            MockTM.return_value.get_valid_credentials.return_value = None

            workflow = StatementWorkflow(account_ids=["primary"])
            await workflow._refresh_all_tokens()

            # Account must NOT be in the refreshed set after a failure
            assert "primary" not in workflow._refreshed_accounts

            # Second call: credentials now succeed
            mock_creds = MagicMock()
            MockTM.return_value.get_valid_credentials.return_value = mock_creds
            await workflow._refresh_all_tokens()

            # Now it should be in the set (retried and succeeded)
            assert "primary" in workflow._refreshed_accounts
            # get_valid_credentials called once per attempt = 2 total
            assert MockTM.return_value.get_valid_credentials.call_count == 2
    finally:
        for p in init_patches:
            p.stop()


# ---------------------------------------------------------------------------
# Task 2 — Per-account SSE events from AlertIngestionService
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_alert_ingestion_service_emits_per_account_events():
    """AlertIngestionService must fire account_started/account_complete for each account."""
    from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService

    emitted: list[dict] = []

    def callback(event: dict) -> None:
        emitted.append(event)

    fake_account = {
        "id": "acc-1", "nickname": "Test Bank CC", "alert_sender": "alerts@test.bank",
        "is_active": True, "alert_last_processed_at": None,
    }

    with patch(
        "src.services.email_ingestion.alert_ingestion_service.AccountOperations.get_all_accounts",
        new_callable=AsyncMock, return_value=[fake_account],
    ), patch.object(
        AlertIngestionService, "_run_for_account",
        new_callable=AsyncMock,
        return_value={"processed": 2, "inserted": 2, "skipped": 0, "errors": 0},
    ):
        svc = AlertIngestionService(event_callback=callback)
        await svc.run()

    event_types = [e["event"] for e in emitted]
    assert "email_ingestion_account_started" in event_types
    assert "email_ingestion_account_complete" in event_types

    complete_evt = next(e for e in emitted if e["event"] == "email_ingestion_account_complete")
    assert complete_evt["data"]["inserted"] == 2
    assert complete_evt["data"]["account"] == "Test Bank CC"
