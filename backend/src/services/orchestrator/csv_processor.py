"""
CSV Processor Service

This service handles CSV normalization and standardization operations:
- Process multiple CSV files from extracted data
- Normalize and standardize transaction data
- Handle different bank statement formats
"""

import asyncio
import pandas as pd
from pathlib import Path
from typing import Dict, List, Any, Optional

from .transaction_standardizer import TransactionStandardizer
from src.utils.logger import get_logger

logger = get_logger(__name__)


class CSVProcessor:
    """Process and standardize CSV files from extracted data"""
    
    def __init__(self, data_dir: Optional[str] = None):
        """
        Initialize the CSV processor
        
        Args:
            data_dir: Path to data directory. If None, uses default backend/data
        """
        self.transaction_standardizer = TransactionStandardizer(data_dir)
        
    async def process_all_csv_files(self, save_to_file: bool = True) -> pd.DataFrame:
        """
        Process all CSV files in the extracted_data directory
        
        Args:
            save_to_file: Whether to save the standardized data to CSV file
            
        Returns:
            Standardized DataFrame with all transactions
        """
        logger.info("Starting CSV processing for all extracted files")
        
        # Use the transaction standardizer to process all CSV files
        standardized_df = self.transaction_standardizer.standardize_all_transactions(save_to_file)
        
        if not standardized_df.empty:
            logger.info(f"Successfully processed {len(standardized_df)} transactions from CSV files")
        else:
            logger.warning("No transactions were processed from CSV files")
            
        return standardized_df
    
    async def process_single_csv_file(self, csv_path: str) -> pd.DataFrame:
        """
        Process a single CSV file
        
        Args:
            csv_path: Path to the CSV file to process
            
        Returns:
            Standardized DataFrame with transactions from the file
        """
        logger.info(f"Processing single CSV file: {csv_path}")
        
        csv_file_path = Path(csv_path)
        if not csv_file_path.exists():
            logger.error(f"CSV file not found: {csv_path}")
            return pd.DataFrame()
        
        # Use the transaction standardizer to process the single file
        standardized_df = self.transaction_standardizer.process_csv_file(csv_file_path)
        
        if not standardized_df.empty:
            logger.info(f"Successfully processed {len(standardized_df)} transactions from {csv_file_path.name}")
        else:
            logger.warning(f"No transactions were processed from {csv_file_path.name}")
            
        return standardized_df
    
    def get_processing_summary(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        Get summary statistics for processed CSV data
        
        Args:
            df: DataFrame with standardized transactions
            
        Returns:
            Dictionary with summary statistics
        """
        return self.transaction_standardizer.get_summary(df)


# Global instance for easy access
csv_processor = CSVProcessor()


def get_csv_processor(data_dir: Optional[str] = None) -> CSVProcessor:
    """Get the global CSV processor instance"""
    if data_dir is not None:
        return CSVProcessor(data_dir)
    return csv_processor
