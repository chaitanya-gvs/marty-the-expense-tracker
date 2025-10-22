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
  onOpenDrawer?: (transaction: Transaction) => void;
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
  

  // Find parent transaction for refunds
  const parentTransaction = useMemo(() => {
    if (!transaction.link_parent_id) return undefined;
    return allTransactions.find(t => t.id === transaction.link_parent_id);
  }, [transaction.link_parent_id, allTransactions]);

  // Find transfer group for transfers
  const transferGroup = useMemo(() => {
    if (!transaction.transfer_group_id) return [];
    return allTransactions.filter(t => t.transfer_group_id === transaction.transfer_group_id);
  }, [transaction.transfer_group_id, allTransactions]);

  const isRefundLinked = !!transaction.link_parent_id && !!parentTransaction;
  const isTransferGrouped = !!transaction.transfer_group_id && transferGroup.length > 0;
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
    
    if (isTransferGrouped) {
      // Active: open drawer to view group
      onOpenDrawer?.(transaction);
    } else {
      // Inactive: open modal to group
      setIsGroupTransferModalOpen(true);
    }
  };

  const handleRefundHover = () => {
    // Only highlight if NO modals are open
    if (!isLinkParentModalOpen && isRefundLinked && parentTransaction && onHighlightTransactions) {
      onHighlightTransactions([parentTransaction.id, transaction.id]);
    }
  };

  const handleTransferHover = () => {
    // Only highlight if NO modals are open
    if (!isGroupTransferModalOpen && isTransferGrouped && onHighlightTransactions) {
      onHighlightTransactions(transferGroup.map(t => t.id));
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
      {/* Refund icon button - only show for credit transactions */}
      {isCredit && (
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
      
      {/* Transfer icon button - show for all transactions */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-8 p-0 rounded-full transition-all duration-200",
            isTransferGrouped
              ? "bg-sky-100 text-sky-600 hover:bg-sky-200 dark:bg-sky-900 dark:text-sky-400 dark:hover:bg-sky-800"
              : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
          )}
          onClick={handleTransferClick}
          onMouseEnter={handleTransferHover}
          onMouseLeave={handleMouseLeave}
          title={isTransferGrouped ? "View transfer group" : "Group as transfer"}
        >
          <span className="text-base">⇄</span>
        </Button>
      </div>

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
          // Open drawer after successful link - refetch should be complete
          setTimeout(() => onOpenDrawer?.(transaction), 100);
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
          transferGroup={transferGroup}
          allTransactions={allTransactions}
          isOpen={isGroupTransferModalOpen}
          onClose={() => setIsGroupTransferModalOpen(false)}
          onGroup={async (transactionIds) => {
            await onGroupTransfer(transactionIds);
            setIsGroupTransferModalOpen(false);
            // Open drawer after successful grouping - refetch should be complete
            setTimeout(() => onOpenDrawer?.(transaction), 100);
          }}
          onUngroup={async () => {
            await onUngroupTransfer(transaction.id);
            setIsGroupTransferModalOpen(false);
          }}
          onAddToGroup={async (transactionIds) => {
            await onAddToTransferGroup(transactionIds);
            setIsGroupTransferModalOpen(false);
            // Open drawer after adding to group - refetch should be complete
            setTimeout(() => onOpenDrawer?.(transaction), 100);
          }}
          onRemoveFromGroup={onRemoveFromTransferGroup}
        />
      )}
      
    </div>
  );
}


