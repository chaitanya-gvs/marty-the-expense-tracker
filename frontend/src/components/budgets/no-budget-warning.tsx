"use client";

import { AlertTriangle } from "lucide-react";
import { UnbudgetedCategory } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NoBudgetWarningProps {
  categories: UnbudgetedCategory[];
  onCreateBudget: (categoryId: string) => void;
}

export function NoBudgetWarning({ categories, onCreateBudget }: NoBudgetWarningProps) {
  if (categories.length === 0) return null;
  return (
    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Recurring expenses without a budget
      </div>
      <div className="space-y-1">
        {categories.map(cat => (
          <div key={cat.id} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{cat.name}</span>
              {" "}— {cat.recurring_count} recurring transaction{cat.recurring_count !== 1 ? "s" : ""}
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-yellow-400 hover:text-yellow-300"
              onClick={() => onCreateBudget(cat.id)}>
              Create budget →
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
