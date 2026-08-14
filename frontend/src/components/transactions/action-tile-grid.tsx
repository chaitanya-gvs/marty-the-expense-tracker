"use client";

import type { LucideIcon } from "lucide-react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TransactionActionType =
  | "shared"
  | "split"
  | "group"
  | "recurring"
  | "links"
  | "flag"
  | "direction"
  | "pdf"
  | "delete";

export interface ActionTile {
  key: TransactionActionType;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;   // visually highlight (e.g. flag currently set)
  disabled?: boolean; // reduced opacity, non-interactive (e.g. no source PDF) — the
                       // tile still occupies its grid slot so the layout stays a
                       // clean 4-column rectangle regardless of per-transaction state
}

interface ActionTileGridProps {
  tiles: ActionTile[];
  onDelete?: () => void;
  deleteLabel?: string;
  className?: string;
}

/**
 * 4-column icon-tile grid used by both the Transaction Details Drawer's
 * view mode and the long-press quick-actions panel. Each caller passes its
 * own tile list (the two surfaces intentionally have different action sets
 * per 2026-08-14-mobile-transactions-list-design.md) — this component only
 * owns the grid layout and the isolated Delete row.
 */
export function ActionTileGrid({ tiles, onDelete, deleteLabel = "Delete transaction", className }: ActionTileGridProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            disabled={tile.disabled}
            onClick={tile.disabled ? undefined : tile.onClick}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg py-2.5 px-1 transition-colors",
              tile.disabled
                ? "bg-muted/50 text-muted-foreground/40 opacity-50 cursor-not-allowed"
                : tile.active
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <tile.icon className="h-[17px] w-[17px]" />
            <span className="text-[9px] font-semibold text-center leading-tight">{tile.label}</span>
          </button>
        ))}
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[12.5px] font-semibold text-destructive bg-destructive/[0.08] hover:bg-destructive/[0.14] transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          {deleteLabel}
        </button>
      )}
    </div>
  );
}
