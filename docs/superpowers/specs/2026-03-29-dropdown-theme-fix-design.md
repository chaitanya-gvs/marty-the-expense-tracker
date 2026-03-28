# Dropdown Theme Consistency Fix

**Date:** 2026-03-29
**Status:** Approved

## Problem

Three dropdown components render with visual inconsistencies:

1. **`FieldAutocomplete`** — uses hardcoded `bg-white/gray-800` colors instead of CSS design tokens; suggestion list uses `position: absolute` so it gets clipped inside modal scroll containers (visible in Add Transaction modal where the account dropdown is cut off)
2. **`CategoryAutocomplete`** — same color and clipping issues; width uses `w-max min-w-[200px]` so it doesn't match the input field width
3. **`ParticipantMultiSelect`** — already uses Radix Popover (no clipping), but has a hardcoded `w-[400px]` that doesn't match trigger width

## Solution: Approach B — Convert to Radix Popover

`FieldAutocomplete` and `CategoryAutocomplete` already control open/closed state via `showSuggestions`. The change is to wrap the existing suggestion list JSX in `<Popover open={showSuggestions}>` / `<PopoverContent>` instead of a plain `<div>`. Radix portals the content to `<body>`, escaping all overflow clipping. Keyboard navigation, blur handling, and all existing logic are preserved — only the container changes.

## Components Modified

| File | Change |
|------|--------|
| `src/components/transactions/field-autocomplete.tsx` | Wrap suggestion div in `Popover` + `PopoverContent`; replace hardcoded colors with design tokens |
| `src/components/transactions/category-autocomplete.tsx` | Same; fix width |
| `src/components/transactions/participant-multi-select.tsx` | Replace `w-[400px]` with `w-[var(--radix-popover-trigger-width)]` |

No other files change.

## Color Token Mapping

| Hardcoded | Design Token | Resolves to (dark) |
|-----------|-------------|-------------------|
| `bg-white dark:bg-gray-800` | `bg-popover` | `#131418` |
| `border-gray-200 dark:border-gray-700` | `border border-border` | `rgba(255,255,255,0.07)` |
| `text-gray-500` | `text-muted-foreground` | `#94A3B8` |
| `hover:bg-gray-100 dark:hover:bg-gray-700` | `hover:bg-accent hover:text-accent-foreground` | amber, matches `ParticipantMultiSelect` |
| keyboard-selected `bg-gray-100 dark:bg-gray-700` | `bg-accent/10` | subtle amber tint |
| `text-blue-600 dark:text-blue-400` (create option) | `text-primary` | `#6366F1` |

## Width Fix

All three `PopoverContent` elements use `w-[var(--radix-popover-trigger-width)]` so the dropdown always matches the trigger field's width exactly. Radix sets this CSS variable automatically on the content element.

## Popover Structure

For `FieldAutocomplete` and `CategoryAutocomplete`, the `<input>` becomes the `<PopoverAnchor>` (not the trigger) so it keeps focus while the popover opens/closes programmatically via `open={showSuggestions}`. This preserves the existing focus/blur logic without modification.

## Out of Scope

- No changes to modal components
- No changes to keyboard navigation logic
- No changes to API calls or data fetching
- No changes to the Edit/Create category dialogs inside `CategoryAutocomplete`
