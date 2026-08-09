"""
Static checks for scripts/compare_cashback_sbi_statement.py — confirms the
hardcoded statement password has been replaced with a DB lookup.

Run from backend/ with: poetry run pytest tests/test_compare_cashback_sbi_statement_script.py -v
"""
import ast
import re
from pathlib import Path

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "compare_cashback_sbi_statement.py"


def _source() -> str:
    return SCRIPT_PATH.read_text()


def test_no_long_digit_literal_anywhere():
    """No 8+ digit string literal (the shape of a bank statement password) anywhere
    in the file. This is a general guard against hardcoded secrets, rather than
    depending on any one specific literal value."""
    assert not re.search(r'["\']\d{8,}["\']', _source())


def test_no_bare_password_string_assignment():
    """No module-level assignment named PASSWORD to a string literal (the old pattern)."""
    tree = ast.parse(_source())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "PASSWORD":
                    assert not isinstance(node.value, ast.Constant), (
                        "PASSWORD must not be a hardcoded string literal"
                    )


def test_uses_password_manager():
    """The script must resolve the password via the shared BankPasswordManager,
    the same mechanism the production PDF-unlock path uses."""
    source = _source()
    assert "get_password_manager" in source
    assert "get_password_for_sender_async" in source
