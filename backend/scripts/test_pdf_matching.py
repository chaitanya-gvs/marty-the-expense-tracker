#!/usr/bin/env python3
"""
Test script to show which PDF would be matched for each account.
This helps debug PDF matching logic.
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime, date
from collections import defaultdict
from typing import Optional

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.database_manager.operations import TransactionOperations
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.utils.logger import get_logger

logger = get_logger(__name__)


def extract_account_keywords(account_name: str) -> list:
    """Extract keywords from account name (same logic as the endpoint)"""
    generic_words = {'credit', 'card', 'savings', 'account'}
    account_keywords = [
        word.lower() for word in account_name.split() 
        if word.lower() not in generic_words
    ]
    
    # If no keywords extracted, use all words from account name
    if not account_keywords:
        account_keywords = [word.lower() for word in account_name.split()]
    
    return account_keywords


def find_matching_pdf(account_keywords: list, pdf_files: list) -> tuple:
    """Find matching PDF for account keywords (same logic as the endpoint)"""
    matching_pdf = None
    best_match_score = 0
    best_matched_keywords = []
    
    # Score each PDF based on how many keywords match
    for pdf_file in pdf_files:
        filename_lower = pdf_file['name'].lower()
        matching_keywords = [kw for kw in account_keywords if kw in filename_lower]
        match_score = len(matching_keywords)
        
        # Prefer matches with more keywords
        if match_score > best_match_score:
            best_match_score = match_score
            matching_pdf = pdf_file
            best_matched_keywords = matching_keywords
    
    # Only use the match if at least one keyword matched
    if matching_pdf and best_match_score > 0:
        return matching_pdf, best_matched_keywords
    else:
        # If no match, use the first PDF file (fallback)
        if pdf_files:
            return pdf_files[0], []
        return None, []


async def test_pdf_matching():
    """Test PDF matching for all accounts"""
    
    print("=" * 80)
    print("PDF Matching Test Script")
    print("=" * 80)
    print()
    
    # Get all transactions to find unique accounts
    print("📊 Fetching transactions to get unique accounts...")
    all_transactions = await TransactionOperations.get_all_transactions(limit=10000, offset=0)
    
    # Group transactions by account and get most recent transaction date for each
    account_info = defaultdict(lambda: {"count": 0, "latest_date": None})
    
    for transaction in all_transactions:
        account = transaction.get('account', 'Unknown')
        account_info[account]["count"] += 1
        
        # Track latest transaction date for this account
        tx_date = transaction.get('transaction_date')
        if tx_date:
            if isinstance(tx_date, str):
                try:
                    tx_date = datetime.fromisoformat(tx_date.replace('Z', '+00:00')).date()
                except:
                    tx_date = None
            elif isinstance(tx_date, datetime):
                tx_date = tx_date.date()
            
            if tx_date and (account_info[account]["latest_date"] is None or tx_date > account_info[account]["latest_date"]):
                account_info[account]["latest_date"] = tx_date
    
    print(f"✅ Found {len(account_info)} unique accounts")
    print()
    
    # Initialize GCS service
    print("☁️  Connecting to Google Cloud Storage...")
    gcs_service = GoogleCloudStorageService()
    print("✅ Connected to GCS")
    print()
    
    # Get PDFs from recent months (last 3 months)
    print("📁 Fetching PDF files from recent months...")
    current_date = datetime.now()
    months_to_check = []
    for i in range(3):
        month_date = current_date.replace(day=1)
        if i > 0:
            # Go back i months
            if month_date.month <= i:
                month_date = month_date.replace(year=month_date.year - 1, month=12 - (i - month_date.month))
            else:
                month_date = month_date.replace(month=month_date.month - i)
        month_year = month_date.strftime("%Y-%m")
        months_to_check.append(month_year)
    
    all_pdf_files = {}
    for month_year in months_to_check:
        prefix = f"{month_year}/unlocked_statements/"
        pdf_files = gcs_service.list_files(prefix=prefix, max_results=100)
        pdf_files = [f for f in pdf_files if f['name'].lower().endswith('.pdf')]
        if pdf_files:
            all_pdf_files[month_year] = pdf_files
            print(f"  📄 {month_year}: Found {len(pdf_files)} PDF files")
    
    print()
    
    # Test matching for each account
    print("=" * 80)
    print("PDF Matching Results by Account")
    print("=" * 80)
    print()
    
    for account_name, info in sorted(account_info.items()):
        print(f"🏦 Account: {account_name}")
        print(f"   Transactions: {info['count']}")
        if info['latest_date']:
            print(f"   Latest Transaction: {info['latest_date']}")
            month_year = info['latest_date'].strftime("%Y-%m")
        else:
            print(f"   Latest Transaction: Unknown")
            month_year = months_to_check[0]  # Use most recent month
        
        # Extract keywords
        account_keywords = extract_account_keywords(account_name)
        print(f"   Extracted Keywords: {account_keywords}")
        
        # Get PDFs for this month
        pdf_files = all_pdf_files.get(month_year, [])
        if not pdf_files:
            # Try other months
            for m in months_to_check:
                if m in all_pdf_files and all_pdf_files[m]:
                    pdf_files = all_pdf_files[m]
                    month_year = m
                    break
        
        if pdf_files:
            print(f"   📁 Checking PDFs in: {month_year}/unlocked_statements/")
            print(f"   Available PDFs ({len(pdf_files)}):")
            for pdf_file in pdf_files[:10]:  # Show first 10
                filename = Path(pdf_file['name']).name
                print(f"      - {filename}")
            if len(pdf_files) > 10:
                print(f"      ... and {len(pdf_files) - 10} more")
            
            # Find matching PDF
            matching_pdf, matched_keywords = find_matching_pdf(account_keywords, pdf_files)
            
            if matching_pdf:
                filename = Path(matching_pdf['name']).name
                if matched_keywords:
                    match_ratio = f"{len(matched_keywords)}/{len(account_keywords)}"
                    print(f"   ✅ MATCHED: {filename}")
                    print(f"      Matched {match_ratio} keywords: {matched_keywords}")
                else:
                    print(f"   ⚠️  FALLBACK (no match): {filename}")
                    print(f"      Using first available PDF (no keywords matched)")
            else:
                print(f"   ❌ NO PDF FOUND")
        else:
            print(f"   ❌ No PDF files found for month {month_year}")
        
        print()
    
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Total accounts tested: {len(account_info)}")
    print(f"Months checked: {', '.join(months_to_check)}")
    print()


if __name__ == "__main__":
    asyncio.run(test_pdf_matching())

