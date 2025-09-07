# Scripts Directory

This directory contains utility scripts for the expense tracker backend.

## Available Scripts

### `process_statement.py` - Core Statement Processing
The main script for processing PDF bank statements. It handles the essential workflow:

1. **Unlock PDFs** - Removes password protection using configured bank passwords
2. **Parse with agentic-doc** - Extracts data using AI-powered document processing
3. **Convert to Excel** - Saves transaction tables as Excel files

#### Usage Examples

```bash
# Process a single PDF file
poetry run python scripts/process_statement.py path/to/statement.pdf

# Process all PDFs in a directory
poetry run python scripts/process_statement.py path/to/statements/

# Clean up old temporary files
poetry run python scripts/process_statement.py --cleanup

# Get help
poetry run python scripts/process_statement.py --help
```

#### Output
- Unlocked PDFs are saved to `data/statements/unlocked_statements/`
- Excel files are saved to `data/extracted_tables/`
- Temporary files are automatically cleaned up

### `manage_bank_passwords.py` - Password Management
Manages bank passwords for unlocking protected PDF statements.

```bash
# Add a new bank password
poetry run python scripts/manage_bank_passwords.py --add --bank "Axis Bank" --password "your_password"

# List configured banks
poetry run python scripts/manage_bank_passwords.py --list

# Remove a bank
poetry run python scripts/manage_bank_passwords.py --remove --bank "Axis Bank"
```

### `fetch_emails.py` - Email Processing
Fetches and processes emails from Gmail (if needed for email-based workflows).

```bash
# Fetch recent emails
poetry run python scripts/fetch_emails.py --recent

# Search by date range
poetry run python scripts/fetch_emails.py --days 7 --limit 10
```

### `download_latest_attachment.py` - Latest Attachment Downloader
Downloads the latest attachment from a specific sender's email. Perfect for getting the most recent bank statements.

```bash
# Download latest PDF from Axis Bank
poetry run python scripts/download_latest_attachment.py cc.statements@axisbank.com

# Download latest Excel file from HDFC
poetry run python scripts/download_latest_attachment.py statements@hdfcbank.com --file-type xlsx

# List common bank statement senders
poetry run python scripts/download_latest_attachment.py --list-senders
```

### `run_statement_processing_workflow.py` - Complete Workflow Runner
Runs the complete end-to-end statement processing workflow that orchestrates the entire process.

```bash
# Run the complete workflow
poetry run python scripts/run_statement_processing_workflow.py
```

### `setup_secondary_email.py` - Secondary Email Setup
Helps set up a secondary Gmail account for the expense tracker.

```bash
# Get setup instructions
poetry run python scripts/setup_secondary_email.py
```

### `standardize_transactions.py` - Transaction Standardization
Standardizes transaction data using the TransactionStandardizer service.

```bash
# Standardize all transactions
poetry run python scripts/standardize_transactions.py
```

## Removed Scripts

The following scripts were removed to simplify the codebase:

- `process_axis_bank_workflow.py` - Complex workflow script (replaced by `process_statement.py`)
- `complete_statement_processing.py` - Redundant processing script
- `process_axis_bank_statement.py` - Bank-specific script (functionality now in `process_statement.py`)
- `standardize_transactions_service.py` - Duplicate of `standardize_transactions.py`
- `test_download_unlock_upload.py` - Test script (moved to tests directory)
- `test_gcs_connection.py` - Test script (moved to tests directory)
- `cloud_statement_processor.py` - Module (functionality integrated into services)
- `process_statement_cloud.py` - Redundant (functionality in main workflow)

## Architecture

The scripts now follow a simplified, service-oriented approach:

- **Scripts** handle command-line interface and orchestration
- **Services** provide the core business logic
- **Clear separation** between script execution and business logic

This makes the codebase easier to maintain and extend while keeping the scripts focused on their specific tasks.
