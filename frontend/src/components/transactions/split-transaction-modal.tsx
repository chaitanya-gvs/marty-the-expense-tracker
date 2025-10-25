"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSplitTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

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
}

export function SplitTransactionModal({ transaction, isOpen, onClose }: SplitTransactionModalProps) {
  const [parts, setParts] = useState<SplitPart[]>([
    {
      id: "1",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
      notes: "",
    },
    {
      id: "2",
      description: "",
      amount: 0,
      category: transaction.category,
      subcategory: transaction.subcategory || "",
      notes: "",
    },
  ]);
  const [deleteOriginal, setDeleteOriginal] = useState(false);

  const splitTransaction = useSplitTransaction();
  const { data: categoriesResponse } = useCategories();
  const categories = categoriesResponse?.data || [];

  const originalAmount = Math.abs(transaction.amount);
  const totalParts = parts.reduce((sum, part) => sum + (part.amount || 0), 0);
  const remaining = originalAmount - totalParts;
  const isValid = Math.abs(remaining) < 0.01 && parts.every(p => p.description && p.amount > 0);

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
        },
        {
          id: "2",
          description: "",
          amount: 0,
          category: transaction.category,
          subcategory: transaction.subcategory || "",
          notes: "",
        },
      ]);
      setDeleteOriginal(false);
    }
  }, [isOpen, transaction]);

  const addPart = () => {
    const newId = String(Math.max(...parts.map(p => Number(p.id))) + 1);
    setParts([
      ...parts,
      {
        id: newId,
        description: "",
        amount: 0,
        category: transaction.category,
        subcategory: transaction.subcategory || "",
        notes: "",
      },
    ]);
  };

  const removePart = (id: string) => {
    if (parts.length > 2) {
      setParts(parts.filter(p => p.id !== id));
    }
  };

  const updatePart = (id: string, field: keyof SplitPart, value: string | number) => {
    setParts(parts.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const autoDistribute = () => {
    const amountPerPart = originalAmount / parts.length;
    setParts(parts.map(p => ({ ...p, amount: Number(amountPerPart.toFixed(2)) })));
  };

  const handleSplit = async () => {
    if (!isValid) {
      toast.error("Please ensure all parts have descriptions and amounts sum to the original transaction amount");
      return;
    }

    try {
      await splitTransaction.mutateAsync({
        transactionId: transaction.id,
        parts: parts.map(p => ({
          description: p.description,
          amount: p.amount,
          category: p.category,
          subcategory: p.subcategory || undefined,
          notes: p.notes || undefined,
          tags: transaction.tags,
        })),
        deleteOriginal,
      });

      toast.success(`Transaction split into ${parts.length} parts`);
      onClose();
    } catch (error) {
      toast.error("Failed to split transaction");
      console.error(error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
          <DialogDescription>
            Split this transaction into multiple parts. Original amount: {formatCurrency(originalAmount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Original Transaction Info */}
          <div className="p-4 bg-muted rounded-lg">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Date:</span> {transaction.date}
              </div>
              <div>
                <span className="font-medium">Account:</span> {transaction.account}
              </div>
              <div className="col-span-2">
                <span className="font-medium">Description:</span> {transaction.description}
              </div>
            </div>
          </div>

          {/* Split Parts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Split Parts</h3>
              <Button type="button" variant="outline" size="sm" onClick={autoDistribute}>
                Auto Distribute
              </Button>
            </div>

            {parts.map((part, index) => (
              <div key={part.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Part {index + 1}</span>
                  {parts.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePart(part.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label htmlFor={`desc-${part.id}`}>Description *</Label>
                    <Input
                      id={`desc-${part.id}`}
                      value={part.description}
                      onChange={(e) => updatePart(part.id, "description", e.target.value)}
                      placeholder="e.g., Internet charges"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`amount-${part.id}`}>Amount *</Label>
                    <Input
                      id={`amount-${part.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={part.amount || ""}
                      onChange={(e) => updatePart(part.id, "amount", parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`category-${part.id}`}>Category</Label>
                    <Select
                      value={part.category}
                      onValueChange={(value) => updatePart(part.id, "category", value)}
                    >
                      <SelectTrigger id={`category-${part.id}`}>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.name}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor={`notes-${part.id}`}>Notes (optional)</Label>
                    <Input
                      id={`notes-${part.id}`}
                      value={part.notes}
                      onChange={(e) => updatePart(part.id, "notes", e.target.value)}
                      placeholder="Additional notes"
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={addPart}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Another Part
            </Button>
          </div>

          {/* Summary */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span>Original Amount:</span>
              <span className="font-medium">{formatCurrency(originalAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Total Parts:</span>
              <span className="font-medium">{formatCurrency(totalParts)}</span>
            </div>
            <div className={`flex justify-between text-sm font-medium ${
              Math.abs(remaining) < 0.01 ? "text-green-600" : "text-red-600"
            }`}>
              <span>Remaining:</span>
              <span>{formatCurrency(remaining)}</span>
            </div>
            {Math.abs(remaining) >= 0.01 && (
              <div className="flex items-center gap-2 text-sm text-amber-600 mt-2">
                <AlertCircle className="h-4 w-4" />
                <span>Parts must sum to the original amount</span>
              </div>
            )}
          </div>

          {/* Delete Original Option */}
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="delete-original"
                checked={deleteOriginal}
                onChange={(e) => setDeleteOriginal(e.target.checked)}
                className="rounded mt-1"
              />
              <div className="flex-1">
                <Label htmlFor="delete-original" className="text-sm font-medium cursor-pointer">
                  Delete original transaction
                </Label>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {deleteOriginal ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      ⚠️ Original will be deleted. Only split parts will remain. You cannot restore the original later.
                    </span>
                  ) : (
                    <span>
                      ✓ Original will be kept and marked as split. You can restore it by removing the split group.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSplit}
            disabled={!isValid || splitTransaction.isPending}
          >
            {splitTransaction.isPending ? "Splitting..." : `Split into ${parts.length} Parts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

