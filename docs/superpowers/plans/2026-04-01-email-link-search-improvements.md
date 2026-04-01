# Email Link Search Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix UPI/Uber auto-suggest in the email-links drawer so it finds Uber trip emails by date + keyword (instead of failing on decimal amount mismatches), and add a general-purpose `amount_tolerance` parameter to the backend email search to allow integer-range amount matching for other future use cases.

**Architecture:** Two coordinated changes: (1) backend gains an `amount_tolerance` query param that generates an OR range of integer amounts in the Gmail query; (2) frontend fixes UPI auto-search to rely on `custom_search_term: "uber"` + same-day date with no amount filter, which reliably surfaces Uber emails whose fare (e.g. ₹197.72) never exactly matches the bank-debit amount (e.g. ₹198). The `amount_tolerance` feature is wired end-to-end but not used for the Uber case (decimal fares are not addressable by integer range search).

**Tech Stack:** FastAPI + Pydantic v2 (backend), Next.js 15 + TypeScript (frontend), Gmail API full-text search (q parameter)

---

## Why the current UPI/Uber auto-search fails

| Step | What happens |
|------|-------------|
| Drawer opens, transaction is "SOME UPI TRANSFER" for ₹198 | `isUPI = true` |
| Auto-search fires with `custom_search_term: "uber"`, `include_amount_filter: true`, `also_search_amount_minus_one: true` | Gmail query: `after:… before:… uber ("198" OR "197")` |
| Uber email body contains "₹197.72" | `"197"` is quoted-exact in Gmail — it does NOT substring-match `"197.72"` |
| Zero results returned | Drawer shows empty suggestions |

**Fix:** Drop the amount filter for UPI transactions entirely. Use `custom_search_term: "uber"` + `date_offset_days: 0` (same calendar day). Uber sends exactly one trip-receipt email per trip; date + keyword is sufficient and precise.

---

## File Map

| File | Change |
|------|--------|
| `backend/src/apis/schemas/transactions.py:337-344` | Add `amount_tolerance: Optional[int]` to `EmailSearchFilters` |
| `backend/src/apis/routes/transaction_read_routes.py:872-882` | Add `amount_tolerance` query param; pass to both `search_emails_for_transaction` calls |
| `backend/src/services/email_ingestion/client.py:942-953` | Add `amount_tolerance` param; implement range OR query |
| `frontend/src/lib/types/index.ts:301-309` | Add `amount_tolerance?: number` to `EmailSearchFilters` interface |
| `frontend/src/lib/api/client.ts:577-608` | Pass `amount_tolerance` as query param |
| `frontend/src/components/transactions/email-links-drawer.tsx:101-145` | Fix UPI branch: `include_amount_filter: false`, `date_offset_days: 0`, remove `also_search_amount_minus_one` |

---

## Task 1: Backend schema — add `amount_tolerance`

**Files:**
- Modify: `backend/src/apis/schemas/transactions.py:337-344`

- [ ] **Step 1: Open the file and read the current `EmailSearchFilters` class**

Current state (lines 337–344):
```python
class EmailSearchFilters(BaseModel):
    """Filters for searching emails related to a transaction."""

    date_offset_days: int = Field(1, ge=0, le=30, description="Days to search before/after transaction date")
    include_amount_filter: bool = Field(True, description="Whether to filter by amount")
    start_date: Optional[str] = Field(None, description="Custom start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, description="Custom end date (YYYY-MM-DD)")
```

- [ ] **Step 2: Add `amount_tolerance` field**

Replace with:
```python
class EmailSearchFilters(BaseModel):
    """Filters for searching emails related to a transaction."""

    date_offset_days: int = Field(1, ge=0, le=30, description="Days to search before/after transaction date")
    include_amount_filter: bool = Field(True, description="Whether to filter by amount")
    start_date: Optional[str] = Field(None, description="Custom start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, description="Custom end date (YYYY-MM-DD)")
    amount_tolerance: Optional[int] = Field(None, ge=0, le=20, description="Search for amounts in range [amount - tolerance, amount] (integer steps)")
```

- [ ] **Step 3: Verify imports — `Optional` must be imported**

At the top of `transactions.py`, confirm `from typing import Optional` (or `Optional` imported via `pydantic`). If missing, add it.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/apis/schemas/transactions.py
git commit -m "feat(email-search): add amount_tolerance field to EmailSearchFilters schema"
```

---

## Task 2: Backend route — wire `amount_tolerance` into the handler

**Files:**
- Modify: `backend/src/apis/routes/transaction_read_routes.py:872-912`

- [ ] **Step 1: Add `amount_tolerance` query parameter to the route signature**

Current signature ends at line 882. Replace the route function signature:
```python
@router.get("/{transaction_id}/emails/search", response_model=ApiResponse)
async def search_transaction_emails(
    transaction_id: str,
    date_offset_days: int = Query(1, ge=0, le=30, description="Days to search before/after transaction date"),
    include_amount_filter: bool = Query(True, description="Whether to filter by amount"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
    custom_search_term: Optional[str] = Query(None, description="Custom search term (e.g., 'Uber', 'Ola', 'Swiggy')"),
    search_amount: Optional[float] = Query(None, description="Optional override for search amount (e.g., rounded amount for UPI)"),
    also_search_amount_minus_one: bool = Query(False, description="Also search for amount-1 (for UPI rounding scenarios)"),
    amount_tolerance: Optional[int] = Query(None, ge=0, le=20, description="Search for amounts in range [amount - tolerance, amount] (integer steps)"),
):
```

- [ ] **Step 2: Pass `amount_tolerance` to both `search_emails_for_transaction` calls**

There are two calls — primary account (line ~901) and secondary account (line ~924). Both currently end with:
```python
also_search_amount_minus_one=also_search_amount_minus_one,
```

Add one line after each:
```python
also_search_amount_minus_one=also_search_amount_minus_one,
amount_tolerance=amount_tolerance,
```

- [ ] **Step 3: Confirm `Optional` is imported at the top of the routes file**

Look for `from typing import Optional`. It should already be there given `Optional[str]` is already used.

- [ ] **Step 4: Commit**

```bash
git add src/apis/routes/transaction_read_routes.py
git commit -m "feat(email-search): add amount_tolerance query param to search route"
```

---

## Task 3: Backend service — implement integer range OR query

**Files:**
- Modify: `backend/src/services/email_ingestion/client.py:942-1027`

- [ ] **Step 1: Add `amount_tolerance` to `search_emails_for_transaction` method signature**

Current signature (lines 942–953):
```python
def search_emails_for_transaction(
    self,
    transaction_date: str,
    transaction_amount: float,
    date_offset_days: int = 1,
    include_amount_filter: bool = True,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    custom_search_term: Optional[str] = None,
    search_amount: Optional[float] = None,
    also_search_amount_minus_one: bool = False
) -> List[dict[str, Any]]:
```

Replace with:
```python
def search_emails_for_transaction(
    self,
    transaction_date: str,
    transaction_amount: float,
    date_offset_days: int = 1,
    include_amount_filter: bool = True,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    custom_search_term: Optional[str] = None,
    search_amount: Optional[float] = None,
    also_search_amount_minus_one: bool = False,
    amount_tolerance: Optional[int] = None,
) -> List[dict[str, Any]]:
```

- [ ] **Step 2: Also update the docstring Args section in the method**

Add after the `also_search_amount_minus_one` arg doc:
```
            amount_tolerance: If set, search for integer amounts in range
                [amount - tolerance, amount] instead of a single amount.
                E.g. tolerance=5 on ₹198 → searches "193 OR 194 OR 195 OR 196 OR 197 OR 198".
                Note: does not help for sub-rupee decimal fares (e.g. ₹197.72);
                use keyword search (custom_search_term) for those cases.
```

- [ ] **Step 3: Implement range query in the amount-filter block**

Current block (lines 1001–1024):
```python
# Add amount filter if enabled
if include_amount_filter:
    # Use search_amount if provided, otherwise use transaction_amount
    amount_to_search = search_amount if search_amount is not None else abs(transaction_amount)

    # Format amount for search (handle both decimal and integer amounts)
    if amount_to_search == int(amount_to_search):
        amount_str = str(int(amount_to_search))
    else:
        amount_str = str(amount_to_search)

    # Build amount search query
    if also_search_amount_minus_one:
        # Search for either amount or amount-1
        amount_minus_one = amount_to_search - 1
        if amount_minus_one == int(amount_minus_one):
            amount_minus_one_str = str(int(amount_minus_one))
        else:
            amount_minus_one_str = str(amount_minus_one)
        # Use OR to search for either amount
        query_parts.append(f'("{amount_str}" OR "{amount_minus_one_str}")')
    else:
        # Search for amount only
        query_parts.append(f'"{amount_str}"')
```

Replace with:
```python
# Add amount filter if enabled
if include_amount_filter:
    # Use search_amount if provided, otherwise use transaction_amount
    amount_to_search = search_amount if search_amount is not None else abs(transaction_amount)

    # Format the base amount string
    if amount_to_search == int(amount_to_search):
        amount_str = str(int(amount_to_search))
    else:
        amount_str = str(amount_to_search)

    # Build amount search query
    if amount_tolerance and amount_tolerance > 0:
        # Range query: search for all integer amounts from (amount - tolerance) to amount
        base = int(amount_to_search)
        lower = max(0, base - amount_tolerance)
        range_terms = " OR ".join(f'"{v}"' for v in range(lower, base + 1))
        query_parts.append(f"({range_terms})")
    elif also_search_amount_minus_one:
        # Search for either amount or amount-1 (legacy UPI rounding helper)
        amount_minus_one = amount_to_search - 1
        if amount_minus_one == int(amount_minus_one):
            amount_minus_one_str = str(int(amount_minus_one))
        else:
            amount_minus_one_str = str(amount_minus_one)
        query_parts.append(f'("{amount_str}" OR "{amount_minus_one_str}")')
    else:
        # Exact amount only
        query_parts.append(f'"{amount_str}"')
```

- [ ] **Step 4: Manually verify the generated query for a ₹198 / tolerance=5 scenario**

Trace through the new code:
- `amount_to_search = 198.0`
- `base = 198`
- `lower = max(0, 198 - 5) = 193`
- `range(193, 199)` → `[193, 194, 195, 196, 197, 198]`
- `range_terms = '"193" OR "194" OR "195" OR "196" OR "197" OR "198"'`
- `query_parts.append('("193" OR "194" OR "195" OR "196" OR "197" OR "198")')`
- Full query: `after:2026/02/26 before:2026/02/27 uber ("193" OR "194" OR "195" OR "196" OR "197" OR "198")`

This is correct. ✓

- [ ] **Step 5: Commit**

```bash
git add src/services/email_ingestion/client.py
git commit -m "feat(email-search): implement amount_tolerance range OR query in Gmail search"
```

---

## Task 4: Frontend types — add `amount_tolerance`

**Files:**
- Modify: `frontend/src/lib/types/index.ts:301-309`

- [ ] **Step 1: Add `amount_tolerance` to `EmailSearchFilters` interface**

Current (lines 301–309):
```typescript
export interface EmailSearchFilters {
  date_offset_days?: number;
  start_date?: string;
  end_date?: string;
  include_amount_filter: boolean;
  custom_search_term?: string;
  search_amount?: number; // Optional override for search amount (e.g., rounded amount for UPI)
  also_search_amount_minus_one?: boolean; // Also search for amount-1 (for UPI rounding scenarios)
}
```

Replace with:
```typescript
export interface EmailSearchFilters {
  date_offset_days?: number;
  start_date?: string;
  end_date?: string;
  include_amount_filter: boolean;
  custom_search_term?: string;
  search_amount?: number; // Optional override for search amount (e.g., rounded amount for UPI)
  also_search_amount_minus_one?: boolean; // Also search for amount-1 (for UPI rounding scenarios)
  amount_tolerance?: number; // Search integer amounts in range [amount - tolerance, amount]
}
```

- [ ] **Step 2: Commit**

```bash
cd frontend
git add src/lib/types/index.ts
git commit -m "feat(email-search): add amount_tolerance to EmailSearchFilters type"
```

---

## Task 5: Frontend API client — pass `amount_tolerance`

**Files:**
- Modify: `frontend/src/lib/api/client.ts` — `searchTransactionEmails` method (~lines 577–608)

- [ ] **Step 1: Read the current method to find where query params are built**

Find the block that constructs `params` for the GET request. It will look roughly like:
```typescript
const params: Record<string, unknown> = {
  date_offset_days: filters.date_offset_days ?? 1,
  include_amount_filter: filters.include_amount_filter,
  ...
};
```

- [ ] **Step 2: Add `amount_tolerance` to the params object**

After whichever last param is in the object, add:
```typescript
...(filters.amount_tolerance !== undefined && { amount_tolerance: filters.amount_tolerance }),
```

Use the same conditional spread pattern already used for other optional params in the same block (e.g. `custom_search_term`, `search_amount`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/client.ts
git commit -m "feat(email-search): pass amount_tolerance to backend search API"
```

---

## Task 6: Frontend drawer — fix UPI auto-search for Uber

**Files:**
- Modify: `frontend/src/components/transactions/email-links-drawer.tsx:101-145`

This is the core fix. The UPI branch currently searches with `include_amount_filter: true` and `also_search_amount_minus_one: true`, which produces a quoted integer OR query that cannot match decimal amounts like ₹197.72.

- [ ] **Step 1: Replace the UPI branch in `handleAutoSearch`**

Current UPI branch (lines 120–130):
```typescript
} else if (isUPI) {
  // UPI: Always search for Uber emails + exact amount + amount-1
  // Use the exact transaction amount as that's what appears in emails
  // Also search for amount-1 because original might have been ₹101.56 and paid ₹102
  // Always search for "uber" for UPI transactions
  // (Many UPI transactions are Uber rides, and we want to show them in suggestions)
  filters.custom_search_term = "uber";

  // Use exact amount for search (not rounded)
  filters.include_amount_filter = true; // Enable amount filter with exact amount
  filters.also_search_amount_minus_one = true; // Also search for amount-1 (for rounding scenarios)
}
```

Replace with:
```typescript
} else if (isUPI) {
  // UPI: Search for Uber trip emails by keyword + same-day date only.
  // Amount filter is intentionally disabled: Uber emails show the exact decimal fare
  // (e.g. ₹197.72) while the bank debit is the ceiling (₹198). Gmail quoted-exact
  // search cannot match a decimal by its integer prefix, so keyword + date is more
  // reliable and sufficiently precise (one Uber trip per day is the common case).
  filters.custom_search_term = "uber";
  filters.include_amount_filter = false;
  filters.date_offset_days = 0; // Same calendar day only — tighter window without amount filter
}
```

- [ ] **Step 2: Remove `also_search_amount_minus_one` from the `handleAutoSearch` dependency array if present**

The `useCallback` deps at line 145 are:
```typescript
}, [transaction.id, transaction.description, transaction.amount]);
```
`transaction.amount` is no longer used inside `handleAutoSearch` for the UPI branch (amount filter is off). However, it is still used in the `isSwiggy` and default branches, so keep it in the dep array unchanged.

- [ ] **Step 3: Verify the complete updated `handleAutoSearch` function looks correct**

After the change, the full function should be:
```typescript
const handleAutoSearch = useCallback(async () => {
  setIsAutoSearch(true);
  setIsSearching(true);
  setHasSearched(true);

  try {
    const description = transaction.description?.toLowerCase() || "";
    const isSwiggy = description.includes("swiggy");
    const isUPI = description.includes("upi");

    const filters: EmailSearchFilters = {
      date_offset_days: 1,
      include_amount_filter: true,
    };

    if (isSwiggy) {
      filters.include_amount_filter = true;
    } else if (isUPI) {
      filters.custom_search_term = "uber";
      filters.include_amount_filter = false;
      filters.date_offset_days = 0;
    } else {
      filters.include_amount_filter = true;
    }

    const response = await apiClient.searchTransactionEmails(transaction.id, filters);
    setSearchResults(response.data);
  } catch {
    setSearchResults([]);
  } finally {
    setIsSearching(false);
  }
}, [transaction.id, transaction.description, transaction.amount]);
```

- [ ] **Step 4: Commit**

```bash
git add src/components/transactions/email-links-drawer.tsx
git commit -m "fix(email-drawer): UPI auto-search uses keyword+date instead of decimal amount match"
```

---

## Task 7: Fix noisy ERROR log for expected 404 in `get_email_content`

**Files:**
- Modify: `backend/src/services/email_ingestion/client.py:1,204-206`

**Problem:** When the route tries the primary Gmail account first for a message that lives in the secondary account, `get_email_content` raises a `HttpError 404`. The `except Exception` block logs this as `ERROR` with a full traceback before re-raising. The route already handles this gracefully with a `WARNING` — the traceback is pure noise.

**Fix:** Import `HttpError`, catch it separately before the generic handler, and only log ERROR for unexpected failures (non-404 HttpErrors and other exceptions).

- [ ] **Step 1: Add `HttpError` import**

In `backend/src/services/email_ingestion/client.py`, replace line 14:
```python
from googleapiclient.discovery import build
```
With:
```python
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
```

- [ ] **Step 2: Replace the generic exception handler in `get_email_content`**

Current (lines 204–206):
```python
        except Exception as e:
            logger.error(f"Error getting email content for {message_id}", exc_info=True)
            raise
```

Replace with:
```python
        except HttpError as e:
            if e.resp.status == 404:
                # Expected: message not in this account — caller will try the other account
                raise
            logger.error(f"Error getting email content for {message_id}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"Error getting email content for {message_id}", exc_info=True)
            raise
```

- [ ] **Step 3: Verify the log output**

After this change:
- 404 from primary account → no ERROR log, no traceback → route logs `WARNING "not found in primary account"` → tries secondary → succeeds silently
- Any other HttpError (e.g. 401, 403, 500 from Gmail) → still logs ERROR with traceback
- Any non-HTTP exception → still logs ERROR with traceback

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/services/email_ingestion/client.py
git commit -m "fix(email-client): suppress noisy ERROR traceback for expected 404 account fallback"
```

---

## Task 8: Smoke test end-to-end

- [ ] **Step 1: Start both servers**

Backend (from `backend/`):
```bash
poetry run uvicorn main:app --reload
```

Frontend (from `frontend/`):
```bash
npm run dev
```

- [ ] **Step 2: Open a UPI transaction in the transactions table**

Find any transaction whose description contains "UPI" (e.g. a Yes Bank UPI debit for a ride).

- [ ] **Step 3: Open the Email Links drawer**

Click the email-links icon on the row (chain-link icon at far right).

Expected: Drawer opens → after ~300ms → "Suggested Emails" section appears → results contain Uber trip confirmation emails for that calendar day.

- [ ] **Step 4: Verify the Gmail query in backend logs**

In the backend terminal, look for the log line:
```
Searching emails with query: after:2026/02/26 before:2026/02/27 uber
```
Note: no amount term — that's correct.

- [ ] **Step 5: Verify `amount_tolerance` wired correctly via API docs**

Open `http://localhost:8000/docs` → find `GET /transactions/{transaction_id}/emails/search` → confirm `amount_tolerance` appears as an optional integer query param with `ge=0, le=20`.

- [ ] **Step 6: Verify no ERROR traceback for 404 fallback in logs**

Open a transaction, click the email-links icon, open an email that lives in the secondary account. Check backend logs — you should see:
```
WARNING - Email message_id=... not found in primary account
INFO    - Email message_id=... found in secondary account
```
No `ERROR` line, no traceback. ✓

- [ ] **Step 7: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix(email-search): post-smoke-test fixups"
```

---

## Self-Review

**Spec coverage check:**
- ✅ UPI transactions auto-suggest Uber emails — Task 6
- ✅ Amount filter disabled for UPI (decimal fare mismatch) — Task 6
- ✅ Same-day date filter for UPI — Task 6
- ✅ `amount_tolerance` backend param (integer range OR query) — Tasks 1–3
- ✅ `amount_tolerance` frontend type + API client — Tasks 4–5
- ✅ Auto-suggest only when no linked emails — existing behavior preserved (Task 6 only modifies the filter content, not the trigger condition)
- ✅ Suppress noisy ERROR traceback for expected 404 Gmail account fallback — Task 7

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `amount_tolerance` is `Optional[int]` (backend schema), `int` (route Query param), `Optional[int]` (service param), `number | undefined` (TS type) — consistent.
- `EmailSearchFilters` interface name used identically across `types/index.ts`, `client.ts`, and `email-links-drawer.tsx`.
