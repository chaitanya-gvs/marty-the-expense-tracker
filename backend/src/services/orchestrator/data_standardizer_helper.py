"""Helper class for combining and standardizing all CSV data from GCS, extracted from StatementWorkflow."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Set, Tuple

import pandas as pd

from src.services.database_manager.operations import StatementLogOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


def _extract_search_pattern_from_csv_filename(csv_filename: str) -> str:
    """
    Extract search pattern from CSV filename for database lookup.

    Examples:
    - amazon_pay_icici_20250903_extracted.csv -> amazon_pay_icici
    - axis_atlas_20250902_extracted.csv -> axis_atlas
    - axis_bank_savings_20250906_extracted.csv -> axis_bank_savings
    """
    try:
        base_name = csv_filename.replace(".csv", "").replace("_extracted", "")
        parts = base_name.split("_")

        if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 8:
            search_parts = parts[:-1]
        else:
            search_parts = parts

        return "_".join(search_parts)

    except Exception:
        logger.error(f"Error extracting search pattern from {csv_filename}", exc_info=True)
        return csv_filename.replace(".csv", "").replace("_extracted", "")


class DataStandardizerHelper:
    """Downloads CSVs from GCS, standardizes each one, deduplicates, and sorts by date."""

    def __init__(
        self,
        transaction_standardizer: Any,
        cloud_storage: Any,
        temp_dir: Path,
        calculate_splitwise_date_range: Callable[[], Tuple[Any, Any]],
        remove_duplicate_transactions: Callable,
        sort_transactions_by_date: Callable,
        emit: Callable,
        log_extra: Callable,
    ) -> None:
        self.transaction_standardizer = transaction_standardizer
        self.cloud_storage = cloud_storage
        self.temp_dir = temp_dir
        self.calculate_splitwise_date_range = calculate_splitwise_date_range
        self.remove_duplicate_transactions = remove_duplicate_transactions
        self.sort_transactions_by_date = sort_transactions_by_date
        self.emit = emit
        self.log_extra = log_extra

    async def process(self, override: bool = False, job_id: str | None = None) -> Tuple[List[Dict[str, Any]], Set[str]]:
        """Standardize and combine all transaction data from cloud storage."""
        try:
            logger.info("Standardizing and combining all transaction data", extra=self.log_extra())

            # Get all CSV files from cloud storage for the previous month
            start_date, end_date = self.calculate_splitwise_date_range()
            previous_month = start_date.strftime("%Y-%m")

            # List all CSV files in the extracted_data directory for the month
            cloud_csv_files = self.cloud_storage.list_files(f"{previous_month}/extracted_data/")

            if not cloud_csv_files:
                logger.warning(
                    f"No CSV files found in cloud storage for {previous_month}",
                    extra=self.log_extra(),
                )
                self.emit(
                    "standardization_started", "standardization",
                    f"No CSV files found in GCS for {previous_month}",
                    level="warning",
                )
                return [], set()

            csv_files_only = [f for f in cloud_csv_files if f.get("name", "").endswith(".csv")]
            logger.info(f"Found {len(csv_files_only)} CSV files in cloud storage", extra=self.log_extra())
            self.emit(
                "standardization_started", "standardization",
                f"Standardizing {len(csv_files_only)} CSV file(s) from GCS ({previous_month})",
                data={"csv_count": len(csv_files_only), "month": previous_month},
            )

            # Fetch already-inserted normalized filenames to skip on reruns (unless override)
            db_inserted_keys: set = set()
            if not override:
                db_inserted_keys = await StatementLogOperations.get_db_inserted_filenames(previous_month)
                if db_inserted_keys:
                    logger.info(
                        f"Will skip {len(db_inserted_keys)} already db_inserted CSV(s) for {previous_month}",
                        extra=self.log_extra(),
                    )

            all_valid_data: List[Dict[str, Any]] = []
            all_flagged_data: List[Dict[str, Any]] = []
            valid_csv_keys: Set[str] = set()

            # Process each CSV file
            for cloud_file_info in csv_files_only:
                try:
                    cloud_file = cloud_file_info.get("name", "")
                    if not cloud_file.endswith(".csv"):
                        continue

                    csv_stem = Path(cloud_file).stem
                    csv_key = csv_stem
                    if db_inserted_keys and csv_key in db_inserted_keys:
                        logger.info(f"Skipping {csv_key} — already db_inserted", extra=self.log_extra())
                        self.emit(
                            "standardization_file_skipped", "standardization",
                            f"Skipping {Path(cloud_file).name} — already inserted",
                            data={"cloud_file": cloud_file, "reason": "already_db_inserted"},
                        )
                        continue

                    if "splitwise" in cloud_file.lower():
                        if Path(cloud_file).name != "splitwise.csv":
                            logger.info(f"Skipping legacy Splitwise file {Path(cloud_file).name}", extra=self.log_extra())
                            self.emit(
                                "standardization_file_skipped", "standardization",
                                f"Skipping {Path(cloud_file).name} — legacy Splitwise file",
                                data={"cloud_file": cloud_file, "reason": "legacy_splitwise"},
                            )
                            continue

                    logger.info(f"Processing cloud CSV: {cloud_file}", extra=self.log_extra())
                    self.emit(
                        "standardization_file_started", "standardization",
                        f"Standardizing {Path(cloud_file).name}",
                        data={"cloud_file": cloud_file},
                    )

                    temp_csv_path = self.temp_dir / Path(cloud_file).name
                    download_result = self.cloud_storage.download_file(cloud_file, str(temp_csv_path))

                    if not download_result.get("success"):
                        logger.error(f"Failed to download {cloud_file}: {download_result.get('error')}", exc_info=True, extra=self.log_extra())
                        self.emit(
                            "standardization_file_failed", "standardization",
                            f"Failed to download {Path(cloud_file).name} from GCS",
                            level="error",
                            data={"cloud_file": cloud_file, "error": download_result.get("error")},
                        )
                        continue

                    df = pd.read_csv(temp_csv_path)

                    if "splitwise" in cloud_file.lower():
                        standardized_df = self.transaction_standardizer.standardize_splitwise_data(df)
                    else:
                        search_pattern = _extract_search_pattern_from_csv_filename(Path(cloud_file).name)
                        standardized_df = await self.transaction_standardizer.process_with_dynamic_method(
                            df, search_pattern, Path(cloud_file).name
                        )

                    if not standardized_df.empty:
                        rows = standardized_df.to_dict("records")
                        valid_rows = [r for r in rows if not r.get("_skip_reason")]
                        flagged_rows = [r for r in rows if r.get("_skip_reason")]

                        all_valid_data.extend(valid_rows)
                        all_flagged_data.extend(flagged_rows)

                        if valid_rows and "splitwise" not in cloud_file.lower():
                            valid_csv_keys.add(csv_key)

                        logger.info(
                            f"Standardized {len(valid_rows)} valid + {len(flagged_rows)} flagged rows from {cloud_file}",
                            extra=self.log_extra(),
                        )
                        self.emit(
                            "standardization_file_complete", "standardization",
                            f"Standardized {len(valid_rows)} transaction(s) from {Path(cloud_file).name}"
                            + (f" ({len(flagged_rows)} flagged)" if flagged_rows else ""),
                            level="success",
                            data={"cloud_file": cloud_file, "row_count": len(valid_rows), "flagged_count": len(flagged_rows)},
                        )
                    else:
                        self.emit(
                            "standardization_file_complete", "standardization",
                            f"No transactions extracted from {Path(cloud_file).name}",
                            level="warning",
                            data={"cloud_file": cloud_file, "row_count": 0},
                        )

                except Exception as e:
                    logger.error(f"Error processing cloud CSV {cloud_file}", exc_info=True, extra=self.log_extra())
                    self.emit(
                        "standardization_file_failed", "standardization",
                        f"Error standardizing {Path(cloud_file).name}: {e}",
                        level="error",
                        data={"cloud_file": cloud_file, "error": str(e)},
                    )
                    continue

            if all_valid_data or all_flagged_data:
                deduplicated = await self.remove_duplicate_transactions(all_valid_data)
                logger.info(
                    f"Removed {len(all_valid_data) - len(deduplicated)} duplicate transactions",
                    extra=self.log_extra(),
                )
                sorted_valid = await self.sort_transactions_by_date(deduplicated)
                combined = sorted_valid + all_flagged_data  # flagged rows appended unsorted

                self.emit(
                    "standardization_complete", "standardization",
                    f"Standardization complete: {len(sorted_valid)} unique valid + {len(all_flagged_data)} flagged",
                    level="success",
                    data={
                        "total_before_dedup": len(all_valid_data),
                        "total_after_dedup": len(sorted_valid),
                        "duplicates_removed": len(all_valid_data) - len(deduplicated),
                        "flagged_count": len(all_flagged_data),
                    },
                )
                return combined, valid_csv_keys
            else:
                logger.warning("No standardized transaction data generated", extra=self.log_extra())
                self.emit(
                    "standardization_complete", "standardization",
                    "No transaction data generated from any CSV source",
                    level="warning",
                    data={"total_after_dedup": 0},
                )
                return [], set()

        except Exception as e:
            logger.error("Error standardizing and combining all data", exc_info=True, extra=self.log_extra())
            self.emit(
                "standardization_complete", "standardization",
                f"Standardization failed: {e}",
                level="error",
                data={"error": str(e)},
            )
            return [], set()
