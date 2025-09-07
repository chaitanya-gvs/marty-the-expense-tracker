#!/usr/bin/env python3
"""
Script to standardize transaction data using the TransactionStandardizer service.
"""

import sys
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import get_transaction_standardizer
from src.utils.logger import get_logger

logger = get_logger(__name__)


def main():
    """Main function to run the standardization process using the service"""
    logger.info("Starting transaction standardization using service")
    
    # Get the transaction standardizer service
    standardizer = get_transaction_standardizer()
    
    # Process all transactions
    standardized_df = standardizer.standardize_all_transactions(save_to_file=True)
    
    if not standardized_df.empty:
        # Get summary
        summary = standardizer.get_summary(standardized_df)
        
        # Print summary
        print(f"\n=== TRANSACTION STANDARDIZATION SUMMARY ===")
        print(f"Total transactions processed: {summary['total_transactions']}")
        print(f"Date range: {summary['date_range']['start']} to {summary['date_range']['end']}")
        print(f"Accounts: {summary['accounts']}")
        print(f"Transaction types: {summary['transaction_types']}")
        print(f"Total amounts - Debit: ₹{summary['total_amount']['debit']:,.2f}, Credit: ₹{summary['total_amount']['credit']:,.2f}")
        
        # Show sample data
        print(f"\n=== SAMPLE DATA ===")
        print(standardized_df.head(10).to_string(index=False))
        
    else:
        logger.error("No transactions were processed successfully")


if __name__ == "__main__":
    main()
