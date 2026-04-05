# Email Alert Ingestion — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Branch:** new branch from `main` (old `codex/email-alert-ingestion` used as reference only)

---

## 1. Problem

Transaction tracking lags by weeks because data only enters the system when monthly bank statements are processed via OCR. Bank alert emails arrive within seconds of each transaction but are currently unused. The goal is to ingest these emails as the primary real-time data source, with statement OCR serving as the monthly reconciliation pass.

---

## 2. Scope

### In scope
- Real-time ingestion of bank transaction alert emails for 6 accounts
- Scheduled + manual + one-time backfill trigger
- Deduplication between email-ingested and statement-extracted transactions
- Review queue for unmatched and ambiguous statement transactions
- Pre-launch validation script using historical email + statement data

### Out of scope (deferred)
- Auto-categorization of ingested transactions (hook left in pipeline, implemented later)
- SBI Savings account (no alert emails; continues OCR-only)
- Budget tracking, analytics improvements, AI agent

---

## 3. Accounts in Scope

| Account | Bank | Type | Parser |
|---|---|---|---|
| Axis Atlas | Axis Bank | Credit Card | `AxisCreditCardParser` |
| Cashback SBI | SBI Card | Credit Card | `SBICardParser` |
| Swiggy HDFC | HDFC Bank | Credit Card | `HDFCParser` |
| Amazon ICICI | ICICI Bank | Credit Card | `ICICIParser` |
| Yes Bank Savings | Yes Bank | Savings | `YesBankParser` |
| Axis Bank Savings | Axis Bank | Savings | `AxisSavingsParser` |
| SBI Savings | SBI | Savings | **OCR only — excluded** |

Note: Axis Atlas CC and Axis Bank Savings have different sender domains and require separate parsers despite sharing the same bank.

---

## 4. Architecture

```
APScheduler (every N hrs, configurable)
     │
     ▼
POST /api/email-ingestion/run   ◄── UI manual trigger
     │                               (accepts: account_ids, since_date)
     ▼
EmailAlertIngestionService
     │
     ├── Load active accounts where alert_sender IS NOT NULL
     │
     ├── For each account:
     │     EmailClient.fetch(since=alert_last_processed_at, sender=alert_sender)
     │     │
     │     ├── Gmail message ID check → skip if already seen
     │     │
     │     ├── BankParserRegistry.route(email) → detect bank + format
     │     │     └── Parser.parse(email) → structured dict
     │     │          (regular variant OR e-mandate variant per bank)
     │     │
     │     ├── [HOOK] auto_categorize(transaction) → deferred, no-op for now
     │     │
     │     └── insert(transaction_source="email_ingestion")
     │
     └── Update account.alert_last_processed_at = now


Statement OCR (existing pipeline, modified post-extraction):
     │
     └── For each extracted transaction:
           DeduplicationService.match(tx, account)
           ├── Tier 1: reference_number match → statement_confirmed = true, skip insert
           ├── Tier 2: amount + account + ±3 day window, 1 match → statement_confirmed = true, skip insert
           ├── Tier 3: amount + account + ±3 day window, >1 match → review queue (ambiguous)
           └── No match + alert_sender account → review queue (statement-only)
                No match + no alert_sender (SBI Savings) → insert normally
```

### New files
- `backend/src/services/email_ingestion/alert_ingestion_service.py` — run orchestrator
- `backend/src/services/email_ingestion/parsers/__init__.py` — `BankParserRegistry`
- `backend/src/services/email_ingestion/parsers/base.py` — `BaseAlertParser` abstract class
- `backend/src/services/email_ingestion/parsers/axis_credit.py` — Axis Atlas CC
- `backend/src/services/email_ingestion/parsers/axis_savings.py` — Axis Bank Savings
- `backend/src/services/email_ingestion/parsers/sbi_card.py` — Cashback SBI CC
- `backend/src/services/email_ingestion/parsers/hdfc.py` — Swiggy HDFC CC
- `backend/src/services/email_ingestion/parsers/icici.py` — Amazon ICICI CC
- `backend/src/services/email_ingestion/parsers/yes_bank.py` — Yes Bank Savings
- `backend/src/services/email_ingestion/dedup_service.py` — tiered matching logic
- `backend/src/apis/routes/email_ingestion_routes.py` — run + status endpoints
- `backend/src/services/database_manager/models/review_queue.py` — `ReviewQueue` model
- `backend/src/services/database_manager/operations/review_queue_operations.py` — queue CRUD
- `backend/scripts/validate_email_dedup.py` — pre-launch validation script

### Modified files
- `backend/main.py` — register APScheduler, include new routes
- `backend/src/services/orchestrator/statement_workflow.py` — add dedup pass post-extraction
- `backend/src/services/database_manager/operations/transaction_operations.py` — bulk dedup queries
- `backend/src/services/database_manager/models/account.py` — 2 new columns
- `backend/src/services/database_manager/models/transaction.py` — 2 new columns

### Reused unchanged
- `backend/src/services/email_ingestion/client.py` — Gmail API client
- `backend/src/services/email_ingestion/token_manager.py` — OAuth token management
- `backend/src/services/email_ingestion/auth.py` — Gmail auth flow

---

## 5. Data Model Changes

### `accounts` table — 2 new columns
```sql
alert_sender             TEXT         -- Gmail sender address for alert emails
                                      -- NULL = no alert emails (SBI Savings)
                                      -- distinct from statement_sender
alert_last_processed_at  TIMESTAMPTZ  -- watermark: scheduler resumes from here
                                      -- NULL = never processed
```

### `transactions` table — 2 new columns
```sql
email_message_id    TEXT     -- Gmail message ID; indexed for fast exact-match dedup
                             -- populated only for transaction_source = 'email_ingestion'
statement_confirmed BOOLEAN  -- true when statement OCR matched this email transaction
                             -- default false
```

### `review_queue` table — new
```sql
CREATE TABLE review_queue (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_type             TEXT        NOT NULL,  -- 'statement_only' | 'ambiguous'
    transaction_date        DATE        NOT NULL,
    amount                  NUMERIC     NOT NULL,
    description             TEXT        NOT NULL,
    account                 TEXT        NOT NULL,
    direction               TEXT        NOT NULL,  -- 'debit' | 'credit'
    transaction_type        TEXT        NOT NULL,
    reference_number        TEXT,                  -- carried over for display
    raw_data                JSONB,                 -- full statement-extracted payload
    ambiguous_candidate_ids UUID[],                -- email tx IDs (ambiguous type only)
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at             TIMESTAMPTZ,           -- NULL = unresolved
    resolution              TEXT                   -- 'confirmed' | 'linked' | 'deleted'
);

CREATE INDEX idx_review_queue_unresolved ON review_queue(review_type) WHERE resolved_at IS NULL;
```

**Why a separate table (not `transaction_source = "pending_review"`):**
Pending items in the main `transactions` table would require every existing query — analytics, totals, settlements, filters — to explicitly exclude them. A missed filter means silently wrong numbers. The dedicated table keeps `transactions` clean with zero impact on existing code paths.

### New indexes on `transactions`
```sql
CREATE INDEX idx_transactions_email_message_id ON transactions(email_message_id);
CREATE INDEX idx_transactions_reference_number ON transactions(reference_number);
-- idx_transactions_account and idx_transactions_date already exist (used by Tier 2)
```

### Migrations
Two Alembic migrations:
1. Alter `accounts` and `transactions` tables, add indexes
2. Create `review_queue` table and its index

---

## 6. Parser Design

Each parser lives in its own file and extends `BaseAlertParser`:

```python
class BaseAlertParser:
    def parse(self, email_content: dict) -> dict | None:
        """Returns structured transaction dict or None if not a transaction email."""
        raise NotImplementedError

    def is_emandate(self, text: str) -> bool:
        """Detect e-mandate format — subclasses override if bank supports it."""
        return False

    def parse_emandate(self, email_content: dict) -> dict | None:
        """E-mandate variant parser — override in subclasses."""
        return None
```

Each parser's `parse()` calls `is_emandate()` first and routes accordingly. Old branch parser logic for Yes Bank, SBI Card, HDFC, Axis, ICICI is used as reference for regex patterns and field extraction, adapted to the new base class structure.

`BankParserRegistry` maps `alert_sender` domain → parser class. Routing is done once at service startup.

**Output schema (all parsers must return this):**
```python
{
    "transaction_date": "YYYY-MM-DD",
    "transaction_time": "HH:MM:SS",   # nullable
    "amount": float,
    "direction": "debit" | "credit",
    "description": str,
    "reference_number": str | None,   # UTR/RRN when available — critical for Tier 1 dedup
    "account_identifier": str | None, # last 4 digits or account nickname
    "email_message_id": str,
    "email_sender": str,
    "raw_data": dict,
}
```

---

## 7. Deduplication Strategy

### Within email ingestion (preventing re-processing)

**Step 1 — Exact match (same email reprocessed):**
Check `email_message_id` against `transactions.email_message_id` using indexed lookup. Skip if exists. Done before parsing to avoid wasted work.

**Step 2 — Fuzzy match (two different emails, same transaction):**
Some banks send an initial alert + a later confirmation email for the same transaction — different Gmail message IDs but identical underlying data. After parsing, run Tier 1 (reference number) and Tier 2 (amount + account + ±3 day window) against existing `email_ingestion` transactions. If a match is found → skip silently and log. No review queue entry — there is no meaningful choice to surface to the user.

### Between email and statement (reconciliation)

Executed as bulk operations, not row-by-row:

**Tier 1 — Reference number (deterministic)**
- Collect all `reference_number` values from the statement batch
- Single query: fetch all existing transactions matching those reference numbers on the same account
- Match found → set `statement_confirmed = true`, do not insert
- Coverage: most UPI/NEFT/IMPS transactions

**Tier 2 — Amount + account + date window (high confidence)**
- For transactions not matched in Tier 1
- Fetch all email_ingestion transactions for each account in the date range (transaction_date ± 3 days)
- In-memory: find candidates where `amount` matches exactly
- Exactly 1 candidate → `statement_confirmed = true`, do not insert
- Coverage: credit card transactions where reference number is absent

**Tier 3 — Ambiguous**
- Tier 2 returns >1 candidate → add to review queue with all candidate IDs attached
- User manually selects the correct match in the review queue

**No match**
- Account has `alert_sender` configured → add to review queue as "statement-only"
- Account has no `alert_sender` (SBI Savings) → insert normally as `statement_extraction`

### Known edge cases and handling

| Scenario | Behaviour |
|---|---|
| Forex/international transaction | Email shows foreign currency amount; won't match on amount → review queue (statement-only) |
| EMI conversion | Statement shows installment amount, email shows full amount → review queue |
| E-mandate | Dedicated parser variant; dedup logic unchanged |
| Bank alert threshold (if any) | No email exists → review queue (statement-only) |
| Multiple emails per transaction | Message ID dedup prevents duplicate insert |
| Same amount × N same account same day | Tier 3 ambiguous → review queue |
| Date drift (posting vs transaction) | ±3 day window in Tier 2 handles this |

---

## 8. Trigger Mechanisms

### Scheduled (APScheduler embedded in FastAPI)
- Runs every N hours (interval configured in `.env`, decided before launch)
- Calls the same internal ingestion logic as the API endpoint
- Starts on app startup; survives within the process lifetime of the server

### Manual trigger (UI)
- Button in settings or review page: "Fetch latest transactions"
- Calls `POST /api/email-ingestion/run` with no params
- Returns a job summary (processed / inserted / skipped / errors)

### Backfill (one-time)
- Same endpoint with `since_date` param: `POST /api/email-ingestion/run?since_date=2026-04-01`
- Fetches all emails from `since_date` to now, ignoring `alert_last_processed_at`
- Does not update `alert_last_processed_at` until complete
- After backfill, scheduler takes over from the watermark

---

## 9. Review Queue UX

Located as a new tab within the existing `/review` page.

### Statement-Only queue
Transactions extracted from statement OCR with no email match on an alert-enabled account.

Each row shows: date, amount, description, account.
Actions per row:
- **Confirm** — accepts as `statement_extraction`, removes from queue
- **Edit** — inline edit before confirming (same component as main transaction table)
- **Delete** — soft delete if genuinely a duplicate

Bulk action: **Confirm All** — for high-confidence batches (e.g., bank charges, interest).

### Ambiguous Matches queue
Statement transaction matched >1 email candidate in Tier 2.

UI shows statement transaction on left, 2–3 email candidates on right side by side.
Actions:
- **Link to this one** (per candidate) — merges, sets `statement_confirmed = true`
- **None of these** — treats as new statement-only transaction and inserts it

### Persistence model
Both item types are written to the dedicated `review_queue` table — the main `transactions` table is never touched until the user resolves the item.

**Statement-only lifecycle:**
1. Statement OCR finds no match → row inserted into `review_queue` with `review_type = "statement_only"`
2. User hits **Confirm** → transaction inserted into `transactions` as `transaction_source = "statement_extraction"` → `review_queue.resolved_at` stamped, `resolution = "confirmed"`
3. User hits **Delete** → no transaction inserted → `resolution = "deleted"`

**Ambiguous lifecycle:**
1. Statement OCR finds >1 email match → row inserted into `review_queue` with `review_type = "ambiguous"`, `ambiguous_candidate_ids` populated with the matching email transaction UUIDs
2. User hits **Link to this one** → chosen email transaction gets `statement_confirmed = true` → `resolution = "linked"`
3. User hits **None of these** → treated as statement-only: transaction inserted as `statement_extraction` → `resolution = "confirmed"`

### Design notes
- Queue is non-blocking — email transactions are already live in the main view
- Queue fills only when statement processing runs (monthly); not a daily inbox
- Auto-categorization integration point: when confirmed from queue, auto-categorize hook fires (deferred)

---

## 10. Pre-Launch Validation Script

**File:** `backend/scripts/validate_email_dedup.py`

**Purpose:** Before going live, validate parser accuracy and dedup matching against historical data where ground truth (statement-extracted transactions) already exists.

**Usage:**
```bash
poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31
poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31 --account "Yes Bank Savings"
```

**What it does:**
1. Fetches all alert emails in the date range from Gmail (read-only, no DB writes)
2. Runs each email through the parser
3. For each parsed transaction, runs the full dedup logic against existing DB transactions in the same period
4. Produces a report — no data is modified

**Report output:**
```
=== EMAIL DEDUP VALIDATION REPORT ===
Period: 2025-11-01 → 2026-03-31

OVERALL SUMMARY
  Emails fetched:           312
  Parse failures:             7  (2.2%)
  Successfully parsed:      305

  Tier 1 matched (ref no):  198  (64.9%)
  Tier 2 matched (amount):   87  (28.5%)
  Tier 3 ambiguous:           4   (1.3%)
  Unmatched:                 16   (5.2%)

BREAKDOWN BY ACCOUNT
  Axis Atlas CC       — 78 parsed, 74 matched, 2 ambiguous, 2 unmatched, 0 parse failures
  Cashback SBI CC     — 55 parsed, 49 matched, 1 ambiguous, 3 unmatched, 2 parse failures
  Swiggy HDFC CC      — 61 parsed, 58 matched, 0 ambiguous, 3 unmatched, 0 parse failures
  Amazon ICICI CC     — 48 parsed, 46 matched, 1 ambiguous, 1 unmatched, 0 parse failures
  Yes Bank Savings    — 42 parsed, 39 matched, 0 ambiguous, 3 unmatched, 3 parse failures
  Axis Bank Savings   — 21 parsed, 19 matched, 0 ambiguous, 2 unmatched, 2 parse failures

UNMATCHED TRANSACTIONS (likely forex, EMI, or parser gaps)
  Date        Amount    Account           Parsed Description
  2025-11-14  1342.50   Amazon ICICI CC   AMAZON US
  2025-12-03  5000.00   Axis Atlas CC     EMI CONVERSION
  ...

PARSE FAILURES (email subjects that failed)
  [Yes Bank] "Account Alert" — 2025-11-22 — no amount found
  ...
```

The unmatched and parse failure rows are the actionable signal — they tell you exactly which parser patterns to fix before going live.

---

## 11. Open Decisions

| Decision | Deferred to |
|---|---|
| Exact scheduler interval (every N hours) | Before launch |
| Auto-categorization integration | Separate feature after email ingestion ships |
