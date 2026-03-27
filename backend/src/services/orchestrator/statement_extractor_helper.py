"""Helper class for statement PDF extraction logic extracted from StatementWorkflow."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, Optional

from src.services.database_manager.operations import AccountOperations, StatementLogOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


class StatementExtractorHelper:
    """Handles PDF unlocking and data extraction for a single bank statement."""

    def __init__(
        self,
        document_extractor: Any,
        cloud_storage: Any,
        unlock_pdf_async: Callable,
        check_unlocked_pdf_in_gcs: Callable,
        check_statement_already_extracted: Callable,
        temp_dir: Path,
        emit: Callable,
        log_extra: Callable,
    ) -> None:
        self.document_extractor = document_extractor
        self.cloud_storage = cloud_storage
        self.unlock_pdf_async = unlock_pdf_async
        self.check_unlocked_pdf_in_gcs = check_unlocked_pdf_in_gcs
        self.check_statement_already_extracted = check_statement_already_extracted
        self.temp_dir = temp_dir
        self.emit = emit
        self.log_extra = log_extra

    async def process(
        self,
        statement_data: Dict[str, Any],
        job_id: Optional[str] = None,
        override: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Process statement for data extraction and unlock PDF.

        3-tier skip logic (applied when override=False):
          Tier 1 — CSV already in GCS?       → skip everything
          Tier 2 — Unlocked PDF already in GCS? → download it, skip local unlock, run extraction
          Tier 3 — Neither                    → full path: unlock locally, extract, upload both
        When override=True all tiers are bypassed and the full path is always taken.
        """
        try:
            temp_file_path = statement_data["temp_file_path"]
            normalized_filename = statement_data["normalized_filename"]
            sender_email = statement_data["sender_email"]
            log_key = statement_data.get("log_key") or normalized_filename.replace("_locked.pdf", "")

            # Get account nickname from database
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            if not account_nickname:
                logger.error(
                    f"No account nickname found for sender: {sender_email}",
                    exc_info=True,
                    extra=self.log_extra(),
                )
                self.emit(
                    "extraction_failed", "extraction",
                    f"No account nickname found for sender {sender_email}",
                    level="error",
                    data={"filename": normalized_filename, "sender": sender_email},
                )
                return None

            unlocked_path = None

            if not override:
                # Tier 1: CSV already extracted? Check DB first, fall back to GCS scan.
                already_extracted = await StatementLogOperations.check_already_extracted(log_key)
                if not already_extracted:
                    already_extracted = await self.check_statement_already_extracted(statement_data)
                if already_extracted:
                    logger.info(
                        f"Skipping extraction for {normalized_filename} - data already exists",
                        extra=self.log_extra(),
                    )
                    self.emit(
                        "extraction_skipped", "extraction",
                        f"Skipping {normalized_filename} — already extracted",
                        level="info",
                        data={"filename": normalized_filename, "account": account_nickname},
                    )
                    return {
                        "success": True,
                        "skipped": True,
                        "reason": "Data already extracted",
                        "extraction_schema": "skipped",
                        "csv_cloud_path": "already_exists",
                    }

                # Tier 2: Unlocked PDF already in GCS?
                unlocked_gcs_path = await self.check_unlocked_pdf_in_gcs(statement_data)
                if unlocked_gcs_path:
                    unlocked_filename = normalized_filename.replace("_locked.pdf", ".pdf")
                    temp_unlocked = self.temp_dir / unlocked_filename
                    download_result = self.cloud_storage.download_file(unlocked_gcs_path, str(temp_unlocked))
                    if download_result.get("success"):
                        unlocked_path = str(temp_unlocked)
                        logger.info(
                            f"Resuming extraction from existing GCS unlocked PDF: {unlocked_gcs_path}",
                            extra=self.log_extra(),
                        )
                        self.emit(
                            "pdf_resume_from_gcs", "pdf_unlock",
                            f"Using existing unlocked PDF from GCS for {normalized_filename}",
                            level="info",
                            data={
                                "filename": normalized_filename,
                                "account": account_nickname,
                                "gcs_path": unlocked_gcs_path,
                            },
                        )
                    else:
                        logger.warning(
                            f"Failed to download unlocked PDF from GCS ({unlocked_gcs_path}), falling back to local unlock",
                            extra=self.log_extra(),
                        )

            # Tier 3 (or override, or Tier 2 download failed): unlock locally
            if unlocked_path is None:
                self.emit(
                    "pdf_unlock_started", "pdf_unlock",
                    f"Unlocking {normalized_filename}",
                    data={"filename": normalized_filename, "account": account_nickname},
                )
                unlock_result = await self.unlock_pdf_async(
                    temp_file_path, sender_email, account_nickname=account_nickname
                )
                if not unlock_result.get("success"):
                    logger.warning(f"Could not unlock PDF: {normalized_filename}", extra=self.log_extra())
                    self.emit(
                        "pdf_unlock_failed", "pdf_unlock",
                        f"Could not unlock {normalized_filename}: {unlock_result.get('error', 'unknown error')}",
                        level="warning",
                        data={"filename": normalized_filename, "error": unlock_result.get("error")},
                    )
                    unlocked_path = temp_file_path
                else:
                    unlocked_path = unlock_result.get("unlocked_path")
                    logger.info(f"Successfully unlocked PDF: {normalized_filename}", extra=self.log_extra())
                    self.emit(
                        "pdf_unlocked", "pdf_unlock",
                        f"Unlocked {normalized_filename}",
                        level="success",
                        data={"filename": normalized_filename, "account": account_nickname},
                    )
                    try:
                        await StatementLogOperations.update_status(
                            log_key, "pdf_unlocked", job_id=job_id
                        )
                    except Exception:
                        logger.warning(
                            f"Failed to update log status to pdf_unlocked for {log_key}",
                            exc_info=True,
                            extra=self.log_extra(),
                        )

            # Extract data from unlocked PDF
            self.emit(
                "extraction_started", "extraction",
                f"Extracting transactions from {normalized_filename} ({account_nickname})",
                data={"filename": normalized_filename, "account": account_nickname},
            )
            extraction_result = self.document_extractor.extract_from_pdf(
                pdf_path=unlocked_path,
                account_nickname=account_nickname,
                save_results=True,
                email_date=statement_data.get("email_date"),
            )

            # Emit page-filter diagnostics so the UI can show which pages were sent for extraction
            kept_pages = extraction_result.get("kept_pages")
            if kept_pages is not None:
                fallback = extraction_result.get("page_filter_fallback", False)
                self.emit(
                    "pdf_pages_filtered", "pdf_page_filter",
                    f"Page filter: kept {len(kept_pages)} page(s) from {normalized_filename}"
                    + (" (fallback: all pages)" if fallback else f" — pages {[p + 1 for p in kept_pages]}"),
                    data={
                        "filename": normalized_filename,
                        "kept_pages": [p + 1 for p in kept_pages],
                        "kept_count": len(kept_pages),
                        "fallback": fallback,
                    },
                )

            # Clean up local CSV file after successful cloud upload
            if extraction_result.get("success") and extraction_result.get("csv_file"):
                try:
                    csv_file_path = Path(extraction_result["csv_file"])
                    if csv_file_path.exists():
                        csv_file_path.unlink()
                        logger.info(
                            f"Cleaned up local CSV file: {csv_file_path.name}",
                            extra=self.log_extra(),
                        )
                except Exception as e:
                    logger.warning(f"Failed to clean up local CSV file: {e}", extra=self.log_extra())

            if extraction_result.get("success"):
                logger.info(f"Extracted data from: {normalized_filename}", extra=self.log_extra())
                self.emit(
                    "extraction_complete", "extraction",
                    f"Extracted data from {normalized_filename}",
                    level="success",
                    data={
                        "filename": normalized_filename,
                        "account": account_nickname,
                        "csv_cloud_path": extraction_result.get("csv_cloud_path"),
                        "row_count": extraction_result.get("row_count"),
                    },
                )
                # Only advance the log status when an actual CSV was produced.
                # If no CSV was saved (e.g. parse failure), leave the status at
                # pdf_unlocked so the next run knows to retry extraction.
                csv_cloud_path = extraction_result.get("csv_cloud_path")
                saved_path = extraction_result.get("saved_path")
                if csv_cloud_path or saved_path:
                    try:
                        csv_status = "csv_stored" if csv_cloud_path else "csv_extracted"
                        await StatementLogOperations.update_status(
                            log_key,
                            csv_status,
                            csv_cloud_path=csv_cloud_path,
                            job_id=job_id,
                        )
                    except Exception:
                        logger.warning(
                            f"Failed to update log status to {csv_status} for {log_key}",
                            exc_info=True,
                            extra=self.log_extra(),
                        )
                else:
                    logger.warning(
                        f"Extraction succeeded but no CSV was produced for {normalized_filename} — log status NOT advanced",
                        extra=self.log_extra(),
                    )
                return extraction_result
            else:
                logger.error(
                    f"Failed to extract data from: {normalized_filename}",
                    exc_info=True,
                    extra=self.log_extra(),
                )
                self.emit(
                    "extraction_failed", "extraction",
                    f"Failed to extract data from {normalized_filename}",
                    level="error",
                    data={"filename": normalized_filename, "account": account_nickname},
                )
                try:
                    await StatementLogOperations.set_error(
                        log_key, f"Extraction failed: {extraction_result.get('error', 'unknown error')}"
                    )
                except Exception:
                    logger.warning(
                        f"Failed to set error in log for {log_key}",
                        exc_info=True,
                        extra=self.log_extra(),
                    )
                return None

        except Exception as e:
            logger.error("Error processing statement extraction", exc_info=True, extra=self.log_extra())
            self.emit(
                "extraction_failed", "extraction",
                f"Unexpected error extracting {statement_data.get('normalized_filename', 'unknown')}: {e}",
                level="error",
                data={"filename": statement_data.get("normalized_filename"), "error": str(e)},
            )
            _log_key = statement_data.get("log_key") or statement_data.get("normalized_filename", "").replace(
                "_locked.pdf", ""
            )
            if _log_key:
                try:
                    await StatementLogOperations.set_error(_log_key, str(e))
                except Exception:
                    logger.warning(
                        f"Failed to set error in log for {_log_key}",
                        exc_info=True,
                        extra=self.log_extra(),
                    )
            return None
