# Mobile Overlay Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three overlay primitives (`Modal`, `Sheet`, `Dialog`/`AlertDialog`) mobile-aware — bottom-sheet / full-screen presentations, safe areas, a single documented z-index scale, correct scroll-lock — so all 29 overlay consumers get correct mobile chrome without being rewritten.

**Architecture:** `Modal` (custom, framer-motion) gains a `presentation` mode chosen from `useIsMobile()` + `size`, exposed to `Modal.Header/Body/Footer` through a React context so consumers change nothing. `Sheet` (Radix) hardens its `bottom` side and renders the grabber itself. `Dialog`/`AlertDialog` (Radix) anchor to the bottom below `md` via pure Tailwind variants and move above `Modal` in the z-order. The bottom nav drops to z-40 so every overlay covers it.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4 (`tw-animate-css` for `animate-in`/`slide-in-from-*`/`zoom-in-*`), framer-motion 12, @radix-ui/react-dialog + react-alert-dialog, lucide-react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-14-mobile-overlay-primitives-design.md`. Z-index scale (binding): bottom nav `z-40` · Sheet `z-50` · quick-actions panel `z-[55]` · Modal `z-[60]` · Dialog/AlertDialog `z-[70]` · sonner toasts (unchanged, higher).
- Mobile gate is `useIsMobile()` from `@/hooks/use-is-mobile` (`(max-width: 767px)`) for JS branches, or Tailwind `max-md:` / `md:` for pure CSS. Desktop (≥768px) rendering must be visually identical to before this plan.
- No new colour tokens, fonts, or dependencies. Use existing `bg-card`, `bg-border`, `--modal-panel`, `--modal-border`, `--modal-panel-header`, `--modal-muted`, `--modal-text`.
- No emoji anywhere. Icons are `lucide-react`.
- Motion: animate `transform`/`opacity` only; respect `useReducedMotion()`.
- **Data safety (binding, for every task's verification):** this frontend talks to the user's PRODUCTION backend. Never create, edit, or delete any transaction, budget, category, tag, or participant. Open overlays, inspect, then Cancel/close. If a flow cannot be exercised without saving, do not exercise it — say so in the report.
- No test runner exists (`package.json` has no `test` script). Verification = `npm run type-check`, `npm run lint` (no new warnings in touched files), and manual browser checks at **375×812** (`resize_window preset:"mobile"`) and **1280×800** (`resize_window {width:1280,height:800}` — the `desktop` preset is only ~657px, below the breakpoint). Run frontend commands from `frontend/`. Do not restart the dev server.
- Browser tool note: `computer left_click` often times out even though the click lands; verify via screenshot / `read_page` or dispatch `PointerEvent`s with `javascript_tool`. Transaction rows respond to pointer events (long-press hook), not `click`.

---

## File Structure

**Modified:**
- `frontend/src/components/layout/mobile-nav.tsx` — nav z-index
- `frontend/src/components/transactions/transaction-quick-actions-panel.tsx` — z-index, a11y, Escape
- `frontend/src/components/transactions/action-tile-grid.tsx` — widen `ActionTile.key`
- `frontend/src/app/globals.css` — z-index scale comment
- `frontend/src/components/ui/modal/index.tsx` — mobile presentations, scroll-lock fix (the main task)
- `frontend/src/components/ui/sheet.tsx` — bottom-side defaults + grabber
- `frontend/src/components/transactions/transaction-details-drawer.tsx` — drop hand-rolled grabber
- `frontend/src/components/ui/dialog.tsx`, `frontend/src/components/ui/alert-dialog.tsx` — bottom anchoring + z-[70]
- `frontend/src/components/transactions/transaction-card-list.tsx` — M2 spacing
- `frontend/src/components/transactions/transaction-filters.tsx` — M4 mobile Clear chip

---

### Task 1: Z-index scale — nav, quick-actions panel, tile keys, docs

**Files:**
- Modify: `frontend/src/components/layout/mobile-nav.tsx`
- Modify: `frontend/src/components/transactions/transaction-quick-actions-panel.tsx`
- Modify: `frontend/src/components/transactions/action-tile-grid.tsx`
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: Nav to z-40**

In `mobile-nav.tsx`, the `<nav>` className begins `"fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around bg-sidebar border-t border-sidebar-border"`. Change `z-50` → `z-40`. Nothing else in the file changes.

- [ ] **Step 2: Widen `ActionTile.key`**

In `action-tile-grid.tsx`, change:

```typescript
export interface ActionTile {
  key: TransactionActionType;
```

to:

```typescript
/** Tile identity used as the React key. Includes the two panel-only tiles that don't map to a TransactionActionType. */
export type ActionTileKey = TransactionActionType | "edit" | "select";

export interface ActionTile {
  key: ActionTileKey;
```

- [ ] **Step 3: Panel — z-[55], dialog semantics, Escape**

Rewrite `transaction-quick-actions-panel.tsx` as:

```typescript
"use client";

import { useEffect } from "react";
import { Edit, Split, Layers, AlertTriangle, Mail, FileText, RefreshCw, CheckSquare } from "lucide-react";
import { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { ActionTileGrid, type ActionTile, type TransactionActionType } from "./action-tile-grid";

interface TransactionQuickActionsPanelProps {
  transaction: Transaction | null;
  anchorTop: number | null;
  onClose: () => void;
  onEdit: (transaction: Transaction) => void;
  onSelect: (transaction: Transaction) => void;
  onAction: (type: TransactionActionType, transaction: Transaction) => void;
}

/**
 * Long-press quick-action panel: anchors below the pressed row (viewport
 * space), scrims the rest of the screen including the bottom nav (z-[55] sits
 * above the nav's z-40 and below Sheet/Modal/Dialog). Deliberately a reduced
 * action set vs. the drawer's full grid — see
 * 2026-08-14-mobile-transactions-list-design.md Component 5.
 */
export function TransactionQuickActionsPanel({
  transaction,
  anchorTop,
  onClose,
  onEdit,
  onSelect,
  onAction,
}: TransactionQuickActionsPanelProps) {
  const isOpen = transaction !== null && anchorTop !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!transaction || anchorTop === null) return null;

  const amount = transaction.is_shared && transaction.split_share_amount ? transaction.split_share_amount : transaction.amount;

  const tiles: ActionTile[] = [
    { key: "edit", label: "Edit", icon: Edit, onClick: () => onEdit(transaction) },
    { key: "split", label: "Split", icon: Split, active: transaction.is_split, onClick: () => onAction("split", transaction) },
    { key: "group", label: "Group", icon: Layers, active: !!transaction.transaction_group_id, onClick: () => onAction("group", transaction) },
    { key: "flag", label: "Flag", icon: AlertTriangle, active: transaction.is_flagged === true, onClick: () => onAction("flag", transaction) },
    { key: "links", label: "Links", icon: Mail, active: !!(transaction.related_mails && transaction.related_mails.length > 0), onClick: () => onAction("links", transaction) },
    { key: "pdf", label: "PDF", icon: FileText, disabled: !transaction.source_file, onClick: () => onAction("pdf", transaction) },
    { key: "recurring", label: "Recurring", icon: RefreshCw, active: transaction.is_recurring === true, onClick: () => onAction("recurring", transaction) },
    { key: "select", label: "Select", icon: CheckSquare, onClick: () => onSelect(transaction) },
  ];

  return (
    <div className="fixed inset-0 z-[55]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transaction actions"
        className="absolute left-3 right-3 rounded-xl bg-card border border-border shadow-2xl overflow-hidden"
        style={{ top: anchorTop }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-3 border-b border-border">
          <p className="text-sm font-bold truncate">{transaction.description}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {transaction.direction === "credit" ? "+" : "−"}{formatCurrency(amount)} · {transaction.category || "Uncategorized"}
          </p>
        </div>
        <div className="p-2.5">
          <ActionTileGrid tiles={tiles} onDelete={() => onAction("delete", transaction)} />
        </div>
      </div>
    </div>
  );
}
```

(Behavioural change vs. today: only z-index, Escape, and the a11y attributes; the tile list and layout are identical apart from the `edit`/`select` keys.)

- [ ] **Step 4: Document the scale**

In `globals.css`, immediately after the `@import` lines at the top, add:

```css
/*
 * Overlay z-index scale (keep in sync when adding layers):
 *   40  mobile bottom nav          (components/layout/mobile-nav.tsx)
 *   50  Sheet overlay + content    (components/ui/sheet.tsx)
 *   55  long-press quick-actions   (components/transactions/transaction-quick-actions-panel.tsx)
 *   60  Modal                      (components/ui/modal/index.tsx)
 *   70  Dialog / AlertDialog       (components/ui/dialog.tsx, alert-dialog.tsx)
 *   sonner toasts render above all of these.
 */
```

- [ ] **Step 5: Verify**

Run from `frontend/`: `npm run type-check` and `npm run lint` — zero errors, no new warnings in the four touched files.
Browser, 375×812, `/transactions`: long-press a row (pointerdown, wait ~600 ms, pointerup on a row button) → the scrim visibly covers the bottom nav; press Escape (dispatch a `keydown` with `key:"Escape"` on `document`) → panel closes. Long-press → tap "Edit" still opens the drawer in edit mode; tap "Select" still enters selection mode.
1280×800: sidebar nav renders; nothing else changed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layout/mobile-nav.tsx frontend/src/components/transactions/transaction-quick-actions-panel.tsx frontend/src/components/transactions/action-tile-grid.tsx frontend/src/app/globals.css
git commit -m "feat(ui): establish overlay z-index scale; nav z-40, quick-actions panel z-55 with Escape + dialog semantics"
```

---

### Task 2: `Modal` — mobile presentations and scroll-lock fix

**Files:**
- Modify: `frontend/src/components/ui/modal/index.tsx` (full rewrite; `frontend/src/components/ui/modal/primitives.tsx` untouched)

**Interfaces:**
- Produces: `ModalProps` gains optional `presentation?: "auto" | "sheet" | "fullscreen" | "center"` (default `"auto"`). Exports unchanged otherwise: `Modal`, `Modal.Header`, `Modal.Body`, `Modal.Footer`, `ModalSize`, `ModalProps`, `ModalHeaderProps`, `ModalBodyProps`, `ModalFooterProps`. Consumers need no changes.

- [ ] **Step 1: Write the file**

```typescript
"use client";

import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-is-mobile";

export type ModalSize = "sm" | "md" | "lg";
export type ModalPresentation = "auto" | "sheet" | "fullscreen" | "center";
type ResolvedPresentation = Exclude<ModalPresentation, "auto">;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  className?: string;
  /**
   * How the panel is housed. "auto" (default): desktop → centred panel;
   * mobile → bottom sheet for sm/md, full-screen for lg.
   */
  presentation?: ModalPresentation;
}

export interface ModalHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  variant?: "split" | "transfer" | "link-parent" | "share";
  className?: string;
}

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "w-[420px]",
  md: "w-[640px]",
  lg: "w-[820px]",
};

const variantColors: Record<string, { bg: string; text: string }> = {
  split: { bg: "bg-[#6366f1]/20", text: "text-[#6366f1]" },
  transfer: { bg: "bg-[#06b6d4]/20", text: "text-[#06b6d4]" },
  "link-parent": { bg: "bg-[#f59e0b]/20", text: "text-[#f59e0b]" },
  share: { bg: "bg-[#6366f1]/20", text: "text-[#6366f1]" },
};

// Lets Header/Body/Footer adapt to the housing without consumers passing props.
const PresentationContext = React.createContext<ResolvedPresentation>("center");

function resolvePresentation(
  presentation: ModalPresentation,
  size: ModalSize,
  isMobile: boolean
): ResolvedPresentation {
  if (presentation !== "auto") return presentation;
  if (!isMobile) return "center";
  return size === "lg" ? "fullscreen" : "sheet";
}

export function Modal({
  open,
  onClose,
  size = "md",
  role = "dialog",
  initialFocusRef,
  children,
  className,
  presentation = "auto",
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const resolved = resolvePresentation(presentation, size, isMobile);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;

      // Focus initial element or first focusable element
      const focusTarget = initialFocusRef?.current || modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      focusTarget?.focus();
    } else {
      // Restore focus when modal closes
      previousFocus.current?.focus();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // Save whatever lock is already in place (e.g. Radix's, when this Modal is
    // opened over an open Sheet) and restore *that* on close — clearing to ""
    // used to break the underlying Sheet's scroll lock.
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const isCenter = resolved === "center";

  const panelMotion = isCenter
    ? {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        transition: { duration: 0.2 },
      }
    : reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { y: "100%" },
        animate: { y: 0, transition: { type: "spring" as const, stiffness: 380, damping: 34 } },
        exit: { y: "100%", transition: { type: "tween" as const, duration: 0.18, ease: "easeIn" as const } },
      };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[60]",
            isCenter && "flex items-start justify-center"
          )}
          role={role}
          aria-modal="true"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={modalRef}
            {...panelMotion}
            className={cn(
              "bg-[var(--modal-panel)] border-[var(--modal-border)]",
              isCenter && [
                "relative my-10 max-h-[calc(100vh-5rem)] overflow-hidden",
                "rounded-2xl border shadow-[0_10px_40px_rgba(0,0,0,0.45)]",
                sizeClasses[size],
                "max-md:w-[calc(100vw-24px)]",
              ],
              resolved === "sheet" && [
                "absolute inset-x-0 bottom-0 flex flex-col overflow-hidden",
                "max-h-[92dvh] rounded-t-2xl border-t shadow-[0_-10px_40px_rgba(0,0,0,0.45)]",
                "pb-[env(safe-area-inset-bottom)]",
              ],
              resolved === "fullscreen" && [
                "absolute inset-0 flex flex-col overflow-hidden",
                "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              ],
              className
            )}
          >
            {resolved === "sheet" && (
              <div aria-hidden className="h-1 w-9 shrink-0 rounded-full bg-border mx-auto mt-2 mb-1" />
            )}
            <PresentationContext.Provider value={resolved}>
              {children}
            </PresentationContext.Provider>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ModalHeader({
  icon,
  title,
  subtitle,
  onClose,
  variant = "split",
  className,
}: ModalHeaderProps) {
  const colors = variantColors[variant] || variantColors.split;
  const headerId = React.useId();
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-start justify-between gap-4 shrink-0",
        "border-b",
        compact ? "px-4 py-3" : "px-6 py-4",
        "bg-[var(--modal-panel-header)] border-[var(--modal-border)]",
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {icon && (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs",
                colors.bg,
                colors.text
              )}
            >
              {icon}
            </span>
          )}
          <h2
            id={headerId}
            className={cn(
              "font-semibold text-[var(--modal-text)] truncate",
              compact ? "text-base" : "text-lg"
            )}
          >
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="text-sm text-[var(--modal-muted)] mt-1">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full",
            "text-[var(--modal-muted)] hover:text-[var(--modal-text)]",
            "hover:bg-muted/60 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring"
          )}
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ModalBody({ children, className }: ModalBodyProps) {
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "overflow-y-auto",
        compact ? "flex-1 min-h-0 px-4 py-3" : "px-6 py-4 max-h-[calc(70vh)]",
        "scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

function ModalFooter({ children, className }: ModalFooterProps) {
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "flex items-center border-t border-[var(--modal-border)]",
        compact
          ? "shrink-0 gap-2 px-4 py-3 bg-[var(--modal-panel)] [&>*]:flex-1"
          : "sticky bottom-0 justify-end gap-3 px-6 py-3 bg-gradient-to-t from-[var(--modal-panel)] to-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
```

Notes for the implementer: the `center` branch's class strings are the previous file's strings verbatim (compare with `git show HEAD:frontend/src/components/ui/modal/index.tsx`). `useIsMobile` is SSR-safe (false first) so server render matches the desktop path. The safe-area bottom padding lives on the panel, not the footer, so sheets without a footer are still padded and sheets with one are not double-padded.

- [ ] **Step 2: Verify**

`npm run type-check`, `npm run lint` — clean, no new warnings.
Browser 375×812 `/transactions`:
- Tap a row → drawer → tap **Recurring** (size `sm`) → a bottom sheet slides up above the nav: grabber, compact header, footer buttons stretched full-width, safe-area padding. Tap the scrim → closes. Reopen → press Escape → closes. Reopen → tap X → closes. **Cancel only; never Save.**
- Header `+` → Add Transaction (`md`) → bottom sheet, body scrolls if tall, footer stays visible. Cancel.
- Enter selection mode → check 1 row → **Edit** → Bulk Edit (`lg`) → full-screen: header pinned at top, body scrolls, footer pinned at bottom. Cancel.
- Open the filter Sheet (filter icon), then trigger nothing else — close it — confirm the page still scrolls. Then open the drawer (a Sheet) and from it open Recurring (a Modal), close the Modal via scrim: the drawer is still open and its body still scrolls; close the drawer: page scrolls (scroll-lock restore works).
- `document.documentElement.scrollWidth === 375` after all of the above.
Browser 1280×800: open Add Transaction and Recurring from the desktop table — centred panels exactly as before (widths 640/420, rounded-2xl, `my-10`); Escape/scrim/X close.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/modal/index.tsx
git commit -m "feat(ui): mobile bottom-sheet and full-screen presentations for Modal; fix scroll-lock restore"
```

---

### Task 3: `Sheet` — bottom-side defaults + grabber; drawer cleanup

**Files:**
- Modify: `frontend/src/components/ui/sheet.tsx`
- Modify: `frontend/src/components/transactions/transaction-details-drawer.tsx`

- [ ] **Step 1: `SheetContent` props and bottom classes**

In `sheet.tsx`, change the props interface:

```typescript
interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: "top" | "right" | "bottom" | "left"
  modal?: boolean
  onClose?: () => void
  hideCloseButton?: boolean
  /** Render a drag-handle-style grabber at the top. Defaults to true for side="bottom". */
  showGrabber?: boolean
}
```

Change the component signature line to destructure it:

```typescript
>(({ side = "right", className, children, modal = true, onClose, hideCloseButton = false, showGrabber, ...props }, ref) => {
  const grabber = showGrabber ?? side === "bottom"
  return (
```

Replace the `side === "bottom"` class line:

```typescript
        side === "bottom" &&
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
```

with:

```typescript
        side === "bottom" &&
          "inset-x-0 bottom-0 border-t max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
```

Inside `<SheetPrimitive.Content ...>`, before `{children}`, add:

```typescript
      {grabber && (
        <div aria-hidden className="h-1 w-9 rounded-full bg-border mx-auto -mt-2 mb-3" />
      )}
```

(`-mt-2` pulls it into the content's `p-6` top padding so it sits ~16px from the top edge.)

- [ ] **Step 2: Drawer uses the primitive's grabber**

In `transaction-details-drawer.tsx`, the `SheetContent` currently has:

```typescript
                className={cn(
                    "w-full sm:w-[540px] overflow-y-auto",
                    isMobile && "max-h-[90vh] rounded-t-xl"
                )}
            >
                {isMobile && (
                    <div className="w-9 h-1 rounded-full bg-border mx-auto mb-3" />
                )}
```

Change to:

```typescript
                className="w-full sm:w-[540px] overflow-y-auto"
            >
```

(the `cn` import may now be unused in that file — remove it only if lint reports it; keep `isMobile`, it still drives `side`).

- [ ] **Step 3: Verify**

Type-check + lint clean. 375×812: tap a row → drawer shows exactly one grabber, rounded top, does not exceed ~92% of the viewport, safe-area padding at bottom; bottom nav "More" sheet and the filter sheet also show a grabber. 1280×800: drawer is the right-side panel, no grabber (side="right").

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/sheet.tsx frontend/src/components/transactions/transaction-details-drawer.tsx
git commit -m "feat(ui): Sheet bottom side gets dvh max-height, safe-area padding and a built-in grabber"
```

---

### Task 4: `Dialog` / `AlertDialog` — bottom anchoring below `md`, z-[70]

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`
- Modify: `frontend/src/components/ui/alert-dialog.tsx`

- [ ] **Step 1: `dialog.tsx`**

`DialogOverlay` className: change `z-50` → `z-[70]` (rest unchanged).

`DialogContent` className — replace the whole string with:

```typescript
        className={cn(
          "bg-card border-border data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-[70] grid w-full gap-4 border p-6 shadow-lg duration-200",
          // < md: bottom-anchored sheet
          "inset-x-0 bottom-0 max-w-full rounded-t-2xl border-x-0 border-b-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          // >= md: centred (previous behaviour)
          "md:inset-x-auto md:bottom-auto md:top-[50%] md:left-[50%] md:max-w-lg md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:border md:pb-6 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95",
          className
        )}
```

`DialogFooter` className: `"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"` → `"flex flex-col-reverse gap-2 [&>*]:w-full sm:flex-row sm:justify-end sm:[&>*]:w-auto"`.

- [ ] **Step 2: `alert-dialog.tsx`**

`AlertDialogOverlay` className: `z-50` → `z-[70]`.

`AlertDialogContent` className — replace the whole string with:

```typescript
      className={cn(
        "fixed z-[70] grid w-full gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        // < md: bottom-anchored sheet
        "inset-x-0 bottom-0 max-w-full rounded-t-2xl border-x-0 border-b-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
        // >= md: centred (previous behaviour)
        "md:inset-x-auto md:bottom-auto md:left-[50%] md:top-[50%] md:max-w-lg md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:border md:pb-6 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95 md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%] md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
```

`AlertDialogFooter` className: `"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2"` → `"flex flex-col-reverse gap-2 [&>*]:w-full sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2 sm:[&>*]:w-auto"`.

- [ ] **Step 3: Verify**

Type-check + lint clean. 375×812 `/transactions`: selection mode → check 1 row → **Delete** → the confirmation slides up from the bottom, full width, rounded top, buttons stacked full-width, above the nav; **Cancel** (never confirm). Open the drawer → Delete tile → same, and it sits above the drawer (z-70 > z-50). Settings → Categories → a category's delete affordance → confirmation anchors bottom → Cancel. 1280×800: the same dialogs are centred with the previous zoom animation; no width change.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx frontend/src/components/ui/alert-dialog.tsx
git commit -m "feat(ui): Dialog/AlertDialog anchor to the bottom on mobile and stack above Modal (z-70)"
```

---

### Task 5: Slice 1 review fold-ins — row spacing (M2) and mobile Clear chip (M4)

**Files:**
- Modify: `frontend/src/components/transactions/transaction-card-list.tsx`
- Modify: `frontend/src/components/transactions/transaction-filters.tsx`

- [ ] **Step 1: M2**

In `transaction-card-list.tsx` the per-day wrapper is `<div className="space-y-1.5 mb-3">`. Change to `<div className="mb-3">`.

- [ ] **Step 2: M4**

In `transaction-filters.tsx`, the mobile branch's chip row is:

```typescript
            {activeFilterBadges.length > 0 && (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
                {activeFilterBadges.map((badge) => (
```

Inside that `<div>`, after the `activeFilterBadges.map(...)` block closes (before the `</div>`), add:

```typescript
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="shrink-0 rounded-full bg-muted text-muted-foreground px-2.5 py-1 text-[11px] font-medium flex items-center gap-1"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
```

- [ ] **Step 3: Verify**

Type-check + lint clean. 375×812: rows' dividers touch (no gap between rows within a day; the day-group gap remains). With the default date filter active, scroll the chip row to the end → a `Clear` chip; tap it → filters clear and the row collapses to the icon-only button. 1280×800: table and desktop filter row unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/transactions/transaction-card-list.tsx frontend/src/components/transactions/transaction-filters.tsx
git commit -m "fix(transactions): abut ledger dividers; add mobile Clear chip to the filter row"
```

---

### Task 6: Whole-slice verification pass

No code changes unless a defect is found (then fix, verify, commit with a `fix(ui):` message).

- [ ] **Step 1:** Run the spec's Verification list items 1–10 (`docs/superpowers/specs/2026-08-14-mobile-overlay-primitives-design.md`) at 375×812, then item 10 at 1280×800. Never save any form. Record for each item: pass/fail and what was observed.
- [ ] **Step 2:** `npm run type-check`; `npm run lint` — compare warning count in touched files against `git stash`-free baseline: must be equal or lower.
- [ ] **Step 3:** Also spot-check Budgets → **Add Budget** (`sm`, bottom sheet, Cancel) and Budgets → a card's **Set monthly override** (`sm`, Cancel), since those are `Modal` consumers outside Transactions.
