"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { useSetRecurring } from "@/hooks/use-budgets";
import { toast } from "sonner";
import { Transaction } from "@/lib/types";

const PERIODS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
] as const;

interface RecurringPeriodPopoverProps {
  transaction: Transaction;
}

export function RecurringPeriodPopover({ transaction }: RecurringPeriodPopoverProps) {
  const [open, setOpen] = useState(false);
  const setRecurring = useSetRecurring();

  const isRecurring = transaction.is_recurring === true;
  const period = transaction.recurrence_period;

  const handleSelect = async (value: string) => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: true,
        recurrence_period: value,
      });
      toast.success(`Marked as recurring (${value})`);
    } catch {
      toast.error("Failed to update recurring status");
    }
    setOpen(false);
  };

  const handleRemove = async () => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: false,
        recurrence_period: null,
      });
      toast.success("Recurring removed");
    } catch {
      toast.error("Failed to update recurring status");
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 cursor-pointer transition-colors",
            isRecurring
              ? "text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 hover:bg-indigo-500/20"
              : "text-muted-foreground/30 hover:text-indigo-400 hover:bg-indigo-500/10"
          )}
          title={isRecurring ? `Recurring: ${period}` : "Mark as recurring"}
        >
          <RefreshCw className="h-3 w-3" />
          {isRecurring && period && (
            <span className="text-[10px] font-medium capitalize leading-none">
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </span>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="end">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Recurrence period
        </p>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => handleSelect(p.value)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors flex items-center gap-2",
              period === p.value && isRecurring ? "text-indigo-400 font-medium" : "text-foreground"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", period === p.value && isRecurring ? "bg-indigo-400" : "bg-muted-foreground")} />
            {p.label}
          </button>
        ))}
        {isRecurring && (
          <>
            <div className="border-t my-1" />
            <button
              onClick={handleRemove}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              ✕ Remove recurring
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
