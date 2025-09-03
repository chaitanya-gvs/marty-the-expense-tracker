#!/usr/bin/env python3
"""
Process Axis Bank Credit Card Statement with Agentic-Doc

This script specifically processes Axis Bank credit card statements using the agentic-doc library.
It follows the existing patterns from the expense tracker system and integrates with the
password management system to unlock protected PDFs.

Usage:
    poetry run python scripts/process_axis_bank_statement.py <pdf_path>
"""

import sys
import os
from pathlib import Path
from typing import Dict, Any

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import get_agentic_doc_processor
from src.utils.password_manager import get_password_manager
from src.utils.logger import get_logger

logger = get_logger(__name__)


def process_axis_bank_statement(pdf_path: str, save_result: bool = True) -> Dict[str, Any]:
    """
    Process an Axis Bank credit card statement using agentic-doc
    
    Args:
        pdf_path: Path to the PDF statement file
        save_result: Whether to save the extraction result
    
    Returns:
        Dictionary containing the extraction result and metadata
    """
    try:
        # Verify the PDF exists
        pdf_file = Path(pdf_path)
        if not pdf_file.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        
        print(f"🏦 Processing Axis Bank Credit Card Statement")
        print(f"📄 File: {pdf_file.name}")
        print("=" * 60)
        
        # Check password configuration
        password_manager = get_password_manager()
        sender_email = "cc.statements@axisbank.com"
        password = password_manager.get_password_for_sender(sender_email)
        
        if password:
            print(f"🔐 Found password for {sender_email}")
            # Mask password for display (following existing pattern)
            masked_password = "*" * min(len(password), 8) + "..." if len(password) > 8 else "*" * len(password)
            print(f"Password: {masked_password}")
        else:
            print(f"❌ No password found for {sender_email}")
            print("Please check your bank_passwords.json configuration")
            return None
        
        # Initialize the agentic-doc extractor
        print("\n🚀 Initializing agentic-doc extractor...")
        extractor = get_agentic_doc_processor()
        
        # Extract data using the specialized Axis Bank method
        print("📊 Starting extraction with agentic-doc...")
        result = extractor.extract_axis_bank_statement(pdf_path)
        
        if result.get("success"):
            print("\n✅ Extraction completed successfully!")
            print(f"📊 Number of chunks extracted: {result.get('num_chunks', 0)}")
            print(f"📝 Markdown available: {bool(result.get('markdown'))}")
            print(f"🔧 Structured chunks available: {bool(result.get('chunks'))}")
            
            # Save the result if requested
            if save_result:
                output_file = extractor.save_extraction_result(result)
                if output_file:
                    print(f"\n💾 Result saved to: {output_file}")
            
            # Display sample of extracted content
            if result.get("markdown"):
                print("\n📄 Sample of extracted content:")
                print("-" * 40)
                markdown = result["markdown"]
                # Show first 400 characters
                sample = markdown[:400] + "..." if len(markdown) > 400 else markdown
                print(sample)
            
            # Display chunk information
            if result.get("chunks"):
                print(f"\n🔍 First few chunks:")
                print("-" * 40)
                for i, chunk in enumerate(result["chunks"][:3]):  # Show first 3 chunks
                    print(f"Chunk {i+1}: {str(chunk)[:120]}...")
            
            # Show next steps (following existing pattern)
            print(f"\n📋 Next steps:")
            print(f"1. Parse financial transactions from extracted text")
            print(f"2. Categorize expenses and income")
            print(f"3. Store data in database")
            print(f"4. Generate expense reports")
            
            return result
            
        else:
            print("❌ Extraction failed!")
            print(f"Error: {result.get('error', 'Unknown error')}")
            return None
            
    except Exception as e:
        print(f"❌ Error processing statement: {e}")
        logger.error(f"Error in process_axis_bank_statement: {e}")
        return None


def main():
    """Main function for command-line usage"""
    if len(sys.argv) < 2:
        print("Usage: poetry run python scripts/process_axis_bank_statement.py <pdf_path>")
        print("\nExample:")
        print("  poetry run python scripts/process_axis_bank_statement.py data/statements/19909a8fef4a20b5_20250903_021052_CreditCardStatement.pdf")
        print("\nThis script:")
        print("  - Automatically detects password protection")
        print("  - Uses configured Axis Bank credit card password")
        print("  - Extracts structured data using agentic-doc")
        print("  - Saves results to JSON format")
        print("  - Follows existing expense tracker patterns")
        return
    
    pdf_path = sys.argv[1]
    
    # Check if VISION_AGENT_API_KEY is set
    if not os.getenv("VISION_AGENT_API_KEY"):
        print("❌ VISION_AGENT_API_KEY environment variable not set")
        print("Please set it before running this script:")
        print("export VISION_AGENT_API_KEY=your_api_key_here")
        return
    
    # Process the statement
    result = process_axis_bank_statement(pdf_path, save_result=True)
    
    if result:
        print(f"\n🎉 Axis Bank statement processing completed successfully!")
        print(f"📊 Extracted {result.get('num_chunks', 0)} data chunks")
        print(f"📝 Markdown content: {len(result.get('markdown', ''))} characters")
    else:
        print(f"\n💥 Statement processing failed. Check the logs for details.")
        sys.exit(1)


if __name__ == "__main__":
    main()
