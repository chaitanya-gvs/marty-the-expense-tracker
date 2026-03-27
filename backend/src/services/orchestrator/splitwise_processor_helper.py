"""Helper class for Splitwise data processing logic extracted from StatementWorkflow."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

import pandas as pd

from src.services.database_manager.operations import ParticipantOperations, TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


class SplitwiseProcessorHelper:
    """Fetches Splitwise transactions, writes a CSV, and uploads it to GCS."""

    def __init__(
        self,
        splitwise_service: Any,
        cloud_storage: Any,
        temp_dir: Path,
        calculate_splitwise_date_range: Callable[[], Tuple[datetime, datetime]],
        emit: Callable,
        log_extra: Callable,
    ) -> None:
        self.splitwise_service = splitwise_service
        self.cloud_storage = cloud_storage
        self.temp_dir = temp_dir
        self.calculate_splitwise_date_range = calculate_splitwise_date_range
        self.emit = emit
        self.log_extra = log_extra

    async def process(
        self,
        override: bool = False,
        continue_on_error: bool = True,
        custom_start_date: Optional[datetime] = None,
        custom_end_date: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Process Splitwise data and upload to cloud storage. Uses incremental sync when cursor exists."""
        try:
            logger.info("Processing Splitwise data", extra=self.log_extra())

            # Transaction date range: use custom or default
            if custom_start_date and custom_end_date:
                start_date = custom_start_date
                end_date = custom_end_date
            else:
                start_date, end_date = self.calculate_splitwise_date_range()

            # GCS folder: always previous month (align with standardization)
            cloud_month = self.calculate_splitwise_date_range()[0].strftime("%Y-%m")

            cursor = await TransactionOperations.get_splitwise_cursor()

            # Full sync: override, no cursor, or explicit custom dates
            use_full_sync = override or cursor is None or (
                custom_start_date is not None and custom_end_date is not None
            )

            if use_full_sync:
                self.emit(
                    "splitwise_sync_started", "splitwise",
                    f"Fetching Splitwise transactions ({start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')})",
                    data={"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "mode": "full"},
                )
                splitwise_transactions, deleted_expense_ids = self.splitwise_service.get_transactions_for_past_month(
                    exclude_created_by_me=True,
                    include_only_my_transactions=True,
                    start_date=start_date,
                    end_date=end_date,
                )
            else:
                self.emit(
                    "splitwise_sync_started", "splitwise",
                    f"Incremental sync: fetching transactions updated after {cursor.isoformat()}",
                    data={"cursor": cursor.isoformat(), "mode": "incremental"},
                )
                splitwise_transactions, deleted_expense_ids, _ = self.splitwise_service.get_transactions_updated_since(
                    updated_after=cursor,
                    updated_before=datetime.now(),
                    exclude_created_by_me=True,
                    include_only_my_transactions=True,
                )

            if deleted_expense_ids:
                soft_deleted = await TransactionOperations.soft_delete_splitwise_by_expense_ids(deleted_expense_ids)
                logger.info(
                    f"Splitwise API reported {len(deleted_expense_ids)} deleted expense(s); "
                    f"soft-deleted {soft_deleted} local row(s)",
                    extra=self.log_extra(),
                )

            # When 0 transactions to put in CSV: upload empty CSV to overwrite stale file, return success
            if not splitwise_transactions:
                if deleted_expense_ids:
                    logger.info(
                        "No active Splitwise transactions to sync (soft-delete(s) applied)",
                        extra=self.log_extra(),
                    )
                else:
                    logger.info("No Splitwise transactions to sync", extra=self.log_extra())
                csv_filename = "splitwise.csv"
                cloud_path = f"{cloud_month}/extracted_data/{csv_filename}"
                empty_df = pd.DataFrame(columns=[
                    "date", "description", "amount", "my_share", "category", "group_name",
                    "source", "created_by", "total_participants", "participants",
                    "paid_by", "split_breakdown", "is_payment", "external_id", "raw_data",
                ])
                temp_csv_path = self.temp_dir / csv_filename
                empty_df.to_csv(temp_csv_path, index=False)
                empty_mode = (
                    "full_empty" if use_full_sync else (
                        "incremental_deletes_only" if deleted_expense_ids else "incremental_empty"
                    )
                )
                upload_result = self.cloud_storage.upload_file(
                    local_file_path=str(temp_csv_path),
                    cloud_path=cloud_path,
                    content_type="text/csv",
                    metadata={
                        "source": "splitwise",
                        "transaction_count": 0,
                        "upload_timestamp": datetime.now().isoformat(),
                        "mode": empty_mode,
                        "deleted_expense_ids_count": str(len(deleted_expense_ids)),
                    },
                )
                if upload_result.get("success"):
                    self.emit(
                        "splitwise_sync_complete", "splitwise",
                        "No new Splitwise transactions (empty file uploaded)",
                        level="info",
                        data={
                            "transaction_count": 0,
                            "cloud_path": cloud_path,
                            "deleted_expense_ids_count": len(deleted_expense_ids),
                        },
                    )
                    return {
                        "success": True,
                        "cloud_path": cloud_path,
                        "transaction_count": 0,
                        "deleted_expense_ids_count": len(deleted_expense_ids),
                    }
                return None

            logger.info(f"Found {len(splitwise_transactions)} Splitwise transactions", extra=self.log_extra())

            # Convert to DataFrame
            splitwise_data = []
            for transaction in splitwise_transactions:
                # Extract split_breakdown from raw_data if it exists
                split_breakdown = None
                if transaction.raw_data and isinstance(transaction.raw_data, dict):
                    split_breakdown = transaction.raw_data.get("split_breakdown")

                # Serialize complex objects to JSON to avoid datetime serialization issues
                def serialize_for_csv(obj):
                    """Serialize object for CSV storage, handling datetime objects"""
                    if obj is None:
                        return None
                    if isinstance(obj, dict):
                        cleaned = {}
                        for k, v in obj.items():
                            if isinstance(v, datetime):
                                cleaned[k] = v.isoformat()
                            elif isinstance(v, dict):
                                cleaned[k] = serialize_for_csv(v)
                            elif isinstance(v, list):
                                cleaned[k] = [serialize_for_csv(item) for item in v]
                            else:
                                cleaned[k] = v
                        return cleaned
                    elif isinstance(obj, list):
                        return [serialize_for_csv(item) for item in obj]
                    elif isinstance(obj, datetime):
                        return obj.isoformat()
                    return obj

                # Serialize raw_data and split_breakdown to JSON strings
                raw_data_json = json.dumps(serialize_for_csv(transaction.raw_data)) if transaction.raw_data else None
                split_breakdown_json = json.dumps(serialize_for_csv(split_breakdown)) if split_breakdown else None

                splitwise_data.append({
                    "date": transaction.date.strftime("%Y-%m-%d"),
                    "description": transaction.description,
                    "amount": transaction.amount,  # Total amount, not my_share
                    "my_share": transaction.my_share,  # User's share
                    "category": transaction.category,
                    "group_name": transaction.group_name,
                    "source": transaction.source,
                    "created_by": transaction.created_by,
                    "total_participants": transaction.total_participants,
                    "participants": ", ".join(transaction.participants),
                    "paid_by": transaction.paid_by,  # Who paid for the transaction
                    "split_breakdown": split_breakdown_json,  # JSON-serialized split breakdown
                    "is_payment": transaction.is_payment,
                    "external_id": transaction.splitwise_id,
                    "raw_data": raw_data_json,  # JSON-serialized raw data
                })

            # Create DataFrame
            df = pd.DataFrame(splitwise_data)

            # Stable path: single file per month, overwritten each run
            csv_filename = "splitwise.csv"
            temp_csv_path = self.temp_dir / csv_filename
            df.to_csv(temp_csv_path, index=False)
            cloud_path = f"{cloud_month}/extracted_data/{csv_filename}"

            # Upload to cloud storage
            metadata = {
                "source": "splitwise",
                "transaction_count": len(splitwise_transactions),
                "upload_timestamp": datetime.now().isoformat(),
                "mode": "full" if use_full_sync else "incremental",
            }
            if use_full_sync:
                metadata["date_range_start"] = start_date.isoformat()
                metadata["date_range_end"] = end_date.isoformat()
            upload_result = self.cloud_storage.upload_file(
                local_file_path=str(temp_csv_path),
                cloud_path=cloud_path,
                content_type="text/csv",
                metadata=metadata,
            )

            if upload_result.get("success"):
                logger.info(f"Uploaded Splitwise data to cloud: {cloud_path}", extra=self.log_extra())
                self.emit(
                    "splitwise_sync_complete", "splitwise",
                    f"Fetched {len(splitwise_transactions)} Splitwise transactions and uploaded CSV to GCS",
                    level="success",
                    data={
                        "transaction_count": len(splitwise_transactions),
                        "cloud_path": cloud_path,
                    },
                )

                # Sync Splitwise friend balances into participants table
                try:
                    logger.info("Syncing Splitwise friend balances...", extra=self.log_extra())
                    friends_with_balances = self.splitwise_service.get_friends_with_balances()
                    synced_at = datetime.now(timezone.utc)
                    for friend in friends_with_balances:
                        if friend["id"] is not None:
                            await ParticipantOperations.update_splitwise_balance(
                                friend["id"], friend["net_balance"], synced_at
                            )
                    logger.info(
                        f"Synced balances for {len(friends_with_balances)} Splitwise friends",
                        extra=self.log_extra(),
                    )
                except Exception:
                    logger.error("Failed to sync Splitwise friend balances", exc_info=True, extra=self.log_extra())

                return {
                    "success": True,
                    "cloud_path": cloud_path,
                    "transaction_count": len(splitwise_transactions),
                    "csv_filename": csv_filename,
                    "temp_csv_path": str(temp_csv_path),
                }
            else:
                logger.error(
                    f"Failed to upload Splitwise data to cloud: {upload_result.get('error')}",
                    exc_info=True,
                    extra=self.log_extra(),
                )
                self.emit(
                    "splitwise_sync_failed", "splitwise",
                    f"Failed to upload Splitwise CSV to GCS: {upload_result.get('error')}",
                    level="error",
                    data={"error": upload_result.get("error")},
                )
                return None

        except Exception as e:
            error_msg = f"Error processing Splitwise data: {e}"
            logger.error(error_msg, exc_info=True, extra=self.log_extra())
            self.emit(
                "splitwise_sync_failed", "splitwise",
                f"Splitwise processing error: {e}",
                level="error",
                data={"error": str(e)},
            )
            if continue_on_error:
                logger.warning("Continuing workflow despite Splitwise error", extra=self.log_extra())
                return None
            else:
                raise Exception(error_msg)
