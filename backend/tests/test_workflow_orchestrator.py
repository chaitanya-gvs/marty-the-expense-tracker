"""
Test script for the Statement Processing Workflow Orchestrator

This test verifies the workflow orchestrator functionality without actually
processing real statements (dry run mode).
"""

import asyncio
import sys
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock

import pytest

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.orchestrator.statement_workflow import StatementWorkflow
from src.utils.logger import get_logger

logger = get_logger(__name__)


class TestStatementWorkflow:
    """Test class for the workflow orchestrator"""
    
    async def test_date_range_calculation_smoke(self):
        """End-to-end smoke test: default call (no accounts mocked) still
        returns a valid, correctly-ordered date range via the fallback path."""
        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={"min_last_statement_date": None, "account_count": 0, "null_count": 0},
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range()

        from datetime import datetime as dt
        assert len(start_date.split('/')) == 3
        assert len(end_date.split('/')) == 3
        start_dt = dt.strptime(start_date, "%Y/%m/%d")
        end_dt = dt.strptime(end_date, "%Y/%m/%d")
        assert start_dt < end_dt

    async def test_date_range_data_driven(self):
        """When every active statement-sender account has a last_statement_date,
        start_date = MIN(last_statement_date) - 3 days, end_date = now."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 6, 28),
                "account_count": 3,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/06/25"  # 2026-06-28 minus 3 days
        assert end_date == "2026/08/08"

    async def test_date_range_data_driven_buffer_crosses_month_boundary(self):
        """3-day buffer subtracted from an early-month min date crosses into
        the previous month/year correctly."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 8, 1),
                "account_count": 2,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/07/29"  # 2026-08-01 minus 3 days crosses into July
        assert end_date == "2026/08/08"

    async def test_date_range_data_driven_buffer_crosses_year_boundary(self):
        """3-day buffer subtracted from an early-January min date crosses into
        the previous year correctly."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 1, 2),
                "account_count": 2,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 1, 10))

        assert start_date == "2025/12/30"  # 2026-01-02 minus 3 days crosses into December of the previous year
        assert end_date == "2026/01/10"

    async def test_date_range_data_driven_handles_datetime_value(self):
        """min_last_statement_date coming back as a datetime (not date) is truncated correctly."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": dt(2026, 6, 28, 14, 30),
                "account_count": 1,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/06/25"
        assert end_date == "2026/08/08"

    async def test_date_range_falls_back_when_account_never_processed(self):
        """Any active statement-sender account with last_statement_date IS NULL
        disqualifies the data-driven path for the whole run."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 6, 28),
                "account_count": 3,
                "null_count": 1,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))

    async def test_date_range_falls_back_when_no_accounts(self):
        """No active statement-sender accounts -> fixed-window fallback."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={"min_last_statement_date": None, "account_count": 0, "null_count": 0},
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))

    async def test_date_range_falls_back_on_query_error(self):
        """Stats query raising -> fixed-window fallback, no exception propagates."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            side_effect=Exception("db unavailable"),
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))

    def test_fallback_date_range_uses_search_day(self):
        """Fixed-window fallback: prev-month day-N to current-month day-N"""
        from datetime import datetime

        workflow = StatementWorkflow()

        start_date, end_date = workflow._calculate_fallback_date_range(datetime(2026, 8, 8))
        assert start_date == "2026/07/25"
        assert end_date == "2026/08/25"

    def test_fallback_date_range_handles_january(self):
        """January rolls back to December of the previous year"""
        from datetime import datetime

        workflow = StatementWorkflow()

        start_date, end_date = workflow._calculate_fallback_date_range(datetime(2026, 1, 10))
        assert start_date == "2025/12/25"
        assert end_date == "2026/01/25"

    def test_previous_month_name_calculation(self):
        """Test previous month name calculation"""
        workflow = StatementWorkflow()
        
        # Test with September email (should return August)
        september_email = "2025-09-04T10:00:00Z"
        prev_month = workflow._get_previous_month_name(september_email)
        assert "August" in prev_month
        assert "2025" in prev_month
        
        # Test with January email (should return December of previous year)
        january_email = "2025-01-15T10:00:00Z"
        prev_month = workflow._get_previous_month_name(january_email)
        assert "December" in prev_month
        assert "2024" in prev_month
        
        logger.info("✅ Previous month name calculation test passed")
    
    def test_cloud_path_generation(self):
        """Test cloud storage path generation"""
        workflow = StatementWorkflow()
        
        cloud_path = workflow._generate_cloud_path(
            sender_email="test@bank.com",
            email_date="2025-09-04T10:00:00Z",
            filename="statement.pdf"
        )
        
        # Should be organized by month only, no account subdirectory
        assert "statements" in cloud_path
        assert "August_2025" in cloud_path
        assert "statement.pdf" in cloud_path
        assert cloud_path == "statements/August_2025/statement.pdf"
        
        logger.info("✅ Cloud path generation test passed")
    
    async def test_normalized_filename_generation(self):
        """Test normalized filename generation"""
        workflow = StatementWorkflow()
        
        # Mock the async function call
        with patch('src.services.orchestrator.statement_workflow.AccountOperations.get_account_nickname_by_sender') as mock_get_nickname:
            mock_get_nickname.return_value = "test_account"
            
            # Test primary account (no suffix)
            filename = await workflow._generate_normalized_filename(
                sender_email="test@bank.com",
                email_date="2025-09-04T10:00:00Z",
                original_filename="statement.pdf"
            )
            
            assert "test_account" in filename
            assert "20250904" in filename
            assert filename.endswith("_locked.pdf")
            assert filename == "test_account_20250904_locked.pdf"
        
        logger.info("✅ Normalized filename generation test passed")
    
    @patch('src.services.orchestrator.statement_workflow.AccountOperations.get_all_statement_senders')
    async def test_workflow_dry_run(self, mock_get_senders):
        """Test workflow with mocked dependencies (dry run)"""
        # Mock the database call
        mock_get_senders.return_value = ["test1@bank.com", "test2@bank.com"]

        # Mock email client methods
        with patch.object(StatementWorkflow, '_download_statements_from_sender') as mock_download:
            mock_download.return_value = []

            # Mock extraction
            with patch.object(StatementWorkflow, '_process_statement_extraction') as mock_extract:
                mock_extract.return_value = {"success": True}

                # Mock cloud storage
                with patch.object(StatementWorkflow, '_upload_unlocked_statement_to_cloud') as mock_upload:
                    mock_upload.return_value = "test/cloud/path"

                    # Mock standardization
                    with patch.object(StatementWorkflow, '_standardize_and_store_data') as mock_standardize:
                        mock_standardize.return_value = True

                        workflow = StatementWorkflow(account_ids=["primary", "secondary"])
                        results = await workflow.run_complete_workflow()

                    # Verify results structure
                    assert "total_senders" in results
                    assert "total_statements_downloaded" in results
                    assert "total_statements_uploaded" in results
                    assert "total_statements_processed" in results
                    assert "errors" in results
                    assert "processed_statements" in results

                    logger.info("✅ Workflow dry run test passed")

    async def test_check_cloud_csvs_exist_true_when_pending(self):
        """check_cloud_csvs_exist() returns True when any month has pending work."""
        with patch(
            "src.services.orchestrator.statement_workflow.StatementLogOperations.get_pending_statement_months",
            new_callable=AsyncMock, return_value=["2026-06", "2026-07"],
        ):
            workflow = StatementWorkflow()
            result = await workflow.check_cloud_csvs_exist()

        assert result is True

    async def test_check_cloud_csvs_exist_false_when_none_pending(self):
        """check_cloud_csvs_exist() returns False when nothing is pending."""
        with patch(
            "src.services.orchestrator.statement_workflow.StatementLogOperations.get_pending_statement_months",
            new_callable=AsyncMock, return_value=[],
        ):
            workflow = StatementWorkflow()
            result = await workflow.check_cloud_csvs_exist()

        assert result is False


@pytest.mark.asyncio
async def test_dedup_pass_does_not_call_match_for_flagged_rows():
    """Flagged rows (_skip_reason set) bypass dedup — transaction_date is None
    so match_statement_transaction would TypeError without the guard."""
    workflow = StatementWorkflow()

    flagged = {
        "transaction_date": None,
        "description": "TRANSACTIONS FOR CHAITANYA GVS",
        "amount": 0.0,
        "account": "Cashback SBI Credit Card",
        "_skip_reason": "null_date",
        "_partial_date_raw": "TRANSACTIONS FOR CHAITANYA GVS",
    }
    valid = {
        "transaction_date": date(2026, 5, 7),
        "description": "SPOTIFY",
        "amount": 179.0,
        "account": "Cashback SBI Credit Card",
        "_skip_reason": None,
    }

    with patch(
        "src.services.orchestrator.statement_workflow.AccountOperations.get_all_accounts",
        new_callable=AsyncMock, return_value=[],
    ), patch(
        "src.services.orchestrator.statement_workflow.DeduplicationService.match_statement_transaction",
        new_callable=AsyncMock,
    ) as mock_match:
        filtered, stats = await workflow._run_dedup_pass([flagged, valid])

    # Flagged row passes through unchanged
    assert any(tx.get("_skip_reason") == "null_date" for tx in filtered)
    # match_statement_transaction must NOT have been called for the flagged row
    for call in mock_match.call_args_list:
        tx_arg = call.args[0] if call.args else call.kwargs.get("tx") or call.args[0]
        assert tx_arg.get("_skip_reason") is None, (
            "match_statement_transaction was called with a flagged row"
        )


async def run_tests():
    """Run all tests"""
    logger.info("🧪 Running Statement Processing Workflow Tests")
    logger.info("=" * 60)
    
    test_instance = TestStatementWorkflow()
    
    try:
        # Run synchronous tests
        test_instance.test_previous_month_name_calculation()
        test_instance.test_cloud_path_generation()

        # Run async tests
        await test_instance.test_date_range_calculation_smoke()
        await test_instance.test_date_range_data_driven()
        await test_instance.test_date_range_data_driven_buffer_crosses_month_boundary()
        await test_instance.test_date_range_data_driven_buffer_crosses_year_boundary()
        await test_instance.test_date_range_data_driven_handles_datetime_value()
        await test_instance.test_date_range_falls_back_when_account_never_processed()
        await test_instance.test_date_range_falls_back_when_no_accounts()
        await test_instance.test_date_range_falls_back_on_query_error()
        await test_instance.test_check_cloud_csvs_exist_true_when_pending()
        await test_instance.test_check_cloud_csvs_exist_false_when_none_pending()
        await test_instance.test_normalized_filename_generation()
        await test_instance.test_workflow_dry_run()
        
        logger.info("=" * 60)
        logger.info("✅ All tests passed successfully!")
        
    except Exception as e:
        logger.error(f"❌ Test failed: {e}")
        raise


if __name__ == "__main__":
    # Run the tests
    asyncio.run(run_tests())
