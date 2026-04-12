"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow, MoneyInput } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBudget, useUpdateBudget } from "@/hooks/use-budgets";
import { useCategories } from "@/hooks/use-categories";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";

interface BudgetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBudget?: BudgetSummary | null;
}

export function BudgetCreateModal({ isOpen, onClose, editingBudget }: BudgetCreateModalProps) {
  const [categoryId, setCategoryId] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [name, setName] = useState("");

  const { data: categories = [] } = useCategories("debit");
  const rootCategories = categories.filter((c) => !c.parent_id);

  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const isEditing = !!editingBudget;
  const isPending = createBudget.isPending || updateBudget.isPending;

  useEffect(() => {
    if (editingBudget) {
      setCategoryId(editingBudget.category_id);
      setMonthlyLimit(String(editingBudget.monthly_limit));
      setName(editingBudget.name ?? "");
    } else {
      setCategoryId("");
      setMonthlyLimit("");
      setName("");
    }
  }, [editingBudget, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(monthlyLimit);
    if (!limit || limit <= 0) {
      toast.error("Enter a valid monthly limit");
      return;
    }

    try {
      if (isEditing && editingBudget) {
        await updateBudget.mutateAsync({
          id: editingBudget.id,
          updates: { monthly_limit: limit, name: name || undefined },
        });
        toast.success("Budget updated");
      } else {
        if (!categoryId) {
          toast.error("Select a category");
          return;
        }
        await createBudget.mutateAsync({
          category_id: categoryId,
          monthly_limit: limit,
          name: name || undefined,
        });
        toast.success("Budget created");
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save budget";
      toast.error(msg);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <Modal.Header
        icon={<DollarSign className="h-4 w-4" />}
        title={isEditing ? "Edit Budget" : "Create Budget"}
        subtitle={
          isEditing
            ? `Editing budget for ${editingBudget?.category_name}`
            : "Set a monthly spending limit for a category"
        }
        onClose={onClose}
        variant="share"
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="space-y-4">
            {/* Category: picker when creating, label when editing */}
            {isEditing ? (
              <FieldRow label="Category">
                <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm text-[var(--modal-text)]">
                  {editingBudget?.category_name}
                </div>
              </FieldRow>
            ) : (
              <FieldRow label="Category" required>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {rootCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            )}

            {/* Monthly limit */}
            <FieldRow label="Monthly Limit" required>
              <MoneyInput
                value={monthlyLimit}
                onChange={(e) => setMonthlyLimit(e.target.value)}
                placeholder="0.00"
                min={0.01}
              />
            </FieldRow>

            {/* Optional name */}
            <FieldRow label="Name" hint="Optional label for this budget">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dining out cap"
                className="text-sm"
              />
            </FieldRow>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEditing ? "Saving…" : "Creating…") : isEditing ? "Save Changes" : "Create Budget"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
