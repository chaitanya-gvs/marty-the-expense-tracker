"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import {
  FieldRow,
  MoneyInput,
  CategorySelect,
  SummaryStat,
  RemainingBar,
  KeepOriginalToggle,
} from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSplitTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { Plus, Trash2, ChevronDown, ChevronRight, Rows3 } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
  notes: string;
  isExpanded: boolean;
}

export function SplitTransactionModal({
  transaction,
  isOpen,
  onClose,
}: SplitTransactionModalProps) {
  const [parts, setParts] = useState<SplitPart[]>([
    {
      id: "1",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
      notes: "",
      isExpanded: true,
    },
    {
      id: "2",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
      notes: "",
      isExpanded: true,
    },
  ]);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const splitTransaction = useSplitTransaction();
  const { data: categories = [] } = useCategories();

  const originalAmount = Math.abs(transaction.amount);
  const totalParts = parts.reduce((sum, part) => sum + (part.amount || 0), 0);
  const remaining = originalAmount - totalParts;
  const isValid =
    Math.abs(remaining) < 0.01 &&
    parts.every((p) => p.description && p.amount > 0);

  // Reset parts when transaction changes
  useEffect(() => {
    if (isOpen) {
      setParts([
        {
          id: "1",
          description: "",
          amount: 0,
          category: transaction.category,
          subcategory: transaction.subcategory || "",
          notes: "",
          isExpanded: true,
        },
        {
          id: "2",
          description: "",
          amount: 0,
          category: transaction.category,
          subcategory: transaction.subcategory || "",
          notes: "",
          isExpanded: true,
        },
      ]);
      setKeepOriginal(true);
    }
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
        notes: "",
        isExpanded: true,
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
    value: string | number | boolean
  ) => {
    setParts(parts.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const togglePartExpand = (id: string) => {
    setParts(
      parts.map((p) =>
        p.id === id ? { ...p, isExpanded: !p.isExpanded } : p
      )
    );
  };

  const autoDistribute = () => {
    const amountPerPart = originalAmount / parts.length;
    setParts(
      parts.map((p) => ({ ...p, amount: Number(amountPerPart.toFixed(2)) }))
    );
  };

  const handleSplit = async () => {
    if (!isValid) {
      toast.error(
        "Please ensure all parts have descriptions and amounts sum to the original transaction amount"
      );
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
          notes: p.notes || undefined,
          tags: transaction.tags,
        })),
        deleteOriginal: !keepOriginal,
      });

      toast.success(`Transaction split into ${parts.length} parts`, {
        action: {
          label: "Undo",
          onClick: () => {
            // TODO: Implement undo functionality
            toast.info("Undo not yet implemented");
          },
        },
      });
      onClose();
    } catch (error) {
      toast.error("Failed to split transaction");
      console.error(error);
    }
  };

  const getCategoryForPart = (categoryName: string) => {
    return categories.find((cat: { name: string }) => cat.name === categoryName);
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Rows3 className="h-4 w-4" />}
        title="Split Transaction"
        subtitle={`Split into parts. Original amount: ${formatCurrency(originalAmount)}`}
        onClose={onClose}
        variant="split"
      />

      <Modal.Body>
        {/* Transaction Summary */}
        <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--modal-muted)] text-xs uppercase tracking-wider">
                Date
              </span>
              <p className="text-[var(--modal-text)] mt-1">{transaction.date}</p>
            </div>
            <div>
              <span className="text-[var(--modal-muted)] text-xs uppercase tracking-wider">
                Account
              </span>
              <p className="text-[var(--modal-text)] mt-1 truncate">
                {transaction.account}
              </p>
            </div>
            <div className="col-span-2">
              <span className="text-[var(--modal-muted)] text-xs uppercase tracking-wider">
                Description
              </span>
              <p className="text-[var(--modal-text)] mt-1">
                {transaction.description}
              </p>
            </div>
          </div>
        </div>

        {/* Parts Header with Auto Distribute */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--modal-text)]">
            Split Parts
          </h3>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={autoDistribute}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 text-xs"
          >
            Auto Distribute
          </Button>
        </div>

        {/* Parts List */}
        <div className="space-y-3 mb-4">
          <AnimatePresence initial={false}>
            {parts.map((part, index) => {
              const category = getCategoryForPart(part.category);
              return (
                <motion.div
                  key={part.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-xl bg-slate-900/70 border border-slate-800 overflow-hidden"
                >
                  {/* Collapsed Summary */}
                  <button
                    type="button"
                    onClick={() => togglePartExpand(part.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--modal-accent)]/20 text-[var(--modal-accent)] text-xs font-semibold flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--modal-text)] font-medium truncate">
                            {part.description || "Untitled"}
                          </span>
                          {category && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full border"
                              style={{
                                borderColor: category.color || "#6366f1",
                                backgroundColor: `${category.color || "#6366f1"}20`,
                                color: category.color || "#6366f1",
                              }}
                            >
                              {category.name}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--modal-muted)] mt-0.5">
                          {formatCurrency(part.amount)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {parts.length > 2 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removePart(part.id);
                          }}
                          className="p-1.5 rounded-full hover:bg-[var(--modal-danger)]/20 text-[var(--modal-muted)] hover:text-[var(--modal-danger)] transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {part.isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[var(--modal-muted)]" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-[var(--modal-muted)]" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  <AnimatePresence>
                    {part.isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-slate-800"
                      >
                        <div className="p-4 space-y-4">
                          <FieldRow label="Description" required>
                            <Input
                              value={part.description}
                              onChange={(e) =>
                                updatePart(part.id, "description", e.target.value)
                              }
                              placeholder="e.g., Internet charges"
                              className="h-10 bg-slate-800/60 border-slate-700 rounded-lg text-[var(--modal-text)]"
                            />
                          </FieldRow>

                          <FieldRow label="Amount" required>
                            <MoneyInput
                              value={part.amount || ""}
                              onValueChange={(val) =>
                                updatePart(part.id, "amount", val)
                              }
                            />
                          </FieldRow>

                          <FieldRow label="Category">
                            <CategorySelect
                              value={part.category}
                              onChange={(val) =>
                                updatePart(part.id, "category", val)
                              }
                              categories={categories}
                            />
                          </FieldRow>

                          <FieldRow label="Notes" hint="Optional additional notes">
                            <Input
                              value={part.notes}
                              onChange={(e) =>
                                updatePart(part.id, "notes", e.target.value)
                              }
                              placeholder="Additional notes"
                              className="h-10 bg-slate-800/60 border-slate-700 rounded-lg text-[var(--modal-text)]"
                            />
                          </FieldRow>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Add Part Button */}
          <Button
            type="button"
            variant="outline"
            onClick={addPart}
            className="w-full rounded-lg border-slate-700 bg-slate-800/40 hover:bg-slate-800/60 text-slate-200 py-2"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Another Part
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 space-y-1 mb-4">
          <SummaryStat
            label="Original Amount"
            value={formatCurrency(originalAmount)}
          />
          <SummaryStat
            label="Total Parts"
            value={formatCurrency(totalParts)}
            valueColor={Math.abs(remaining) < 0.01 ? "success" : "default"}
          />
          <SummaryStat
            label="Remaining"
            value={formatCurrency(remaining)}
            valueColor={Math.abs(remaining) < 0.01 ? "success" : "danger"}
          />
        </div>

        {/* Progress Bar */}
        <RemainingBar remaining={remaining} total={originalAmount} className="mb-4" />

        {/* Keep Original Toggle */}
        <KeepOriginalToggle value={keepOriginal} onChange={setKeepOriginal} />
      </Modal.Body>

      <Modal.Footer>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSplit}
          disabled={!isValid || splitTransaction.isPending}
          className={cn(
            "rounded-lg px-4 py-2",
            isValid
              ? "bg-[var(--modal-accent)] hover:bg-indigo-500 text-white"
              : "bg-slate-700 text-slate-400 cursor-not-allowed"
          )}
        >
          {splitTransaction.isPending
            ? "Splitting..."
            : isValid
              ? `Split into ${parts.length} Parts`
              : "Distribute to Continue"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

