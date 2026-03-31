"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Split, ArrowLeftRight } from "lucide-react";
import { Transaction } from "@/lib/types";
import { GroupTransferModal } from "./group-transfer-modal";

interface LinksColumnProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onGroupTransfer: (transactionIds: string[]) => void;
  onUngroupTransfer: (transactionId: string) => void;
  onAddToTransferGroup: (transactionIds: string[]) => void;
  onRemoveFromTransferGroup: (transactionId: string) => void;
  onHighlightTransactions?: (transactionIds: string[]) => void;
  onClearHighlight?: () => void;
  onOpenDrawer?: (transactionOrId: Transaction | string) => void;
}

export function LinksColumn({
  transaction,
  allTransactions,
  onGroupTransfer,
  onUngroupTransfer,
  onAddToTransferGroup,
  onRemoveFromTransferGroup,
  onHighlightTransactions,
  onClearHighlight,
  onOpenDrawer,
}: LinksColumnProps) {
  const [isGroupTransferModalOpen, setIsGroupTransferModalOpen] = useState(false);

  // Find transaction group for transfers or splits
  const transactionGroup = useMemo(() => {
    if (!transaction.transaction_group_id) return [];
    return allTransactions.filter(t => t.transaction_group_id === transaction.transaction_group_id);
  }, [transaction.transaction_group_id, allTransactions]);

  // Determine if this is a transfer group or split group
  const isTransferGroup = !!transaction.transaction_group_id && !transaction.is_split && transactionGroup.length > 0;
  const isSplitGroup = !!transaction.transaction_group_id && transaction.is_split && transactionGroup.length > 0;

  const handleTransferClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isTransferGroup) {
      // Active: open drawer to view group
      onOpenDrawer?.(transaction);
    } else if (!isSplitGroup) {
      // Inactive: open modal to group (only if not already in a split group)
      setIsGroupTransferModalOpen(true);
    }
  };

  const handleSplitClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isSplitGroup) {
      // Active: open drawer to view split group
      onOpenDrawer?.(transaction);
    }
  };

  const handleTransferHover = () => {
    // Only highlight if NO modals are open
    if (!isGroupTransferModalOpen && isTransferGroup && onHighlightTransactions) {
      onHighlightTransactions(transactionGroup.map(t => t.id));
    }
  };

  const handleSplitHover = () => {
    // Highlight split group
    if (isSplitGroup && onHighlightTransactions) {
      onHighlightTransactions(transactionGroup.map(t => t.id));
    }
  };

  const handleMouseLeave = () => {
    // Only clear highlights if NO modals are open
    if (!isGroupTransferModalOpen && onClearHighlight) {
      onClearHighlight();
    }
  };

  return (
    <div className="flex justify-center items-center gap-2">
      {/* Split icon button - show for split transactions */}
      {isSplitGroup && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0 rounded-full transition-all duration-200",
              "bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-400 dark:hover:bg-purple-800"
            )}
            onClick={handleSplitClick}
            onMouseEnter={handleSplitHover}
            onMouseLeave={handleMouseLeave}
            title="View split transaction group"
          >
            <Split className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Transfer icon button - show for non-split transactions */}
      {!isSplitGroup && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0 rounded-full transition-all duration-200",
              isTransferGroup
                ? "bg-sky-100 text-sky-600 hover:bg-sky-200 dark:bg-sky-900 dark:text-sky-400 dark:hover:bg-sky-800"
                : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
            )}
            onClick={handleTransferClick}
            onMouseEnter={handleTransferHover}
            onMouseLeave={handleMouseLeave}
            title={isTransferGroup ? "View transfer group" : "Group as transfer"}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Modals */}
      {isGroupTransferModalOpen && (
        <GroupTransferModal
          key={`group-transfer-${transaction.id}`}
          transaction={transaction}
          transferGroup={transactionGroup.filter(t => !t.is_split)}
          allTransactions={allTransactions}
          isOpen={isGroupTransferModalOpen}
          onClose={() => setIsGroupTransferModalOpen(false)}
          onGroup={async (transactionIds) => {
            await onGroupTransfer(transactionIds);
            setIsGroupTransferModalOpen(false);
          }}
          onUngroup={async () => {
            await onUngroupTransfer(transaction.id);
            setIsGroupTransferModalOpen(false);
          }}
          onAddToGroup={async (transactionIds) => {
            await onAddToTransferGroup(transactionIds);
            setIsGroupTransferModalOpen(false);
          }}
          onRemoveFromGroup={onRemoveFromTransferGroup}
        />
      )}
    </div>
  );
}
