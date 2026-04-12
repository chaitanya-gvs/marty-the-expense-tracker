"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetCreateModal } from "@/components/budgets/budget-create-modal";
import { BudgetOverrideModal } from "@/components/budgets/budget-override-modal";
import { useDeleteBudget } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";

interface BudgetsListProps {
  budgets: BudgetSummary[];
  isLoading: boolean;
  period: string;
  onCreateWithCategory?: (categoryId: string) => void;
}

export function BudgetsList({ budgets, isLoading, period }: BudgetsListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetSummary | null>(null);
  const [overrideBudget, setOverrideBudget] = useState<BudgetSummary | null>(null);
  const deleteBudget = useDeleteBudget();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this budget and all its overrides?")) return;
    try {
      await deleteBudget.mutateAsync(id);
      toast.success("Budget deleted");
    } catch { toast.error("Failed to delete budget"); }
  };

  const handleEdit = (budget: BudgetSummary) => {
    setEditingBudget(budget);
    setCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Monthly Budgets
        </h2>
        <Button size="sm" onClick={() => { setEditingBudget(null); setCreateOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
        </Button>
      </div>

      {budgets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
          No budgets set up yet. Create your first budget to start tracking spending.
        </div>
      ) : (
        <div className="space-y-4">
          {budgets.map(b => (
            <BudgetCard
              key={b.id}
              budget={b}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOverride={(b) => setOverrideBudget(b)}
            />
          ))}
        </div>
      )}

      <BudgetCreateModal
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setEditingBudget(null); }}
        editingBudget={editingBudget}
      />
      <BudgetOverrideModal
        isOpen={!!overrideBudget}
        onClose={() => setOverrideBudget(null)}
        budget={overrideBudget}
        period={period}
      />
    </>
  );
}
