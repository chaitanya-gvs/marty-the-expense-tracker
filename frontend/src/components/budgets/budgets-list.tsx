"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, PiggyBank } from "lucide-react";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetOverrideModal } from "@/components/budgets/budget-override-modal";
import { useDeleteBudget } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";

type SortKey = "utilisation_desc" | "name_asc" | "spend_desc" | "headroom_asc";

function sortBudgets(budgets: BudgetSummary[], sortKey: SortKey): BudgetSummary[] {
  const sorted = [...budgets];
  switch (sortKey) {
    case "utilisation_desc":
      return sorted.sort((a, b) => b.utilisation_pct - a.utilisation_pct);
    case "name_asc":
      return sorted.sort((a, b) =>
        (a.name ?? a.category_name).localeCompare(b.name ?? b.category_name),
      );
    case "spend_desc":
      return sorted.sort(
        (a, b) =>
          b.committed_spend + b.variable_spend - (a.committed_spend + a.variable_spend),
      );
    case "headroom_asc":
      return sorted.sort((a, b) => a.headroom - b.headroom);
  }
}

interface BudgetsListProps {
  budgets: BudgetSummary[];
  isLoading: boolean;
  period: string;
  onAddBudget: () => void;
  onEditBudget: (budget: BudgetSummary) => void;
}

export function BudgetsList({
  budgets,
  isLoading,
  period,
  onAddBudget,
  onEditBudget,
}: BudgetsListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("utilisation_desc");
  const [overrideBudget, setOverrideBudget] = useState<BudgetSummary | null>(null);
  const deleteBudget = useDeleteBudget();

  const sortedBudgets = sortBudgets(budgets, sortKey);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this budget and all its overrides?")) return;
    try {
      await deleteBudget.mutateAsync(id);
      toast.success("Budget deleted");
    } catch {
      toast.error("Failed to delete budget");
    }
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
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex-1">
          Monthly Budgets · {budgets.length} active
        </h2>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs bg-transparent text-muted-foreground border border-border rounded-md px-2 py-1 cursor-pointer hover:border-border/80 focus:outline-none"
          aria-label="Sort budgets"
        >
          <option value="utilisation_desc">↓ Utilisation %</option>
          <option value="name_asc">A → Z</option>
          <option value="spend_desc">↓ Amount spent</option>
          <option value="headroom_asc">↑ Headroom</option>
        </select>
        <Button size="sm" onClick={onAddBudget}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
        </Button>
      </div>

      {budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-border/50 bg-card/30">
          <PiggyBank className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <div className="text-center space-y-1">
            <h3 className="font-semibold text-foreground">No budgets yet</h3>
            <p className="text-sm text-muted-foreground">
              Create your first budget to start tracking spending limits.
            </p>
          </div>
          <Button
            size="sm"
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={onAddBudget}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedBudgets.map((b) => (
            <BudgetCard
              key={b.id}
              budget={b}
              period={period}
              onEdit={onEditBudget}
              onDelete={handleDelete}
              onOverride={(b) => setOverrideBudget(b)}
            />
          ))}
        </div>
      )}

      <BudgetOverrideModal
        isOpen={!!overrideBudget}
        onClose={() => setOverrideBudget(null)}
        budget={overrideBudget}
        period={period}
      />
    </>
  );
}
