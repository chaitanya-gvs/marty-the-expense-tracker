"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Transaction } from "@/lib/types";
import { RefundPopover } from "./refund-popover";
import { TransferPopover } from "./transfer-popover";

interface LinksColumnProps {
  transaction: Transaction;
  allTransactions: Transaction[];
  onLinkRefund: (childId: string, parentId: string) => void;
  onUnlinkRefund: (childId: string) => void;
  onGroupTransfer: (transactionIds: string[]) => void;
  onUngroupTransfer: (transactionId: string) => void;
  onAddToTransferGroup: (transactionIds: string[]) => void;
  onRemoveFromTransferGroup: (transactionId: string) => void;
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
}: LinksColumnProps) {
  const [isRefundPopoverOpen, setIsRefundPopoverOpen] = useState(false);
  const [isTransferPopoverOpen, setIsTransferPopoverOpen] = useState(false);

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
            onClick={() => setIsRefundPopoverOpen(true)}
            title={isRefundLinked ? "Linked to parent purchase" : "Link to parent purchase"}
          >
            <span className="text-base">↩︎</span>
          </Button>
          
          <RefundPopover
            transaction={transaction}
            parentTransaction={parentTransaction}
            isOpen={isRefundPopoverOpen}
            onClose={() => setIsRefundPopoverOpen(false)}
            onLink={(parentId) => onLinkRefund(transaction.id, parentId)}
            onUnlink={() => onUnlinkRefund(transaction.id)}
          />
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
          onClick={() => setIsTransferPopoverOpen(true)}
          title={isTransferGrouped ? "Part of transfer group" : "Group as transfer"}
        >
          <span className="text-base">⇄</span>
        </Button>
        
        <TransferPopover
          transaction={transaction}
          transferGroup={transferGroup}
          isOpen={isTransferPopoverOpen}
          onClose={() => setIsTransferPopoverOpen(false)}
          onGroup={onGroupTransfer}
          onUngroup={() => onUngroupTransfer(transaction.id)}
          onAddToGroup={onAddToTransferGroup}
          onRemoveFromGroup={onRemoveFromTransferGroup}
        />
      </div>
    </div>
  );
}


