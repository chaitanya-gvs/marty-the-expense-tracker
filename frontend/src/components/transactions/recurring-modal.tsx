"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSetRecurring } from "@/hooks/use-budgets";
import { toast } from "sonner";
import { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

const PERIODS = [
  { value: "monthly",   label: "Monthly",   sublabel: "Every month"    },
  { value: "quarterly", label: "Quarterly", sublabel: "Every 3 months" },
  { value: "yearly",    label: "Yearly",    sublabel: "Once a year"    },
  { value: "custom",    label: "Custom",    sublabel: "Set interval"   },
] as const;

type Period = typeof PERIODS[number]["value"];

const PERIOD_VALUES = PERIODS.map((p) => p.value);

function isValidPeriod(v: string | null | undefined): v is Period {
  return PERIOD_VALUES.includes(v as Period);
}

interface RecurringModalProps {
  transaction: Transaction;
  open: boolean;
  onClose: () => void;
}

export function RecurringModal({ transaction, open, onClose }: RecurringModalProps) {
  const isRecurring = transaction.is_recurring === true;

  const [selectedPeriod, setSelectedPeriod] = useState<Period>(
    isValidPeriod(transaction.recurrence_period)
      ? transaction.recurrence_period
      : "monthly"
  );
  const [recurringKey, setRecurringKey] = useState(transaction.recurring_key ?? "");
  const [editingKey, setEditingKey] = useState(false);

  const setRecurring = useSetRecurring();
  const isPending = setRecurring.isPending;

  const handleSave = async () => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: true,
        recurrence_period: selectedPeriod,
        recurring_key: recurringKey || null,
      });
      toast.success(
        isRecurring
          ? "Recurring updated"
          : `Marked as recurring (${selectedPeriod})`
      );
      onClose();
    } catch {
      toast.error("Failed to update recurring status");
    }
  };

  const handleRemove = async () => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: false,
        recurrence_period: null,
      });
      toast.success("Recurring removed");
      onClose();
    } catch {
      toast.error("Failed to remove recurring status");
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        title={isRecurring ? "Edit Recurring" : "Set Recurring"}
        subtitle={`${transaction.description} · ${formatCurrency(transaction.amount)}${transaction.category ? ` · ${transaction.category}` : ""}`}
        onClose={onClose}
        variant="split"
      />

      <Modal.Body className="space-y-5">
        {/* Period selector */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Recurrence Period
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSelectedPeriod(p.value)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                  selectedPeriod === p.value
                    ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                    : "border-border bg-muted/40 text-muted-foreground hover:border-indigo-500/50 hover:bg-indigo-500/5"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                    selectedPeriod === p.value
                      ? "bg-indigo-400"
                      : "bg-muted-foreground/40"
                  )}
                />
                <div>
                  <div className="text-sm font-medium leading-none mb-0.5">
                    {p.label}
                  </div>
                  <div className="text-[10px] opacity-60">{p.sublabel}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Recurring key */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Recurring Key
          </p>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">
              Groups matching transactions
            </span>
            {editingKey ? (
              <input
                autoFocus
                value={recurringKey}
                onChange={(e) => setRecurringKey(e.target.value)}
                onBlur={() => setEditingKey(false)}
                className="text-xs font-mono text-indigo-400 bg-transparent border-b border-indigo-500/50 outline-none w-32 text-right"
                placeholder="auto-generated"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingKey(true)}
                className="text-xs font-mono text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 rounded transition-colors"
              >
                {recurringKey || "auto"}
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Tap key to edit · Used to link the same subscription across months
          </p>
        </div>
      </Modal.Body>

      <Modal.Footer>
        {isRecurring && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={isPending}
            className="mr-auto text-destructive border border-destructive/30 hover:bg-destructive/10 text-xs"
          >
            ✕ Remove Recurring
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          className="bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isRecurring ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Save Changes
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Mark Recurring
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export function RecurringModalTrigger({
  transaction,
}: {
  transaction: Transaction;
}) {
  const [open, setOpen] = useState(false);
  const isRecurring = transaction.is_recurring === true;
  const period = transaction.recurrence_period;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center",
          isRecurring
            ? "bg-indigo-400/15 text-indigo-300 hover:bg-indigo-400/20 shadow-[0_0_12px_rgba(129,140,248,0.2)]"
            : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
        title={isRecurring ? `Recurring: ${period ?? "set"}` : "Mark as recurring"}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
      <RecurringModal
        key={transaction.id}
        transaction={transaction}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
