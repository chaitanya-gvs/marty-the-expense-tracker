"""Tests for DataStandardizerHelper: verifies tuple return, valid_csv_keys tracking, and no premature db_inserted calls."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from src.services.orchestrator.data_standardizer_helper import (
    DataStandardizerHelper,
    _extract_search_pattern_from_csv_filename,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_helper(
    cloud_csv_files=None,
    standardized_df=None,
    db_inserted_keys=None,
    temp_dir=None,
    list_files_side_effect=None,
    splitwise_month="2026-05",
) -> DataStandardizerHelper:
    """Build a DataStandardizerHelper with minimal mocks."""
    if temp_dir is None:
        temp_dir = Path(tempfile.mkdtemp())

    cloud_storage = MagicMock()
    if list_files_side_effect is not None:
        cloud_storage.list_files.side_effect = list_files_side_effect
    else:
        cloud_storage.list_files.return_value = cloud_csv_files or []
    cloud_storage.download_file.return_value = {"success": True}

    transaction_standardizer = MagicMock()
    if standardized_df is not None:
        transaction_standardizer.process_with_dynamic_method = AsyncMock(return_value=standardized_df)
    else:
        transaction_standardizer.process_with_dynamic_method = AsyncMock(return_value=pd.DataFrame())

    async def _remove_dupes(rows):
        return rows

    async def _sort(rows):
        return rows

    helper = DataStandardizerHelper(
        transaction_standardizer=transaction_standardizer,
        cloud_storage=cloud_storage,
        temp_dir=temp_dir,
        calculate_splitwise_date_range=lambda: (
            MagicMock(strftime=lambda fmt: splitwise_month),
            MagicMock(),
        ),
        remove_duplicate_transactions=_remove_dupes,
        sort_transactions_by_date=_sort,
        emit=MagicMock(),
        log_extra=lambda: {},
    )
    return helper, db_inserted_keys


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_process_returns_tuple_on_empty_storage():
    """process() returns ([], set()) when no months are pending."""
    helper, _ = _make_helper(cloud_csv_files=[])
    with patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
        new=AsyncMock(return_value=[]),
    ), patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
        new=AsyncMock(return_value=set()),
    ):
        result = await helper.process()

    assert isinstance(result, tuple), "process() must return a tuple"
    data, keys = result
    assert data == []
    assert keys == set()


@pytest.mark.asyncio
async def test_process_returns_tuple_with_valid_rows():
    """process() returns (rows, {csv_stem}) for a CSV with valid rows."""
    df = pd.DataFrame([
        {"date": "2026-05-01", "description": "UPI payment", "amount": 100.0, "_skip_reason": None},
        {"date": "2026-05-02", "description": "Grocery", "amount": 200.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        # Create a fake CSV so pd.read_csv won't fail
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    assert isinstance(result, tuple)
    data, keys = result
    assert len(data) == 2
    assert "axis_savings_20260501" in keys


@pytest.mark.asyncio
async def test_process_separates_flagged_rows():
    """Flagged rows (with _skip_reason) are excluded from valid_csv_keys but included in combined data."""
    df = pd.DataFrame([
        {"date": "2026-05-01", "description": "Good tx", "amount": 100.0, "_skip_reason": None},
        {"date": None, "description": "Bad tx", "amount": 0.0, "_skip_reason": "null_date"},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    data, keys = result
    # combined = sorted_valid + flagged
    assert len(data) == 2
    # valid_csv_keys only added because there was at least one valid row
    assert "axis_savings_20260501" in keys


@pytest.mark.asyncio
async def test_process_no_valid_csv_keys_for_flagged_only():
    """If all rows are flagged, valid_csv_keys remains empty."""
    df = pd.DataFrame([
        {"date": None, "description": None, "amount": 0.0, "_skip_reason": "null_date"},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    data, keys = result
    assert len(data) == 1
    assert keys == set()  # no valid rows → no entry in valid_csv_keys


@pytest.mark.asyncio
async def test_process_does_not_call_update_status():
    """process() must NOT call StatementLogOperations.update_status (premature db_inserted removed)."""
    df = pd.DataFrame([
        {"date": "2026-05-01", "description": "Test", "amount": 50.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,50\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ) as _mock_get, patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.update_status",
            new=AsyncMock(),
        ) as mock_update:
            await helper.process()

    mock_update.assert_not_called()


@pytest.mark.asyncio
async def test_process_skips_already_inserted():
    """process() skips CSVs whose stem is already in db_inserted_keys."""
    df = pd.DataFrame([
        {"date": "2026-05-01", "description": "Test", "amount": 50.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,50\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value={"axis_savings_20260501"}),
        ):
            result = await helper.process(override=False)

    data, keys = result
    assert data == []
    assert keys == set()


@pytest.mark.asyncio
async def test_process_combines_multiple_pending_months():
    """CSVs from two different pending months are combined into one result."""
    df_may = pd.DataFrame([
        {"date": "2026-05-01", "description": "May tx", "amount": 100.0, "_skip_reason": None},
    ])
    df_june = pd.DataFrame([
        {"date": "2026-06-01", "description": "June tx", "amount": 200.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")
        (tmp / "axis_savings_20260601.csv").write_text("date,description,amount\n2026-06-01,test,200\n")

        def list_files_side_effect(prefix):
            if prefix == "2026-05/extracted_data/":
                return [{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}]
            if prefix == "2026-06/extracted_data/":
                return [{"name": "2026-06/extracted_data/axis_savings_20260601.csv"}]
            return []

        transaction_standardizer_returns = {
            "axis_savings_20260501.csv": df_may,
            "axis_savings_20260601.csv": df_june,
        }

        helper, _ = _make_helper(temp_dir=tmp, list_files_side_effect=list_files_side_effect)

        async def _dynamic_method(df, search_pattern, filename):
            return transaction_standardizer_returns[filename]

        helper.transaction_standardizer.process_with_dynamic_method = _dynamic_method

        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05", "2026-06"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    data, keys = result
    assert len(data) == 2
    assert keys == {"axis_savings_20260501", "axis_savings_20260601"}


@pytest.mark.asyncio
async def test_process_always_scans_splitwise_month_even_if_not_pending():
    """Splitwise always uploads to its own date-range month's GCS folder,
    independent of statement_processing_log. That month must be scanned even
    when it has no pending (or any) row in the DB."""
    df_statement = pd.DataFrame([
        {"date": "2026-06-01", "description": "June tx", "amount": 100.0, "_skip_reason": None},
    ])
    df_splitwise = pd.DataFrame([
        {"date": "2026-07-01", "description": "Splitwise tx", "amount": 50.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260601.csv").write_text("date,description,amount\n2026-06-01,test,100\n")
        (tmp / "splitwise.csv").write_text("date,description,amount\n2026-07-01,test,50\n")

        def list_files_side_effect(prefix):
            if prefix == "2026-06/extracted_data/":
                return [{"name": "2026-06/extracted_data/axis_savings_20260601.csv"}]
            if prefix == "2026-07/extracted_data/":
                return [{"name": "2026-07/extracted_data/splitwise.csv"}]
            return []

        helper, _ = _make_helper(
            temp_dir=tmp,
            list_files_side_effect=list_files_side_effect,
            splitwise_month="2026-07",
        )

        async def _dynamic_method(df, search_pattern, filename):
            return df_statement

        helper.transaction_standardizer.process_with_dynamic_method = _dynamic_method
        helper.transaction_standardizer.standardize_splitwise_data = MagicMock(return_value=df_splitwise)

        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-06"]),  # "2026-07" (Splitwise month) is NOT pending
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    data, keys = result
    dates = {row["date"] for row in data}
    assert "2026-06-01" in dates, "statement CSV from the pending month must be present"
    assert "2026-07-01" in dates, "Splitwise CSV from the non-pending Splitwise month must still be scanned"
    assert "axis_savings_20260601" in keys


@pytest.mark.asyncio
async def test_process_override_true_uses_get_all_statement_months():
    """override=True must rediscover already-db_inserted months via
    get_all_statement_months() (not just pending ones via
    get_pending_statement_months()), and must skip the db_inserted_keys
    filter query entirely."""
    helper, _ = _make_helper(cloud_csv_files=[])

    with patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_all_statement_months",
        new=AsyncMock(return_value=["2026-05", "2026-06"]),
    ) as mock_all_months, patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
        new=AsyncMock(return_value=["2026-06"]),  # would NOT include the already-db_inserted "2026-05"
    ), patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
        new=AsyncMock(),
    ) as mock_db_inserted:
        await helper.process(override=True)

    mock_all_months.assert_awaited_once()
    mock_db_inserted.assert_not_called()

    called_prefixes = {call.args[0] for call in helper.cloud_storage.list_files.call_args_list}
    assert "2026-05/extracted_data/" in called_prefixes
    assert "2026-06/extracted_data/" in called_prefixes


# ---------------------------------------------------------------------------
# Filename utility
# ---------------------------------------------------------------------------


def test_extract_search_pattern_strips_date_and_suffix():
    assert _extract_search_pattern_from_csv_filename("axis_atlas_20250902_extracted.csv") == "axis_atlas"
    assert _extract_search_pattern_from_csv_filename("amazon_pay_icici_20250903_extracted.csv") == "amazon_pay_icici"
    assert _extract_search_pattern_from_csv_filename("yes_bank_savings_20260402.csv") == "yes_bank_savings"
