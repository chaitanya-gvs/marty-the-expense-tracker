"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow, MoneyInput } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { useUpsertBudgetOverride, useDeleteBudgetOverride } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";
import { Calendar } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  budget: BudgetSummary | null;
  period: string; // YYYY-MM
}

export function BudgetOverrideModal({ isOpen, onClose, budget, period }: BudgetOverrideModalProps) {
  const [limit, setLimit] = useState("");

  const upsert = useUpsertBudgetOverride();
  const deleteOverride = useDeleteBudgetOverride();
  const isPending = upsert.isPending || deleteOverride.isPending;

  // Populate field when modal opens or budget changes
  useEffect(() => {
    if (isOpen && budget) {
      setLimit(String(budget.effective_limit));
    }
  }, [isOpen, budget]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budget) return;
    const val = parseFloat(limit);
    if (!val || val <= 0) {
      toast.error("Enter a valid limit");
      return;
    }
    try {
      await upsert.mutateAsync({ budgetId: budget.id, period, monthlyLimit: val });
      toast.success(`Override set for ${period}`);
      onClose();
    } catch {
      toast.error("Failed to set override");
    }
  };

  const handleRemove = async () => {
    if (!budget) return;
    try {
      await deleteOverride.mutateAsync({ budgetId: budget.id, period });
      toast.success("Override removed");
      onClose();
    } catch {
      toast.error("Failed to remove override");
    }
  };

  const hasExistingOverride = budget?.has_override ?? false;

  return (
    <Modal open={isOpen && !!budget} onClose={onClose} size="sm">
      <Modal.Header
        icon={<Calendar className="h-4 w-4" />}
        title="Monthly Override"
        subtitle={budget ? `${budget.category_name} · ${period}` : undefined}
        onClose={onClose}
        variant="transfer"
      />

      <form onSubmit={handleSave}>
        <Modal.Body>
          <div className="space-y-4">
            {/* Base limit info */}
            {budget && (
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-[var(--modal-muted)]">
                Default monthly limit:{" "}
                <span className="font-mono font-semibold text-[var(--modal-text)]">
                  {formatCurrency(budget.monthly_limit)}
                </span>
              </div>
            )}

            {/* Override limit input */}
            <FieldRow
              label="Override Limit"
              required
              hint={hasExistingOverride ? "An override is already set for this period." : undefined}
            >
              <MoneyInput
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="0.00"
                min={0.01}
              />
            </FieldRow>
          </div>
        </Modal.Body>

        <Modal.Footer>
          {hasExistingOverride && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={isPending}
            >
              {deleteOverride.isPending ? "Removing…" : "Remove Override"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {upsert.isPending ? "Saving…" : hasExistingOverride ? "Update Override" : "Set Override"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
