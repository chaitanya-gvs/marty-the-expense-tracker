"""
Transaction Standardizer Service

This service standardizes transaction data from multiple CSV files into a unified format.
It handles different bank statement formats and normalizes them into a consistent schema.
"""

import re
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

import pandas as pd

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
            "%d-%m-%y",      # 06-10-25 (SBI savings format)
            "%d-%b-%Y",      # 01-Oct-2025 (Yes Bank format)
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
            # Rename columns to standard names - handle both 5 and 6 column formats
            if len(df_clean.columns) == 6:
                df_clean.columns = ["Date", "SerNo", "Transaction Details", "Reward Points", "Intl Amount", "Amount"]
            elif len(df_clean.columns) == 5:
                df_clean.columns = ["Date", "SerNo", "Transaction Details", "Reward Points", "Amount"]
        else:
            # If no header row found, try to normalize column names
            # Check if column names need normalization (e.g., "Amount (in ₹)" -> "Amount")
            if "Amount (in ₹)" in df_clean.columns or "Amount (in₹)" in df_clean.columns:
                # Rename the amount column to "Amount"
                amount_col = [col for col in df_clean.columns if "Amount" in col and "in" in col][0]
                df_clean = df_clean.rename(columns={amount_col: "Amount"})
        
        standardized_data = []
        for _, row in df_clean.iterrows():
            if pd.isna(row.get("Date")) or str(row.get("Date")).strip() == "":
                continue
            
            # Get the amount string - prioritize "Amount" column, but fallback to "Intl Amount" if Amount is empty
            amount_str = str(row.get("Amount", "")).strip()
            if not amount_str or amount_str.lower() == 'nan' or amount_str == '':
                # If Amount column is empty, try Intl Amount column
                if "Intl Amount" in df_clean.columns:
                    amount_str = str(row.get("Intl Amount", "")).strip()
                elif "Intl.* amount" in df_clean.columns:
                    amount_str = str(row.get("Intl.* amount", "")).strip()
            
            if not amount_str or amount_str.lower() == 'nan' or amount_str == '':
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
        last_valid_date = None
        
        # Find the description column dynamically — it starts with "Transaction Details"
        description_col = next(
            (c for c in df.columns if str(c).startswith("Transaction Details")),
            None
        )
        if not description_col:
            logger.warning(f"No 'Transaction Details' column found in {filename}, skipping")
            return pd.DataFrame()

        for _, row in df.iterrows():
            date_value = row.get("Date")
            description = str(row.get(description_col, "")).strip()

            # Skip summary rows
            if any(keyword in description.lower() for keyword in ['transactions for', 'summary', 'total']):
                logger.warning(f"Skipping summary row: {description}")
                continue

            # Handle rows without dates (likely forex charges or fees)
            if pd.isna(date_value) or str(date_value).strip() == "":
                if any(keyword in description.lower() for keyword in ['forex', 'markup', 'igst', 'tax', 'charge', 'fee']):
                    # Use the first of the month for forex charges/fees
                    if last_valid_date:
                        if hasattr(last_valid_date, 'date'):
                            date_obj = last_valid_date.date()
                        elif isinstance(last_valid_date, str):
                            try:
                                date_obj = datetime.strptime(last_valid_date, "%Y-%m-%d").date()
                            except ValueError:
                                transaction_date = date.today().replace(day=1)
                                logger.info(f"Using current month first day {transaction_date} for forex charge: {description}")
                                continue
                        else:
                            date_obj = last_valid_date
                        transaction_date = date_obj.replace(day=1)
                    else:
                        transaction_date = date.today().replace(day=1)
                    logger.info(f"Using first of month {transaction_date} for forex charge: {description}")
                else:
                    logger.warning(f"Skipping row without date: {description}")
                    continue
            else:
                transaction_date = self.parse_date(date_value)
                last_valid_date = transaction_date
                
            amount, transaction_type = self.clean_amount(row.get("Amount (₹)", ""), is_credit_card=True)
            
            standardized_data.append({
                'transaction_date': transaction_date,
                'transaction_time': None,
                'description': description,
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
            
            # Skip summary/balance rows
            date_str = str(row.get("Transaction Date")).strip()
            description = str(row.get("Description", "")).strip()
            
            if any(keyword in date_str.lower() for keyword in ['closing balance', 'opening balance', 'total', 'summary', 'b/f', 'brought forward']):
                logger.warning(f"Skipping summary row: {date_str} - {description}")
                continue
            
            if any(keyword in description.lower() for keyword in ['closing balance', 'opening balance', 'total', 'summary', 'b/f', 'brought forward']):
                logger.warning(f"Skipping summary row: {date_str} - {description}")
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
    
    def process_sbi_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process SBI Savings Account data"""
        logger.info(f"Processing SBI Savings data: {filename}")
        
        standardized_data = []
        for _, row in df.iterrows():
            # Get date from "Date" column (format: DD-MM-YY)
            date_value = row.get("Date")
            if pd.isna(date_value) or str(date_value).strip() == "" or str(date_value).strip() == "-":
                continue
            
            # Get transaction description from "Transaction Reference" column
            description = str(row.get("Transaction Reference", "")).strip()
            if not description or description == "-" or description.lower() in ['nan', 'none']:
                continue
            
            # Skip summary/balance rows
            if any(keyword in description.upper() for keyword in ['OPENING BALANCE', 'CLOSING BALANCE', 'TOTAL', 'SUMMARY']):
                logger.info(f"Skipping summary row: {description}")
                continue
            
            # For savings account, determine amount from Debit/Credit columns
            debit_str = str(row.get("Debit", "")).strip() if pd.notna(row.get("Debit")) else ""
            credit_str = str(row.get("Credit", "")).strip() if pd.notna(row.get("Credit")) else ""
            
            # Handle hyphen (-) as empty value
            if debit_str == "-":
                debit_str = ""
            if credit_str == "-":
                credit_str = ""
            
            # Clean and parse amounts (remove commas, CR suffix, etc.)
            amount = 0.0
            transaction_type = None
            
            if debit_str and debit_str.lower() not in ['', 'nan', 'none', '-']:
                try:
                    # Remove commas and any suffixes
                    debit_clean = debit_str.replace(',', '').replace('CR', '').replace('DR', '').strip()
                    if debit_clean:
                        amount = float(debit_clean)
                        transaction_type = "debit"
                except (ValueError, AttributeError):
                    pass
            
            if credit_str and credit_str.lower() not in ['', 'nan', 'none', '-'] and amount == 0:
                try:
                    # Remove commas and any suffixes
                    credit_clean = credit_str.replace(',', '').replace('CR', '').replace('DR', '').strip()
                    if credit_clean:
                        amount = float(credit_clean)
                        transaction_type = "credit"
                except (ValueError, AttributeError):
                    pass
            
            # Skip if no valid amount found
            if amount <= 0 or transaction_type is None:
                continue
            
            # Get reference number from "Ref.No./Chq.No." column
            ref_no = row.get("Ref.No./Chq.No.") or row.get("Ref.No./Chq.No")
            if pd.notna(ref_no) and str(ref_no).strip() not in ['', '-', 'nan', 'none']:
                reference_number = str(ref_no).strip()
            else:
                reference_number = None
            
            standardized_data.append({
                'transaction_date': self.parse_date(date_value),
                'transaction_time': None,
                'description': description,
                'amount': amount,
                'transaction_type': transaction_type,
                'account': account_name or "SBI Savings Account",
                'category': None,
                'reference_number': reference_number,
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
            
            # Skip summary/balance rows
            date_str = str(row.get("Date")).strip()
            description = str(row.get("Transaction Details", "")).strip()
            
            if any(keyword in date_str.lower() for keyword in ['closing balance', 'opening balance', 'total', 'summary']):
                logger.warning(f"Skipping summary row: {date_str} - {description}")
                continue
            
            if any(keyword in description.lower() for keyword in ['closing balance', 'opening balance', 'total', 'summary']):
                logger.warning(f"Skipping summary row: {date_str} - {description}")
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
            elif "axis" in filename.lower() and "savings" in filename.lower():
                return self.process_axis_bank_savings(df, filename)
            elif "axis" in filename.lower():
                return self.process_axis_atlas(df, filename)
            elif "swiggy" in filename.lower() and "hdfc" in filename.lower():
                return self.process_swiggy_hdfc(df, filename)
            elif "cashback" in filename.lower() and "sbi" in filename.lower():
                return self.process_cashback_sbi(df, filename)
            elif "sbi" in filename.lower():
                return self.process_sbi_savings(df, filename)
            elif "yes" in filename.lower() and "savings" in filename.lower():
                return self.process_yes_bank_savings(df, filename)
            else:
                logger.warning(f"Unknown file type: {filename}")
                return pd.DataFrame()
                
        except Exception as e:
            logger.error(f"Error processing {filename}", exc_info=True)
            return pd.DataFrame()
    
