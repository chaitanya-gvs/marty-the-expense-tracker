"""Unit tests for PDFPageFilter strategy routing."""
import os
import fitz
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.services.statement_processor.pdf_page_filter import PDFPageFilter


class _MockPage:
    def __init__(self, page_num: int, category: str):
        self.page_num = page_num
        self.category = category


class _MockClassifyResponse:
    def __init__(self, pages):
        self.pages = pages


@pytest.fixture
def two_page_pdf(tmp_path):
    """Minimal 2-page PDF for testing."""
    p = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    doc.save(str(p))
    doc.close()
    return p


def _classify_client(kept_indices):
    """Return a mock ADE client whose classify() says the given pages are transaction pages."""
    client = MagicMock()
    all_pages = [
        _MockPage(i, "transaction_page" if i in kept_indices else "non_transaction_page")
        for i in range(2)
    ]
    client.classify.return_value = _MockClassifyResponse(all_pages)
    return client


def test_classify_strategy_uses_ade_client(two_page_pdf):
    client = _classify_client([0])
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    client.classify.assert_called_once()
    assert kept == [0]
    assert result_path != two_page_pdf  # filtered PDF written


def test_classify_strategy_falls_back_when_zero_pages_returned(two_page_pdf):
    client = _classify_client([])  # all non-transaction
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    # Fallback to pymupdf — no config for this test pdf, returns full pdf
    assert result_path == two_page_pdf


def test_classify_strategy_falls_back_on_exception(two_page_pdf):
    client = MagicMock()
    client.classify.side_effect = RuntimeError("API error")
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    assert result_path == two_page_pdf  # fallback to pymupdf → full pdf (no config)


def test_compare_strategy_calls_classify_but_uses_pymupdf_result(two_page_pdf):
    client = _classify_client([0])
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "compare"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    # classify was called for comparison logging
    client.classify.assert_called_once()
    # but pymupdf result is used (no config → full pdf)
    assert result_path == two_page_pdf


def test_pymupdf_strategy_never_calls_ade(two_page_pdf):
    client = MagicMock()
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "pymupdf"}):
        PDFPageFilter().filter_transaction_pages(two_page_pdf, "axis_atlas", ade_client=client)
    client.classify.assert_not_called()


def test_default_strategy_is_compare_when_no_env(two_page_pdf):
    """Default strategy is 'compare' — classify IS called even with no explicit env var."""
    client = _classify_client([0])
    env = {k: v for k, v in os.environ.items() if k != "PAGE_FILTER_STRATEGY"}
    with patch.dict(os.environ, env, clear=True):
        PDFPageFilter().filter_transaction_pages(two_page_pdf, "axis_atlas", ade_client=client)
    client.classify.assert_called_once()


def test_no_ade_client_falls_through_to_pymupdf_even_in_classify_mode(two_page_pdf):
    """If no client is provided but strategy=classify, falls back to pymupdf silently."""
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=None
        )
    assert result_path == two_page_pdf
