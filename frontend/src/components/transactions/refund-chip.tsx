"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { RefundPopover } from "./refund-popover";

interface RefundChipProps {
  transaction: Transaction;
  parentTransaction?: Transaction;
  onLink: (parentId: string) => void;
  onUnlink: () => void;
  className?: string;
}

export function RefundChip({ 
  transaction, 
  parentTransaction, 
  onLink, 
  onUnlink, 
  className 
}: RefundChipProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  // Only show for credit transactions
  if (transaction.direction !== "credit") {
    return null;
  }

  const isLinked = !!transaction.link_parent_id && !!parentTransaction;

  if (isLinked && parentTransaction) {
    // Show linked state with parent details
    const merchantName = parentTransaction.description.length > 18 
      ? `${parentTransaction.description.substring(0, 18)}...` 
      : parentTransaction.description;
    
    return (
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs cursor-pointer",
            "bg-emerald-700/60 text-emerald-50 hover:bg-emerald-600/60",
            className
          )}
          onClick={() => setIsPopoverOpen(true)}
          title="Link this credit to its original purchase"
        >
          <span>↩︎</span>
          <span className="truncate">
            Refund · {merchantName} · {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))}
          </span>
        </Button>
        
        <RefundPopover
          transaction={transaction}
          parentTransaction={parentTransaction}
          isOpen={isPopoverOpen}
          onClose={() => setIsPopoverOpen(false)}
          onLink={onLink}
          onUnlink={onUnlink}
        />
      </div>
    );
  }

  // Show unlinked state
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
        title="Link this credit to its original purchase"
      >
        <span>↩︎</span>
        <span>Link refund</span>
      </Button>
      
      <RefundPopover
        transaction={transaction}
        isOpen={isPopoverOpen}
        onClose={() => setIsPopoverOpen(false)}
        onLink={onLink}
        onUnlink={onUnlink}
      />
    </div>
  );
}

