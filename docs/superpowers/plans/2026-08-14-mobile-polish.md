# Mobile Polish Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App-wide tactile/touch finish and reduced-motion support, plus closing the parked per-task review items.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-08-14-mobile-polish-design.md`. Rulebook R10 (no logic) applies.
- **Data safety:** production backend — no data changes, no form submissions.
- `npm run type-check`, `npm run lint` clean (no new warnings). Browser verification blocked — record pending checks.

### Task 1: Primitives — tactile press, touch-manipulation, reduced motion
- Modify: `frontend/src/components/ui/button.tsx` (add `active:scale-[0.98] transition-transform touch-manipulation` to the base cva string; keep everything else), `frontend/src/components/ui/tabs.tsx` (TabsTrigger `touch-manipulation`), `frontend/src/components/ui/select.tsx` (SelectTrigger `touch-manipulation`), `frontend/src/components/ui/checkbox.tsx` and `switch.tsx` (`touch-manipulation`), `frontend/src/components/transactions/transaction-card-list.tsx` (row button `select-none touch-manipulation`), `frontend/src/app/globals.css` (append a `@media (prefers-reduced-motion: reduce)` block: `.animate-in, .animate-out { animation-duration: 1ms !important; animation-delay: 0ms !important; } * { transition-duration: 0.01ms !important; }` — keep it minimal and commented).
- [ ] Verify; commit `feat(ui): tactile press feedback, touch-manipulation, and reduced-motion support`.

### Task 2: Parked review items
- Modify: `frontend/src/components/transactions/email-card.tsx` (Unlink/Expand icon buttons `h-11 w-11 md:h-6 md:w-6` replacing the `h-9 w-9` dense exception), `frontend/src/components/settlements/settlement-filters.tsx` (badge `X` button: add `relative before:absolute before:-inset-2.5 before:content-['']` so the hit area is ~44px while the chip is unchanged; keep its size classes), `frontend/src/components/transactions/group-expense-modal.tsx` (stats grid: `grid-cols-2 md:grid-cols-3 gap-px md:gap-0 md:divide-x` and the third cell `col-span-2 md:col-span-1` — inspect the actual markup and apply the closest equivalent that removes the stray divider on mobile; state what you did).
- [ ] Verify; commit `fix(ui): unify email-card button sizes, enlarge chip remove hit area, fix wrapped stat divider`.

### Task 3: Empty/loading/error state audit
- Inspect (read-only unless a CTA is under 44px or an empty state is left-aligned/cramped at 375px): `transaction-card-list.tsx` (empty + error + loading), `budgets-list.tsx`/`no-budget-warning.tsx`, `analytics-overview.tsx`, `statement-review-queue.tsx`, `splitwise-tab.tsx`/`manual-tab.tsx`, `categories-manager.tsx`/`tags-manager.tsx`. Apply `min-h-11 md:min-h-0` to any CTA under 44px and `text-center py-10` wrappers where an empty message is a bare paragraph.
- [ ] Verify; commit `feat(ui): consistent mobile empty/loading state blocks` (skip the commit if nothing needed changing — say so).

### Task 4: Consolidate + push
- [ ] Merge every `verification-pending.md` and `verification-priority.md` under `.superpowers/sdd/` into `docs/superpowers/plans/2026-08-14-mobile-verification-checklist.md` (a human-runnable checklist, grouped by page, with the "never submit/confirm" rule at the top); commit `docs: mobile verification checklist`; push `feature/mobile-responsive` (never merge).
