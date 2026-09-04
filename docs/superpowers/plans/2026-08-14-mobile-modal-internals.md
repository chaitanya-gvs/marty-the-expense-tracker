# Mobile Modal Internals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the mobile touch/typography rulebook to the ten remaining transaction surfaces so each is comfortable at 375px and byte-identical at ≥768px.

**Architecture:** Rule-driven className passes, one commit per file (or file pair). No logic changes. Each task produces a change table (line · before · after · rule) that the reviewer audits against the rulebook.

**Tech Stack:** Next.js 15, React 19, Tailwind 4.

## Global Constraints

- Spec + rulebook (binding, read it first): `docs/superpowers/specs/2026-08-14-mobile-modal-internals-design.md`.
- Desktop (≥768px) identical: every mobile class has an `md:` restore of the exact current value.
- No new colour tokens, fonts, dependencies, emoji; no handler/state/prop/copy changes (R10).
- **Data safety (binding):** production backend. Never create, edit, or delete any transaction, budget, category, tag, or participant. Never submit any form.
- No test runner. Verification = `npm run type-check`, `npm run lint` (no new warnings in touched files) from `frontend/`. Browser verification is BLOCKED (login wall) — record pending checks; do not attempt to log in.
- Each task's report MUST include the change table. A change without an `md:` restore, or a diff line that is not a className/`inputMode`/`side` attribute, fails review.

---

### Task 1: `shared-expense-editor.tsx`
- Modify: `frontend/src/components/transactions/shared-expense-editor.tsx`
- [ ] Read the file. Apply R1 (amount inputs, `inputMode="decimal"`), R2, R3 (participant/split rows), R6 (the two `group-hover` reveals), R8, R9 (if it has its own action row).
- [ ] `npm run type-check`, `npm run lint`. Change table in report.
- [ ] `git add` this file only; commit `feat(transactions): mobile touch pass for shared expense editor`.

### Task 2: `split-transaction-modal.tsx`
- Modify: `frontend/src/components/transactions/split-transaction-modal.tsx`
- [ ] Apply R1, R2, R3 (part rows), R5 (the `w-[72px]` row), R8, R9. Leave `KeepOriginalToggle` and `RemainingBar` untouched.
- [ ] Verify; commit `feat(transactions): mobile touch pass for split transaction modal`.

### Task 3: `group-expense-search-modal.tsx` + `group-expense-modal.tsx`
- Modify both files.
- [ ] Search modal: R1 (`inputMode="search"`), R2, R3 (candidate rows), R8. Group modal: R4 on its `grid-cols-3` (state in the report whether it holds fields or stats and which rule variant you applied), R1, R2.
- [ ] Verify; one commit `feat(transactions): mobile touch pass for group expense modals`.

### Task 4: `group-transfer-modal.tsx`
- Modify: `frontend/src/components/transactions/group-transfer-modal.tsx`
- [ ] R1, R2, R3, R8, R9.
- [ ] Verify; commit `feat(transactions): mobile touch pass for group transfer modal`.

### Task 5: `email-links-drawer.tsx` + `email-card.tsx`
- Modify both.
- [ ] Drawer: R4 on `grid-cols-2`, R1 (`inputMode="search"`), R2, R3 (email rows), R8. Card: R2/R7 on its action buttons, R8 on chip rows; do not change its expand/collapse behaviour.
- [ ] Verify; one commit `feat(transactions): mobile touch pass for email links drawer and email card`.

### Task 6: `related-transactions-drawer.tsx` + `recurring-modal.tsx`
- Modify both.
- [ ] Related: R5 (`w-[72px]`), R2/R7 (18 `text-xs` tappables), R3, R8. Recurring: keep `grid-cols-2`, R3 on the period rows (`min-h-11`), R2.
- [ ] Verify; one commit `feat(transactions): mobile touch pass for related transactions and recurring modals`.

### Task 7: `pdf-viewer.tsx` + `workflow-sheet.tsx`
- Modify both.
- [ ] PDF viewer: R2 on toolbar buttons only. Workflow sheet (R11): its `SheetContent` gets `side={isMobile ? "bottom" : "right"}` using `useIsMobile()` (import from `@/hooks/use-is-mobile`), keeping every other prop; apply R1/R2/R6/R8 to header/action controls only; do NOT touch the progress tree. If the file's structure makes the `side` switch unsafe (e.g. it depends on side-specific classes), report NEEDS_CONTEXT instead of guessing.
- [ ] Verify; one commit `feat(workflow): mobile bottom-sheet import panel; touch pass for pdf viewer toolbar`.

### Task 8: Slice verification (code-level)
- [ ] `npm run type-check`, `npm run lint` clean; concatenate all change tables into `.superpowers/sdd/internals/change-tables.md`; append the spec's browser list to `.superpowers/sdd/internals/verification-pending.md`.
