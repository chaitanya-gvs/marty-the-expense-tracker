"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { MoneyInput, KeepOriginalToggle } from "@/components/ui/modal/primitives";
import { CategorySelector } from "@/components/transactions/category-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSplitTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { Plus, Trash2, Split, Check } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Fallback palette when a category has no color
export const PART_COLORS = [
  "#6366f1",
  "#14b8a6",
  "#f59e0b",
  "#f43f5e",
  "#a78bfa",
  "#84cc16",
];

interface SplitTransactionModalProps {
  transaction: Transaction;
  isOpen: boolean;
  onClose: () => void;
}

interface SplitPart {
  id: string;
  description: string;
  amount: number;
  category: string;
  subcategory: string;
}

interface BarSegment {
  id: string;
  amount: number;
  color: string;
  label: string;
}

// Live proportional allocation bar — driven by pre-computed segments
function AllocationBar({
  segments,
  total,
}: {
  segments: BarSegment[];
  total: number;
}) {
  const allocated = segments.reduce((sum, s) => sum + s.amount, 0);
  const overAllocated = allocated > total + 0.01;
  const totalForBar = overAllocated ? allocated : total;

  return (
    <div className="relative h-2 rounded-full overflow-hidden bg-muted/40">
      <div className="absolute inset-0 flex">
        {segments.map((seg) => {
          const pct = totalForBar > 0 ? (seg.amount / totalForBar) * 100 : 0;
          return (
            <motion.div
              key={seg.id}
              className="h-full flex-shrink-0"
              style={{ backgroundColor: overAllocated ? "#f43f5e" : seg.color }}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SplitTransactionModal({
  transaction,
  isOpen,
  onClose,
}: SplitTransactionModalProps) {
  const makeDefaultParts = (): SplitPart[] => [
    {
      id: "1",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
    },
    {
      id: "2",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
    },
  ];

  const [parts, setParts] = useState<SplitPart[]>(makeDefaultParts);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const splitTransaction = useSplitTransaction();
  const { data: categories = [] } = useCategories();

  // For shared transactions, split against the user's share, not the full amount
  const isShared = transaction.is_shared;
  const splitShareAmount = transaction.split_share_amount;
  const originalAmount =
    isShared && splitShareAmount !== undefined
      ? Math.abs(splitShareAmount)
      : Math.abs(transaction.amount);
  const totalAmount =
    isShared && splitShareAmount !== undefined && splitShareAmount !== transaction.amount
      ? Math.abs(transaction.amount)
      : null;

  const totalParts = parts.reduce((sum, p) => sum + (p.amount || 0), 0);
  const remaining = originalAmount - totalParts;
  const isComplete = Math.abs(remaining) < 0.01;
  const isOverAllocated = remaining < -0.01;
  const isValid = isComplete && parts.every((p) => p.description && p.amount > 0);

  // Resolve category color; fall back to indexed palette
  const getPartColor = (categoryName: string, fallbackIndex: number): string => {
    const cat = categories.find(
      (c: { name: string; color?: string }) => c.name === categoryName
    );
    return cat?.color || PART_COLORS[fallbackIndex % PART_COLORS.length];
  };

  // Pre-computed segments used by both the bar and the legend
  const barSegments: BarSegment[] = parts.map((part, i) => ({
    id: part.id,
    amount: part.amount || 0,
    color: getPartColor(part.category, i),
    label: part.description || `Part ${i + 1}`,
  }));

  useEffect(() => {
    if (isOpen) {
      setParts(makeDefaultParts());
      setKeepOriginal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transaction]);

  const addPart = () => {
    const newId = String(Math.max(...parts.map((p) => Number(p.id))) + 1);
    setParts([
      ...parts,
      {
        id: newId,
        description: "",
        amount: 0,
        category: transaction.category,
        subcategory: transaction.subcategory || "",
      },
    ]);
  };

  const removePart = (id: string) => {
    if (parts.length > 2) {
      setParts(parts.filter((p) => p.id !== id));
    }
  };

  const updatePart = (
    id: string,
    field: keyof SplitPart,
    value: string | number
  ) => {
    setParts(parts.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const autoDistribute = () => {
    const base = Number((originalAmount / parts.length).toFixed(2));
    const last = Number((originalAmount - base * (parts.length - 1)).toFixed(2));
    setParts(parts.map((p, i) => ({ ...p, amount: i === parts.length - 1 ? last : base })));
  };

  const handleSplit = async () => {
    if (!isValid) {
      toast.error("Please fill in all descriptions and make sure amounts add up correctly.");
      return;
    }
    try {
      await splitTransaction.mutateAsync({
        transactionId: transaction.id,
        parts: parts.map((p) => ({
          description: p.description,
          amount: p.amount,
          category: p.category,
          subcategory: p.subcategory || undefined,
          tags: transaction.tags,
        })),
        deleteOriginal: !keepOriginal,
      });
      toast.success(`Transaction split into ${parts.length} parts`);
      onClose();
    } catch {
      toast.error("Failed to split transaction");
    }
  };

  const accountDisplay = transaction.account
    ? transaction.account.split(" ").slice(0, -2).join(" ") || transaction.account
    : null;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Split className="h-4 w-4" />}
        title="Split Transaction"
        subtitle={[transaction.description, formatDate(transaction.date), accountDisplay]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
        variant="split"
      />

      <Modal.Body className="scrollbar-none">
        {/* ── Amount + Allocation block ──────────────────────────────── */}
        <div className="mb-6 p-4 rounded-xl bg-muted/30 border border-border/40">
          {/* Totals row */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {isShared ? "Your Share" : "Splitting"}
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-foreground">
                {formatCurrency(originalAmount)}
              </p>
              {isShared && totalAmount && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total: {formatCurrency(totalAmount)}
                </p>
              )}
            </div>

            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Remaining
              </p>
              <div
                className={cn(
                  "text-xl font-bold font-mono tabular-nums transition-colors",
                  isComplete
                    ? "text-emerald-400"
                    : isOverAllocated
                      ? "text-[#f43f5e]"
                      : "text-foreground"
                )}
              >
                {isComplete ? (
                  <span className="flex items-center gap-1.5 justify-end">
                    <Check className="h-4 w-4" />
                    Done
                  </span>
                ) : (
                  formatCurrency(Math.abs(remaining))
                )}
              </div>
            </div>
          </div>

          {/* Bar */}
          <AllocationBar segments={barSegments} total={originalAmount} />

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            {barSegments.map((seg) => (
              <div key={seg.id} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-muted-foreground truncate max-w-[72px]">
                  {seg.label}
                </span>
                <span className="font-mono text-foreground/60 tabular-nums">
                  {formatCurrency(seg.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Parts header ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Parts ({parts.length})
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={autoDistribute}
            className="rounded-lg bg-muted hover:bg-muted/70 text-foreground px-3 py-1 text-xs font-medium transition-colors"
          >
            Auto Distribute
          </motion.button>
        </div>

        {/* ── Part rows ──────────────────────────────────────────────── */}
        <div className="space-y-4 mb-6">
          {parts.map((part, index) => {
            const dotColor = getPartColor(part.category, index);
            return (
              <div
                key={part.id}
                className="space-y-2 pb-4 border-b border-border/30 last:border-0 last:pb-0"
              >
                {/* Row 1: dot · description · amount · [trash] */}
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />
                  <Input
                    value={part.description}
                    onChange={(e) => updatePart(part.id, "description", e.target.value)}
                    placeholder={`Part ${index + 1} description`}
                    className="flex-1 h-9 bg-muted/50 border-border/50 text-sm"
                  />
                  <div className="w-28 flex-shrink-0">
                    <MoneyInput
                      value={part.amount || ""}
                      onValueChange={(val) => updatePart(part.id, "amount", val)}
                      className="h-9"
                    />
                  </div>
                  {parts.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removePart(part.id)}
                      className="flex-shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Row 2: category */}
                <div className="pl-[18px]">
                  <CategorySelector
                    value={part.category}
                    onValueChange={(val) => updatePart(part.id, "category", val)}
                  />
                </div>
              </div>
            );
          })}

          {/* Add part */}
          <button
            type="button"
            onClick={addPart}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors pl-[18px]"
          >
            <Plus className="h-3 w-3" />
            Add part
          </button>
        </div>

        {/* ── Keep original toggle ───────────────────────────────────── */}
        <KeepOriginalToggle value={keepOriginal} onChange={setKeepOriginal} />
      </Modal.Body>

      <Modal.Footer>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSplit}
          disabled={!isValid || splitTransaction.isPending}
        >
          {splitTransaction.isPending ? "Splitting…" : `Split into ${parts.length} Parts`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
