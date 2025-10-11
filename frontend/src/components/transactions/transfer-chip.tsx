"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { TransferPopover } from "./transfer-popover";

interface TransferChipProps {
  transaction: Transaction;
  transferGroup?: Transaction[];
  onGroup: (transactionIds: string[]) => void;
  onUngroup: () => void;
  onAddToGroup: (transactionIds: string[]) => void;
  onRemoveFromGroup: (transactionId: string) => void;
  className?: string;
}

export function TransferChip({ 
  transaction, 
  transferGroup = [], 
  onGroup, 
  onUngroup, 
  onAddToGroup,
  onRemoveFromGroup,
  className 
}: TransferChipProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const isGrouped = !!transaction.transfer_group_id && transferGroup.length > 0;

  if (isGrouped && transferGroup.length > 0) {
    // Show grouped state
    const commonAmount = Math.abs(transaction.amount);
    
    // Try to determine source and destination accounts
    const debitTransaction = transferGroup.find(t => t.direction === "debit");
    const creditTransaction = transferGroup.find(t => t.direction === "credit");
    
    if (debitTransaction && creditTransaction) {
      const sourceAccount = debitTransaction.account.split(' ').slice(0, -2).join(' ');
      const destinationAccount = creditTransaction.account.split(' ').slice(0, -2).join(' ');
      
      return (
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer",
              "bg-sky-700/60 text-sky-50 hover:bg-sky-600/60",
              className
            )}
            onClick={() => setIsPopoverOpen(true)}
            title="Group the legs of this internal transfer"
          >
            <span>⇄</span>
            <span className="truncate">
              Transfer · {sourceAccount} → {destinationAccount} · {formatCurrency(commonAmount)}
            </span>
          </Button>
          
          <TransferPopover
            transaction={transaction}
            transferGroup={transferGroup}
            isOpen={isPopoverOpen}
            onClose={() => setIsPopoverOpen(false)}
            onGroup={onGroup}
            onUngroup={onUngroup}
            onAddToGroup={onAddToGroup}
            onRemoveFromGroup={onRemoveFromGroup}
          />
        </div>
      );
    }
    
    // Fallback: show number of legs
    return (
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer",
            "bg-sky-700/60 text-sky-50 hover:bg-sky-600/60",
            className
          )}
          onClick={() => setIsPopoverOpen(true)}
          title="Group the legs of this internal transfer"
        >
          <span>⇄</span>
          <span className="truncate">
            Transfer · {transferGroup.length} legs
          </span>
        </Button>
        
        <TransferPopover
          transaction={transaction}
          transferGroup={transferGroup}
          isOpen={isPopoverOpen}
          onClose={() => setIsPopoverOpen(false)}
          onGroup={onGroup}
          onUngroup={onUngroup}
          onAddToGroup={onAddToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
        />
      </div>
    );
  }

  // Show ungrouped state
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer",
          "bg-slate-700 text-slate-300 hover:bg-slate-600",
          className
        )}
        onClick={() => setIsPopoverOpen(true)}
        title="Group the legs of this internal transfer"
      >
        <span>⇄</span>
        <span>Group transfer</span>
      </Button>
      
      <TransferPopover
        transaction={transaction}
        isOpen={isPopoverOpen}
        onClose={() => setIsPopoverOpen(false)}
        onGroup={onGroup}
        onUngroup={onUngroup}
        onAddToGroup={onAddToGroup}
        onRemoveFromGroup={onRemoveFromGroup}
      />
    </div>
  );
}

