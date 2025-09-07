# Statement Processing Workflow

This document describes the end-to-end statement processing workflow that automates the complete process of fetching, processing, and storing bank statements.

## Overview

The `StatementWorkflow` orchestrator coordinates the following steps:

1. **Get Statement Senders**: Retrieves all unique statement sender emails from the accounts table
2. **Fetch Emails**: Searches for emails from these senders within a specific date range (from both email accounts)
3. **Download Statements**: Downloads PDF attachments with proper naming convention to temp directory
4. **Unlock PDFs**: Removes password protection from statements
5. **Extract Data**: Uses AI-powered extraction to parse statement data
6. **Upload to Cloud**: Stores only unlocked statements in Google Cloud Storage
7. **Standardize**: Converts extracted data to a unified format
8. **Store in Database**: Saves standardized transactions to the database

## Date Range Logic

The workflow automatically calculates the date range for statement retrieval:
- **Start Date**: 10th of the previous month
- **End Date**: 10th of the current month

For example, if run in September 2025:
- Start: August 10, 2025
- End: September 10, 2025

This ensures we capture statements for the previous month's data.

## Cloud Storage Organization

Only unlocked statements are uploaded to cloud storage, organized by month:
```
statements/
└── {previous_month_name}/
    ├── {normalized_filename}_unlocked.pdf
    ├── {normalized_filename}_unlocked.pdf
    └── {normalized_filename}_unlocked.pdf
```

Example:
```
statements/
└── August_2025/
    ├── axis_credit_20250815_unlocked.pdf
    ├── hdfc_bank_20250820_unlocked.pdf
    └── sbi_card_20250825_unlocked.pdf
```

**Note**: 
- Only unlocked statements are uploaded to cloud storage
- Locked statements are processed locally in temp directory and then cleaned up
- No secondary account suffixes are used in filenames

## Temp Directory Usage

The workflow uses a temporary directory for processing statements:

- **Location**: System temp directory with prefix `statement_processing_`
- **Example**: `/tmp/statement_processing_abc123/` or `/var/folders/.../statement_processing_xyz789/`
- **Contents**: Downloaded locked PDF statements during processing
- **Cleanup**: Automatically cleaned up after workflow completion
- **Purpose**: 
  - Download statements from emails
  - Unlock PDFs locally
  - Extract data from unlocked PDFs
  - Upload only unlocked versions to cloud storage

The temp directory path is included in workflow results for debugging purposes.

## Usage

### Running the Complete Workflow

```bash
# From the backend directory
cd backend/
poetry run python scripts/run_statement_processing_workflow.py
```

### Running Tests

```bash
# From the backend directory
cd backend/
poetry run python tests/test_workflow_orchestrator.py
```

### Using the Workflow in Code

```python
from src.services.statement_processor import run_statement_workflow

# Run the complete workflow (searches both email accounts by default)
results = await run_statement_workflow()

# Or specify specific email accounts
results = await run_statement_workflow(account_ids=["primary", "secondary"])

# Check results
print(f"Downloaded: {results['total_statements_downloaded']}")
print(f"Processed: {results['total_statements_processed']}")
print(f"Errors: {len(results['errors'])}")
print(f"Temp Directory: {results['temp_directory']}")
```

## Configuration Requirements

### Database
- Ensure accounts table has `statement_sender` column populated
- Active accounts should have `is_active = true`

### Email Configuration
- Gmail API credentials configured for both email accounts:
  - Primary: chaitanyagvs23@gmail.com
  - Secondary: chaitanyagvs98@gmail.com
- Email clients properly authenticated for both accounts

### Cloud Storage
- Google Cloud Storage bucket configured
- Proper authentication and permissions

### AI Extraction
- Vision Agent API key configured
- Extraction schemas defined for each bank

## Workflow Results

The workflow returns a comprehensive results dictionary:

```python
{
    "total_senders": 5,                    # Number of statement senders found
    "total_statements_downloaded": 12,     # Statements downloaded from emails
    "total_statements_uploaded": 12,       # Successfully uploaded to cloud
    "total_statements_processed": 10,      # Successfully extracted data
    "errors": [                            # List of any errors encountered
        "Failed to extract data from statement_x.pdf"
    ],
    "processed_statements": [              # Details of successfully processed statements
        {
            "sender_email": "statements@bank.com",
            "filename": "bank_20250815_locked.pdf",
            "cloud_path": "statements/bank/August_2025/bank_20250815_locked.pdf",
            "extraction_success": True,
            "standardization_success": True
        }
    ]
}
```

## Error Handling

The workflow includes comprehensive error handling:
- Individual statement failures don't stop the entire workflow
- All errors are logged and collected in the results
- Temporary files are cleaned up even if errors occur
- Each step is isolated to prevent cascading failures

## Monitoring and Logging

The workflow provides detailed logging at each step:
- 📋 Step 1: Getting statement senders
- 🔍 Searching for emails from each sender
- 📧 Email search results
- ⬇️ Downloading attachments
- ☁️ Uploading to cloud storage
- 📊 Data extraction results
- 📈 Standardization results
- 🧹 Cleanup operations

## Troubleshooting

### Common Issues

1. **No statement senders found**
   - Check that accounts table has `statement_sender` populated
   - Verify accounts are marked as active

2. **Email authentication errors**
   - Verify Gmail API credentials
   - Check token refresh if needed

3. **Cloud storage upload failures**
   - Verify GCS bucket permissions
   - Check authentication credentials

4. **Data extraction failures**
   - Verify Vision Agent API key
   - Check extraction schema mappings

### Debug Mode

For detailed debugging, check the logs in `backend/logs/` directory. The workflow logs all operations with appropriate log levels.

## Future Enhancements

- [ ] Add retry logic for failed operations
- [ ] Implement incremental processing (only new statements)
- [ ] Add webhook notifications for completion
- [ ] Support for additional file formats
- [ ] Parallel processing for multiple statements
- [ ] Integration with monitoring systems
