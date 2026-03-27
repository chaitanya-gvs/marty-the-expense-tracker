"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { History, Pencil } from "lucide-react";

export function InlineDateCell({ transaction }: { transaction: Transaction }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(transaction.date);
  const updateTransaction = useUpdateTransaction();

  const handleSave = async () => {
    if (value === transaction.date) {
      setOpen(false);
      return;
    }
    try {
      await updateTransaction.mutateAsync({ id: transaction.id, updates: { date: value } });
      toast.success("Date updated");
    } catch {
      toast.error("Failed to update date");
      setValue(transaction.date);
    }
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      {transaction.original_date && (
        <span title={`Original: ${transaction.original_date}`} className="inline-flex items-center">
          <History className="h-3 w-3 text-amber-400/70" />
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
            title="Edit date"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 space-y-2" align="start">
          <p className="text-xs font-medium text-muted-foreground">Change date</p>
          {transaction.original_date && (
            <p className="text-xs text-amber-400/80">Original: {transaction.original_date}</p>
          )}
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex h-8 w-full rounded-md border border-input bg-muted px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setValue(transaction.date);
                setOpen(false);
              }
            }}
            autoFocus
          />
          <div className="flex gap-1.5 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setValue(transaction.date);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={updateTransaction.isPending}
            >
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
