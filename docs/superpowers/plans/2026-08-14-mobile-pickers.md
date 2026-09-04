# Mobile Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap-to-open pickers (tags, participants) present as bottom sheets on mobile and remain anchored popovers on desktop, via a drop-in `ResponsivePopover` wrapper.

**Architecture:** `ResponsivePopover{,Trigger,Content}` mirror the Radix `Popover` API and switch on `useIsMobile()` between `Popover` (desktop) and `Dialog` (mobile — already bottom-anchored at z-70 by Phase 1). Four pickers swap one import line. `DialogContent` gains a `container` prop so pickers that portal into a host element keep working on mobile.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4, @radix-ui/react-popover, @radix-ui/react-dialog, cmdk.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-mobile-pickers-design.md`. Z-scale from Phase 1 is binding (Modal 60 < Dialog 70 < Popover 100).
- Desktop (≥768px) behaviour of every picker must be identical to before: same `PopoverContent` props reach Radix, same classes.
- No new colour tokens, fonts, dependencies, or emoji.
- **Data safety (binding):** production backend. Never create, edit, or delete any transaction, budget, category, tag, or participant. No verification step may submit a form.
- No test runner. Verification = `npm run type-check`, `npm run lint` (no new warnings in touched files), from `frontend/`. Browser verification is currently BLOCKED by a login wall — list the spec's browser checks as pending in reports; do not attempt to log in.

---

### Task 1: `DialogContent.container` + `ResponsivePopover`

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`
- Create: `frontend/src/components/ui/responsive-popover.tsx`

**Interfaces:**
- Produces: `ResponsivePopover` (props of `Popover` root), `ResponsivePopoverTrigger` (props of `PopoverTrigger`), `ResponsivePopoverContent` (props of `PopoverContent` + `title?: string`). `DialogContent` gains `container?: HTMLElement | null`.

- [ ] **Step 1: `container` on `DialogContent`**

In `dialog.tsx`, change the `DialogContent` signature and portal:

```typescript
function DialogContent({
  className,
  children,
  showCloseButton = true,
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Portal target; defaults to document.body. */
  container?: HTMLElement | null
}) {
  return (
    <DialogPortal data-slot="dialog-portal" container={container ?? undefined}>
```

Nothing else in the file changes.

- [ ] **Step 2: Write `responsive-popover.tsx`**

```typescript
"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

/**
 * Drop-in replacement for Popover/PopoverTrigger/PopoverContent that renders a
 * bottom-anchored Dialog sheet on mobile (<768px) and the normal anchored
 * Popover on desktop. Only for tap-to-open pickers — never for typeahead
 * suggestions anchored to an input (a modal Dialog would steal focus from it).
 * See docs/superpowers/specs/2026-08-14-mobile-pickers-design.md.
 */

type RootProps = React.ComponentProps<typeof PopoverPrimitive.Root>

function ResponsivePopover({ modal, ...props }: RootProps) {
  const isMobile = useIsMobile()
  if (isMobile) {
    // Always modal on mobile: the sheet needs its scrim and focus trap.
    return <Dialog {...props} />
  }
  return <Popover modal={modal} {...props} />
}

type TriggerProps = React.ComponentProps<typeof PopoverPrimitive.Trigger>

function ResponsivePopoverTrigger(props: TriggerProps) {
  const isMobile = useIsMobile()
  if (isMobile) {
    return <DialogTrigger {...(props as React.ComponentProps<typeof DialogPrimitive.Trigger>)} />
  }
  return <PopoverTrigger {...props} />
}

type ContentProps = React.ComponentProps<typeof PopoverContent> & {
  /** Accessible name for the mobile sheet (rendered sr-only). */
  title?: string
}

function ResponsivePopoverContent({
  title = "Options",
  className,
  children,
  // popover-only positioning props — stripped on mobile
  align,
  alignOffset,
  side,
  sideOffset,
  avoidCollisions,
  collisionPadding,
  collisionBoundary,
  sticky,
  hideWhenDetached,
  arrowPadding,
  updatePositionStrategy,
  container,
  ...rest
}: ContentProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    const {
      onOpenAutoFocus,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onPointerDownOutside,
      onInteractOutside,
      onMouseLeave,
      style,
    } = rest
    return (
      <DialogContent
        showCloseButton={false}
        container={container}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
        onPointerDownOutside={onPointerDownOutside}
        onInteractOutside={onInteractOutside}
        onMouseLeave={onMouseLeave}
        style={style}
        className={cn(
          "bg-popover text-popover-foreground p-2 max-h-[60dvh] overflow-y-auto",
          "[&_[role=option]]:min-h-11 [&_[cmdk-item]]:min-h-11 [&_[role=button]]:min-h-11",
          className
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    )
  }

  return (
    <PopoverContent
      className={className}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      avoidCollisions={avoidCollisions}
      collisionPadding={collisionPadding}
      collisionBoundary={collisionBoundary}
      sticky={sticky}
      hideWhenDetached={hideWhenDetached}
      arrowPadding={arrowPadding}
      updatePositionStrategy={updatePositionStrategy}
      container={container}
      {...rest}
    >
      {children}
    </PopoverContent>
  )
}

export { ResponsivePopover, ResponsivePopoverTrigger, ResponsivePopoverContent }
```

Notes: on desktop every prop (including `undefined` positional ones) is forwarded exactly as a direct `PopoverContent` usage would receive them — `PopoverContent` applies its own defaults (`align="center"`, `sideOffset=4`) only when the prop is `undefined`, so passing `undefined` through is equivalent to omitting. If `tsc` complains about a specific prop name not existing on `PopoverContent`'s type (Radix version differences), drop that name from the destructure list and let it flow via `...rest`; note it in the report.

- [ ] **Step 3: Verify**

`npm run type-check`, `npm run lint` — clean, no new warnings in the two files. No consumers yet, so this is compile-only.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx frontend/src/components/ui/responsive-popover.tsx
git commit -m "feat(ui): ResponsivePopover (Popover on desktop, bottom-sheet Dialog on mobile); DialogContent container prop"
```

---

### Task 2: Migrate the four tap-to-open pickers

**Files:**
- Modify: `frontend/src/components/transactions/multi-tag-selector.tsx`
- Modify: `frontend/src/components/transactions/tag-selector.tsx`
- Modify: `frontend/src/components/transactions/participant-combobox.tsx`
- Modify: `frontend/src/components/transactions/participant-multi-select.tsx`

- [ ] **Step 1: Import swap (each file)**

Replace the existing popover import with the aliased responsive one so JSX stays untouched.

`multi-tag-selector.tsx` — replace:
```typescript
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
```
with:
```typescript
import {
  ResponsivePopover as Popover,
  ResponsivePopoverContent as PopoverContent,
  ResponsivePopoverTrigger as PopoverTrigger,
} from "@/components/ui/responsive-popover";
```

`tag-selector.tsx` — replace:
```typescript
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```
with:
```typescript
import {
  ResponsivePopover as Popover,
  ResponsivePopoverContent as PopoverContent,
  ResponsivePopoverTrigger as PopoverTrigger,
} from "@/components/ui/responsive-popover";
```

`participant-combobox.tsx` and `participant-multi-select.tsx` — same three-line replacement as `multi-tag-selector.tsx`.

- [ ] **Step 2: `title` on each Content**

- `multi-tag-selector.tsx` line ~156: `<PopoverContent className="w-full p-0" align="start">` → `<PopoverContent className="w-full p-0" align="start" title="Select tags">`
- `tag-selector.tsx` line ~169: same → add `title="Select tags"`
- `participant-combobox.tsx` line ~74: add `title="Select participant"` to the existing multi-line `<PopoverContent` opening tag.
- `participant-multi-select.tsx` line ~107: add `title="Select participants"`.

- [ ] **Step 3: Verify**

`npm run type-check`, `npm run lint` — clean, no new warnings in the four files. Confirm with `git diff --stat` that only the import block and one attribute per file changed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/transactions/multi-tag-selector.tsx frontend/src/components/transactions/tag-selector.tsx frontend/src/components/transactions/participant-combobox.tsx frontend/src/components/transactions/participant-multi-select.tsx
git commit -m "feat(transactions): tag and participant pickers open as bottom sheets on mobile"
```

---

### Task 3: Slice verification (code-level while browser is blocked)

- [ ] Run `npm run type-check` and `npm run lint`; confirm no new warnings vs. baseline in touched files.
- [ ] Trace for each migrated picker: on desktop, does Radix receive exactly the props it did before (compare the pre-change `<PopoverContent …>` attributes to what `ResponsivePopoverContent` forwards)? On mobile, is `container` still honoured, and do the two participant pickers' `onInteractOutside` handlers still receive the event object they expect?
- [ ] Record the spec's browser checks as pending in `.superpowers/sdd/pickers/verification-pending.md`.
