"""
Tests for settlement calculation logic.

Key invariant: for payment transactions (direction == "credit"), the money always
flowed FROM the participant TO me — regardless of what paid_by says.
"""
import pytest
from src.apis.routes.settlement_routes import _calculate_settlements


def _tx(
    id: str,
    amount: float,
    direction: str,
    paid_by: str | None,
    participants: list[str],
    account: str = "HDFC Savings",
):
    """Build a minimal transaction dict matching what _get_settlement_transactions returns."""
    n = len(participants) + 1  # participants + me
    entries = [{"participant": p, "amount": amount / n} for p in participants]
    entries.append({"participant": "me", "amount": amount / n})
    return {
        "id": id,
        "date": "2024-01-01",
        "description": f"tx {id}",
        "amount": amount,
        "split_share_amount": amount / n,
        "split_breakdown": {"mode": "equal", "entries": entries, "paid_by": paid_by},
        "paid_by": paid_by,
        "account": account,
        "direction": direction,
        "transaction_type": "purchase",
        "group_name": None,
    }


class TestCreditPaymentReducesOwed:
    """A credit transaction from participant A should REDUCE what A owes me."""

    def test_credit_with_paid_by_participant_removes_from_settlements(self):
        """Happy path: A pays me 1000 (paid_by=A) → settles the 1000 debt → not in settlements."""
        initial_expense = _tx("e1", 2000, "debit", "me", ["Alice"])
        payment = _tx("p1", 1000, "credit", "Alice", ["Alice"])

        summary = _calculate_settlements([initial_expense, payment])

        # Alice owed me 1000 (half of 2000).  After 1000 credit, balance = 0 → filtered.
        alice = next((s for s in summary.settlements if s.participant == "Alice"), None)
        assert alice is None or abs(alice.net_balance) < 0.01, (
            f"Expected Alice to be settled, got net_balance={alice.net_balance if alice else 'n/a'}"
        )

    def test_credit_with_paid_by_me_reduces_owed_not_increases(self):
        """
        Bug scenario: A pays me 1000, but paid_by = "me" (UI default for all transactions).
        Before fix: amount_i_owe goes to -1000, net_balance increases from 1000 → 2000.
        After fix:  credit direction takes precedence → amount_owed_to_me decreases to 0.
        """
        initial_expense = _tx("e1", 2000, "debit", "me", ["Alice"])
        # paid_by = "me" — this is what the split editor sends when user doesn't change the default
        payment = _tx("p1", 1000, "credit", "me", ["Alice"])

        summary = _calculate_settlements([initial_expense, payment])

        alice = next((s for s in summary.settlements if s.participant == "Alice"), None)

        # Net balance must not have INCREASED — it should be 0 (settled) or below
        if alice is not None:
            assert alice.net_balance <= 0.01, (
                f"Bug: credit payment increased balance instead of reducing it. "
                f"net_balance={alice.net_balance} (expected ≤ 0)"
            )
            # amount_i_owe must never be negative
            assert alice.amount_i_owe >= -0.01, (
                f"amount_i_owe went negative: {alice.amount_i_owe}"
            )

    def test_credit_payment_never_produces_negative_amount_i_owe(self):
        """amount_i_owe should never go negative after a credit payment."""
        expense = _tx("e1", 1000, "debit", "me", ["Bob"])
        credit_payment = _tx("p1", 500, "credit", "me", ["Bob"])

        summary = _calculate_settlements([expense, credit_payment])

        bob = next((s for s in summary.settlements if s.participant == "Bob"), None)
        if bob is not None:
            assert bob.amount_i_owe >= -0.01, (
                f"amount_i_owe went negative: {bob.amount_i_owe}"
            )
            # Bob owed 500 from expense, paid 500 back → should owe 0 now
            assert bob.net_balance <= 0.01, (
                f"Expected net_balance ≤ 0 after full payment, got {bob.net_balance}"
            )
