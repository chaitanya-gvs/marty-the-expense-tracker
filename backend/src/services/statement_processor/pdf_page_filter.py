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

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import fitz  # PyMuPDF

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))

from src.schemas.extraction import PAGE_FILTER_CONFIGS, PageFilterConfig
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

    Two main entry points:
    - analyze_pages()            — dry-run, no file written, returns PageAnalysis per page
    - filter_transaction_pages() — writes a filtered PDF and returns its path
    """

    def _detect_transaction_table(
        self, page: fitz.Page, config: PageFilterConfig
    ) -> Tuple[bool, int, int]:
        """
        Use PyMuPDF's find_tables() to detect whether the page has a table that looks
        like a transaction table (enough columns and rows).

        Returns (has_transaction_table, max_cols_found, max_rows_found).
        """
        try:
            table_finder = page.find_tables()
            max_cols = 0
            max_rows = 0
            for table in table_finder.tables:
                cols = len(table.header.names)
                # rows includes the header row; subtract 1 for data rows only
                rows = max(0, len(table.rows) - 1)
                if cols > max_cols:
                    max_cols = cols
                if rows > max_rows:
                    max_rows = rows
            qualifies = (
                max_cols >= config.min_table_cols
                and max_rows >= config.min_table_rows
            )
            return qualifies, max_cols, max_rows
        except Exception:
            logger.debug("find_tables() failed on a page — skipping table detection", exc_info=True)
            return False, 0, 0

    def _score_page(
        self, page: fitz.Page, config: PageFilterConfig
    ) -> PageAnalysis:
        """
        Score a single fitz.Page using all four signals in priority order.
        page_num is set to 0 and filled in by the caller.

        Priority:
          1. Column headers  — exact column names from the transaction table header row
          2. Required keywords — bank-specific section headings
          3. Table density   — structural detection via find_tables()
          4. Supporting keywords — generic fallback
        """
        text = page.get_text().lower()

        # Signal 1: exact column header matching (highest confidence)
        matched_col_headers = [h for h in config.column_headers if h in text]
        col_header_hit = len(matched_col_headers) >= config.min_column_header_matches

        # Signal 2: required keywords
        matched_required = [kw for kw in config.required_keywords if kw in text]

        # Signal 3: table density
        has_table, max_cols, max_rows = self._detect_transaction_table(page, config)

        # Signal 4: supporting keywords (fallback only)
        matched_supporting = [kw for kw in config.supporting_keywords if kw in text]

        # Strict decision: only column headers and required keywords count.
        # Table density and supporting keywords are recorded for diagnostics but do not
        # influence the keep/drop result.
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

    def analyze_pages(self, pdf_path: Path, schema_key: str) -> List[PageAnalysis]:
        """
        Dry-run: score every page and return analysis without writing any file.

        Returns an empty list (with a warning) if the schema_key has no config,
        or if the PDF cannot be opened.
        """
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(
                f"No PageFilterConfig found for schema_key '{schema_key}' — skipping analysis"
            )
            return []

        try:
            doc = fitz.open(str(pdf_path))
        except Exception:
            logger.error(f"Could not open PDF for page analysis: {pdf_path}", exc_info=True)
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
        logger.info(
            f"Page analysis for '{schema_key}' ({pdf_path.name}): "
            f"{kept_count}/{len(analyses)} pages would be kept"
        )
        return analyses

    def filter_transaction_pages(
        self, pdf_path: Path, schema_key: str
    ) -> Tuple[Path, List[int]]:
        """
        Build a filtered PDF containing only transaction pages.

        Returns:
            (filtered_pdf_path, kept_page_indices)  — filtered_pdf_path is a new temp
            file named '{stem}_filtered.pdf' in the same directory as pdf_path.

        Fallback: returns (pdf_path, []) unchanged when:
        - No config exists for schema_key
        - 0 pages matched (avoids sending an empty PDF to Landing AI)
        - Any exception occurs during filtering
        """
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(
                f"No PageFilterConfig for schema_key '{schema_key}' — using full PDF"
            )
            return pdf_path, []

        try:
            analyses = self.analyze_pages(pdf_path, schema_key)
            kept_indices = [a.page_num for a in analyses if a.kept]

            if not kept_indices:
                logger.warning(
                    f"Page filter matched 0 pages for '{schema_key}' ({pdf_path.name}) "
                    f"— falling back to full PDF"
                )
                return pdf_path, []

            # Write kept pages to a sibling temp file
            filtered_path = pdf_path.with_name(f"{pdf_path.stem}_filtered.pdf")
            src = fitz.open(str(pdf_path))
            dst = fitz.open()
            try:
                for idx in kept_indices:
                    dst.insert_pdf(src, from_page=idx, to_page=idx)
                dst.save(str(filtered_path))
            finally:
                src.close()
                dst.close()

            logger.info(
                f"Wrote filtered PDF ({len(kept_indices)} of {len(analyses)} pages): "
                f"{filtered_path.name}"
            )
            return filtered_path, kept_indices

        except Exception:
            logger.error(
                f"Error filtering pages for '{schema_key}' ({pdf_path.name}) "
                f"— falling back to full PDF",
                exc_info=True,
            )
            return pdf_path, []
