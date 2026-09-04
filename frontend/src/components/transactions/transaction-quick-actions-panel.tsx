"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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

/** Focusable descendants used for initial focus and the Tab trap. Mirrors
 * the shared Modal's FOCUSABLE_SELECTOR/getFocusable (src/components/ui/modal/index.tsx). */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !(el instanceof HTMLInputElement && el.type === "hidden") &&
      (el.offsetParent !== null || el.getClientRects().length > 0)
  );
}

/**
 * Long-press quick-action panel: anchors below the pressed row (viewport
 * space), scrims the rest of the screen including the bottom nav (z-[55] sits
 * above the bottom nav (40) and Sheet (50), below Modal (60) and Dialog (70)).
 * Deliberately a reduced action set vs. the drawer's full grid — see
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
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Mirrors the shared Modal's Escape guard: a nested Radix dismissable
      // layer (Select/Popover/Dialog) calls preventDefault on its own
      // capture-phase listener, and honouring that keeps Escape from closing
      // this panel too (M7).
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Focus management: remember what was focused before opening, move focus
  // into the panel on open (first focusable tile, falling back to the panel
  // root's tabIndex={-1}), and restore focus on close — mirrors the shared
  // Modal's approach.
  useEffect(() => {
    if (!isOpen) {
      previousFocus.current?.focus();
      return;
    }

    previousFocus.current = document.activeElement as HTMLElement;

    const raf = requestAnimationFrame(() => {
      const target = getFocusable(panelRef.current)[0] || panelRef.current;
      target?.focus();
    });

    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Lock body scroll while open — same previous-value restore as the shared
  // Modal, so nesting under an already-locked ancestor (e.g. a Modal opened
  // from this panel) doesn't unlock it prematurely.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Minimal focus trap: cycle Tab / Shift+Tab among the panel's focusables.
  // Mirrors the shared Modal's handlePanelKeyDown.
  const handlePanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = getFocusable(panel);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && panel.contains(active);

    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction actions"
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
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
