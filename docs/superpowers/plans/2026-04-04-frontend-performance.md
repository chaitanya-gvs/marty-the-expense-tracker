# Frontend Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate visible UI lag on the transactions page — specifically: category dropdown double-open flicker, slow click response, and scroll jank.

**Architecture:** Five targeted fixes applied in order of user-facing impact. No structural rewrites — each fix is isolated to one or two files, measurable before/after by feel. Work happens on the `perf/frontend-performance` branch.

**Tech Stack:** Next.js 15 App Router, React 19, TanStack React Table, TanStack React Query v5, Radix UI Popover, Framer Motion, Tailwind CSS v4

---

## Root Causes Summary

| Symptom | Root Cause | File |
|---------|-----------|------|
| Category dropdown opens→closes→opens | `useState(false)` + `useEffect(() => setOpen(true))` creates a closed→open flash on mount | `inline-category-dropdown.tsx:48,79-81` |
| Clicks feel delayed | `columns` useMemo has 31 deps including `allTransactions` (changes on every scroll page load) and `updateTransaction` (new object reference every render) — entire column tree rebuilds on each scroll fetch | `transactions-table.tsx:554-654` |
| Clicks feel delayed (secondary) | `allTransactions` useMemo runs O(n²) `.some()` inside `.filter()` — with 500 rows that's 250,000 iterations per recalculation | `transactions-table.tsx:248-265` |
| Scroll jank | Every scroll event calls `fetchMoreOnBottomReached` synchronously; when a new page loads `allTransactions` changes → columns rebuild → full re-render while scroll events are still firing | `transactions-table.tsx:428-452` |
| Date-header totals O(n²) | Inside the row render loop, each date-header row runs `rows.filter().reduce()` over the entire rows array | `transactions-table.tsx:944-948` |
| Page size 500 | Each infinite-scroll fetch loads 500 rows — 5× more DOM nodes, cell renders, and handler allocations than needed | `use-transactions.ts:25` |

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/components/transactions/inline-category-dropdown.tsx` | Fix double-open: init `open` as `true`, delete auto-open `useEffect` |
| `frontend/src/hooks/use-transactions.ts` | Reduce page size from 500 → 100 |
| `frontend/src/components/transactions/transactions-table.tsx` | (1) Pre-compute split-parent set for O(n) filter; (2) Pre-compute daily totals Map; (3) Remove `allTransactions`, `allTransactionsUnfiltered`, `allTags`, `allCategories`, `updateTransaction` from columns deps; (4) Throttle scroll handler |
| `frontend/src/components/transactions/transaction-columns.tsx` | Accept data via refs instead of deps so column callbacks read latest values without causing rebuilds |

---

## Task 0: Enable Local Development via Next.js Proxy

**Files:**
- Modify: `frontend/next.config.ts`
- Modify: `frontend/.env.local`

**What's happening:** When the frontend runs on `localhost:3000` and calls the production backend at `expenses.chaitanya-gvs.com`, the browser treats the auth cookie as third-party and blocks it — even with `SameSite=None; Secure`. This makes local dev impossible without running the backend locally.

The fix: add a Next.js server-side rewrite so `localhost:3000/api/*` proxies to the production backend. The browser only ever talks to `localhost:3000`, so cookies are same-origin and work correctly. The production deployment is unaffected.

- [ ] **Step 1: Add rewrites to `next.config.ts`**

  Replace the entire file content:
  ```ts
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {
    output: "standalone",
    async rewrites() {
      // In development, proxy /api/* to the production backend so the browser
      // sees same-origin requests and auth cookies work correctly.
      if (process.env.NEXT_PUBLIC_APP_ENV === "development") {
        return [
          {
            source: "/api/:path*",
            destination: "https://expenses.chaitanya-gvs.com/api/:path*",
          },
        ];
      }
      return [];
    },
  };

  export default nextConfig;
  ```

- [ ] **Step 2: Update `.env.local` to use the local proxy**

  Open `frontend/.env.local`. Change:
  ```
  NEXT_PUBLIC_API_URL=https://expenses.chaitanya-gvs.com/api
  ```
  To:
  ```
  NEXT_PUBLIC_API_URL=http://localhost:3000/api
  ```

  `NEXT_PUBLIC_APP_ENV=development` should already be set — this is what activates the rewrite rule.

- [ ] **Step 3: Restart the dev server**

  The rewrite is a config-level change — hot reload won't pick it up. Stop and restart:
  ```bash
  cd frontend && npm run dev
  ```

- [ ] **Step 4: Verify login works**

  Open `http://localhost:3000`. Log in. You should land on `/transactions` without a redirect loop. Open DevTools → Network — all API calls should go to `localhost:3000/api/*` (not `expenses.chaitanya-gvs.com`).

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/next.config.ts
  # NOTE: do NOT commit .env.local — it is gitignored and contains local-only config
  git commit -m "fix(dev): proxy /api/* to production backend in development

  Allows local frontend dev against the production backend without
  cross-origin cookie issues. Rewrites only activate when
  NEXT_PUBLIC_APP_ENV=development."
  ```

---

## Task 1: Fix Category Dropdown Double-Open Flicker

**Files:**
- Modify: `frontend/src/components/transactions/inline-category-dropdown.tsx:48,79-81`

**What's happening:** `open` initialises as `false`. React renders the closed Popover. Then the `useEffect` fires `setOpen(true)` — causing a second render where it opens. The user sees it flicker closed then open. Additionally, the `onOpenChange` handler calls `onCancel()` on any close event, meaning if Radix internally calls `onOpenChange(false)` during the mount sequence (which it can), the component cancels itself before the user sees it.

- [ ] **Step 1: Open the file and locate the state init and auto-open effect**

  ```
  frontend/src/components/transactions/inline-category-dropdown.tsx
  ```

  Lines to change:
  - Line 48: `const [open, setOpen] = useState(false);`
  - Lines 78–81: the `// Auto-open the popover when component mounts` useEffect block

- [ ] **Step 2: Change `useState(false)` to `useState(true)` and delete the auto-open effect**

  Replace:
  ```tsx
  const [open, setOpen] = useState(false);
  ```
  With:
  ```tsx
  const [open, setOpen] = useState(true);
  ```

  Delete lines 78–81 entirely:
  ```tsx
  // DELETE THIS BLOCK:
  // Auto-open the popover when component mounts
  // useEffect(() => {
  //   setOpen(true);
  // }, []);
  ```

  The focus `useEffect` at lines 83–95 fires when `open` is `true`, which it now is from mount — so focus still works automatically. No other changes needed.

- [ ] **Step 3: Verify the fix manually**

  Open the transactions page in the browser. Click on any category cell. The dropdown should open instantly with a single smooth animation — no flicker, no close-then-reopen. Click away; it should close cleanly.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/transactions/inline-category-dropdown.tsx
  git commit -m "fix(perf): eliminate category dropdown open-close-open flicker

  Initialize open state as true instead of false+useEffect.
  The auto-open effect was causing a closed→open flash on every mount."
  ```

---

## Task 2: Reduce Infinite Scroll Page Size (500 → 100)

**Files:**
- Modify: `frontend/src/hooks/use-transactions.ts:25`

**What's happening:** Each scroll fetch loads 500 rows. That means the DOM holds 500+ `<tr>` elements, 500+ instances of every cell renderer and click handler, and all layout calculations run across 500 rows. Reducing to 100 cuts all of that by 5× while being invisible to the user (the progress bar already shows pagination state, and 100 rows fills any screen comfortably).

- [ ] **Step 1: Open the file**

  ```
  frontend/src/hooks/use-transactions.ts
  ```

- [ ] **Step 2: Change the limit**

  Find line 25:
  ```ts
  apiClient.getTransactions(filters, sort, { page: pageParam - 1, limit: 500 }),
  ```

  Change to:
  ```ts
  apiClient.getTransactions(filters, sort, { page: pageParam - 1, limit: 100 }),
  ```

- [ ] **Step 3: Verify**

  Open the transactions page. The initial load should be visibly faster. The table should still infinite-scroll correctly — when you reach the bottom, more rows load. The footer shows `100 / total` then `200 / total` etc. as you scroll.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/hooks/use-transactions.ts
  git commit -m "fix(perf): reduce infinite scroll page size from 500 to 100

  Cuts initial DOM node count by 5x. 100 rows fills any viewport
  comfortably; pagination is invisible to the user."
  ```

---

## Task 3: Fix O(n²) Split-Parent Filter

**Files:**
- Modify: `frontend/src/components/transactions/transactions-table.tsx:248-265`

**What's happening:** `allTransactions` is derived from `allTransactionsUnfiltered` by filtering out split-parent rows. The filter callback calls `allTransactionsUnfiltered.some(...)` for every row — O(n²). With 100–500 rows this runs thousands of iterations every time `data` changes (i.e., on every scroll fetch).

- [ ] **Step 1: Open the file**

  ```
  frontend/src/components/transactions/transactions-table.tsx
  ```

- [ ] **Step 2: Pre-compute the split-parent set and use it in the filter**

  Find the two `useMemo` blocks at lines 241–265. Replace them with:

  ```tsx
  const allTransactionsUnfiltered = useMemo(() => {
    return data?.pages.flatMap(page => page.data) ?? [];
  }, [data]);

  // Pre-compute set of split-parent IDs in O(n) instead of O(n²) filter
  const splitParentIds = useMemo(() => {
    const childGroupIds = new Set<string>();
    for (const t of allTransactionsUnfiltered) {
      if (t.transaction_group_id && t.is_split === true) {
        childGroupIds.add(t.transaction_group_id);
      }
    }
    // Collect IDs of rows that are the non-split parent in a split group
    const ids = new Set<string>();
    for (const t of allTransactionsUnfiltered) {
      if (t.transaction_group_id && t.is_split === false && childGroupIds.has(t.transaction_group_id)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [allTransactionsUnfiltered]);

  const allTransactions = useMemo(() => {
    if (splitParentIds.size === 0) return allTransactionsUnfiltered;
    return allTransactionsUnfiltered.filter(t => !splitParentIds.has(t.id));
  }, [allTransactionsUnfiltered, splitParentIds]);
  ```

- [ ] **Step 3: Verify**

  The transactions table should render identically — split transactions should still show their parts correctly, and parent rows should still be hidden. No visual change; this is a pure performance fix.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/transactions/transactions-table.tsx
  git commit -m "fix(perf): replace O(n²) split-parent filter with O(n) Set lookup

  Pre-compute split-parent IDs in a single pass instead of calling
  .some() inside .filter() for every row."
  ```

---

## Task 4: Pre-Compute Daily Debit Totals (O(n²) → O(n))

**Files:**
- Modify: `frontend/src/components/transactions/transactions-table.tsx` (inside the `rows.map()` render block, approx. line 944)

**What's happening:** Inside the JSX row render loop, every date-header row calls `rows.filter().reduce()` across the full `rows` array to sum up that day's debits. This is O(n) work per date group × number of rows = O(n²) total on every render.

- [ ] **Step 1: Add a `dailyDebitTotals` useMemo above the table JSX**

  Find the `const rows = table.getRowModel().rows;` line (approximately line 890) and add the following immediately after it:

  ```tsx
  const rows = table.getRowModel().rows;

  // Pre-compute daily debit totals: O(n) one pass, used O(1) per date header
  const dailyDebitTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.original.direction !== "debit") continue;
      const date = (r.original.date ?? "").split("T")[0];
      if (!date) continue;
      const amount = r.original.is_shared && r.original.split_share_amount
        ? r.original.split_share_amount
        : r.original.amount ?? 0;
      map.set(date, (map.get(date) ?? 0) + amount);
    }
    return map;
  }, [rows]);
  ```

- [ ] **Step 2: Replace the inline `rows.filter().reduce()` with a Map lookup**

  Find lines 944–948:
  ```tsx
  // Daily debit total for the date group
  const dailyTotal = showDateHeader
    ? rows
        .filter(r => (r.original.date || "").split("T")[0] === rowDate && r.original.direction === "debit")
        .reduce((sum, r) => sum + (r.original.is_shared && r.original.split_share_amount ? r.original.split_share_amount : r.original.amount || 0), 0)
    : 0;
  ```

  Replace with:
  ```tsx
  // Daily debit total — O(1) lookup into pre-computed map
  const dailyTotal = showDateHeader ? (dailyDebitTotals.get(rowDate) ?? 0) : 0;
  ```

- [ ] **Step 3: Verify**

  Date headers should still show the correct daily total amounts. No visual change.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/transactions/transactions-table.tsx
  git commit -m "fix(perf): pre-compute daily debit totals as Map instead of O(n²) filter/reduce"
  ```

---

## Task 5: Remove Volatile Values from columns useMemo Dependencies

**Files:**
- Modify: `frontend/src/components/transactions/transactions-table.tsx:554-654`
- Modify: `frontend/src/components/transactions/transaction-columns.tsx` (callbacks signature + usages)

**What's happening:** The `columns` useMemo rebuilds the entire TanStack Table column tree whenever any of its 31 dependencies change. Critically, `allTransactions` and `allTransactionsUnfiltered` change on **every scroll page fetch**, and `updateTransaction` (the TanStack mutation object) has a new reference on every render. This means every scroll that triggers a new page load also triggers a full column rebuild → full table re-render.

The fix: move `allTransactions`, `allTransactionsUnfiltered`, `allTags`, `allCategories`, and `updateTransaction` out of the dependency array by reading them from stable `useRef` values inside the callbacks. React's `setState` functions are already stable, so all the `set*` deps can stay.

- [ ] **Step 1: Add refs for the volatile values near the top of `TransactionsTable`**

  Find the section after the `useMemo` declarations for `allTransactions` (approximately line 265). Add the following refs:

  ```tsx
  // Stable refs so column callbacks always read latest values without
  // triggering a columns useMemo rebuild on every data update.
  const allTransactionsRef = useRef(allTransactions);
  const allTransactionsUnfilteredRef = useRef(allTransactionsUnfiltered);
  const allTagsRef = useRef(allTags);
  const allCategoriesRef = useRef(allCategories);
  const updateTransactionRef = useRef(updateTransaction);

  useEffect(() => { allTransactionsRef.current = allTransactions; }, [allTransactions]);
  useEffect(() => { allTransactionsUnfilteredRef.current = allTransactionsUnfiltered; }, [allTransactionsUnfiltered]);
  useEffect(() => { allTagsRef.current = allTags; }, [allTags]);
  useEffect(() => { allCategoriesRef.current = allCategories; }, [allCategories]);
  useEffect(() => { updateTransactionRef.current = updateTransaction; }, [updateTransaction]);
  ```

- [ ] **Step 2: Update `TransactionColumnCallbacks` interface in `transaction-columns.tsx` to accept refs**

  Open `frontend/src/components/transactions/transaction-columns.tsx`. Find the `TransactionColumnCallbacks` interface (approximately line 88). Change the data fields and `onUpdateTransaction` to accept `RefObject`:

  ```tsx
  import { RefObject } from "react";
  import { UseMutationResult } from "@tanstack/react-query"; // already imported
  ```

  In the interface, change:
  ```tsx
  // Data
  allTags: Tag[];
  allCategories: Category[];
  allTransactions: Transaction[];
  allTransactionsUnfiltered: Transaction[];
  transactionGroupMap: Map<string, Transaction[]>;
  ```
  To:
  ```tsx
  // Data — passed as refs so column callbacks read latest values
  // without the columns useMemo rebuilding on every data change.
  allTagsRef: RefObject<Tag[]>;
  allCategoriesRef: RefObject<Category[]>;
  allTransactionsRef: RefObject<Transaction[]>;
  allTransactionsUnfilteredRef: RefObject<Transaction[]>;
  ```

  And change:
  ```tsx
  onUpdateTransaction: (params: { id: string; updates: Partial<Transaction> }) => Promise<unknown>;
  ```
  To:
  ```tsx
  updateTransactionRef: RefObject<{ mutateAsync: (params: { id: string; updates: Partial<Transaction> }) => Promise<unknown> }>;
  ```

- [ ] **Step 3: Update all usages inside `buildTransactionColumns` to read `.current`**

  Inside `buildTransactionColumns`, update the destructuring at the top:
  ```tsx
  const {
    // ... all other fields unchanged ...
    allTagsRef,
    allCategoriesRef,
    allTransactionsRef,
    allTransactionsUnfilteredRef,
    updateTransactionRef,
    // ... rest unchanged
  } = callbacks;
  ```

  Then replace every usage of `allTags`, `allCategories`, `allTransactions`, `allTransactionsUnfiltered` inside cell renderers with `.current` reads:
  - `allTags` → `allTagsRef.current`
  - `allCategories` → `allCategoriesRef.current`
  - `allTransactions` → `allTransactionsRef.current`
  - `allTransactionsUnfiltered` → `allTransactionsUnfilteredRef.current`

  For `onUpdateTransaction` calls (e.g., in the amount pill and description cell), replace:
  ```tsx
  await onUpdateTransaction({ id: ..., updates: ... });
  ```
  With:
  ```tsx
  await updateTransactionRef.current.mutateAsync({ id: ..., updates: ... });
  ```

- [ ] **Step 4: Update the `buildTransactionColumns` call in `transactions-table.tsx`**

  In the `useMemo` at line 554, change the passed props from values to refs:
  ```tsx
  const columns = useMemo(
    () =>
      buildTransactionColumns({
        editingRow,
        editingField,
        editingTagsForTransaction,
        editingCategoryForTransaction,
        isMultiSelectMode,
        selectedTransactionIds,
        isAllSelected,
        isIndeterminate,
        isKeyboardNavigationMode,
        focusedRowIndex,
        focusedColumnId,
        focusedActionButton,
        // Pass refs instead of values:
        allTagsRef,
        allCategoriesRef,
        allTransactionsRef,
        allTransactionsUnfilteredRef,
        expandedGroupedExpenses,
        editableColumns,
        getNextEditableColumn,
        handleSelectAll,
        handleSelectTransaction,
        handleHighlightTransactions,
        handleClearHighlight,
        toggleGroupExpense,
        // Pass ref instead of mutation object:
        updateTransactionRef,
        setEditingRow,
        setEditingField,
        setEditingTagsForTransaction,
        setEditingCategoryForTransaction,
        setFocusedRowIndex,
        setFocusedColumnId,
        setIsKeyboardNavigationMode,
        setSelectedTransactionForSplit,
        setIsSplitEditorOpen,
        setDrawerTransaction,
        setDrawerVariant,
        setIsDrawerOpen,
        setGroupExpenseFromTransaction,
        setIsGroupExpenseSearchModalOpen,
        setSelectedTransactionForSplitting,
        setIsSplitTransactionModalOpen,
        setEmailLinksTransaction,
        setIsEmailLinksDrawerOpen,
        setTransactionToDelete,
        setIsDeleteConfirmationOpen,
        setPdfViewerTransactionId,
        setIsPdfViewerOpen,
      }),
    [
      editingRow,
      editingField,
      editingTagsForTransaction,
      editingCategoryForTransaction,
      isMultiSelectMode,
      selectedTransactionIds,
      isAllSelected,
      isIndeterminate,
      isKeyboardNavigationMode,
      focusedRowIndex,
      focusedColumnId,
      focusedActionButton,
      expandedGroupedExpenses,
      editableColumns,
      getNextEditableColumn,
      handleSelectAll,
      handleSelectTransaction,
      handleHighlightTransactions,
      handleClearHighlight,
      toggleGroupExpense,
      // REMOVED: allTags, allCategories, allTransactions, allTransactionsUnfiltered, updateTransaction
      // These are now refs — columns rebuild only on UI-state changes, not data changes.
      setEditingRow,
      setEditingField,
      setEditingTagsForTransaction,
      setEditingCategoryForTransaction,
      setFocusedRowIndex,
      setFocusedColumnId,
      setIsKeyboardNavigationMode,
      setSelectedTransactionForSplit,
      setIsSplitEditorOpen,
      setDrawerTransaction,
      setDrawerVariant,
      setIsDrawerOpen,
      setGroupExpenseFromTransaction,
      setIsGroupExpenseSearchModalOpen,
      setSelectedTransactionForSplitting,
      setIsSplitTransactionModalOpen,
      setEmailLinksTransaction,
      setIsEmailLinksDrawerOpen,
      setTransactionToDelete,
      setIsDeleteConfirmationOpen,
      setPdfViewerTransactionId,
      setIsPdfViewerOpen,
    ]
  );
  ```

- [ ] **Step 5: Run the TypeScript compiler to catch any missed ref usages**

  ```bash
  cd frontend && npm run build 2>&1 | grep -E "error TS|Cannot find"
  ```

  Fix any remaining `allTags`/`allCategories`/`allTransactions`/`allTransactionsUnfiltered` usages that are not yet using `.current`.

- [ ] **Step 6: Verify**

  Click on any cell (category, tags, amount direction). The response should feel immediate — no perceptible delay before the UI reacts. Scroll to the bottom to trigger infinite scroll; the scroll should stay smooth while the new page loads in the background.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/components/transactions/transactions-table.tsx \
          frontend/src/components/transactions/transaction-columns.tsx
  git commit -m "fix(perf): remove volatile data arrays from columns useMemo deps

  allTransactions, allTags, allCategories, and updateTransaction were
  in the 31-item columns useMemo dep array. They change on every scroll
  page fetch, causing a full column tree rebuild after every new page.

  Move them to useRef so column callbacks always read latest values
  without triggering a rebuild. Columns now only rebuild on genuine
  UI-state changes (editing, selection, keyboard nav)."
  ```

---

## Task 6: Throttle Scroll Handler with requestAnimationFrame

**Files:**
- Modify: `frontend/src/components/transactions/transactions-table.tsx:447-452`

**What's happening:** `handleBodyScroll` fires on every browser scroll frame (up to 120 times/second). It synchronously reads `scrollLeft` and writes it to the frozen header element. While this write is cheap, it triggers layout recalculation on every frame. On slower machines this blocks the main thread enough to cause scroll jank.

- [ ] **Step 1: Wrap the header sync in requestAnimationFrame**

  Find `handleBodyScroll` at line 447:
  ```tsx
  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    fetchMoreOnBottomReached(e.currentTarget);
  }, [fetchMoreOnBottomReached]);
  ```

  Replace with:
  ```tsx
  const rafRef = useRef<number | null>(null);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    // Throttle header sync to one write per animation frame
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = scrollLeft;
      }
    });
    fetchMoreOnBottomReached(e.currentTarget);
  }, [fetchMoreOnBottomReached]);
  ```

  Add `const rafRef = useRef<number | null>(null);` near the other refs at the top of the component (around line 140).

- [ ] **Step 2: Verify**

  Scroll quickly through the transactions table. The sticky header columns should track the horizontal scroll position smoothly. Vertical scroll should feel lighter.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/transactions/transactions-table.tsx
  git commit -m "fix(perf): throttle header scroll sync with requestAnimationFrame

  Prevents multiple DOM writes per frame during fast scrolling."
  ```

---

## Task 7: Increase React Query Cache Lifetime (gcTime)

**Files:**
- Modify: `frontend/src/components/providers.tsx`

**What's happening:** React Query's default `gcTime` is 5 minutes — after 5 minutes of inactivity, cached data is garbage-collected. When the user navigates back to the transactions page after 5+ minutes, the entire dataset is re-fetched from scratch. Setting `gcTime` to 30 minutes keeps the cache warm across typical session usage.

- [ ] **Step 1: Open the file**

  ```
  frontend/src/components/providers.tsx
  ```

- [ ] **Step 2: Add gcTime to defaultOptions**

  Find:
  ```tsx
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
    },
  },
  ```

  Replace with:
  ```tsx
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,      // 1 min — serve cache, revalidate in bg
      gcTime: 30 * 60 * 1000,    // 30 min — keep cache alive across navigation
      retry: 1,
    },
  },
  ```

- [ ] **Step 3: Verify**

  Navigate to the transactions page, then to settings, then back. On the second visit the table should appear instantly (served from cache) while quietly revalidating in the background.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/providers.tsx
  git commit -m "fix(perf): increase React Query gcTime from 5 min to 30 min

  Keeps cache warm across navigation so returning to transactions
  doesn't trigger a full re-fetch from scratch."
  ```

---

## Task 8: Final Verification & Push

- [ ] **Step 1: Full build check**

  ```bash
  cd frontend && npm run build
  ```

  Expected: build completes with no TypeScript errors. Warnings about missing `use client` or image dimensions are acceptable — TypeScript errors are not.

- [ ] **Step 2: Run lint**

  ```bash
  cd frontend && npm run lint
  ```

  Fix any lint errors introduced. Warnings are acceptable.

- [ ] **Step 3: Smoke test the transactions page**

  - Load the transactions page → should be noticeably faster on first render
  - Click a category cell → dropdown should open once, cleanly, no flicker
  - Click the amount pill → direction should toggle immediately with no delay
  - Scroll to the bottom → more rows load smoothly without jank
  - Navigate away and back → table appears instantly from cache
  - Apply a filter → filtered results appear without delay
  - Multi-select rows → checkboxes respond immediately

- [ ] **Step 4: Push branch**

  ```bash
  git push -u origin perf/frontend-performance
  ```

- [ ] **Step 5: Create PR**

  ```bash
  gh pr create \
    --title "perf: eliminate UI lag on transactions page" \
    --body "$(cat <<'EOF'
  ## Summary
  - Fix category dropdown open→close→open flicker (Task 1)
  - Reduce infinite scroll page size 500 → 100 (Task 2)
  - Replace O(n²) split-parent filter with O(n) Set lookup (Task 3)
  - Pre-compute daily debit totals as Map instead of O(n²) filter/reduce (Task 4)
  - Remove volatile data arrays from columns useMemo dep array — columns no longer rebuild on every scroll page fetch (Task 5)
  - Throttle header scroll sync with requestAnimationFrame (Task 6)
  - Increase React Query gcTime 5 min → 30 min (Task 7)

  ## Test plan
  - [ ] Category dropdown opens once cleanly, no flicker
  - [ ] Clicking amount pill / category / tags responds immediately
  - [ ] Scrolling through 500+ transactions stays smooth
  - [ ] Infinite scroll still loads new pages at the bottom
  - [ ] Daily totals in date headers are correct
  - [ ] Split transactions still display correctly (split parts shown, parent hidden)
  - [ ] Navigating away and back serves from cache
  - [ ] TypeScript build passes with no errors

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

## Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Initial page load (DOM nodes) | ~500 rows × columns | ~100 rows × columns |
| Category click response | ~150–200ms (column rebuild) | ~16ms (no rebuild) |
| Category dropdown | Opens→closes→reopens | Opens once, cleanly |
| columns useMemo rebuild triggers | Every scroll fetch, every data load | Only editing/selection/keyboard-nav state changes |
| Daily total calculation per render | O(n²) — ~250k iterations | O(n) — ~100 iterations |
| Scroll handler DOM writes/sec | Up to 120 | 1 per animation frame (60 max) |
| Cache warm after navigation | Re-fetches from scratch after 5 min | Serves cache for 30 min |
