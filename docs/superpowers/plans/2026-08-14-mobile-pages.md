# Mobile Pages Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two confirmed horizontal-overflow bugs (Analytics, Budgets), size charts for phones, and apply the touch rulebook to every component on the Analytics, Budgets, Review, Settlements and Settings pages — ≥768px identical.

**Architecture:** Class/attribute changes per the spec's per-component lists plus one `useIsMobile()` read in the charts component; one commit per page.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-mobile-pages-design.md`. Rulebook: `docs/superpowers/specs/2026-08-14-mobile-modal-internals-design.md` (R1–R9, R10 no-logic).
- Desktop (≥768px) identical: every mobile class has an `md:` restore of the exact previous COMPUTED value (remember `Input` already computes `text-sm` on desktop; restore `md:text-sm`, not `md:text-xs`). Padding-driven icon buttons use the established `flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0` (or the dense exception where the spec says so).
- **Data safety (binding):** production backend. Never create, edit, or delete a transaction, budget, category, tag, participant, or settlement; never run/cancel a workflow; never submit a form.
- No test runner. `npm run type-check`, `npm run lint` (no new warnings; baseline 77) from `frontend/`. Browser verification is BLOCKED — record pending checks.
- Each report includes a CHANGE TABLE (line · element · before · after · rule/spec item) and, for Tasks 1–2, a short argument for why no row can exceed 375px after the change.

---

### Task 1: Analytics
- Modify: `frontend/src/components/analytics/analytics-filters.tsx`, `analytics-charts.tsx`, `analytics-overview.tsx`
- [ ] Apply spec Component 1. In `analytics-charts.tsx` import `useIsMobile` from `@/hooks/use-is-mobile`, call it unconditionally at the top of the component that renders the `ResponsiveContainer`s, and use `height={isMobile ? 300 : 420}` / `height={isMobile ? 280 : 380}` (leave the 230 one). If the containers live in a component that is not a client component, add `"use client"` only if it is missing (state it).
- [ ] Verify; commit `feat(analytics): mobile filter row wraps/scrolls, phone chart heights, touch sizing`.

### Task 2: Budgets
- Modify: `frontend/src/app/budgets/page.tsx`, `frontend/src/components/budgets/budget-card.tsx`, `budget-create-modal.tsx`, `budget-override-modal.tsx`, `no-budget-warning.tsx`
- [ ] Apply spec Component 2 exactly (header `flex-col md:flex-row`, centred month navigator, wrapping list header, 36px card icon buttons, R1/R2 in the two modals and the warning).
- [ ] Verify; commit `feat(budgets): mobile header/list-header layout, touch sizing, modal inputs`.

### Task 3: Review queue
- Modify: `frontend/src/components/review/statement-review-queue.tsx`
- [ ] Apply spec Component 3.
- [ ] Verify; commit `feat(review): touch sizing for the statement review queue`.

### Task 4: Settlements
- Modify: `frontend/src/app/settlements/page.tsx`, `frontend/src/components/settlements/settlement-filters.tsx`, `splitwise-tab.tsx`, `manual-tab.tsx`
- [ ] Apply spec Component 4 (tab strip, ResponsivePopover migration with `title`, rulebook on both tabs).
- [ ] Verify; commit `feat(settlements): full-width tabs, sheet filter popover, touch sizing`.

### Task 5: Settings
- Modify: `frontend/src/components/settings/categories-manager.tsx`, `tags-manager.tsx`
- [ ] Apply spec Component 5.
- [ ] Verify; commit `feat(settings): full-width nested tabs and touch sizing for category/tag managers`.

### Task 6: Verification + push
- [ ] `npm run type-check`, `npm run lint`; append browser checks to `.superpowers/sdd/pages/verification-pending.md`; push `feature/mobile-responsive` to origin (never merge).
