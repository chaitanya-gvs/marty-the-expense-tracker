"""
Transaction Standardizer Service

This service standardizes transaction data from multiple CSV files into a unified format.
It handles different bank statement formats and normalizes them into a consistent schema.
"""

import pandas as pd
import numpy as np
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple

from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


class TransactionStandardizer:
    """Standardize transaction data from multiple CSV files into a unified format"""
    
    def __init__(self, data_dir: Optional[str] = None):
        """
        Initialize the transaction standardizer
        
        Args:
            data_dir: Path to data directory. If None, uses default backend/data
        """
        if data_dir is None:
            # Default to backend/data directory
            backend_path = Path(__file__).parent.parent.parent.parent
            self.data_dir = backend_path / "data"
        else:
            self.data_dir = Path(data_dir)
            
        self.extracted_data_dir = self.data_dir / "extracted_data"
        self.standardized_data = []
        
    def clean_amount(self, amount_str: str, is_credit_card: bool = False) -> Tuple[float, str]:
        """
        Clean amount string and determine transaction type.
        Returns (amount, transaction_type)
        
        Args:
            amount_str: The amount string to parse
            is_credit_card: If True, default to debit for purchases (credit card logic)
        """
        if pd.isna(amount_str) or amount_str == "":
            return 0.0, "unknown"
            
        # Convert to string and clean
        amount_str = str(amount_str).strip()
        
        # Remove currency symbols and extra spaces, but keep decimal point
        amount_str = re.sub(r'[₹Rs\s]', '', amount_str)
        # Remove commas but keep decimal point
        amount_str = amount_str.replace(',', '')
        
        # Handle CR/Credit indicators
        is_credit = False
        if 'CR' in amount_str.upper() or 'C' in amount_str.upper():
            is_credit = True
            amount_str = re.sub(r'[CR]', '', amount_str, flags=re.IGNORECASE)
        
        # Handle Dr/Debit indicators
        is_debit = False
        if 'DR' in amount_str.upper() or 'D' in amount_str.upper():
            is_debit = True
            amount_str = re.sub(r'[DR]', '', amount_str, flags=re.IGNORECASE)
        
        # Handle + and - signs
        is_positive = False
        if amount_str.startswith('+'):
            is_positive = True
            amount_str = amount_str[1:]
        elif amount_str.startswith('-'):
            is_positive = False
            amount_str = amount_str[1:]
        
        try:
            amount = float(amount_str)
            
            # Determine transaction type
            if is_credit or is_positive:
                return amount, "credit"
            elif is_debit or amount < 0:
                return abs(amount), "debit"
            else:
                # Default logic based on account type
                if is_credit_card:
                    # For credit cards: default to debit (purchases)
                    return amount, "debit"
                else:
                    # For savings accounts: default to credit (deposits)
                    return amount, "credit"
                
        except ValueError:
            logger.warning(f"Could not parse amount: {amount_str}")
            return 0.0, "unknown"
    
    def parse_date(self, date_str: str) -> Optional[str]:
        """Parse various date formats and return YYYY-MM-DD"""
        if pd.isna(date_str) or date_str == "":
            return None
            
        date_str = str(date_str).strip()
        
        # Handle datetime format with pipe separator (HDFC format: "06/07/2025| 15:40")
        if "|" in date_str:
            date_part = date_str.split("|")[0].strip()
            date_str = date_part
        
        # Handle different date formats
        date_formats = [
            "%d/%m/%Y",      # 03/08/2025
            "%d %b %y",      # 01 Aug 25
            "%d-%m-%Y",      # 03-08-2025
            "%Y-%m-%d",      # 2025-08-03
        ]
        
        for fmt in date_formats:
            try:
                parsed_date = datetime.strptime(date_str, fmt)
                return parsed_date.strftime("%Y-%m-%d")
            except ValueError:
                continue
        
        logger.warning(f"Could not parse date: {date_str}")
        return None
    
    def extract_time(self, datetime_str: str) -> Optional[str]:
        """Extract time from datetime string"""
        if pd.isna(datetime_str) or datetime_str == "":
            return None
            
        datetime_str = str(datetime_str).strip()
        
        # Look for time pattern HH:MM
        time_match = re.search(r'(\d{1,2}):(\d{2})', datetime_str)
        if time_match:
            return f"{time_match.group(1).zfill(2)}:{time_match.group(2)}:00"
        
        return None
    
    async def get_account_name(self, search_pattern: str) -> str:
        """Get account name using database lookup with search pattern"""
        try:
            # Try to get nickname from database using search pattern
            nickname = await AccountOperations.get_account_nickname_by_pattern(search_pattern)
            if nickname:
                return nickname
        except Exception as e:
            logger.warning(f"Failed to get account name from database for pattern {search_pattern}: {e}")
        
        # Fallback: return the search pattern as-is
        return search_pattern
    
    async def get_processing_method(self, search_pattern: str) -> str:
        """Get the appropriate processing method name based on search pattern"""
        try:
            # Get account nickname from database using search pattern
            nickname = await AccountOperations.get_account_nickname_by_pattern(search_pattern)
            if nickname:
                # Convert nickname to method name
                # e.g., "Amazon Pay ICICI Credit Card" -> "process_amazon_pay_icici"
                method_name = nickname.lower()
                method_name = method_name.replace(" ", "_")
                method_name = method_name.replace("credit_card", "")
                method_name = method_name.replace("account", "")
                method_name = method_name.strip("_")
                method_name = f"process_{method_name}"
                
                # Check if method exists
                if hasattr(self, method_name):
                    return method_name
        except Exception as e:
            logger.warning(f"Failed to get processing method from database for pattern {search_pattern}: {e}")
        
        # If no method found, return default fallback
        return "standardize_transactions"
    
    async def process_with_dynamic_method(self, df: pd.DataFrame, search_pattern: str, filename: str) -> pd.DataFrame:
        """Process data using dynamic method lookup"""
        method_name = await self.get_processing_method(search_pattern)
        
        # Get account name once for all methods
        account_name = await self.get_account_name(search_pattern)
        
        if method_name == "standardize_transactions":
            # Use the generic method
            standardized_data = self.standardize_transactions(df.to_dict('records'), account_name)
            return pd.DataFrame(standardized_data)
        else:
            # Use the specific method with account name
            method = getattr(self, method_name)
            return method(df, filename, account_name)
    
    def process_amazon_pay_icici(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Amazon Pay ICICI Credit Card data"""
        logger.info(f"Processing Amazon Pay ICICI data: {filename}")
        
        # Skip header rows and card number rows
        df_clean = df.copy()
        
        # Find the actual header row (contains "Date")
        header_row = None
        for idx, row in df_clean.iterrows():
            if any("Date" in str(cell) for cell in row):
                header_row = idx
                break
        
        if header_row is not None:
            df_clean = df_clean.iloc[header_row+1:].reset_index(drop=True)
            # Use the actual column names from the CSV
            df_clean.columns = ["Date", "SerNo", "Transaction Details", "Reward Points", "Intl Amount", "Amount"]
        else:
            # If no header row found, use the original column names
            pass
        
        standardized_data = []
        for _, row in df_clean.iterrows():
            if pd.isna(row.get("Date")) or str(row.get("Date")).strip() == "":
                continue
            
            # Get the amount string and clean it - use the actual column name
            amount_str = str(row.get("Amount (in₹)", "")).strip()
            if not amount_str or amount_str.lower() == 'nan':
                continue
                
            # Parse amount and determine transaction type
            amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
            
            # Skip if amount is 0 or invalid
            if amount <= 0:
                continue
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("Date")),
                'transaction_time': None,
                'description': str(row.get("Transaction Details", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Amazon Pay ICICI Credit Card",
                'category': None,
                'reference_number': str(row.get("SerNo", "")).strip(),
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    def process_axis_atlas(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Axis Atlas Credit Card data"""
        logger.info(f"Processing Axis Atlas data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            if pd.isna(row.get("DATE")) or str(row.get("DATE")).strip() == "":
                continue
                
            amount, transaction_type = self.clean_amount(row.get("AMOUNT (Rs.)", ""), is_credit_card=True)
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("DATE")),
                'transaction_time': None,
                'description': str(row.get("TRANSACTION DETAILS", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Axis Atlas Credit Card",
                'category': str(row.get("MERCHANT CATEGORY", "")).strip() if pd.notna(row.get("MERCHANT CATEGORY")) else None,
                'reference_number': None,
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    def process_swiggy_hdfc(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Swiggy HDFC Credit Card data"""
        logger.info(f"Processing Swiggy HDFC data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            if pd.isna(row.get("DATE & TIME")) or str(row.get("DATE & TIME")).strip() == "":
                continue
                
            amount, transaction_type = self.clean_amount(row.get("AMOUNT", ""), is_credit_card=True)
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("DATE & TIME")),
                'transaction_time': self.extract_time(row.get("DATE & TIME")),
                'description': str(row.get("TRANSACTION DESCRIPTION", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Swiggy HDFC Credit Card",
                'category': None,
                'reference_number': None,
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    def process_cashback_sbi(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Cashback SBI Credit Card data"""
        logger.info(f"Processing Cashback SBI data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            if pd.isna(row.get("Date")) or str(row.get("Date")).strip() == "":
                continue
                
            amount, transaction_type = self.clean_amount(row.get("Amount (₹)", ""), is_credit_card=True)
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("Date")),
                'transaction_time': None,
                'description': str(row.get("Transaction Details for Statement Period: 02 Aug 25 to 01 Sep 25", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Cashback SBI Credit Card",
                'category': None,
                'reference_number': None,
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    def process_yes_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Yes Bank Savings Account data"""
        logger.info(f"Processing Yes Bank Savings data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            if pd.isna(row.get("Transaction Date")) or str(row.get("Transaction Date")).strip() == "":
                continue
                
            # For savings account, we need to determine amount from withdrawals/deposits
            withdrawal = row.get("Withdrawals", 0)
            deposit = row.get("Deposits", 0)
            
            if pd.notna(withdrawal) and float(withdrawal) > 0:
                amount = float(withdrawal)
                transaction_type = "debit"
            elif pd.notna(deposit) and float(deposit) > 0:
                amount = float(deposit)
                transaction_type = "credit"
            else:
                continue
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("Transaction Date")),
                'transaction_time': None,
                'description': str(row.get("Description", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Unknown Account",
                'category': None,
                'reference_number': str(row.get("Cheque No/Reference No.", "")).strip() if pd.notna(row.get("Cheque No/Reference No.")) else None,
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    
    def process_axis_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Axis Bank Savings Account data"""
        logger.info(f"Processing Axis Bank Savings data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            if pd.isna(row.get("Date")) or str(row.get("Date")).strip() == "":
                continue
                
            # For savings account, we need to determine amount from withdrawals/deposits
            withdrawal = row.get("Withdrawal", 0)
            deposit = row.get("Deposits", 0)
            
            if pd.notna(withdrawal) and str(withdrawal).strip() and str(withdrawal).lower() != 'nan':
                try:
                    amount = float(str(withdrawal).replace(',', ''))
                    transaction_type = "debit"
                except (ValueError, TypeError):
                    continue
            elif pd.notna(deposit) and str(deposit).strip() and str(deposit).lower() != 'nan':
                try:
                    amount = float(str(deposit).replace(',', ''))
                    transaction_type = "credit"
                except (ValueError, TypeError):
                    continue
            else:
                continue
            
            standardized_data.append({
                'transaction_date': self.parse_date(row.get("Date")),
                'transaction_time': None,
                'description': str(row.get("Transaction Details", "")).strip(),
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "Unknown Account",
                'category': None,
                'reference_number': str(row.get("Chq No.", "")).strip() if pd.notna(row.get("Chq No.")) else None,
                'source_file': filename,
                'raw_data': row.to_dict()
            })
        
        return pd.DataFrame(standardized_data)
    
    def process_csv_file(self, csv_path: Path) -> pd.DataFrame:
        """Process a single CSV file based on its content"""
        filename = csv_path.name
        
        try:
            # Read CSV file
            df = pd.read_csv(csv_path)
            logger.info(f"Read {len(df)} rows from {filename}")
            
            # Determine processing method based on filename and content
            if "amazon" in filename.lower() and "icici" in filename.lower():
                return self.process_amazon_pay_icici(df, filename)
            elif "axis" in filename.lower():
                return self.process_axis_bank(df, filename)
            elif "hdfc" in filename.lower():
                return self.process_hdfc_bank(df, filename)
            elif "sbi" in filename.lower():
                return self.process_sbi_card(df, filename)
            elif "yes" in filename.lower() and "savings" in filename.lower():
                return self.process_yes_bank_savings(df, filename)
            else:
                logger.warning(f"Unknown file type: {filename}")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
            return pd.DataFrame()
    
    def standardize_all_transactions(self, save_to_file: bool = True) -> pd.DataFrame:
        """
        Process all CSV files and return standardized DataFrame
        
        Args:
            save_to_file: Whether to save the standardized data to CSV file
            
        Returns:
            Standardized DataFrame with all transactions
        """
        logger.info("Starting transaction standardization process")
        
        # Find all CSV files
        csv_files = list(self.extracted_data_dir.glob("*.csv"))
        logger.info(f"Found {len(csv_files)} CSV files to process")
        
        all_transactions = []
        
        for csv_file in csv_files:
            logger.info(f"Processing {csv_file.name}")
            standardized_df = self.process_csv_file(csv_file)
            
            if not standardized_df.empty:
                all_transactions.append(standardized_df)
                logger.info(f"Processed {len(standardized_df)} transactions from {csv_file.name}")
            else:
                logger.warning(f"No transactions processed from {csv_file.name}")
        
        if all_transactions:
            # Concatenate all DataFrames
            combined_df = pd.concat(all_transactions, ignore_index=True)
            
            # Remove rows with invalid dates
            combined_df = combined_df[combined_df['transaction_date'].notna()]
            
            # Sort by transaction date
            combined_df = combined_df.sort_values('transaction_date').reset_index(drop=True)
            
            logger.info(f"Total standardized transactions: {len(combined_df)}")
            
            # Save to file if requested
            if save_to_file:
                output_path = self.data_dir / "standardized_transactions.csv"
                combined_df.to_csv(output_path, index=False)
                logger.info(f"Saved standardized transactions to {output_path}")
            
            return combined_df
        else:
            logger.error("No transactions were processed")
            return pd.DataFrame()
    
    def standardize_transactions(self, extracted_data: List[Dict[str, Any]], account_nickname: str = None) -> List[Dict[str, Any]]:
        """
        Standardize transaction data from extracted data (used by workflow)
        
        Args:
            extracted_data: List of dictionaries containing extracted transaction data
            account_nickname: The account nickname to use for account field
            
        Returns:
            List of standardized transaction dictionaries
        """
        if not extracted_data:
            logger.warning("No extracted data provided for standardization")
            return []
        
        logger.info(f"Standardizing {len(extracted_data)} extracted transactions")
        
        # Special handling for Amazon Pay ICICI - skip first row if it contains card number
        if account_nickname and "amazon pay icici" in account_nickname.lower():
            if len(extracted_data) > 0:
                first_transaction = extracted_data[0]
                # Check if first row contains card number pattern (all fields have same card number)
                first_values = list(first_transaction.values())
                if len(set(first_values)) == 1 and len(first_values[0]) > 10 and 'X' in first_values[0]:
                    logger.info("Skipping first row for Amazon Pay ICICI (contains card number)")
                    extracted_data = extracted_data[1:]
        
        standardized_transactions = []
        
        for transaction in extracted_data:
            try:
                # Find the correct column names for this transaction
                date_col = self._find_date_column(transaction)
                amount_col = self._find_amount_column(transaction)
                description_col = self._find_description_column(transaction)
                category_col = self._find_category_column(transaction)
                
                # Check if this is a savings account with separate withdrawal/deposit columns
                withdrawal_col = self._find_withdrawal_column(transaction)
                deposit_col = self._find_deposit_column(transaction)
                
                # Be more flexible - require date and either amount column OR withdrawal/deposit columns
                if not date_col:
                    logger.warning(f"Skipping transaction - missing date column: {list(transaction.keys())}")
                    continue
                
                if not amount_col and not (withdrawal_col and deposit_col):
                    logger.warning(f"Skipping transaction - missing amount columns (amount: {amount_col}, withdrawal: {withdrawal_col}, deposit: {deposit_col}): {list(transaction.keys())}")
                    continue
                
                # Clean amount and determine transaction type
                if amount_col:
                    # Standard credit card format with single amount column
                    amount_str = str(transaction.get(amount_col, ''))
                    amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
                else:
                    # Savings account format with separate withdrawal/deposit columns
                    withdrawal_str = str(transaction.get(withdrawal_col, ''))
                    deposit_str = str(transaction.get(deposit_col, ''))
                    
                    # Parse withdrawal amount
                    withdrawal_amount = 0.0
                    if withdrawal_str and withdrawal_str.strip() and withdrawal_str.lower() != 'nan':
                        try:
                            withdrawal_amount = float(withdrawal_str.replace(',', ''))
                        except (ValueError, TypeError):
                            withdrawal_amount = 0.0
                    
                    # Parse deposit amount
                    deposit_amount = 0.0
                    if deposit_str and deposit_str.strip() and deposit_str.lower() != 'nan':
                        try:
                            deposit_amount = float(deposit_str.replace(',', ''))
                        except (ValueError, TypeError):
                            deposit_amount = 0.0
                    
                    # Determine which amount to use and transaction type
                    if withdrawal_amount > 0:
                        amount = withdrawal_amount
                        transaction_type = "debit"
                    elif deposit_amount > 0:
                        amount = deposit_amount
                        transaction_type = "credit"
                    else:
                        # Skip if both are zero or invalid
                        continue
                
                # Parse date
                date_str = str(transaction.get(date_col, ''))
                parsed_date = self.parse_date(date_str)
                
                # Skip if date is invalid
                if not parsed_date:
                    logger.warning(f"Skipping transaction with invalid date: {date_str}")
                    continue
                
                # Extract time if available
                time_str = str(transaction.get('time', ''))
                parsed_time = self.extract_time(time_str) if time_str else None
                
                # Use account nickname if provided, otherwise try to extract from transaction
                account_name = account_nickname if account_nickname else str(transaction.get('account', 'Unknown'))
                
                standardized_transaction = {
                    'transaction_date': parsed_date,
                    'transaction_time': parsed_time,
                    'description': str(transaction.get(description_col, '')).strip() if description_col else '',
                    'amount': amount,
                    'transaction_type': transaction_type,
                    'account': account_name,
                    'category': str(transaction.get(category_col, '')).strip() if category_col and transaction.get(category_col) else '',
                    'reference_number': str(transaction.get('reference_number', '')).strip() if transaction.get('reference_number') else '',
                    'source_file': str(transaction.get('source_file', '')),
                    'raw_data': transaction
                }
                
                # Only add if we have valid date and amount
                if parsed_date and amount > 0:
                    standardized_transactions.append(standardized_transaction)
                else:
                    logger.warning(f"Skipping transaction with invalid date or amount: {transaction}")
                    
            except Exception as e:
                logger.error(f"Error standardizing transaction: {e}")
                continue
        
        logger.info(f"Successfully standardized {len(standardized_transactions)} transactions")
        return standardized_transactions
    
    def _find_date_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the date column in the transaction data"""
        date_keywords = ['date', 'DATE', 'Date']
        for key in transaction.keys():
            if any(keyword in key for keyword in date_keywords):
                return key
        return None
    
    def _find_amount_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the amount column in the transaction data"""
        amount_keywords = ['amount', 'AMOUNT', 'Amount', '₹', 'Rs.']
        
        # First, try to find columns with actual data (non-empty values)
        for key in transaction.keys():
            if any(keyword in key for keyword in amount_keywords):
                value = str(transaction.get(key, '')).strip()
                if value and value != '' and value.lower() != 'nan':
                    return key
        
        # If no column with data found, return the first matching column
        for key in transaction.keys():
            if any(keyword in key for keyword in amount_keywords):
                return key
        return None
    
    def _find_withdrawal_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the withdrawal column in the transaction data"""
        withdrawal_keywords = ['withdrawal', 'Withdrawal', 'WITHDRAWAL', 'withdraw', 'Withdraw']
        for key in transaction.keys():
            if any(keyword in key for keyword in withdrawal_keywords):
                return key
        return None
    
    def _find_deposit_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the deposit column in the transaction data"""
        deposit_keywords = ['deposit', 'Deposit', 'DEPOSIT', 'deposits', 'Deposits']
        for key in transaction.keys():
            if any(keyword in key for keyword in deposit_keywords):
                return key
        return None
    
    def _find_description_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the description column in the transaction data"""
        desc_keywords = ['description', 'DESCRIPTION', 'Description', 'details', 'DETAILS', 'Details', 'transaction', 'TRANSACTION']
        for key in transaction.keys():
            if any(keyword in key for keyword in desc_keywords):
                return key
        return None
    
    def _find_category_column(self, transaction: Dict[str, Any]) -> Optional[str]:
        """Find the category column in the transaction data"""
        category_keywords = ['category', 'CATEGORY', 'Category', 'merchant', 'MERCHANT', 'Merchant']
        for key in transaction.keys():
            if any(keyword in key for keyword in category_keywords):
                return key
        return None

    def get_summary(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Get summary statistics for standardized transactions"""
        if df.empty:
            return {"error": "No transactions to summarize"}
        
        return {
            "total_transactions": len(df),
            "date_range": {
                "start": df['transaction_date'].min(),
                "end": df['transaction_date'].max()
            },
            "accounts": df['account'].unique().tolist(),
            "transaction_types": df['transaction_type'].value_counts().to_dict(),
            "total_amount": {
                "debit": df[df['transaction_type'] == 'debit']['amount'].sum(),
                "credit": df[df['transaction_type'] == 'credit']['amount'].sum()
            }
        }


# Global instance for easy access
transaction_standardizer = TransactionStandardizer()


def get_transaction_standardizer(data_dir: Optional[str] = None) -> TransactionStandardizer:
    """Get the global transaction standardizer instance"""
    if data_dir is not None:
        return TransactionStandardizer(data_dir)
    return transaction_standardizer
