"use client";

import React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Transaction } from "@/lib/types";

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  transactions: Transaction[];
  isLoading?: boolean;
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  transactions,
  isLoading = false,
}: DeleteConfirmationDialogProps) {
  const isMultiple = transactions.length > 1;
  const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const debits = transactions.filter(t => t.amount < 0).length;
  const credits = transactions.filter(t => t.amount > 0).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#F44D4D]">
            <AlertTriangle className="h-5 w-5" />
            Delete {isMultiple ? "Transactions" : "Transaction"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left space-y-3">
              {isMultiple ? (
                <>
                  <p>
                    Are you sure you want to delete <strong>{transactions.length} transactions</strong>?
                  </p>
                  <p>This will permanently remove:</p>
                  <ul className="ml-4 list-disc space-y-1">
                    <li><strong>{debits} debit(s)</strong> totaling <strong>₹{totalAmount.toFixed(2)}</strong></li>
                    <li><strong>{credits} credit(s)</strong></li>
                  </ul>
                  <p className="text-[#F44D4D] font-semibold">
                    This action cannot be undone.
                  </p>
                </>
              ) : (
                <>
                  <p>Are you sure you want to delete this transaction?</p>
                  <div className="bg-muted/50 border border-border p-3 rounded-md">
                    <div className="font-medium text-foreground">{transactions[0]?.description}</div>
                    <div className="text-sm text-muted-foreground font-mono tabular-nums">
                      {transactions[0]?.date} • ₹{Math.abs(transactions[0]?.amount || 0).toFixed(2)}
                    </div>
                  </div>
                  <p className="text-[#F44D4D] font-semibold">
                    This action cannot be undone.
                  </p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {isLoading ? "Deleting..." : `Delete ${isMultiple ? "Transactions" : "Transaction"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
