# Budgets Page Redesign — Design Spec
**Date:** 2026-04-18
**Status:** Approved for implementation planning
**Branch:** `feature/budgets`

---

## Overview

A visual redesign of the Budgets page. No backend changes — this is a pure frontend rework of the existing components (`BudgetsOverview`, `BudgetCard`, `BudgetsList`, `BudgetThresholdAlerts`, `budgets/page.tsx`). The data model and API are unchanged; only how the data is presented changes.

**Primary goal:** Make the committed vs. variable spend distinction immediately visible at every level — in the summary, in each card's progress bar, and in the recurring items list.

---

## Design Decisions

| Question | Decision |
|---|---|
| Primary use case | Both monitoring (am I on track?) AND managing (edit/add budgets) |
| Summary style | Ring chart + stat sidebar |
| Card layout | Option C — Timeline Card (left accent border + stacked bar + always-visible committed block) |
| Card actions visibility | Always visible (no hover-reveal) |
| Override action icon | `Replace` (Lucide) — replaces Calendar |

---

## Page Structure

```
┌─ Header: "Budgets" title + month navigator ─────────────────┐
├─ Summary Card ──────────────────────────────────────────────┤
│   Ring chart (utilisation %) │ 4 stat rows                  │
├─ Threshold Alerts (conditional) ────────────────────────────┤
├─ No-Budget Warning (conditional) ───────────────────────────┤
├─ Section header "Monthly Budgets · N active" + Add button ──┤
├─ Budget Card (repeated per budget) ─────────────────────────┤
│   Left accent border (health colour)                        │
│   Card header: name + limit | amount badge | 3 actions      │
│   Stacked progress bar                                      │
│   Legend row                                                │
│   Committed items block (if ≥ 1 recurring items)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Designs

### 1. Summary Card (`BudgetsOverview`)

**Layout:** Single card spanning full width. Two zones separated by a 1px divider:
- **Left zone:** Ring/donut chart (96px diameter) showing total budget utilisation.
- **Right zone:** 4 stat rows in a 2×2 grid.

**Ring chart:**
- Track colour: `bg-muted` (dark empty ring)
- Segment 1 — Committed: `indigo-500`, arc width proportional to `totalCommitted / totalLimit`
- Segment 2 — Variable: health colour (see colour scale below), arc proportional to `totalVariable / totalLimit`
- Segments are drawn consecutively (committed first, variable second)
- Centre text: `"XX%"` (utilisation percentage, large bold mono) + `"used"` label above + `"N over"` alert count below in red (hidden if 0 budgets over limit)

**Stat rows (2×2 grid):**
| Stat | Colour |
|---|---|
| Total Budget | `text-foreground` |
| Committed | `text-indigo-400` |
| Variable | `text-orange-400` (or red if any budget is over) |
| Headroom | `text-green-400` (positive) / `text-red-400` (negative) |

Each stat: label in `text-[9px] uppercase tracking-wider text-muted-foreground`, value in `text-xl font-bold font-mono`.

---

### 2. Threshold Alerts (`BudgetThresholdAlerts`)

Unchanged in behaviour. Visual update:
- Single slim banner (not individual rows) listing the worst-offending budget inline: `"⚠ [Category] is over budget by ₹X — ₹Y spent of ₹Z limit"`
- Background: `bg-red-950/20 border border-red-500/30 rounded-xl`
- Multiple alerts: show the most severe one inline; add `+N more` count link if >1

---

### 3. Budget Cards (`BudgetCard`)

#### Card container
```
bg-card rounded-xl border border-border
border-l-[3px] border-l-{health-colour}   ← left accent only
```
Left border colour follows the health scale (see below). Over-budget cards also get `border-t border-t-red-500/20` for a subtle top tint.

#### Card header
```
[Category name (font-semibold)]     [Amount + badge]  [Replace] [Edit2] [Trash2]
[Limit: ₹X / month  (muted xs)]
```
- **Amount**: `text-base font-bold font-mono` in health colour
- **Badge**: `"Over ₹X"` (red) or `"₹X left"` (green/muted) — `text-[9px] font-bold px-1.5 py-0.5 rounded`
- **Override button**: `Replace` icon (Lucide), `title="Set monthly override"`
- **Edit button**: `Edit2` icon
- **Delete button**: `Trash2` icon, `text-destructive/60 hover:text-destructive`
- All action buttons: `h-7 w-7 p-0` ghost variant, `rounded-md`
- If `has_override === true`: show a small `"Override"` badge (indigo outline) beside the category name

#### Stacked progress bar
```
h-[10px] rounded-full bg-muted overflow-hidden flex
```
Three segments rendered left to right:
1. **Committed** (indigo): `width = (committed_spend / effective_limit) * 100%`, `bg-indigo-500`
2. **Variable** (health colour): `width = min(variable_spend, effective_limit - committed_spend) / effective_limit * 100%`
3. **Remainder**: implicit (unfilled dark background)

**Over-budget state:** when `headroom < 0`, the bar fills 100% with a gradient `from-orange-500 to-red-500`. No overflow overflow is shown — the bar is simply full.

#### Legend row
```
● Committed ₹X   ● Variable ₹X   ● ₹X free    (or "−₹X over" in red)
```
- `text-[10px]` with 7px dot
- Committed dot: `bg-indigo-500`; Variable dot: health colour; Free dot: `bg-muted-foreground/30`
- Hidden dots/labels with ₹0 values are shown at reduced opacity (`opacity-40`) rather than hidden, so the layout stays stable

#### Committed items block
Rendered **only when `committed_items.length > 0`**.

```
┌─ dark inset panel (bg-background/60 rounded-lg border border-border/50) ──┐
│  ↻ Recurring · N items                    [label, 8px uppercase]          │
│  ─────────────────────────────────────────────────────────────────────     │
│  Description name   [period badge]              ₹amount  (mono, indigo)   │
│  Description name   [period badge] projected    ₹amount  (muted, italic)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- Period badge: `text-[8px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-1 rounded`
- Projected items: description in `text-muted-foreground italic`, amount in `text-muted-foreground`, badge shows `"projected"` in muted
- This block is **not collapsible** — always fully shown. Rationale: committed items are few (typically 1–5) and are core monitoring data, not noise.

---

### 4. Colour Health Scale

Used for left border, variable bar segment, amount text, and badge:

| Utilisation (`committed + variable / effective_limit`) | Colour token | Tailwind |
|---|---|---|
| < 50% | Green | `text-green-400` / `bg-green-500` / `border-l-green-500` |
| 50–74% | Yellow | `text-yellow-400` / `bg-yellow-500` / `border-l-yellow-500` |
| 75–94% | Orange | `text-orange-400` / `bg-orange-500` / `border-l-orange-500` |
| ≥ 95% or over | Red | `text-red-400` / `bg-red-500` / `border-l-red-500` |

The existing `getUtilisationColor` / `getUtilisationTextColor` helpers in `budget-card.tsx` already implement this — keep them, add a `getUtilisationBorderColor` counterpart.

---

### 5. Empty state

When `budgets.length === 0`:
```
Centred empty-state panel:
  Icon: PiggyBank (Lucide, 40px, muted)
  Heading: "No budgets yet"
  Body: "Create your first budget to start tracking spending limits."
  CTA: "+ Add Budget" button (indigo)
```
Replace the current plain-text border box.

---

## Files to Change

| File | Change |
|---|---|
| `src/components/budgets/budgets-overview.tsx` | Rewrite: ring chart + stat grid layout |
| `src/components/budgets/budget-card.tsx` | Rewrite: left-border card + stacked bar + always-visible committed block + Replace icon |
| `src/components/budgets/budgets-list.tsx` | Minor: update empty state; pass through unchanged otherwise |
| `src/components/budgets/budget-threshold-alerts.tsx` | Minor: update to single slim banner style |

No changes to:
- `budget-create-modal.tsx`, `budget-override-modal.tsx` — modals are fine
- `budgets/page.tsx` — page structure unchanged
- All hooks, API client, types — no backend changes

---

## Non-Goals

- No new data fetched — all fields already exist on `BudgetSummary`
- No animation beyond existing Tailwind transitions
- No mobile-specific layout changes (the page is desktop-first)
- No changes to the create/edit/override modal designs

---

## Colour & Spacing Reference

Matches app conventions from `globals.css` and `CLAUDE.md`:
- Use `cn()` for all conditional classes
- Currency: always `formatCurrency()`
- Icons: Lucide React
- Radix `Card` primitives are **not** used in the new design — use plain `div` with Tailwind for full border control (left-border accent requires `border-l-[3px]` which conflicts with Radix Card's uniform border)
