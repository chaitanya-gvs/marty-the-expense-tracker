"""
Test script for the Statement Processing Workflow Orchestrator

This test verifies the workflow orchestrator functionality without actually
processing real statements (dry run mode).
"""

import asyncio
import sys
from pathlib import Path
from unittest.mock import Mock, patch, AsyncMock

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import StatementWorkflow
from src.utils.logger import get_logger

logger = get_logger(__name__)


class TestStatementWorkflow:
    """Test class for the workflow orchestrator"""
    
    def test_date_range_calculation(self):
        """Test date range calculation logic"""
        workflow = StatementWorkflow()
        start_date, end_date = workflow._calculate_date_range()
        
        logger.info(f"Calculated date range: {start_date} to {end_date}")
        
        # Verify format is YYYY/MM/DD
        assert len(start_date.split('/')) == 3
        assert len(end_date.split('/')) == 3
        
        # Verify start_date is before end_date
        from datetime import datetime
        start_dt = datetime.strptime(start_date, "%Y/%m/%d")
        end_dt = datetime.strptime(end_date, "%Y/%m/%d")
        assert start_dt < end_dt
        
        logger.info("✅ Date range calculation test passed")
    
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
        with patch('src.services.statement_processor.workflow.AccountOperations.get_account_nickname_by_sender') as mock_get_nickname:
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
    
    @patch('src.services.statement_processor.workflow.AccountOperations.get_all_statement_senders')
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


async def run_tests():
    """Run all tests"""
    logger.info("🧪 Running Statement Processing Workflow Tests")
    logger.info("=" * 60)
    
    test_instance = TestStatementWorkflow()
    
    try:
        # Run synchronous tests
        test_instance.test_date_range_calculation()
        test_instance.test_previous_month_name_calculation()
        test_instance.test_cloud_path_generation()
        
        # Run async tests
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
