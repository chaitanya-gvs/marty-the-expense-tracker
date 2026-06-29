"""
Transaction Standardizer Service

This service standardizes transaction data from multiple CSV files into a unified format.
It handles different bank statement formats and normalizes them into a consistent schema.
"""

import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional, Tuple

import pandas as pd

from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


def _splitwise_ref_from_external_id(ext_id: Any) -> Optional[str]:
    """Extract valid reference_number from Splitwise external_id, guarding against pandas NaN."""
    if ext_id is None:
        return None
    if pd.isna(ext_id):
        return None
    s = str(ext_id).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    return s


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
            return 0.0, "debit" if is_credit_card else "unknown"
            
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
            return 0.0, "debit" if is_credit_card else "unknown"
    
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

    def _make_skip_row(
        self,
        reason: str,
        date_str: str,
        description: str,
        account: str,
        source_file: str,
        raw_data: dict,
        reference_number: Optional[str] = None,
    ) -> dict:
        """Build a flagged row dict. Flagged rows are reported but not inserted into the DB."""
        return {
            "transaction_date": None,
            "transaction_time": None,
            "description": description,
            "amount": 0.0,
            "transaction_type": None,
            "account": account,
            "category": None,
            "reference_number": reference_number,
            "source_file": source_file,
            "raw_data": raw_data,
            "_skip_reason": reason,
            "_partial_date_raw": date_str if reason == "null_date" else None,
        }

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
        """Process Amazon Pay ICICI Credit Card data. Schema produces: Date, SerNo, Transaction Details, Amount (INR)."""
        logger.info(f"Processing Amazon Pay ICICI data: {filename}")
        account = account_name or "Amazon Pay ICICI Credit Card"
        standardized_data = []

        # Amount column name varies by extraction: "Amount (INR)", "Amount (in•)", or falls through to "Intl.# amount"
        amount_col = next(
            (c for c in df.columns if str(c).lower().startswith("amount")),
            None,
        )
        fallback_col = next(
            (c for c in df.columns if "intl" in str(c).lower() or "amount" in str(c).lower()),
            None,
        )

        for _, row in df.iterrows():
            date_str = str(row.get("Date", "")).strip()
            description = str(row.get("Transaction Details", "")).strip()
            # Prefer the "Amount*" column; if NaN fall back to "Intl.# amount"
            amount_str = ""
            if amount_col:
                val = row.get(amount_col, "")
                if not (pd.isna(val) or str(val).strip().lower() in ("nan", "")):
                    amount_str = str(val).strip()
            if not amount_str and fallback_col and fallback_col != amount_col:
                val = row.get(fallback_col, "")
                if not (pd.isna(val) or str(val).strip().lower() in ("nan", "")):
                    amount_str = str(val).strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
                continue

            amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
            if amount <= 0:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": str(row.get("SerNo", "")).strip(),
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def process_axis_atlas(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Axis Atlas Credit Card data. Schema produces: DATE, TRANSACTION DETAILS, AMOUNT (Rs.)."""
        logger.info(f"Processing Axis Atlas data: {filename}")
        account = account_name or "Axis Atlas Credit Card"
        standardized_data = []

        for _, row in df.iterrows():
            date_str = str(row.get("DATE", "")).strip()
            description = str(row.get("TRANSACTION DETAILS", "")).strip()
            amount_str = str(row.get("AMOUNT (Rs.)", "")).strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
            if amount <= 0:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": None,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def process_swiggy_hdfc(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Swiggy HDFC Credit Card data. Schema produces: Date, Time, Transaction Description, Amount (INR)."""
        logger.info(f"Processing Swiggy HDFC data: {filename}")
        account = account_name or "Swiggy HDFC Credit Card"
        standardized_data = []

        # Two extraction layouts observed:
        #   Old: Date | Time | Transaction Description | Amount (INR)
        #   New: DATE & TIME | TRANSACTION DESCRIPTION (has time) | AMOUNT (has desc) | PI (has amount)
        cols = list(df.columns)
        new_layout = "DATE & TIME" in cols

        for _, row in df.iterrows():
            if new_layout:
                date_str = str(row.get("DATE & TIME", "")).strip()
                time_str = str(row.get("TRANSACTION DESCRIPTION", "")).strip()
                description = str(row.get("AMOUNT", "")).strip()
                amount_str = str(row.get("PI", "")).strip()
            else:
                date_str = str(row.get("Date", "")).strip()
                time_str = str(row.get("Time", "")).strip()
                description = str(row.get("Transaction Description", "")).strip()
                amount_str = str(row.get("Amount (INR)", "")).strip()
            raw = row.to_dict()

            # Combine into format expected by parse_date / extract_time
            if time_str and time_str.lower() not in ("nan", ""):
                full_datetime = f"{date_str}| {time_str}"
            else:
                full_datetime = date_str

            parsed_date = self.parse_date(full_datetime) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
            if amount <= 0:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": self.extract_time(full_datetime),
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": None,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def process_cashback_sbi(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Cashback SBI Credit Card data. Schema produces: Date, Transaction Details, Amount (INR)."""
        logger.info(f"Processing Cashback SBI data: {filename}")
        account = account_name or "Cashback SBI Credit Card"

        # Dynamic column detection — safety net for minor column name variations
        description_col = next((c for c in df.columns if str(c).startswith("Transaction Details")), None)
        if not description_col:
            logger.warning(f"No 'Transaction Details' column in {filename} — skipping")
            return pd.DataFrame()

        amount_col = next((c for c in df.columns if str(c).startswith("Amount")), None)
        if not amount_col:
            logger.warning(f"No 'Amount' column in {filename} — skipping")
            return pd.DataFrame()

        standardized_data = []
        for _, row in df.iterrows():
            date_str = str(row.get("Date", "")).strip()
            description = str(row.get(description_col, "")).strip()
            amount_str = str(row.get(amount_col, "")).strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
            if amount <= 0:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": None,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def process_yes_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Yes Bank Savings Account data. Schema produces: Date, Description, Withdrawals, Deposits."""
        logger.info(f"Processing Yes Bank Savings data: {filename}")
        account = account_name or "Yes Bank Savings Account"

        def _parse_amt(val) -> float:
            if val is None or (isinstance(val, float) and pd.isna(val)):
                return 0.0
            try:
                return float(str(val).strip().replace(",", ""))
            except (ValueError, AttributeError):
                return 0.0

        standardized_data = []
        for _, row in df.iterrows():
            date_val = row.get("Date") or row.get("Transaction Date")
            date_str = str(date_val).strip() if date_val is not None else ""
            description = str(row.get("Description", "")).strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            withdrawal = _parse_amt(row.get("Withdrawals", 0))
            deposit = _parse_amt(row.get("Deposits", 0))

            if withdrawal > 0:
                amount, transaction_type = withdrawal, "debit"
            elif deposit > 0:
                amount, transaction_type = deposit, "credit"
            else:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": None,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def process_sbi_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process SBI Savings Account data. Schema produces: Date, Description, Amount."""
        logger.info(f"Processing SBI Savings data: {filename}")
        account = account_name or "SBI Savings Account"

        def _parse_amount(val) -> float:
            if val is None or (isinstance(val, float) and pd.isna(val)):
                return 0.0
            s = str(val).strip().replace(",", "").strip()
            if not s or s.lower() in ("nan", "none", "-", ""):
                return 0.0
            try:
                return float(s)
            except (ValueError, AttributeError):
                return 0.0

        standardized_data = []
        for _, row in df.iterrows():
            date_str = str(row.get("Date", "")).strip()
            description = str(row.get("Description") or "").strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            amount = _parse_amount(row.get("Amount"))
            if amount <= 0:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            desc_upper = description.upper()
            if "/CR/" in desc_upper or (
                ("CREDIT" in desc_upper or "INTEREST" in desc_upper) and "/DR/" not in desc_upper
            ):
                transaction_type = "credit"
            elif "/DR/" in desc_upper or ("DEBIT" in desc_upper and "/CR/" not in desc_upper):
                transaction_type = "debit"
            else:
                # Direction cannot be inferred from SBI description format — skip silently
                logger.warning(f"SBI Savings: unknown direction for '{description}' in {filename}")
                continue

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": None,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)

    
    def process_axis_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
        """Process Axis Bank Savings Account data. Schema produces: Date, Transaction Details, Chq No, Withdrawal, Deposits."""
        logger.info(f"Processing Axis Bank Savings data: {filename}")
        account = account_name or "Axis Bank Savings Account"
        standardized_data = []

        for _, row in df.iterrows():
            date_str = str(row.get("Date", "")).strip()
            description = str(row.get("Transaction Details", "")).strip()
            raw = row.to_dict()

            parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
            if not parsed_date:
                standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
                continue

            if not description or description.lower() in ("nan", "none"):
                standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
                continue

            withdrawal_raw = row.get("Withdrawals", "")
            deposit_raw = row.get("Deposits", "")

            def _safe_float(val) -> float:
                if val is None or (isinstance(val, float) and pd.isna(val)):
                    return 0.0
                s = str(val).strip().replace(",", "")
                if not s or s.lower() in ("nan", ""):
                    return 0.0
                try:
                    return float(s)
                except (ValueError, TypeError):
                    return 0.0

            withdrawal = _safe_float(withdrawal_raw)
            deposit = _safe_float(deposit_raw)

            if withdrawal > 0:
                amount, transaction_type = withdrawal, "debit"
            elif deposit > 0:
                amount, transaction_type = deposit, "credit"
            else:
                standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
                continue

            chq_no = str(row.get("Chq No", "")).strip()
            reference_number = chq_no if chq_no and chq_no.lower() not in ("nan", "") else None

            standardized_data.append({
                "transaction_date": parsed_date,
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "transaction_type": transaction_type,
                "account": account,
                "category": None,
                "reference_number": reference_number,
                "source_file": filename,
                "raw_data": raw,
                "_skip_reason": None,
                "_partial_date_raw": None,
            })

        return pd.DataFrame(standardized_data)
    
    def standardize_splitwise_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Standardize Splitwise CSV data into the canonical transaction format."""
        standardized_data = []

        for _, row in df.iterrows():
            date_val = row.get("date")
            description = str(row.get("description", "")).strip()
            if not date_val or not description:
                continue

            # Total transaction amount
            try:
                amount = float(row.get("amount", 0) or 0)
            except (ValueError, TypeError):
                amount = 0.0

            # User's personal share of the expense
            try:
                my_share = float(row.get("my_share", 0) or 0)
            except (ValueError, TypeError):
                my_share = amount

            if amount <= 0:
                continue

            # Splitwise entries are always outgoing expenses (debits) unless explicitly a payment
            is_payment = str(row.get("is_payment", "False")).lower() in ("true", "1", "yes")
            transaction_type = "credit" if is_payment else "debit"

            # Parse split_breakdown JSON string if present
            split_breakdown_raw = row.get("split_breakdown")
            split_breakdown = None
            if split_breakdown_raw and str(split_breakdown_raw) not in ("", "None", "nan"):
                try:
                    split_breakdown = split_breakdown_raw if isinstance(split_breakdown_raw, dict) else __import__("json").loads(str(split_breakdown_raw))
                except Exception:
                    split_breakdown = None

            standardized_data.append({
                "transaction_date": self.parse_date(date_val),
                "transaction_time": None,
                "description": description,
                "amount": amount,
                "my_share": my_share,
                "transaction_type": transaction_type,
                "is_shared": True,
                "split_breakdown": split_breakdown,
                "account": "Splitwise",  # Normalize to title case; source column may be "splitwise"
                "category": str(row.get("category", "")).strip() or None,
                "sub_category": str(row.get("group_name", "")).strip() or None,
                "reference_number": _splitwise_ref_from_external_id(row.get("external_id")),
                "source_file": "splitwise",
                "raw_data": row.to_dict(),
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
            elif "yes" in filename.lower() and ("savings" in filename.lower() or "bank" in filename.lower()):
                return self.process_yes_bank_savings(df, filename)
            else:
                logger.warning(f"Unknown file type: {filename}")
                return pd.DataFrame()
                
        except Exception:
            logger.error(f"Error processing {filename}", exc_info=True)
            return pd.DataFrame()
    
