#!/usr/bin/env python3
"""
Complete Statement Processing Workflow

This script provides a complete workflow for processing bank statements:
1. Extract data using agentic-doc
2. Extract transaction table
3. Save both results in multiple formats

Usage:
    poetry run python scripts/complete_statement_processing.py <pdf_path> [--format excel|csv] [--output-dir <dir>]
"""

import sys
import os
from pathlib import Path
from typing import Dict, Any, Optional

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import get_agentic_doc_processor, get_transaction_extractor
from src.utils.password_manager import get_password_manager
from src.utils.logger import get_logger

logger = get_logger(__name__)


class CompleteStatementProcessor:
    """Complete workflow for processing bank statements with agentic-doc"""
    
    def __init__(self):
        self.agentic_extractor = get_agentic_doc_processor()
        self.transaction_extractor = get_transaction_extractor()
        self.password_manager = get_password_manager()
    
    def process_statement(self, pdf_path: str, sender_email: str = None, 
                         output_format: str = 'excel', output_dir: str = "data/statements") -> Dict[str, Any]:
        """
        Complete statement processing workflow
        
        Args:
            pdf_path: Path to the PDF statement
            sender_email: Email for password lookup
            output_format: 'excel' or 'csv'
            output_dir: Output directory for results
        
        Returns:
            Dictionary containing processing results
        """
        try:
            pdf_file = Path(pdf_path)
            if not pdf_file.exists():
                raise FileNotFoundError(f"PDF file not found: {pdf_path}")
            
            print(f"🚀 Complete Statement Processing Workflow")
            print(f"📄 File: {pdf_file.name}")
            print(f"📧 Sender: {sender_email or 'Not specified'}")
            print(f"💾 Output Format: {output_format.upper()}")
            print("=" * 70)
            
            # Step 1: Extract data with agentic-doc
            print("\n📊 Step 1: Extracting data with agentic-doc...")
            extraction_result = self.agentic_extractor.extract_from_pdf(pdf_path, sender_email)
            
            if not extraction_result.get("success"):
                raise Exception(f"Agentic-doc extraction failed: {extraction_result.get('error')}")
            
            print(f"✅ Agentic-doc extraction successful!")
            print(f"📊 Extracted {extraction_result.get('num_chunks', 0)} chunks")
            print(f"📝 Markdown content: {len(extraction_result.get('markdown', ''))} characters")
            
            # Step 2: Save extraction result
            print("\n💾 Step 2: Saving extraction result...")
            extraction_file = self.agentic_extractor.save_extraction_result(extraction_result, output_dir)
            if not extraction_file:
                raise Exception("Failed to save extraction result")
            
            print(f"✅ Extraction result saved to: {extraction_file}")
            
            # Step 3: Extract transaction table
            print("\n🔍 Step 3: Extracting transaction table...")
            table_df = self.transaction_extractor.extract_transaction_table(extraction_result)
            
            if table_df is None or table_df.empty:
                print("⚠️  No transaction table found, but extraction was successful")
                return {
                    "success": True,
                    "extraction_file": extraction_file,
                    "transaction_table": None,
                    "message": "Data extracted but no transaction table identified"
                }
            
            print(f"✅ Transaction table extracted successfully!")
            print(f"📊 Rows: {len(table_df)}, Columns: {len(table_df.columns)}")
            print(f"📋 Columns: {list(table_df.columns)}")
            
            # Step 4: Save transaction table
            print(f"\n💾 Step 4: Saving transaction table as {output_format.upper()}...")
            # Save transaction table to extracted_tables directory
            extracted_tables_dir = Path("data/extracted_tables")
            extracted_tables_dir.mkdir(parents=True, exist_ok=True)
            output_path = extracted_tables_dir / f"transactions_{pdf_file.stem}"
            transaction_file = self.transaction_extractor.save_transaction_table(
                table_df, output_path, output_format
            )
            
            if not transaction_file:
                raise Exception("Failed to save transaction table")
            
            print(f"✅ Transaction table saved to: {transaction_file}")
            
            # Step 5: Show summary
            print("\n📋 Step 5: Processing Summary")
            print("-" * 40)
            print(f"📄 Source PDF: {pdf_file.name}")
            print(f"🔐 Password used: {extraction_result['metadata']['password_used']}")
            print(f"📊 Data chunks: {extraction_result['num_chunks']}")
            print(f"📝 Text content: {len(extraction_result['markdown'])} characters")
            print(f"💰 Transactions: {len(table_df)}")
            print(f"💾 Files created:")
            print(f"   - Extraction: {Path(extraction_file).name}")
            print(f"   - Transactions: {Path(transaction_file).name}")
            
            return {
                "success": True,
                "extraction_file": extraction_file,
                "transaction_table": str(transaction_file),
                "transaction_count": len(table_df),
                "chunk_count": extraction_result['num_chunks'],
                "text_length": len(extraction_result['markdown'])
            }
            
        except Exception as e:
            print(f"❌ Error in complete processing: {e}")
            logger.error(f"Complete processing failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def process_axis_bank_statement(self, pdf_path: str, output_format: str = 'excel', 
                                  output_dir: str = "data/statements") -> Dict[str, Any]:
        """
        Process Axis Bank credit card statement specifically
        
        Args:
            pdf_path: Path to the PDF statement
            output_format: 'excel' or 'csv'
            output_dir: Output directory for results
        
        Returns:
            Dictionary containing processing results
        """
        sender_email = "cc.statements@axisbank.com"
        return self.process_statement(pdf_path, sender_email, output_format, output_dir)


def main():
    """Main function for command-line usage"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Complete statement processing workflow with agentic-doc"
    )
    parser.add_argument(
        "pdf_path", 
        help="Path to the PDF bank statement file"
    )
    parser.add_argument(
        "--sender-email", 
        help="Email of the statement sender (for password lookup)"
    )
    parser.add_argument(
        "--format", 
        choices=['excel', 'csv'], 
        default='excel',
        help="Output format for transaction table (default: excel)"
    )
    parser.add_argument(
        "--output-dir", 
        default="data/statements",
        help="Output directory for results (default: data/statements)"
    )
    parser.add_argument(
        "--axis-bank", 
        action="store_true",
        help="Process as Axis Bank credit card statement (uses configured password)"
    )
    
    args = parser.parse_args()
    
    try:
        # Check if VISION_AGENT_API_KEY is set
        if not os.getenv("VISION_AGENT_API_KEY"):
            print("❌ VISION_AGENT_API_KEY environment variable not set")
            print("Please set it before running this script:")
            print("export VISION_AGENT_API_KEY=your_api_key_here")
            return
        
        # Initialize processor
        processor = CompleteStatementProcessor()
        
        # Process the statement
        if args.axis_bank:
            print("🏦 Processing as Axis Bank credit card statement...")
            result = processor.process_axis_bank_statement(
                args.pdf_path, args.format, args.output_dir
            )
        else:
            result = processor.process_statement(
                args.pdf_path, args.sender_email, args.format, args.output_dir
            )
        
        # Show final result
        if result.get("success"):
            print(f"\n🎉 Complete processing successful!")
            print(f"📊 Processed {result.get('transaction_count', 0)} transactions")
            print(f"📝 Extracted {result.get('chunk_count', 0)} data chunks")
            print(f"💾 Results saved to: {args.output_dir}/")
            
            print(f"\n📋 Next steps:")
            print(f"1. Review extracted data in: {result.get('extraction_file', 'N/A')}")
            print(f"2. Analyze transactions in: {result.get('transaction_table', 'N/A')}")
            print(f"3. Import transactions to your expense tracker")
            print(f"4. Generate expense reports and analytics")
            
        else:
            print(f"\n💥 Processing failed!")
            print(f"Error: {result.get('error', 'Unknown error')}")
            sys.exit(1)
        
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
