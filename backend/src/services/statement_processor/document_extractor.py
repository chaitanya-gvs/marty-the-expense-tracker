"""
Agentic-Doc Processor Service

This service integrates with LandingAI's agentic-doc library to extract structured data
from PDF bank statements and save the results.
"""

import asyncio
import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

import pandas as pd
from agentic_doc.parse import parse
from dotenv import load_dotenv

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))

from src.schemas.extraction import BANK_STATEMENT_MODELS
from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)
load_dotenv("configs/secrets/.env")


class DocumentExtractor:
    """Extract structured data from documents using AI-powered extraction models"""
    
    def __init__(self):
        self.api_key = os.getenv("VISION_AGENT_API_KEY")
        
        if not self.api_key:
            logger.warning("VISION_AGENT_API_KEY environment variable not set")
            logger.warning("Agentic-doc functionality will not be available")
            self.available = False
            return
        
        # Assign parse function
        self.parse = parse
        

    
    def _get_schema_from_filename(self, filename: str, account_nickname: str = None):
        """
        Determine the appropriate extraction schema based on the account nickname.
        
        Args:
            filename: PDF filename (for logging purposes)
            account_nickname: The actual account nickname from database (e.g., "Axis Atlas Credit Card")
            
        Returns:
            The appropriate Pydantic model class, or None if no match found
        """
        try:
            if not account_nickname:
                logger.warning(f"No account nickname provided for filename: {filename}")
                return None
            
            logger.info(f"Using account nickname: {account_nickname} for filename: {filename}")
            
            # Map account nickname to schema
            schema = self._map_nickname_to_schema(account_nickname)
            if schema:
                logger.info(f"Matched schema '{schema.__name__}' for nickname: {account_nickname}")
                return schema
            else:
                logger.warning(f"No schema mapping found for nickname: {account_nickname}")
                return None
                
        except Exception as e:
            logger.error(f"Error determining schema from nickname: {e}")
            return None
    
    def _extract_account_nickname_from_filename(self, filename: str) -> Optional[str]:
        """Extract account nickname from normalized filename"""
        try:
            # Remove file extension and _unlocked suffix
            base_name = Path(filename).stem
            if base_name.endswith('_unlocked'):
                base_name = base_name[:-9]  # Remove '_unlocked'
            
            # Extract nickname (everything before the last underscore which should be the date)
            parts = base_name.split('_')
            if len(parts) >= 2:
                # Join all parts except the last one (which should be the date)
                nickname = '_'.join(parts[:-1])
                return nickname
            
            return None
            
        except Exception as e:
            logger.error(f"Error extracting nickname from filename: {e}")
            return None
    
    def _map_nickname_to_schema(self, nickname: str):
        """Map account nickname to appropriate extraction schema"""
        nickname_lower = nickname.lower()
        
        # Remove "account" or "credit card" from the end to get the schema key
        schema_key = nickname_lower
        if schema_key.endswith(" credit card"):
            schema_key = schema_key[:-12]  # Remove " credit card"
        elif schema_key.endswith(" account"):
            schema_key = schema_key[:-8]   # Remove " account"
        
        # Convert to schema key format (replace spaces with underscores)
        schema_key = schema_key.replace(" ", "_")
        
        # Check if the schema exists in BANK_STATEMENT_MODELS
        if schema_key in BANK_STATEMENT_MODELS:
            logger.info(f"Mapped nickname '{nickname}' to schema key '{schema_key}'")
            return BANK_STATEMENT_MODELS[schema_key]
        
        logger.warning(f"No schema found for nickname '{nickname}' (derived key: '{schema_key}')")
        return None
    
    
    def _parse_html_table_to_dataframe(self, html_table: str) -> pd.DataFrame:
        """
        Parse HTML table string and convert to pandas DataFrame
        
        Args:
            html_table: HTML table string from agentic-doc extraction
            
        Returns:
            Pandas DataFrame with parsed transaction data
        """
        try:
            # Use pandas to read HTML tables
            tables = pd.read_html(html_table)
            
            if not tables:
                logger.warning("No tables found in HTML")
                return pd.DataFrame()
            
            # Combine all tables if multiple exist
            if len(tables) > 1:
                logger.info(f"Found {len(tables)} tables, combining them")
                combined_df = pd.concat(tables, ignore_index=True)
            else:
                combined_df = tables[0]
            
            # Clean up the DataFrame
            combined_df = combined_df.dropna(how='all')  # Remove completely empty rows
            
            # Remove rows that are just card info or headers
            combined_df = combined_df[~combined_df.iloc[:, 0].str.contains('Card No:|Name:', na=False)]
            
            logger.info(f"Successfully parsed HTML table: {len(combined_df)} rows, {len(combined_df.columns)} columns")
            return combined_df
            
        except Exception as e:
            logger.error(f"Error parsing HTML table: {e}")
            return pd.DataFrame()
    
    def extract_from_pdf(self, pdf_path: str, account_nickname: str = None, save_results: bool = True) -> Dict[str, Any]:
        """
        Extract structured data from a PDF bank statement using agentic-doc
        
        Args:
            pdf_path: Path to the PDF file
            account_nickname: The account nickname from database for schema selection
            save_results: Whether to save results to file
        
        Returns:
            Dictionary containing extracted data and metadata
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                raise FileNotFoundError(f"PDF file not found: {pdf_path}")
            
            logger.info(f"Processing PDF with agentic-doc: {pdf_path.name}")
            
            # Extract data using agentic-doc
            logger.info("Starting extraction with agentic-doc...")
            extraction_result = self._extract_with_agentic_doc(pdf_path, account_nickname)
            
            if not extraction_result.get("success"):
                return extraction_result
            
            # Save results if requested (only CSV in temp directory)
            if save_results:
                saved_path = self._save_extraction_csv_only(extraction_result, pdf_path, account_nickname)
                extraction_result["saved_path"] = saved_path
            
            # Add metadata
            extraction_result["metadata"] = {
                "source_file": str(pdf_path),
                "extraction_method": "agentic-doc",
                "extracted_at": self._get_timestamp()
            }
            
            logger.info(f"Successfully extracted data from {pdf_path.name}")
            return extraction_result
            
        except Exception as e:
            logger.error(f"Error extracting data from PDF {pdf_path}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _extract_with_agentic_doc(self, pdf_path: Path, account_nickname: str = None) -> Dict[str, Any]:
        """Extract data using the agentic-doc library"""
        try:
            logger.info("Calling agentic-doc parse function...")
            
            # Automatically determine the extraction schema based on account nickname
            extraction_schema = self._get_schema_from_filename(pdf_path.name, account_nickname)
            if not extraction_schema:
                raise Exception(f"No extraction schema found for account nickname: {account_nickname}")
            
            logger.info(f"Using extraction schema: {extraction_schema.__name__}")
            
            # Parse the document with the appropriate schema
            file_paths = [str(pdf_path)]
            results = self.parse(file_paths, extraction_model=extraction_schema)
            
            if not results:
                raise Exception("agentic-doc returned no results")
            
            # Process the first result (assuming single document)
            doc_result = results[0]
            
            # Extract the table data
            if hasattr(doc_result, 'extraction') and doc_result.extraction:
                table_data = doc_result.extraction.table
                logger.info(f"Successfully extracted transaction table with {len(table_data)} characters")
                
                return {
                    "success": True,
                    "table_data": table_data,
                    "raw_result": doc_result,
                    "extraction_schema": extraction_schema.__name__
                }
            else:
                logger.warning("No extraction data found in agentic-doc result")
                return {
                    "success": False,
                    "error": "No extraction data found in agentic-doc result"
                }
            
        except Exception as e:
            logger.error(f"Error in agentic-doc extraction: {e}")
            raise
    
    def _save_extraction_csv_only(self, extraction_result: Dict[str, Any], pdf_path: Path, account_nickname: str = None) -> Optional[str]:
        """Save extraction results as CSV only in extracted_data directory"""
        try:
            # Create extracted_data directory for CSV files
            output_dir = Path("data/extracted_data")
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate output filename using account nickname if available
            if account_nickname:
                # Convert nickname to filename format (lowercase, replace spaces with underscores)
                nickname_clean = account_nickname.lower().replace(" ", "_").replace("_credit_card", "").replace("_account", "")
                
                # Extract date from PDF filename or use current date
                date_str = self._extract_date_from_pdf_filename(pdf_path)
                base_filename = f"{nickname_clean}_{date_str}_extracted"
            else:
                # Fallback to original method
                timestamp = self._get_timestamp().replace(":", "-").replace(".", "-")
                base_filename = f"{pdf_path.stem}_extracted_{timestamp}"
            
            # Parse HTML table and save as CSV only
            if extraction_result.get("table_data"):
                df = self._parse_html_table_to_dataframe(extraction_result["table_data"])
                if not df.empty:
                    # Save as CSV only
                    csv_filename = f"{base_filename}.csv"
                    csv_file = output_dir / csv_filename
                    df.to_csv(csv_file, index=False, encoding='utf-8')
                    logger.info(f"Saved CSV table to: {csv_file}")
                    
                    # Add file path to result
                    extraction_result["csv_file"] = str(csv_file)
                    return str(csv_file)
            
            return None
            
        except Exception as e:
            logger.error(f"Error saving extraction CSV: {e}")
            return None
    
    def _save_extraction_results(self, extraction_result: Dict[str, Any], pdf_path: Path) -> Optional[str]:
        """Save extraction results to file"""
        try:
            # Create output directory
            output_dir = Path("data/extracted_data")
            output_dir.mkdir(parents=True, exist_ok=True)
            
            # Generate output filename
            timestamp = self._get_timestamp().replace(":", "-").replace(".", "-")
            base_filename = f"{pdf_path.stem}_extracted_{timestamp}"
            
            # Save JSON results
            json_filename = f"{base_filename}.json"
            json_file = output_dir / json_filename
            
            # Prepare data for saving
            save_data = {
                "source_file": str(pdf_path),
                "extraction_timestamp": self._get_timestamp(),
                "extraction_schema": extraction_result.get("extraction_schema"),
                "table_data": extraction_result.get("table_data"),
                "success": extraction_result.get("success")
            }
            
            # Save as JSON
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(save_data, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Saved extraction results to: {json_file}")
            
            # Parse HTML table and save as CSV/Excel
            if extraction_result.get("table_data"):
                df = self._parse_html_table_to_dataframe(extraction_result["table_data"])
                if not df.empty:
                    # Save as CSV
                    csv_filename = f"{base_filename}.csv"
                    csv_file = output_dir / csv_filename
                    df.to_csv(csv_file, index=False, encoding='utf-8')
                    logger.info(f"Saved CSV table to: {csv_file}")
                    
                    # Save as Excel
                    excel_filename = f"{base_filename}.xlsx"
                    excel_file = output_dir / excel_filename
                    df.to_excel(excel_file, index=False, engine='openpyxl')
                    logger.info(f"Saved Excel table to: {excel_file}")
                    
                    # Add file paths to result
                    extraction_result["csv_file"] = str(csv_file)
                    extraction_result["excel_file"] = str(excel_file)
            
            return str(json_file)
            
        except Exception as e:
            logger.error(f"Error saving extraction results: {e}")
            return None
    
    def _get_timestamp(self) -> str:
        """Get current timestamp as string"""
        return datetime.now().isoformat()
    
    def _extract_date_from_pdf_filename(self, pdf_path: Path) -> str:
        """Extract date from PDF filename or use current date as fallback"""
        try:
            filename = pdf_path.stem
            
            # Look for date pattern YYYYMMDD in filename
            import re
            date_match = re.search(r'(\d{8})', filename)
            if date_match:
                date_str = date_match.group(1)
                # Convert YYYYMMDD to YYYYMMDD format
                return date_str
            
            # Look for date pattern YYYY-MM-DD or YYYY_MM_DD
            date_match = re.search(r'(\d{4})[-_](\d{2})[-_](\d{2})', filename)
            if date_match:
                year, month, day = date_match.groups()
                return f"{year}{month}{day}"
            
            # Fallback to current date
            return datetime.now().strftime("%Y%m%d")
            
        except Exception as e:
            logger.error(f"Error extracting date from filename: {e}")
            return datetime.now().strftime("%Y%m%d")


# Global instance for easy access
document_extractor = DocumentExtractor()


def get_document_extractor() -> DocumentExtractor:
    """Get the global document extractor instance"""
    return document_extractor


if __name__ == "__main__":
    """Test the document extraction with a real PDF file"""

    # Test file path - Yes Bank statement unlocked
    test_pdf = "/Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/backend/data/statements/unlocked_statements/yes_bank_savings_account_20250904_unlocked.pdf"
    
    print("🚀 Testing Document Extraction with real PDF file")
    print(f"📄 Test file: {test_pdf}")
    print("-" * 60)
    
    try:
        # Create extractor instance
        extractor = DocumentExtractor()
        
        # Check if API key is available
        if not extractor.api_key:
            print("❌ VISION_AGENT_API_KEY not set. Please set the environment variable.")
            exit(1)
        
        print("✅ API key found")
        
        # Test schema selection
        print("\n🔍 Testing schema selection...")
        schema = extractor._get_schema_from_filename(test_pdf)
        if schema:
            print(f"✅ Selected schema: {schema.__name__}")
        else:
            print("❌ No schema found for filename")
            exit(1)
        
        # Extract data from PDF
        print(f"\n📊 Extracting data from PDF...")
        result = extractor.extract_from_pdf(test_pdf, save_results=True)
        
        if result.get("success"):
            print("✅ Extraction successful!")
            print(f"📋 Schema used: {result.get('extraction_schema')}")
            print(f"📊 Table data length: {len(result.get('table_data', ''))} characters")
            print(f"💾 JSON results saved to: {result.get('saved_path')}")
            
            # Show CSV and Excel file paths
            if result.get("csv_file"):
                print(f"📊 CSV table saved to: {result.get('csv_file')}")
            if result.get("excel_file"):
                print(f"📈 Excel table saved to: {result.get('excel_file')}")
            
            # Show a preview of the extracted table data
            table_data = result.get("table_data", "")
            if table_data:
                print(f"\n📋 Table Data Preview (first 500 chars):")
                print("-" * 40)
                print(table_data[:500] + "..." if len(table_data) > 500 else table_data)
                print("-" * 40)
        else:
            print("❌ Extraction failed!")
            print(f"Error: {result.get('error')}")
            
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        traceback.print_exc()
