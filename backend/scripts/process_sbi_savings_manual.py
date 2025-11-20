#!/usr/bin/env python3
"""
Manually process SBI Savings CSV from cloud storage
"""
import asyncio
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
from src.services.database_manager.operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def main():
    """Download and process SBI savings CSV from cloud storage"""
    try:
        # Initialize services
        cloud_storage = GoogleCloudStorageService()
        standardizer = TransactionStandardizer()
        
        # CSV path in cloud storage (from the logs, it was uploaded to 2025-09)
        cloud_csv_path = "2025-09/extracted_data/sbi_savings_20251023_extracted.csv"
        
        logger.info(f"Downloading {cloud_csv_path} from cloud storage...")
        
        # Download to temp file
        temp_dir = Path("/tmp")
        temp_csv_path = temp_dir / "sbi_savings_20251023_extracted.csv"
        
        download_result = cloud_storage.download_file(cloud_csv_path, str(temp_csv_path))
        
        if not download_result.get("success"):
            logger.error(f"Failed to download: {download_result.get('error')}")
            # Try 2025-10 folder as well
            cloud_csv_path = "2025-10/extracted_data/sbi_savings_20251023_extracted.csv"
            logger.info(f"Trying {cloud_csv_path}...")
            download_result = cloud_storage.download_file(cloud_csv_path, str(temp_csv_path))
            
            if not download_result.get("success"):
                logger.error(f"Failed to download from both locations: {download_result.get('error')}")
                return
        
        logger.info(f"Successfully downloaded to {temp_csv_path}")
        
        # Read CSV
        import pandas as pd
        df = pd.read_csv(temp_csv_path)
        logger.info(f"Read {len(df)} rows from CSV")
        
        # Get account name
        search_pattern = "sbi_savings"
        account_name = await standardizer.get_account_name(search_pattern)
        logger.info(f"Account name: {account_name}")
        
        # Process using the new method
        standardized_df = await standardizer.process_with_dynamic_method(
            df, search_pattern, temp_csv_path.name
        )
        
        if standardized_df.empty:
            logger.error("No transactions standardized!")
            return
        
        logger.info(f"Standardized {len(standardized_df)} transactions")
        
        # Convert to list of dicts
        transactions = standardized_df.to_dict('records')
        
        # Insert into database
        logger.info("Inserting transactions into database...")
        result = await TransactionOperations.bulk_insert_transactions(
            transactions,
            check_duplicates=True
        )
        
        if result.get("success"):
            logger.info(f"✅ Successfully inserted {result.get('inserted_count', 0)} transactions")
            logger.info(f"⏭️  Skipped {result.get('skipped_count', 0)} duplicates")
            logger.info(f"❌ Errors: {result.get('error_count', 0)}")
        else:
            logger.error(f"Failed to insert transactions: {result.get('errors', [])}")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())

