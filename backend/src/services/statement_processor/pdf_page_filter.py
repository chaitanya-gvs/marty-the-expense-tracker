"""
PDF Page Filter Service

Pre-filters PDF pages before sending to Landing AI, keeping only pages that contain
transaction data. Uses two complementary signals per page:

  1. Required keywords  — bank-specific table headings; one match = definite keep.
  2. Table density      — PyMuPDF find_tables(); a table with enough columns/rows = keep.
  3. Supporting keywords — generic transaction terms used only when neither of the above
                           matched, as a last-resort fallback.

Each bank account has its own PageFilterConfig defined in statement_extraction.py.
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import fitz  # PyMuPDF

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor.schemas import PAGE_FILTER_CONFIGS, PageFilterConfig
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class PageAnalysis:
    """Result of scoring a single PDF page."""
    page_num: int                        # 0-indexed
    kept: bool
    matched_column_headers: List[str] = field(default_factory=list)
    matched_required: List[str] = field(default_factory=list)
    has_transaction_table: bool = False
    max_table_cols: int = 0
    max_table_rows: int = 0
    matched_supporting: List[str] = field(default_factory=list)

    @property
    def display_num(self) -> int:
        """1-indexed page number for human-readable output."""
        return self.page_num + 1


class PDFPageFilter:
    """
    Filters PDF pages to include only those containing transaction data.

    Strategy is controlled by the PAGE_FILTER_STRATEGY environment variable:
      "pymupdf"  — keyword/table detection via PyMuPDF (default fallback)
      "classify" — LandingAI ADE classify() API; falls back to pymupdf on failure
      "compare"  — runs both, logs the comparison, uses pymupdf result (default)

    Main entry points:
      analyze_pages()            — dry-run, returns PageAnalysis per page
      filter_transaction_pages() — returns (filtered_pdf_path, kept_page_indices)
    """

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _detect_transaction_table(
        self, page: fitz.Page, config: PageFilterConfig
    ) -> Tuple[bool, int, int]:
        """PyMuPDF structural table detection. Returns (has_table, max_cols, max_rows)."""
        try:
            table_finder = page.find_tables()
            max_cols, max_rows = 0, 0
            for table in table_finder.tables:
                cols = len(table.header.names)
                rows = max(0, len(table.rows) - 1)
                if cols > max_cols:
                    max_cols = cols
                if rows > max_rows:
                    max_rows = rows
            qualifies = max_cols >= config.min_table_cols and max_rows >= config.min_table_rows
            return qualifies, max_cols, max_rows
        except Exception:
            logger.debug("find_tables() failed — skipping table detection", exc_info=True)
            return False, 0, 0

    def _score_page(self, page: fitz.Page, config: PageFilterConfig) -> PageAnalysis:
        """Score a single page using column headers and required keywords."""
        text = page.get_text().lower()
        matched_col_headers = [h for h in config.column_headers if h in text]
        col_header_hit = len(matched_col_headers) >= config.min_column_header_matches
        matched_required = [kw for kw in config.required_keywords if kw in text]
        has_table, max_cols, max_rows = self._detect_transaction_table(page, config)
        matched_supporting = [kw for kw in config.supporting_keywords if kw in text]
        kept = col_header_hit or bool(matched_required)
        return PageAnalysis(
            page_num=0,
            kept=kept,
            matched_column_headers=matched_col_headers,
            matched_required=matched_required,
            has_transaction_table=has_table,
            max_table_cols=max_cols,
            max_table_rows=max_rows,
            matched_supporting=matched_supporting,
        )

    def _write_filtered_pdf(self, source_path: Path, kept_indices: List[int]) -> Path:
        """Write a new PDF containing only the pages at kept_indices."""
        filtered_path = source_path.with_name(f"{source_path.stem}_filtered.pdf")
        src = fitz.open(str(source_path))
        dst = fitz.open()
        try:
            for idx in kept_indices:
                dst.insert_pdf(src, from_page=idx, to_page=idx)
            dst.save(str(filtered_path))
        finally:
            src.close()
            dst.close()
        return filtered_path

    # ------------------------------------------------------------------ #
    # Public dry-run                                                       #
    # ------------------------------------------------------------------ #

    def analyze_pages(self, pdf_path: Path, schema_key: str) -> List[PageAnalysis]:
        """Dry-run: score every page and return analysis without writing any file."""
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(f"No PageFilterConfig for '{schema_key}' — skipping analysis")
            return []
        try:
            doc = fitz.open(str(pdf_path))
        except Exception:
            logger.error(f"Could not open PDF: {pdf_path}", exc_info=True)
            return []
        analyses: List[PageAnalysis] = []
        try:
            for i in range(len(doc)):
                page = doc.load_page(i)
                analysis = self._score_page(page, config)
                analysis.page_num = i
                analyses.append(analysis)
        finally:
            doc.close()
        kept_count = sum(1 for a in analyses if a.kept)
        logger.info(f"PyMuPDF page analysis '{schema_key}' ({pdf_path.name}): {kept_count}/{len(analyses)} kept")
        return analyses

    # ------------------------------------------------------------------ #
    # Strategy implementations                                            #
    # ------------------------------------------------------------------ #

    def _filter_with_pymupdf(self, pdf_path: Path, schema_key: str) -> Tuple[Path, List[int]]:
        """PyMuPDF keyword/table strategy — the original implementation."""
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(f"No PageFilterConfig for '{schema_key}' — using full PDF")
            return pdf_path, []
        try:
            analyses = self.analyze_pages(pdf_path, schema_key)
            kept = [a.page_num for a in analyses if a.kept]
            if not kept:
                logger.warning(f"PyMuPDF matched 0 pages for '{schema_key}' — using full PDF")
                return pdf_path, []
            filtered_path = self._write_filtered_pdf(pdf_path, kept)
            logger.info(f"PyMuPDF: kept {len(kept)}/{len(analyses)} pages for '{schema_key}'")
            return filtered_path, kept
        except Exception:
            logger.error(f"PyMuPDF filter error for '{schema_key}' — using full PDF", exc_info=True)
            return pdf_path, []

    def _filter_with_classify(
        self, pdf_path: Path, schema_key: str, ade_client
    ) -> Tuple[Path, List[int]]:
        """LandingAI classify() strategy. Falls back to pymupdf on any failure."""
        try:
            response = ade_client.classify(
                document=pdf_path,
                classes=json.dumps([
                    {"class": "transaction_page", "description": "Page containing bank transaction records"},
                    {"class": "non_transaction_page", "description": "Page without transactions (cover, summary, footer)"},
                ]),
            )
            kept = [p.page for p in response.classification if p.class_ == "transaction_page"]
            if not kept:
                logger.warning(
                    f"classify() returned 0 transaction pages for '{schema_key}' — falling back to pymupdf"
                )
                return self._filter_with_pymupdf(pdf_path, schema_key)
            filtered_path = self._write_filtered_pdf(pdf_path, kept)
            logger.info(f"classify(): kept {len(kept)} pages for '{schema_key}'")
            return filtered_path, kept
        except Exception:
            logger.warning(
                f"classify() failed for '{schema_key}' — falling back to pymupdf", exc_info=True
            )
            return self._filter_with_pymupdf(pdf_path, schema_key)

    def _filter_with_compare(
        self, pdf_path: Path, schema_key: str, ade_client
    ) -> Tuple[Path, List[int]]:
        """Runs both strategies, logs comparison, uses pymupdf result."""
        pymupdf_path, pymupdf_kept = self._filter_with_pymupdf(pdf_path, schema_key)
        try:
            response = ade_client.classify(
                document=pdf_path,
                classes=json.dumps([
                    {"class": "transaction_page", "description": "Page containing bank transaction records"},
                    {"class": "non_transaction_page", "description": "Page without transactions (cover, summary, footer)"},
                ]),
            )
            classify_kept = [p.page for p in response.classification if p.class_ == "transaction_page"]
            logger.info(
                f"PAGE_FILTER compare '{schema_key}' ({pdf_path.name}): "
                f"pymupdf={pymupdf_kept} ({len(pymupdf_kept)} pages), "
                f"classify={classify_kept} ({len(classify_kept)} pages). "
                f"Using pymupdf result."
            )
        except Exception:
            logger.warning(
                f"classify() failed in compare mode for '{schema_key}' — only pymupdf result available",
                exc_info=True,
            )
        return pymupdf_path, pymupdf_kept

    # ------------------------------------------------------------------ #
    # Main entry point                                                     #
    # ------------------------------------------------------------------ #

    def filter_transaction_pages(
        self, pdf_path: Path, schema_key: str, ade_client=None
    ) -> Tuple[Path, List[int]]:
        """
        Return (filtered_pdf_path, kept_page_indices).

        Fallback: returns (pdf_path, []) unchanged when 0 pages match or any error.
        Strategy is selected via PAGE_FILTER_STRATEGY env var (default: "compare").
        """
        import os
        strategy = os.getenv("PAGE_FILTER_STRATEGY", "compare").lower()

        if strategy == "classify" and ade_client is not None:
            return self._filter_with_classify(pdf_path, schema_key, ade_client)
        elif strategy == "compare" and ade_client is not None:
            return self._filter_with_compare(pdf_path, schema_key, ade_client)
        else:
            # "pymupdf" strategy, or classify/compare requested but no client provided
            return self._filter_with_pymupdf(pdf_path, schema_key)
