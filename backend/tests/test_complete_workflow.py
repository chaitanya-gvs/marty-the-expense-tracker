#!/usr/bin/env python3
"""
Test Script: Complete End-to-End Statement Processing Workflow

This script tests the complete statement processing workflow:
1. Get statement senders from database
2. Download statements from emails
3. Unlock PDFs
4. Upload to cloud storage
5. Extract data using AI
6. Standardize transactions
7. Save final CSV locally (no database storage)
"""

import asyncio
import sys
import re
from pathlib import Path
from datetime import datetime

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor.workflow import StatementWorkflow
from src.utils.logger import get_logger

logger = get_logger(__name__)


def extract_search_pattern_from_csv_filename(csv_filename: str) -> str:
    """
    Extract search pattern from CSV filename for database lookup.
    
    Examples:
    - amazon_pay_icici_20250903_extracted.csv -> amazon_pay_icici
    - axis_atlas_20250902_extracted.csv -> axis_atlas
    - axis_bank_savings_20250906_extracted.csv -> axis_bank_savings
    """
    try:
        # Remove .csv extension and _extracted suffix
        base_name = csv_filename.replace('.csv', '').replace('_extracted', '')
        parts = base_name.split('_')
        
        # Remove only the last element (date) if it's 8 digits
        if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 8:
            search_parts = parts[:-1]
        else:
            search_parts = parts
        
        # Join the remaining parts to create search pattern
        search_pattern = '_'.join(search_parts)
        return search_pattern
                
    except Exception as e:
        logger.error(f"Error extracting search pattern from {csv_filename}: {e}")
        return csv_filename.replace('.csv', '').replace('_extracted', '')


async def process_and_combine_csvs():
    """Process all CSV files from temp directory, standardize and combine them"""
    try:
        import pandas as pd
        from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
        
        extracted_data_dir = Path("data/extracted_data")
        if not extracted_data_dir.exists():
            logger.warning("No extracted_data directory found")
            return None
        
        # Get all CSV files
        csv_files = list(extracted_data_dir.glob("*.csv"))
        if not csv_files:
            logger.warning("No CSV files found in extracted_data directory")
            return None
        
        logger.info(f"Found {len(csv_files)} CSV files to process")
        
        # Initialize transaction standardizer
        standardizer = TransactionStandardizer()
        
        # Process each CSV file
        all_standardized_transactions = []
        for csv_file in csv_files:
            try:
                logger.info(f"Processing CSV: {csv_file.name}")
                
                # Read CSV file
                df = pd.read_csv(csv_file)
                
                # Extract search pattern from CSV filename for database lookup
                search_pattern = extract_search_pattern_from_csv_filename(csv_file.name)
                
                # Get account nickname using database lookup
                account_nickname = await standardizer.get_account_name(search_pattern)
                
                # Convert DataFrame to list of dictionaries
                extracted_data = []
                for _, row in df.iterrows():
                    row_dict = {}
                    for col, value in row.items():
                        if pd.isna(value):
                            row_dict[col] = ""
                        else:
                            row_dict[col] = str(value).strip()
                    
                    # Add metadata
                    row_dict['source_file'] = csv_file.name  # Use full filename for traceability
                    row_dict['account'] = account_nickname  # Use database lookup result
                    
                    extracted_data.append(row_dict)
                
                # Use dynamic processing method lookup with search pattern
                standardized_df = await standardizer.process_with_dynamic_method(df, search_pattern, csv_file.name)
                
                # Convert DataFrame to list of dictionaries
                if not standardized_df.empty:
                    standardized_data = standardized_df.to_dict('records')
                    all_standardized_transactions.extend(standardized_data)
                
                logger.info(f"Standardized {len(standardized_data)} transactions from {csv_file.name}")
                
            except Exception as e:
                logger.error(f"Error processing CSV {csv_file.name}: {e}")
                continue
        
        if not all_standardized_transactions:
            logger.warning("No standardized transactions generated")
            return None
        
        # Save final combined CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_filename = f"standardized_transactions_{timestamp}.csv"
        csv_path = Path("data") / csv_filename
        
        # Ensure data directory exists
        csv_path.parent.mkdir(exist_ok=True)
        
        # Save to CSV
        df_final = pd.DataFrame(all_standardized_transactions)
        df_final.to_csv(csv_path, index=False)
        
        logger.info(f"💾 Saved {len(all_standardized_transactions)} standardized transactions to: {csv_path}")
        
        # Note: Keeping CSV files in extracted_data for validation
        logger.info("CSV files kept in extracted_data directory for validation")
        
        return str(csv_path)
        
    except Exception as e:
        logger.error(f"Error processing and combining CSVs: {e}")
        return None


async def test_complete_workflow():
    """Test the complete end-to-end workflow"""
    try:
        logger.info("🚀 Starting Complete End-to-End Workflow Test")
        logger.info("=" * 80)
        
        # Create workflow instance
        workflow = StatementWorkflow()
        
        # Get statement senders
        logger.info("📋 Step 1: Getting all statement senders")
        from src.services.database_manager.operations import AccountOperations
        statement_senders_raw = await AccountOperations.get_all_statement_senders()
        
        # Handle comma-separated sender emails
        statement_senders = []
        for sender in statement_senders_raw:
            if ',' in sender:
                individual_senders = [s.strip() for s in sender.split(',') if s.strip()]
                statement_senders.extend(individual_senders)
            else:
                statement_senders.append(sender)
        
        # Remove duplicates while preserving order
        statement_senders = list(dict.fromkeys(statement_senders))
        logger.info(f"Found {len(statement_senders)} statement senders")
        
        if not statement_senders:
            logger.warning("No statement senders found in accounts table")
            return
        
        # Calculate date range
        start_date, end_date = workflow._calculate_date_range()
        logger.info(f"Date range: {start_date} to {end_date}")
        
        # Test results
        results = {
            "total_senders": len(statement_senders),
            "total_statements_downloaded": 0,
            "total_statements_uploaded": 0,
            "total_statements_extracted": 0,
            "total_statements_processed": 0,
            "errors": [],
            "processed_statements": []
        }
        
        # Process all senders
        test_senders = statement_senders
        logger.info(f"Testing with all {len(test_senders)} senders: {test_senders}")
        
        for sender_email in test_senders:
            try:
                logger.info(f"🔄 Processing sender: {sender_email}")
                
                # Download statements from this sender
                statements = await workflow._download_statements_from_sender(sender_email, start_date, end_date)
                results["total_statements_downloaded"] += len(statements)
                
                # Process each statement
                for statement_data in statements:
                    try:
                        logger.info(f"📄 Processing: {statement_data['normalized_filename']}")
                        
                        # Unlock PDF
                        unlock_result = await workflow._unlock_pdf_async(
                            statement_data["temp_file_path"], 
                            statement_data["sender_email"]
                        )
                        
                        if not unlock_result.get("success"):
                            logger.warning(f"Could not unlock PDF: {statement_data['normalized_filename']}")
                            results["errors"].append(f"Failed to unlock: {statement_data['normalized_filename']}")
                            continue
                        
                        logger.info(f"✅ Successfully unlocked: {statement_data['normalized_filename']}")
                        
                        # Upload to cloud storage
                        cloud_path = await workflow._upload_unlocked_statement_to_cloud(
                            statement_data, 
                            {"extraction_schema": "test"}  # Dummy extraction result
                        )
                        
                        if cloud_path:
                            results["total_statements_uploaded"] += 1
                            logger.info(f"☁️ Successfully uploaded to: {cloud_path}")
                            
                            # Extract data from PDF
                            extraction_result = await workflow._process_statement_extraction(statement_data)
                            
                            if extraction_result and extraction_result.get("success"):
                                results["total_statements_extracted"] += 1
                                results["total_statements_processed"] += 1
                                logger.info(f"📊 Successfully extracted data from: {statement_data['normalized_filename']}")
                                
                                results["processed_statements"].append({
                                    "sender_email": statement_data["sender_email"],
                                    "filename": statement_data["normalized_filename"],
                                    "cloud_path": cloud_path,
                                    "unlock_success": True,
                                    "upload_success": True,
                                    "extraction_success": True,
                                    "csv_saved": extraction_result.get("csv_file") is not None
                                })
                            else:
                                logger.error(f"Failed to extract data from: {statement_data['normalized_filename']}")
                                results["errors"].append(f"Extraction failed: {statement_data['normalized_filename']}")
                        else:
                            results["errors"].append(f"Failed to upload: {statement_data['normalized_filename']}")
                    
                    except Exception as e:
                        error_msg = f"Error processing statement {statement_data.get('normalized_filename', 'unknown')}: {e}"
                        logger.error(error_msg)
                        results["errors"].append(error_msg)
            
            except Exception as e:
                error_msg = f"Error processing sender {sender_email}: {e}"
                logger.error(error_msg)
                results["errors"].append(error_msg)
        
        # Process all CSV files from temp directory, standardize and combine
        final_csv_path = await process_and_combine_csvs()
        if final_csv_path:
            results["final_csv_path"] = final_csv_path
            logger.info(f"💾 Final combined CSV saved to: {final_csv_path}")
        
        # Display results
        logger.info("=" * 80)
        logger.info("📊 COMPLETE WORKFLOW TEST RESULTS")
        logger.info("=" * 80)
        logger.info(f"Total Statement Senders: {results['total_senders']}")
        logger.info(f"Total Statements Downloaded: {results['total_statements_downloaded']}")
        logger.info(f"Total Statements Uploaded: {results['total_statements_uploaded']}")
        logger.info(f"Total Statements Extracted: {results['total_statements_extracted']}")
        logger.info(f"Total Statements Processed: {results['total_statements_processed']}")
        logger.info(f"Total Errors: {len(results['errors'])}")
        logger.info(f"Temp Directory Used: {workflow.temp_dir}")
        
        if results.get("final_csv_path"):
            logger.info(f"Final CSV Saved: {results['final_csv_path']}")
        
        if results['errors']:
            logger.warning("⚠️ ERRORS ENCOUNTERED:")
            for error in results['errors']:
                logger.warning(f"  - {error}")
        
        if results['processed_statements']:
            logger.info("✅ SUCCESSFULLY PROCESSED STATEMENTS:")
            for statement in results['processed_statements']:
                logger.info(f"  - {statement['filename']} from {statement['sender_email']}")
                logger.info(f"    Cloud path: {statement['cloud_path']}")
                logger.info(f"    CSV saved: {statement['csv_saved']}")
        
        logger.info("=" * 80)
        logger.info("🏁 Complete End-to-End Workflow Test Completed")
        
        return results
        
    except Exception as e:
        logger.error(f"❌ Critical error in complete workflow test: {e}")
        raise


if __name__ == "__main__":
    # Run the complete workflow test
    asyncio.run(test_complete_workflow())
