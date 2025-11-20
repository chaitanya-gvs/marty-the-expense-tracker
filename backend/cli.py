#!/usr/bin/env python3
"""
Expense Tracker CLI - Main entrypoint for all operations

This CLI provides comprehensive control over the expense tracking pipeline,
including statement extraction, transaction processing, and database management.

Usage:
    poetry run python cli.py process --help
    poetry run python cli.py status
    poetry run python cli.py extract --help
"""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint

# Add the backend directory to Python path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from src.services.orchestrator.statement_workflow import (
    run_statement_workflow,
    run_resume_workflow,
    can_resume_workflow,
)
from src.services.database_manager.operations import (
    AccountOperations,
    TransactionOperations,
)
from src.utils.logger import get_logger

logger = get_logger(__name__)
console = Console()


@click.group()
@click.version_option(version="1.0.0")
def cli():
    """
    🚀 Expense Tracker CLI
    
    Manage your expense tracking pipeline with ease.
    Extract statements, process transactions, and manage your financial data.
    """
    pass


@cli.command()
@click.option(
    "--start-date",
    type=str,
    help="Start date in YYYY/MM/DD format (e.g., 2025/08/10)",
)
@click.option(
    "--end-date",
    type=str,
    help="End date in YYYY/MM/DD format (e.g., 2025/10/10)",
)
@click.option(
    "--full",
    is_flag=True,
    help="Full repopulation: Clear database and reinsert all transactions",
)
@click.option(
    "--append",
    is_flag=True,
    help="Append mode: Only process new statements since last run (keeps existing data)",
)
@click.option(
    "--resume",
    is_flag=True,
    help="Resume from standardization: Skip extraction, use existing CSVs in cloud",
)
@click.option(
    "--account",
    type=str,
    multiple=True,
    help="Process specific account(s) only. Can be used multiple times.",
)
@click.option(
    "--enable-secondary",
    is_flag=True,
    help="Enable secondary Gmail account checking (overrides environment setting)",
)
@click.option(
    "--auto",
    is_flag=True,
    help="Auto mode: Automatically detect whether to resume or run full workflow",
)
@click.option(
    "--last-n-days",
    type=int,
    help="Process statements from last N days (alternative to start/end dates)",
)
def process(
    start_date: Optional[str],
    end_date: Optional[str],
    full: bool,
    append: bool,
    resume: bool,
    account: tuple,
    enable_secondary: bool,
    auto: bool,
    last_n_days: Optional[int],
):
    """
    🔄 Process statements and extract transactions
    
    This is the main command for running the extraction pipeline.
    You can customize the behavior with various options.
    
    Examples:
    
      # Full repopulation with custom date range
      cli.py process --full --start-date 2025/08/10 --end-date 2025/10/10
      
      # Append new transactions since last run
      cli.py process --append
      
      # Process last 30 days
      cli.py process --last-n-days 30
      
      # Resume from standardization (skip extraction)
      cli.py process --resume --start-date 2025/08/10 --end-date 2025/10/10
      
      # Auto-detect mode
      cli.py process --auto --start-date 2025/08/10 --end-date 2025/10/10
    """
    # Validate mutually exclusive options
    mode_count = sum([full, append, resume, auto])
    if mode_count > 1:
        console.print(
            "[red]❌ Error: Only one mode can be selected (--full, --append, --resume, --auto)[/red]"
        )
        sys.exit(1)
    
    # Calculate dates
    if last_n_days:
        if start_date or end_date:
            console.print(
                "[red]❌ Error: Cannot use --last-n-days with --start-date/--end-date[/red]"
            )
            sys.exit(1)
        end_date_obj = datetime.now()
        start_date_obj = end_date_obj - timedelta(days=last_n_days)
        start_date = start_date_obj.strftime("%Y/%m/%d")
        end_date = end_date_obj.strftime("%Y/%m/%d")
    
    # Validate date parameters
    if (start_date and not end_date) or (not start_date and end_date):
        console.print(
            "[red]❌ Error: Both --start-date and --end-date must be provided together[/red]"
        )
        sys.exit(1)
    
    # Display mode
    if full:
        mode_display = "[bold red]FULL REPOPULATION[/bold red] - Will clear database and reinsert"
    elif append:
        mode_display = "[bold green]APPEND MODE[/bold green] - Will add new transactions only"
    elif resume:
        mode_display = "[bold yellow]RESUME MODE[/bold yellow] - Will skip extraction and use existing CSVs"
    elif auto:
        mode_display = "[bold cyan]AUTO MODE[/bold cyan] - Will automatically detect best approach"
    else:
        mode_display = "[bold blue]STANDARD MODE[/bold blue] - Will process with duplicate checking"
    
    # Display configuration
    config_table = Table(title="🔧 Configuration", show_header=False)
    config_table.add_column("Setting", style="cyan")
    config_table.add_column("Value", style="green")
    
    config_table.add_row("Mode", mode_display)
    config_table.add_row(
        "Date Range",
        f"{start_date or 'Auto (10th prev month - 10th current month)'} → {end_date or 'Auto'}",
    )
    config_table.add_row(
        "Secondary Account", "✅ Enabled" if enable_secondary else "❌ Disabled (or from env)"
    )
    if account:
        config_table.add_row("Specific Accounts", ", ".join(account))
    
    console.print(config_table)
    console.print()
    
    # Confirmation for full mode
    if full:
        console.print(
            "[bold red]⚠️  WARNING: Full mode will DELETE ALL existing transactions![/bold red]"
        )
        if not click.confirm("Are you sure you want to continue?", default=False):
            console.print("[yellow]Operation cancelled.[/yellow]")
            sys.exit(0)
    
    # Run the workflow
    try:
        asyncio.run(
            _run_process_workflow(
                start_date=start_date,
                end_date=end_date,
                mode="full" if full else "append" if append else "resume" if resume else "auto" if auto else "standard",
                enable_secondary=enable_secondary or None,
                specific_accounts=list(account) if account else None,
            )
        )
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Operation cancelled by user[/yellow]")
        sys.exit(130)
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        logger.error(f"CLI process command failed: {e}")
        sys.exit(1)


async def _run_process_workflow(
    start_date: Optional[str],
    end_date: Optional[str],
    mode: str,
    enable_secondary: Optional[bool],
    specific_accounts: Optional[list],
):
    """Internal function to run the processing workflow"""
    console.print("[bold]🚀 Starting workflow...[/bold]\n")
    
    # Auto mode: check if we can resume
    if mode == "auto":
        console.print("[cyan]🤖 Auto-detecting workflow mode...[/cyan]")
        can_resume = await can_resume_workflow(
            enable_secondary_account=enable_secondary,
            custom_start_date=start_date,
            custom_end_date=end_date,
        )
        if can_resume:
            console.print("[green]✅ Found existing CSVs in cloud - Resuming from standardization[/green]\n")
            mode = "resume"
        else:
            console.print("[yellow]⚠️  No existing CSVs found - Running full extraction[/yellow]\n")
            mode = "full"
    
    # Run appropriate workflow based on mode
    if mode == "resume":
        result = await run_resume_workflow(
            enable_secondary_account=enable_secondary,
            custom_start_date=start_date,
            custom_end_date=end_date,
            clear_before_insert=(mode == "full"),  # Clear only in full mode
        )
    else:
        # For full/append/standard modes, run the full workflow
        # Clear database only in full mode, append in other modes
        result = await run_statement_workflow(
            enable_secondary_account=enable_secondary,
            custom_start_date=start_date,
            custom_end_date=end_date,
            clear_before_insert=(mode == "full"),  # Clear only in full mode
        )
    
    # Display results
    _display_workflow_results(result)


def _display_workflow_results(result: dict):
    """Display workflow results in a nice format"""
    console.print("\n")
    console.print(Panel.fit("✅ [bold green]Workflow Completed Successfully![/bold green]", border_style="green"))
    console.print()
    
    # Create results table
    results_table = Table(title="📊 Processing Results", show_header=True)
    results_table.add_column("Metric", style="cyan", width=40)
    results_table.add_column("Count", justify="right", style="green")
    
    results_table.add_row("📧 Statements Downloaded", str(result.get("total_statements_downloaded", 0)))
    results_table.add_row("📄 Statements Processed", str(result.get("total_statements_processed", 0)))
    results_table.add_row("⏭️  Statements Skipped (Already Extracted)", str(result.get("total_statements_skipped", 0)))
    results_table.add_row("☁️  Statements Uploaded to Cloud", str(result.get("total_statements_uploaded", 0)))
    results_table.add_row("💰 Splitwise Transactions", str(result.get("splitwise_transaction_count", 0)))
    results_table.add_row("🔢 Total Combined Transactions", str(result.get("combined_transaction_count", 0)))
    results_table.add_row("✅ Inserted to Database", str(result.get("database_inserted_count", 0)))
    results_table.add_row("⏭️  Skipped (Duplicates)", str(result.get("database_skipped_count", 0)))
    
    console.print(results_table)
    
    # Display errors if any
    errors = result.get("errors", [])
    if errors:
        console.print()
        error_table = Table(title="⚠️  Errors Encountered", show_header=False)
        error_table.add_column("Error", style="red")
        for error in errors:
            error_table.add_row(error)
        console.print(error_table)


@cli.command()
@click.option(
    "--detailed",
    is_flag=True,
    help="Show detailed information about each account",
)
def status(detailed: bool):
    """
    📊 Show current system status
    
    Display information about accounts, last processing date,
    transaction counts, and system configuration.
    
    Examples:
    
      # Basic status
      cli.py status
      
      # Detailed status with account information
      cli.py status --detailed
    """
    try:
        asyncio.run(_show_status(detailed))
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        sys.exit(1)


async def _show_status(detailed: bool):
    """Internal function to show system status"""
    console.print(Panel.fit("📊 [bold cyan]Expense Tracker Status[/bold cyan]", border_style="cyan"))
    console.print()
    
    # Get accounts
    accounts = await AccountOperations.get_all_accounts()
    
    # Get transaction stats (simplified - you may want to add methods to get these)
    # For now, we'll show account information
    
    # Accounts table
    accounts_table = Table(title="🏦 Configured Accounts", show_header=True)
    accounts_table.add_column("Account Name", style="cyan")
    accounts_table.add_column("Type", style="yellow")
    accounts_table.add_column("Statement Sender", style="green")
    
    for account in accounts:
        accounts_table.add_row(
            account.get("nickname", "N/A"),
            account.get("account_type", "N/A"),
            account.get("statement_sender_email", "N/A"),
        )
    
    console.print(accounts_table)
    
    if detailed:
        console.print()
        console.print("[cyan]💡 Use 'cli.py process --help' for processing options[/cyan]")


@cli.command()
@click.option(
    "--account",
    type=str,
    required=True,
    help="Account nickname or sender email to extract",
)
@click.option(
    "--start-date",
    type=str,
    required=True,
    help="Start date in YYYY/MM/DD format",
)
@click.option(
    "--end-date",
    type=str,
    required=True,
    help="End date in YYYY/MM/DD format",
)
def extract(account: str, start_date: str, end_date: str):
    """
    📄 Extract a specific account's statements
    
    Extract and process statements for a single account only.
    Useful for targeted extraction or re-extraction.
    
    Examples:
    
      # Extract Axis Atlas statements
      cli.py extract --account "Axis Atlas" --start-date 2025/08/01 --end-date 2025/10/10
      
      # Extract using sender email
      cli.py extract --account "cc.statements@axisbank.com" --start-date 2025/08/01 --end-date 2025/10/10
    """
    console.print(f"[cyan]📄 Extracting statements for: {account}[/cyan]")
    console.print(f"[cyan]📅 Date range: {start_date} → {end_date}[/cyan]")
    console.print()
    
    try:
        # Run workflow with specific account filter
        # Note: This would require implementing account filtering in the workflow
        console.print("[yellow]⚠️  Account-specific extraction not yet implemented[/yellow]")
        console.print("[yellow]💡 Use: cli.py process --start-date {start_date} --end-date {end_date}[/yellow]")
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--confirm",
    is_flag=True,
    help="Skip confirmation prompt",
)
def clear(confirm: bool):
    """
    🗑️  Clear all transactions from database
    
    ⚠️  WARNING: This will delete ALL transactions from your database!
    Use this command with caution.
    
    Examples:
    
      # Clear with confirmation
      cli.py clear
      
      # Clear without prompt (dangerous!)
      cli.py clear --confirm
    """
    if not confirm:
        console.print("[bold red]⚠️  WARNING: This will DELETE ALL transactions from the database![/bold red]")
        console.print()
        if not click.confirm("Are you absolutely sure you want to continue?", default=False):
            console.print("[yellow]Operation cancelled.[/yellow]")
            sys.exit(0)
    
    try:
        asyncio.run(_clear_transactions())
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        sys.exit(1)


async def _clear_transactions():
    """Internal function to clear transactions"""
    with console.status("[bold green]Clearing transactions...[/bold green]"):
        result = await TransactionOperations.clear_all_transactions()
    
    if result.get("success"):
        console.print(f"[green]✅ Cleared {result.get('deleted_count', 0)} transactions[/green]")
    else:
        console.print(f"[red]❌ Failed to clear transactions: {result.get('error')}[/red]")
        sys.exit(1)


@cli.command()
def check():
    """
    🔍 Check if resume is possible
    
    Check if there are existing CSVs in cloud storage that allow
    resuming the workflow from the standardization step.
    
    Examples:
    
      cli.py check
    """
    try:
        asyncio.run(_check_resume())
    except Exception as e:
        console.print(f"[red]❌ Error: {e}[/red]")
        sys.exit(1)


async def _check_resume():
    """Internal function to check resume possibility"""
    with console.status("[bold green]Checking cloud storage...[/bold green]"):
        can_resume = await can_resume_workflow()
    
    if can_resume:
        console.print("[green]✅ Resume is possible - CSV files found in cloud storage[/green]")
        console.print("[cyan]💡 You can run: cli.py process --resume[/cyan]")
    else:
        console.print("[yellow]⚠️  Resume is not possible - no CSV files found[/yellow]")
        console.print("[cyan]💡 You need to run: cli.py process --full[/cyan]")


@cli.command()
@click.option('--start-date', type=str, help='Start date in YYYY/MM/DD format')
@click.option('--end-date', type=str, help='End date in YYYY/MM/DD format')
@click.option('--last-n-days', type=int, help='Process last N days')
@click.option(
    '--clear-before',
    is_flag=True,
    help='Clear existing Splitwise transactions before inserting (dangerous!)'
)
@click.option(
    '--yes',
    is_flag=True,
    help='Skip confirmation prompts'
)
def splitwise(start_date: str, end_date: str, last_n_days: int, clear_before: bool, yes: bool):
    """
    📊 Update Splitwise transactions only
    
    Fetch and update Splitwise transactions without processing bank statements.
    By default, performs duplicate detection and only adds new transactions.
    
    Examples:
    
      # Update last 30 days of Splitwise data
      main.py splitwise --last-n-days 30
      
      # Update specific date range
      main.py splitwise --start-date 2025/08/10 --end-date 2025/10/10
      
      # Clear and reload (dangerous!)
      main.py splitwise --start-date 2025/08/10 --end-date 2025/10/10 --clear-before --yes
    """
    asyncio.run(_update_splitwise(start_date, end_date, last_n_days, clear_before, yes))


async def _update_splitwise(
    start_date_str: Optional[str],
    end_date_str: Optional[str], 
    last_n_days: Optional[int],
    clear_before: bool,
    yes: bool = False
):
    """Update Splitwise transactions."""
    from datetime import datetime, timedelta
    from src.services.splitwise_processor.service import SplitwiseService
    from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
    from src.services.database_manager.operations import TransactionOperations
    import pandas as pd
    
    console.print("[bold cyan]📊 Updating Splitwise Transactions[/bold cyan]")
    console.print()
    
    # Calculate date range
    if last_n_days:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=last_n_days)
        console.print(f"[cyan]📅 Using last {last_n_days} days[/cyan]")
    elif start_date_str and end_date_str:
        try:
            start_date = datetime.strptime(start_date_str, "%Y/%m/%d")
            end_date = datetime.strptime(end_date_str, "%Y/%m/%d")
        except ValueError as e:
            console.print(f"[red]❌ Invalid date format: {e}[/red]")
            console.print("[yellow]Expected format: YYYY/MM/DD[/yellow]")
            return
    else:
        # Default: previous month
        today = datetime.now()
        first_of_this_month = today.replace(day=1)
        end_date = first_of_this_month - timedelta(days=1)  # Last day of previous month
        start_date = end_date.replace(day=1)  # First day of previous month
        console.print("[cyan]📅 Using default: previous month[/cyan]")
    
    console.print(f"[cyan]📆 Date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}[/cyan]")
    console.print()
    
    if clear_before and not yes:
        console.print("[yellow]⚠️  Warning: This will clear existing Splitwise transactions![/yellow]")
        if not click.confirm("Are you sure you want to continue?"):
            console.print("[yellow]Cancelled by user[/yellow]")
            return
        console.print()
    
    try:
        # Step 1: Fetch Splitwise data
        console.print("[bold]Step 1/3:[/bold] Fetching Splitwise transactions...")
        splitwise_service = SplitwiseService()
        
        splitwise_transactions = splitwise_service.get_transactions_for_past_month(
            exclude_created_by_me=True,
            include_only_my_transactions=True,
            start_date=start_date,
            end_date=end_date
        )
        
        if not splitwise_transactions:
            console.print("[yellow]⚠️  No Splitwise transactions found for the date range[/yellow]")
            return
        
        console.print(f"[green]✓ Found {len(splitwise_transactions)} Splitwise transactions[/green]")
        console.print()
        
        # Step 2: Convert to DataFrame and standardize
        console.print("[bold]Step 2/3:[/bold] Standardizing transaction data...")
        
        splitwise_data = []
        for transaction in splitwise_transactions:
            # Extract split_breakdown from raw_data if it exists
            split_breakdown = None
            if transaction.raw_data and isinstance(transaction.raw_data, dict):
                split_breakdown = transaction.raw_data.get('split_breakdown')
            
            splitwise_data.append({
                'date': transaction.date.strftime('%Y-%m-%d'),
                'description': transaction.description,
                'amount': transaction.amount,  # Total amount
                'my_share': transaction.my_share,  # User's share
                'category': transaction.category,
                'group_name': transaction.group_name,
                'source': transaction.source,
                'created_by': transaction.created_by,
                'total_participants': transaction.total_participants,
                'participants': ', '.join(transaction.participants),
                'paid_by': transaction.paid_by,
                'split_breakdown': split_breakdown,  # Split breakdown data
                'is_shared': True,
                'is_payment': transaction.is_payment,
                'external_id': transaction.splitwise_id,
                'raw_data': transaction.raw_data
            })
        
        df = pd.DataFrame(splitwise_data)
        
        # Standardize the data
        standardizer = TransactionStandardizer()
        standardized_df = standardizer.standardize_splitwise_data(df)
        standardized_data = standardized_df.to_dict('records')
        
        console.print(f"[green]✓ Standardized {len(standardized_data)} transactions[/green]")
        console.print()
        
        # Step 3: Insert into database
        console.print("[bold]Step 3/3:[/bold] Inserting into database...")
        
        if clear_before:
            # Clear only Splitwise transactions
            from sqlalchemy import text
            from src.services.database_manager.connection import get_session_factory
            
            session_factory = get_session_factory()
            session = session_factory()
            try:
                result = await session.execute(
                    text("""
                        UPDATE transactions
                        SET is_deleted = true,
                            deleted_at = COALESCE(deleted_at, NOW()),
                            updated_at = NOW()
                        WHERE account = :account
                          AND is_deleted = false
                    """),
                    {"account": "Splitwise"}
                )
                await session.commit()
                deleted_count = result.rowcount
                console.print(f"[yellow]🗑️  Cleared {deleted_count} existing Splitwise transactions[/yellow]")
            except Exception as e:
                await session.rollback()
                console.print(f"[red]❌ Failed to clear Splitwise transactions: {e}[/red]")
            finally:
                await session.close()
        
        # Insert transactions with upsert for Splitwise (updates existing, inserts new)
        db_result = await TransactionOperations.bulk_insert_transactions(
            standardized_data,
            check_duplicates=not clear_before,  # Skip duplicate check if we just cleared
            upsert_splitwise=True  # Update existing Splitwise transactions with latest data
        )
        
        if db_result.get("success"):
            console.print()
            console.print("[bold green]✅ Splitwise update completed![/bold green]")
            console.print()
            
            # Show summary
            table = Table(title="Update Summary", show_header=True, header_style="bold cyan")
            table.add_column("Metric", style="cyan")
            table.add_column("Value", style="green", justify="right")
            
            table.add_row("Fetched", str(len(splitwise_transactions)))
            table.add_row("Updated", str(db_result.get("updated_count", 0)))
            table.add_row("Inserted", str(db_result.get("inserted_count", 0)))
            table.add_row("Skipped", str(db_result.get("skipped_count", 0)))
            table.add_row("Failed", str(db_result.get("error_count", 0)))
            
            console.print(table)
            
            # Show errors if any
            if db_result.get("errors"):
                console.print()
                console.print("[bold red]⚠️  Errors encountered:[/bold red]")
                for error in db_result.get("errors", [])[:10]:  # Show first 10 errors
                    console.print(f"[red]  • {error}[/red]")
                if len(db_result.get("errors", [])) > 10:
                    console.print(f"[yellow]  ... and {len(db_result.get('errors', [])) - 10} more errors[/yellow]")
        else:
            console.print(f"[red]❌ Database insertion failed: {db_result.get('error', 'Unknown error')}[/red]")
            
            # Show errors if any
            if db_result.get("errors"):
                console.print()
                console.print("[bold red]Errors:[/bold red]")
                for error in db_result.get("errors", []):
                    console.print(f"[red]  • {error}[/red]")
            
    except Exception as e:
        console.print(f"[red]❌ Error updating Splitwise: {e}[/red]")
        import traceback
        console.print(f"[red]{traceback.format_exc()}[/red]")


@cli.command()
@click.option(
    "--dry-run",
    is_flag=True,
    default=True,
    help="Dry run mode: Show what would be deleted without actually deleting (default: True)",
)
@click.option(
    "--execute",
    is_flag=True,
    help="Actually delete duplicates (overrides --dry-run)",
)
@click.option(
    "--yes",
    is_flag=True,
    help="Skip confirmation prompt",
)
def remove_duplicate_splitwise(dry_run: bool, execute: bool, yes: bool):
    """
    🧹 Remove duplicate Splitwise transactions
    
    Finds and removes duplicate Splitwise transactions based on splitwise_id.
    Keeps the oldest transaction for each splitwise_id and soft-deletes the rest.
    
    By default, runs in dry-run mode to show what would be deleted.
    Use --execute to actually perform the deletion.
    """
    console.print()
    console.print(Panel.fit(
        "[bold cyan]🧹 Remove Duplicate Splitwise Transactions[/bold cyan]",
        border_style="cyan"
    ))
    console.print()
    
    # Determine if we're actually executing or just dry-running
    actually_execute = execute
    
    if actually_execute and not yes:
        console.print("[yellow]⚠️  Warning: This will permanently soft-delete duplicate transactions![/yellow]")
        if not click.confirm("Are you sure you want to continue?"):
            console.print("[yellow]Cancelled by user[/yellow]")
            return
        console.print()
    
    try:
        console.print("[bold]Analyzing Splitwise transactions...[/bold]")
        
        result = asyncio.run(
            TransactionOperations.remove_duplicate_splitwise_transactions(
                dry_run=not actually_execute
            )
        )
        
        if not result.get("success"):
            console.print(f"[red]❌ Error: {result.get('errors', ['Unknown error'])}[/red]")
            return
        
        # Display results
        console.print()
        console.print("[bold]📊 Results:[/bold]")
        console.print(f"  Total Splitwise transactions: {result.get('total_splitwise_transactions', 0)}")
        console.print(f"  Duplicate groups found: {result.get('duplicate_groups', 0)}")
        console.print(f"  Duplicates found: {result.get('duplicates_found', 0)}")
        
        if actually_execute:
            console.print(f"  [green]✅ Duplicates removed: {result.get('duplicates_removed', 0)}[/green]")
        else:
            console.print(f"  [yellow]🔍 Would remove: {result.get('duplicates_removed', 0)}[/yellow]")
            console.print()
            console.print("[yellow]💡 This was a dry run. Use --execute to actually remove duplicates.[/yellow]")
        
        console.print()
        
    except Exception as e:
        console.print(f"[red]❌ Error removing duplicates: {e}[/red]")
        logger.error(f"Error removing duplicate Splitwise transactions: {e}", exc_info=True)
        raise click.Abort()


@cli.command()
@click.option(
    "--host",
    default="0.0.0.0",
    help="Host to bind the server to (default: 0.0.0.0)",
)
@click.option(
    "--port",
    default=8000,
    type=int,
    help="Port to bind the server to (default: 8000)",
)
@click.option(
    "--reload",
    is_flag=True,
    default=True,
    help="Enable auto-reload on code changes",
)
def serve(host: str, port: int, reload: bool):
    """
    🚀 Start the FastAPI server
    
    Start the expense tracker API server for frontend integration.
    
    Examples:
    
      # Start with default settings
      main.py serve
      
      # Start on specific port
      main.py serve --port 3000
      
      # Start without auto-reload (production mode)
      main.py serve --no-reload
    """
    import uvicorn
    from src.utils.settings import get_settings
    
    settings = get_settings()
    
    console.print(f"[bold green]🚀 Starting {settings.APP_NAME} server...[/bold green]")
    console.print(f"[cyan]📡 Host: {host}[/cyan]")
    console.print(f"[cyan]🔌 Port: {port}[/cyan]")
    console.print(f"[cyan]🔄 Auto-reload: {'Enabled' if reload else 'Disabled'}[/cyan]")
    console.print()
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info"
    )


if __name__ == "__main__":
    cli()

