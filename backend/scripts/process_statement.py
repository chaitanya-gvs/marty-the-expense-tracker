#!/usr/bin/env python3
"""
Simple Statement Processing Script

This script handles the core statement processing workflow:
1. Unlock PDF and save unlocked version
2. Parse using agentic_doc and extract data
3. Convert table to Excel and save

Usage:
    poetry run python scripts/process_statement.py <pdf_path>
    poetry run python scripts/process_statement.py --help
"""

import sys
import os
import argparse
from pathlib import Path
from typing import Dict, Any, Optional

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import (
    get_attachment_handler,
    get_agentic_doc_processor,
    get_transaction_extractor
)
from src.utils.logger import get_logger

logger = get_logger(__name__)


class StatementProcessor:
    """Simple statement processor for PDF statements"""
    
    def __init__(self):
        self.attachment_handler = get_attachment_handler()
        self.agentic_processor = get_agentic_doc_processor()
        self.transaction_extractor = get_transaction_extractor()
    
    def process_statement(self, pdf_path: str) -> Dict[str, Any]:
        """
        Process a single PDF statement
        
        Args:
            pdf_path: Path to the PDF file to process
        
        Returns:
            Dictionary containing processing results
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {"success": False, "error": f"PDF file not found: {pdf_path}"}
            
            logger.info(f"🚀 Processing statement: {pdf_path.name}")
            
            # Step 1: Unlock PDF and save unlocked version
            logger.info("🔓 Step 1: Unlocking PDF...")
            unlock_result = self.attachment_handler.unlock_pdf(str(pdf_path))
            
            if not unlock_result.get("success"):
                return {"success": False, "error": f"Failed to unlock PDF: {unlock_result.get('error')}"}
            
            unlocked_pdf_path = unlock_result["unlocked_path"]
            logger.info(f"✅ PDF unlocked: {Path(unlocked_pdf_path).name}")
            
            # Step 2: Parse using agentic_doc and extract data
            logger.info("🔍 Step 2: Parsing with agentic_doc...")
            extraction_result = self.agentic_processor.extract_from_pdf(unlocked_pdf_path)
            
            if not extraction_result.get("success"):
                return {"success": False, "error": f"Agentic-doc extraction failed: {extraction_result.get('error')}"}
            
            logger.info("✅ Data extraction completed")
            
            # Step 3: Convert table to Excel and save
            logger.info("📊 Step 3: Converting table to Excel...")
            table_df = self.transaction_extractor.extract_transaction_table(extraction_result)
            
            if table_df is None or table_df.empty:
                return {"success": False, "error": "No transaction table found in extracted data"}
            
            # Generate output filename
            output_path = f"data/extracted_tables/{pdf_path.stem}_transactions"
            excel_file = self.transaction_extractor.save_transaction_table(table_df, output_path, 'excel')
            
            if not excel_file:
                return {"success": False, "error": "Failed to save Excel file"}
            
            logger.info(f"✅ Excel file saved: {excel_file}")
            
            # Cleanup old files
            logger.info("🧹 Cleaning up old files...")
            self.attachment_handler.cleanup_old_files()
            
            return {
                "success": True,
                "pdf_name": pdf_path.name,
                "unlocked_pdf": Path(unlocked_pdf_path).name,
                "rows_extracted": len(table_df),
                "excel_file": excel_file,
                "message": "Statement processed successfully"
            }
            
        except Exception as e:
            logger.error(f"Error processing statement: {e}")
            return {"success": False, "error": str(e)}
    
    def process_directory(self, directory_path: str) -> Dict[str, Any]:
        """
        Process all PDF files in a directory
        
        Args:
            directory_path: Path to directory containing PDF files
        
        Returns:
            Dictionary containing processing results
        """
        try:
            directory_path = Path(directory_path)
            if not directory_path.exists() or not directory_path.is_dir():
                return {"success": False, "error": f"Directory not found: {directory_path}"}
            
            pdf_files = list(directory_path.glob("*.pdf"))
            if not pdf_files:
                return {"success": False, "error": f"No PDF files found in directory: {directory_path}"}
            
            logger.info(f"📁 Processing {len(pdf_files)} PDF files in {directory_path}")
            
            results = []
            successful = 0
            failed = 0
            
            for pdf_file in pdf_files:
                logger.info(f"\n📄 Processing: {pdf_file.name}")
                result = self.process_statement(str(pdf_file))
                
                if result.get("success"):
                    successful += 1
                    results.append(result)
                else:
                    failed += 1
                    logger.error(f"Failed to process {pdf_file.name}: {result.get('error')}")
            
            return {
                "success": True,
                "total_files": len(pdf_files),
                "successful": successful,
                "failed": failed,
                "results": results
            }
            
        except Exception as e:
            logger.error(f"Error processing directory: {e}")
            return {"success": False, "error": str(e)}


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Process PDF statements")
    parser.add_argument("path", nargs='?', help="Path to PDF file or directory to process")
    parser.add_argument("--cleanup", action="store_true", help="Clean up old files only")
    
    args = parser.parse_args()
    
    processor = StatementProcessor()
    
    if args.cleanup:
        # Just cleanup old files
        processor.attachment_handler.cleanup_old_files()
        logger.info("🧹 Cleanup completed")
        return
    
    if not args.path:
        logger.error("Path is required unless using --cleanup")
        sys.exit(1)
    
    path = Path(args.path)
    
    if path.is_file() and path.suffix.lower() == '.pdf':
        # Process single PDF file
        result = processor.process_statement(str(path))
    elif path.is_dir():
        # Process all PDFs in directory
        result = processor.process_directory(str(path))
    else:
        logger.error(f"Invalid path: {path}. Must be a PDF file or directory.")
        sys.exit(1)
    
    if not result.get("success"):
        logger.error(f"Processing failed: {result.get('error')}")
        sys.exit(1)
    
    # Print summary
    if "total_files" in result:
        # Directory processing
        logger.info(f"\n🎉 Directory processing completed!")
        logger.info(f"📁 Total files: {result['total_files']}")
        logger.info(f"✅ Successful: {result['successful']}")
        logger.info(f"❌ Failed: {result['failed']}")
    else:
        # Single file processing
        logger.info(f"\n🎉 File processing completed!")
        logger.info(f"📄 File: {result['pdf_name']}")
        logger.info(f"📊 Rows extracted: {result['rows_extracted']}")
        logger.info(f"💾 Excel saved: {result['excel_file']}")


if __name__ == "__main__":
    main()
