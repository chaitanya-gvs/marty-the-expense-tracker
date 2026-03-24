# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directory Structure

```
frontend/
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── tsconfig.json
├── components.json              # shadcn/ui config
├── public/                      # Static assets
└── src/
    ├── app/                     # Next.js App Router
    │   ├── layout.tsx           # Root layout (fonts, providers)
    │   ├── page.tsx             # Root redirect
    │   ├── globals.css          # Tailwind + CSS custom properties (OkLCH theme)
    │   ├── analytics/page.tsx
    │   ├── budgets/page.tsx
    │   ├── review/page.tsx
    │   ├── settings/page.tsx
    │   ├── settlements/page.tsx
    │   └── transactions/page.tsx
    ├── components/
    │   ├── providers.tsx        # React Query + ThemeProvider + Toaster
    │   ├── theme-toggle.tsx
    │   ├── analytics/
    │   │   ├── analytics-charts.tsx
    │   │   ├── analytics-filters.tsx
    │   │   └── analytics-overview.tsx
    │   ├── budgets/
    │   │   ├── budgets-list.tsx
    │   │   └── budgets-overview.tsx
    │   ├── layout/
    │   │   ├── main-layout.tsx
    │   │   └── navigation.tsx
    │   ├── review/
    │   │   └── review-queue.tsx
    │   ├── settings/
    │   │   ├── categories-manager.tsx
    │   │   └── tags-manager.tsx
    │   ├── settlements/
    │   │   └── settlement-filters.tsx
    │   ├── split-editor/
    │   │   └── split-editor.tsx
    │   ├── transactions/
    │   │   ├── transactions-page.tsx
    │   │   ├── transactions-table.tsx
    │   │   ├── transaction-filters.tsx
    │   │   ├── transaction-details-drawer.tsx
    │   │   ├── transaction-edit-modal.tsx
    │   │   ├── transaction-inline-edit.tsx
    │   │   ├── add-transaction-modal.tsx
    │   │   ├── bulk-edit-modal.tsx
    │   │   ├── split-transaction-modal.tsx
    │   │   ├── split-editor.tsx
    │   │   ├── group-expense-modal.tsx
    │   │   ├── group-expense-search-modal.tsx
    │   │   ├── group-transfer-modal.tsx
    │   │   ├── email-links-drawer.tsx
    │   │   ├── email-card.tsx
    │   │   ├── pdf-viewer.tsx
    │   │   ├── related-transactions-drawer.tsx
    │   │   ├── category-selector.tsx
    │   │   ├── category-autocomplete.tsx
    │   │   ├── inline-category-dropdown.tsx
    │   │   ├── tag-selector.tsx
    │   │   ├── multi-tag-selector.tsx
    │   │   ├── compact-tag-selector.tsx
    │   │   ├── inline-tag-editor.tsx
    │   │   ├── inline-tag-dropdown.tsx
    │   │   ├── tag-pill.tsx
    │   │   ├── participant-combobox.tsx
    │   │   ├── participant-multi-select.tsx
    │   │   ├── field-autocomplete.tsx
    │   │   ├── transfer-popover.tsx
    │   │   ├── transfer-chip.tsx
    │   │   ├── transfer-group-section.tsx
    │   │   ├── links-column.tsx
    │   │   ├── table-skeleton.tsx
    │   │   └── delete-confirmation-dialog.tsx
    │   ├── ui/                  # Radix UI primitives (button, dialog, sheet, etc.)
    │   │   └── modal/           # Custom modal primitives
    │   └── workflow/
    │       └── workflow-sheet.tsx
    ├── hooks/
    │   ├── use-transactions.ts
    │   ├── use-categories.ts
    │   ├── use-settlements.ts
    │   ├── use-workflow.ts
    │   ├── use-analytics.ts
    │   ├── use-budgets.ts
    │   ├── use-tags.ts
    │   ├── use-accounts.ts
    │   ├── use-participants.ts
    │   └── use-debounce.ts
    ├── lib/
    │   ├── api/
    │   │   ├── client.ts        # Singleton API client (all backend calls)
    │   │   └── types/
    │   │       └── workflow.ts
    │   ├── types/
    │   │   └── index.ts         # All canonical TypeScript interfaces
    │   ├── format-utils.ts      # formatCurrency(), formatDate()
    │   ├── utils.ts             # cn() helper
    │   └── workflow-tasks.ts    # SSE event → task tree builder
    └── store/
```

## Working Directory

**Always run all commands from `frontend/`** — this is where `package.json` lives. Never run npm commands from the repo root.

The dev server has hot reload enabled via Turbopack. **Do not restart it** unless explicitly asked or after config file changes.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:3000 (Turbopack)
npm run build        # Production build (also Turbopack)
npm run lint         # ESLint
```

## Configuration

- Backend URL: `NEXT_PUBLIC_API_URL=http://localhost:8000/api` (in `.env.local`)
- App env: `NEXT_PUBLIC_APP_ENV=development`
- Path alias: `@/*` → `src/*` (use this everywhere, not relative imports)
- Styling: Tailwind CSS v4 (no `tailwind.config.js` — uses PostCSS plugin)
- Theming: CSS custom properties in `src/app/globals.css` using OkLCH color space. Dark mode via CSS class.

## Architecture

### Data Flow

```
API Client (src/lib/api/client.ts)
    ↓
Custom Hooks (src/hooks/) — TanStack React Query wrappers
    ↓
Page Components (src/app/**/page.tsx)
    ↓
Feature Components (src/components/{feature}/)
    ↓
UI Primitives (src/components/ui/) — Radix UI + Tailwind
```

### API Client (`src/lib/api/client.ts`)

Singleton `apiClient` instance. All backend calls go through this — never use `fetch` or `axios` directly in components or hooks.

Key method groups:
- **Transactions**: `getTransactions()` (complex filter object), `createTransaction()`, `updateTransaction()`, `bulkUpdateTransactions()`, `deleteTransaction()`, `splitTransaction()`, `groupExpense()`, `groupTransfer()`
- **Splits**: `updateTransactionSplit()`, `clearTransactionSplit()`
- **Budgets/Tags/Categories**: Full CRUD + search + `upsertCategory()` / `upsertTag()`
- **Settlements**: `getSettlementSummary()`, `getSettlementDetail()`, `getSettlementParticipants()`
- **Workflow**: `startWorkflow()`, `cancelWorkflow()`, `getWorkflowStatus()`, `streamWorkflowEvents()` (returns `EventSource`)
- **Email linking**: `searchTransactionEmails()`, `linkEmailToTransaction()`, `unlinkEmailFromTransaction()`, `getTransactionSourcePdf()`
- **Analytics**: `getExpenseAnalytics()` with groupBy dimension support

### Hooks (`src/hooks/`)

Each hook file wraps the API client with TanStack React Query. Patterns to follow:

```typescript
// Query hook
export function useTransactions(filters: TransactionFilters) {
  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => apiClient.getTransactions(filters),
    staleTime: 60_000,
  });
}

// Mutation hook with cache invalidation
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiClient.createTransaction(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
}
```

Key hook files: `use-transactions.ts`, `use-categories.ts`, `use-settlements.ts`, `use-workflow.ts`, `use-analytics.ts`, `use-budgets.ts`, `use-tags.ts`, `use-accounts.ts`, `use-participants.ts`, `use-debounce.ts`

**Special patterns:**
- `useInfiniteTransactions()` — Infinite scroll (TanStack `useInfiniteQuery`)
- `useWorkflowStatus()` — Auto-refetches every 3s when job is non-terminal
- `useWorkflowStream()` — Opens `EventSource`, auto-closes on unmount
- `useBulkUpdateTransactions()` — Handles cache updates for both infinite and paginated queries

### State Management

- **Server state**: TanStack React Query (stale time: 1 min global, 30s for analytics/workflow)
- **UI state**: `useState` in components
- **Persistent state**: `localStorage` for transaction filters (persisted across sessions in transactions page)
- No Redux or Zustand — React Query is the source of truth for server data

### Pages (`src/app/`)

All pages use Next.js App Router. Each page file is a thin shell that renders a single feature component:

| Route | Feature Component |
|-------|-----------------|
| `/transactions` | `TransactionsPage` — infinite scroll table, filter panel, stats bar |
| `/settlements` | Inline in page.tsx — summary cards + tabbed overview/details |
| `/analytics` | `AnalyticsOverview` — Recharts visualizations |
| `/budgets` | `BudgetsOverview` + `BudgetsList` |
| `/review` | `ReviewQueue` — flagged/uncertain transactions |
| `/settings` | `CategoriesManager` + `TagsManager` (tabbed) |

### Components (`src/components/`)

Organized by feature. Key patterns:

**Modals/Drawers**: Use `Dialog` (Radix) for modals, `Sheet` for side drawers. Most detail views (edit, split, email links, PDF viewer) are drawers.

**Forms**: React Hook Form + Zod. Schema defined inline or in the component file. Always use `resolver: zodResolver(schema)`.

**Tables**: TanStack React Table (`useReactTable`). The transactions table uses virtual scrolling for performance.

**Inline editing**: Transactions support inline edits (category, tags, description) without opening a modal — see `transaction-inline-edit.tsx`.

**Autocomplete**: `field-autocomplete.tsx` and `category-autocomplete.tsx` use `getFieldValues()` API for suggestions.

### TypeScript Types (`src/lib/types/index.ts`)

All canonical interfaces live here. Key types:
- `Transaction` — Main transaction model with all optional fields for splits/groups/refunds
- `SplitBreakdown` / `SplitEntry` — Split expense structure (mirrors backend JSONB)
- `TransactionFilters` — All filter options for `getTransactions()`
- `SettlementSummary` / `SettlementDetail` / `SettlementTransaction`
- `EmailMetadata` / `EmailDetails` — Gmail integration types
- `ExpenseAnalyticsFilters` / `ExpenseAnalytics`
- `ApiResponse<T>` — Standard paginated response wrapper

### Utilities (`src/lib/`)

- `format-utils.ts` — `formatCurrency(amount)` (SSR-safe, INR/₹), `formatDate(dateString)` (SSR-safe)
- `utils.ts` — `cn(...inputs)` combines `clsx` + `tailwind-merge` for conditional class names
- `workflow-tasks.ts` — Converts flat SSE event array into a hierarchical task tree for the workflow UI

### Workflow UI

The review/workflow UI (`src/components/workflow/workflow-sheet.tsx`) streams real-time progress:
1. `useWorkflowStream()` opens an `EventSource` connection to the backend SSE endpoint
2. Events are fed into `buildTaskTree()` from `workflow-tasks.ts` to build a visual task tree
3. Tasks have statuses: `pending` → `running` → `done` | `error` | `skipped`

### Providers (`src/components/providers.tsx`)

Wraps the app with:
- `QueryClientProvider` (TanStack React Query, 1-min stale time, 1 retry)
- `ThemeProvider` (next-themes, supports `light`/`dark`/`system`)
- `Toaster` (sonner, top-right, rich colors)

Toast notifications are used in all mutation hooks — import `toast` from `sonner`.

## UI Component Conventions

- Use `cn()` for all conditional class names
- Radix UI primitives are in `src/components/ui/` — always use these, don't add raw HTML form elements
- Currency: always `formatCurrency()`, never manual `₹` formatting
- Dates: always `formatDate()` for display (SSR-safe)
- Icons: Lucide React (`lucide-react` package)
- Animations: Framer Motion for complex transitions; Tailwind transitions for simple hover/focus states
