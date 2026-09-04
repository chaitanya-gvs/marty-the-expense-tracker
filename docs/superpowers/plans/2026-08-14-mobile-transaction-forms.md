# Mobile Transaction Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Add Transaction, the drawer's edit form, and Bulk Edit comfortable on a 375px phone (amount-first layout, 16px inputs, 44px touch rows, design-system controls) with no change at ≥768px.

**Architecture:** Class-level responsive changes (`md:` variants, `order-*`) in the two modals; the drawer's edit branch is rewritten to use `Input`/`Select`/`Switch`/`Label` from `components/ui` behind a tiny local `Field` wrapper. No state, validation, mutation, or copy changes.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4, Radix Select/Switch/Label via `components/ui`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-mobile-transaction-forms-design.md`.
- Desktop (≥768px) rendering of Add Transaction and Bulk Edit must be visually identical to before — every mobile class has an `md:` counterpart restoring the previous value.
- No new colour tokens, fonts, dependencies, or emoji. Icons are `lucide-react`.
- **Data safety (binding):** production backend. Never create, edit, or delete any transaction, budget, category, tag, or participant. No verification step may submit a form.
- No test runner. Verification = `npm run type-check`, `npm run lint` (no new warnings in touched files) from `frontend/`. Browser verification is BLOCKED (login wall) — list the spec's browser checks as pending in each report; do not attempt to log in.
- Read each file before editing; apply exactly the edits below.

---

### Task 1: Add Transaction — amount-first mobile layout

**Files:**
- Modify: `frontend/src/components/transactions/add-transaction-modal.tsx`

- [ ] **Step 1: Row 1 wrapper and ordering**

Replace:
```typescript
            <div className="grid grid-cols-[auto_1fr_160px] gap-3 items-end">
```
with:
```typescript
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_160px] md:items-end">
```

Then give the three `FieldRow`s inside it an explicit order (the `FieldRow` component accepts `className`):
- Date: `<FieldRow label="Date" className="order-3 md:order-1">`
- Amount: `<FieldRow label="Amount" required className="order-1 md:order-2">`
- Direction: `<FieldRow label="Direction" className="order-2 md:order-3">`

- [ ] **Step 2: Inputs**

Date input className: `"w-auto text-sm"` → `"w-full md:w-auto h-11 md:h-9 text-base md:text-sm"`.

Amount `₹` prefix span: add `text-base md:text-sm` in place of its `text-sm` (keep the rest of its classes). Amount `Input`: className `"pl-7 font-mono text-sm tabular-nums"` → `"pl-7 font-mono tabular-nums h-12 text-xl md:h-9 md:text-sm"`, and add `inputMode="decimal"` to it.

Direction container: `"relative flex h-9 rounded-md overflow-hidden border border-border bg-muted text-xs font-medium"` → `"relative flex h-11 md:h-9 rounded-md overflow-hidden border border-border bg-muted text-sm md:text-xs font-medium"`.

Account `FieldAutocomplete`: className `"w-full"` → `"w-full h-11 md:h-9 text-base md:text-sm"`.

Description `Input`: className `"text-sm"` → `"h-11 md:h-9 text-base md:text-sm"`.

- [ ] **Step 3: Row 4 wrapper**

`<div className="grid grid-cols-2 gap-3">` (Category + Tags) → `<div className="grid grid-cols-1 gap-3 md:grid-cols-2">`.

- [ ] **Step 4: Verify + commit**

`npm run type-check`, `npm run lint` — clean, no new warnings in this file. Confirm `git diff` shows only className/`inputMode` edits and the three `className` props on `FieldRow`; no logic lines changed.

```bash
git add frontend/src/components/transactions/add-transaction-modal.tsx
git commit -m "feat(transactions): amount-first mobile layout and 16px inputs for Add Transaction"
```

---

### Task 2: Bulk Edit — touch-sized controls

**Files:**
- Modify: `frontend/src/components/transactions/bulk-edit-modal.tsx`

- [ ] **Step 1: Field-card header rows**

Each of the three field cards has `<div className="flex items-center gap-3">` immediately inside `<div className="p-3 rounded-lg bg-muted/40 border border-border/50">`. Change all three to `"flex items-center gap-3 min-h-11 md:min-h-0"`.

- [ ] **Step 2: Segmented mode buttons (9 buttons)**

Every mode button in the three segmented controls has a className starting `"px-2 py-0.5 text-xs rounded transition-colors"` (the Find & Replace one starts `"flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors"`). Replace the `px-2 py-0.5` token pair with `px-3 py-1.5 md:px-2 md:py-0.5` in all nine. Nothing else in those class strings changes.

- [ ] **Step 3: Inputs**

- Description "set" `Input`: `"mt-2 h-10"` → `"mt-2 h-11 md:h-10 text-base md:text-sm"`.
- Find and Replace `Input`s: `"h-10 text-sm"` → `"h-11 md:h-10 text-base md:text-sm"` (both).

- [ ] **Step 4: Selected-transactions disclosure and rows**

- Disclosure button className `"flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"` → add `min-h-11 md:min-h-0`.
- Each row `"p-2 rounded-md bg-muted/30 border border-border/40 text-xs"` → `"p-2.5 md:p-2 min-h-11 md:min-h-0 rounded-md bg-muted/30 border border-border/40 text-sm md:text-xs"`.

- [ ] **Step 5: Verify + commit**

`npm run type-check`, `npm run lint` — clean. `git diff` shows only className edits.

```bash
git add frontend/src/components/transactions/bulk-edit-modal.tsx
git commit -m "feat(transactions): touch-sized controls in Bulk Edit on mobile"
```

---

### Task 3: Drawer edit form — design-system controls

**Files:**
- Modify: `frontend/src/components/transactions/transaction-details-drawer.tsx`

- [ ] **Step 1: Imports**

Add (keep existing imports; `Textarea`, `Button`, `X`, `ChevronDown`, `Loader2`, `cn` are already imported):
```typescript
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

- [ ] **Step 2: Local `Field` helper**

Add above `export function TransactionDetailsDrawer` (module scope):
```typescript
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">{label}</Label>
            {children}
        </div>
    );
}
```
(`React` is referenced as a type only; if the file doesn't import React, use `import type { ReactNode } from "react"` and `children: ReactNode`.)

- [ ] **Step 3: Replace the edit branch's field markup**

Inside the `) : (` edit branch, replace everything from `<div className="mt-6 space-y-4">` through the closing `</div>` that precedes `)}` / `</SheetContent>` with:

```typescript
                    <div className="mt-6 space-y-4">
                        <Field label="Description">
                            <Input
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="h-11 text-base"
                            />
                        </Field>

                        <Field label="Category">
                            <CategorySelector
                                value={form.category}
                                onValueChange={(value) => setForm({ ...form, category: value })}
                                transactionDirection={form.direction}
                            />
                        </Field>

                        <Field label="Tags">
                            <MultiTagSelector
                                selectedTags={selectedTags}
                                onTagsChange={setSelectedTags}
                            />
                            {unresolvedTagNames.length > 0 && (
                                <div className="mt-1.5">
                                    <p className="text-xs text-muted-foreground mb-1">
                                        {unresolvedTagNames.length} tag{unresolvedTagNames.length === 1 ? "" : "s"} will be kept:
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {unresolvedTagNames.map((name) => (
                                            <span
                                                key={name}
                                                className="inline-flex items-center gap-1 min-h-7 pl-2 pr-1 rounded-full bg-muted text-muted-foreground text-xs"
                                            >
                                                {name}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setUnresolvedTagNames((prev) => prev.filter((n) => n !== name))
                                                    }
                                                    className="rounded-full p-0.5 hover:bg-background/60"
                                                    aria-label={`Remove tag ${name}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Field>

                        <Field label="Notes">
                            <Textarea
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder="Add a note…"
                                rows={3}
                                className="text-base"
                            />
                        </Field>

                        <button
                            type="button"
                            onClick={() => setAdvancedOpen(!advancedOpen)}
                            className="w-full min-h-11 flex items-center justify-between py-2.5 border-t border-border text-xs font-semibold text-muted-foreground"
                        >
                            <span>Advanced (date, account, amount, flags)</span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                        </button>

                        {advancedOpen && (
                            <div className="space-y-4 pt-1">
                                <Field label="Date">
                                    <Input
                                        type="date"
                                        value={form.date}
                                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                                        className="h-11 text-base"
                                    />
                                </Field>
                                <Field label="Account">
                                    <Input
                                        value={form.account}
                                        onChange={(e) => setForm({ ...form, account: e.target.value })}
                                        className="h-11 text-base"
                                    />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Direction">
                                        <Select
                                            value={form.direction}
                                            onValueChange={(value) => setForm({ ...form, direction: value as "debit" | "credit" })}
                                        >
                                            <SelectTrigger className="h-11 text-base">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="debit">Debit (money out)</SelectItem>
                                                <SelectItem value="credit">Credit (money in)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="Amount">
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.01"
                                            value={form.amount}
                                            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                                            className="h-11 text-base font-mono tabular-nums"
                                        />
                                    </Field>
                                </div>
                                <div className="divide-y divide-border rounded-md border border-border">
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Shared</span>
                                        <Switch checked={form.is_shared} onCheckedChange={(checked) => setForm({ ...form, is_shared: checked })} />
                                    </label>
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Refund</span>
                                        <Switch checked={form.is_refund} onCheckedChange={(checked) => setForm({ ...form, is_refund: checked })} />
                                    </label>
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Transfer</span>
                                        <Switch checked={form.is_transfer} onCheckedChange={(checked) => setForm({ ...form, is_transfer: checked })} />
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1 h-11" onClick={handleCancel} disabled={updateTransaction.isPending}>
                                Cancel
                            </Button>
                            <Button className="flex-1 h-11" onClick={handleSave} disabled={updateTransaction.isPending}>
                                {updateTransaction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                            </Button>
                        </div>
                    </div>
```

Keep every handler/state reference exactly as it exists in the file today (`form`, `setForm`, `selectedTags`, `setSelectedTags`, `unresolvedTagNames`, `setUnresolvedTagNames`, `advancedOpen`, `setAdvancedOpen`, `handleCancel`, `handleSave`, `updateTransaction`). If the current file's edit branch contains anything not shown here (compare before replacing), keep it and report the difference.

- [ ] **Step 4: Verify + commit**

`npm run type-check`, `npm run lint` — clean, no new warnings in this file. Check that `Select`'s `onValueChange` typing compiles (Radix passes `string`).

```bash
git add frontend/src/components/transactions/transaction-details-drawer.tsx
git commit -m "feat(transactions): drawer edit form uses design-system inputs, selects and switches"
```

---

### Task 4: Slice verification (code-level while browser is blocked)

- [ ] `npm run type-check`, `npm run lint`; no new warnings in the three files.
- [ ] Diff review: every mobile class in Tasks 1–2 has an `md:` counterpart restoring the previous value (list them in the report); no logic lines changed in Tasks 1–2.
- [ ] Append the spec's browser checks to `.superpowers/sdd/forms/verification-pending.md`.
