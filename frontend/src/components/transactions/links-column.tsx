"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Transaction } from "@/lib/types";
import { LinkParentModal } from "./link-parent-modal";
import { GroupTransferModal } from "./group-transfer-modal";

interface LinksColumnProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onLinkRefund: (childId: string, parentId: string) => void;
  onUnlinkRefund: (childId: string) => void;
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
  onLinkRefund,
  onUnlinkRefund,
  onGroupTransfer,
  onUngroupTransfer,
  onAddToTransferGroup,
  onRemoveFromTransferGroup,
  onHighlightTransactions,
  onClearHighlight,
  onOpenDrawer,
}: LinksColumnProps) {
  const [isLinkParentModalOpen, setIsLinkParentModalOpen] = useState(false);
  const [isGroupTransferModalOpen, setIsGroupTransferModalOpen] = useState(false);
  

  // Find parent transaction for refunds (if this transaction is a child/refund)
  const parentTransaction = useMemo(() => {
    if (!transaction.link_parent_id) return undefined;
    return allTransactions.find(t => t.id === transaction.link_parent_id);
  }, [transaction.link_parent_id, allTransactions]);

  // Find children transactions (if this transaction is a parent)
  const childTransactions = useMemo(() => {
    return allTransactions.filter(t => t.link_parent_id === transaction.id);
  }, [transaction.id, allTransactions]);

  // Find transaction group for transfers or splits
  const transactionGroup = useMemo(() => {
    if (!transaction.transaction_group_id) return [];
    return allTransactions.filter(t => t.transaction_group_id === transaction.transaction_group_id);
  }, [transaction.transaction_group_id, allTransactions]);

  // Determine if this is a transfer group or split group
  const isTransferGroup = !!transaction.transaction_group_id && !transaction.is_split && transactionGroup.length > 0;
  const isSplitGroup = !!transaction.transaction_group_id && transaction.is_split && transactionGroup.length > 0;

  // This transaction is part of a refund link if it has a parent OR has children
  const isRefundLinked = (!!transaction.link_parent_id && !!parentTransaction) || childTransactions.length > 0;
  const isCredit = transaction.direction === "credit";

  

  const handleRefundClick = () => {
    if (isRefundLinked) {
      // Active: open drawer to view relationship
      onOpenDrawer?.(transaction);
    } else {
      // Inactive: open modal to link
      setIsLinkParentModalOpen(true);
    }
  };

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

  const handleRefundHover = () => {
    // Only highlight if NO modals are open
    if (!isLinkParentModalOpen && isRefundLinked && onHighlightTransactions) {
      // Highlight parent + current, OR current + all children
      if (parentTransaction) {
        onHighlightTransactions([parentTransaction.id, transaction.id]);
      } else if (childTransactions.length > 0) {
        onHighlightTransactions([transaction.id, ...childTransactions.map(c => c.id)]);
      }
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
    if (!isLinkParentModalOpen && !isGroupTransferModalOpen && onClearHighlight) {
      onClearHighlight();
    }
  };

  return (
    <div className="flex justify-center items-center gap-2">
      {/* Refund icon button - show for credits (to link) or debits with children (to view) */}
      {(isCredit || childTransactions.length > 0) && (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0 rounded-full transition-all duration-200",
              isRefundLinked
                ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-800"
                : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
            )}
            onClick={handleRefundClick}
            onMouseEnter={handleRefundHover}
            onMouseLeave={handleMouseLeave}
            title={isRefundLinked ? "View refund relationship" : "Link to parent purchase"}
          >
            <span className="text-base">↩︎</span>
          </Button>
        </div>
      )}
      
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
            <span className="text-base">⚡</span>
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
            <span className="text-base">⇄</span>
          </Button>
        </div>
      )}

      {/* Modals */}
      <LinkParentModal
        transaction={transaction}
        parentTransaction={parentTransaction}
        allTransactions={allTransactions}
        isOpen={isLinkParentModalOpen}
        onClose={() => setIsLinkParentModalOpen(false)}
        onLink={async (parentId) => {
          await onLinkRefund(transaction.id, parentId);
          setIsLinkParentModalOpen(false);
          // Don't auto-open drawer - user can click the highlighted button to view
        }}
        onUnlink={async () => {
          await onUnlinkRefund(transaction.id);
          setIsLinkParentModalOpen(false);
        }}
      />

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
            // Don't auto-open drawer - user can click the highlighted button to view
          }}
          onUngroup={async () => {
            await onUngroupTransfer(transaction.id);
            setIsGroupTransferModalOpen(false);
          }}
          onAddToGroup={async (transactionIds) => {
            await onAddToTransferGroup(transactionIds);
            setIsGroupTransferModalOpen(false);
            // Don't auto-open drawer - user can click the highlighted button to view
          }}
          onRemoveFromGroup={onRemoveFromTransferGroup}
        />
      )}
      
    </div>
  );
}


