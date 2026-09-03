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
