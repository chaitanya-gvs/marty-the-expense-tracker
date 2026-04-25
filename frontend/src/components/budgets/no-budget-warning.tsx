"use client";

import { AlertTriangle } from "lucide-react";
import { BudgetCoverageGaps } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface NoBudgetWarningProps {
  coverageGaps: BudgetCoverageGaps;
  onCreateBudget: (categoryId: string) => void;
}

export function NoBudgetWarning({ coverageGaps, onCreateBudget }: NoBudgetWarningProps) {
  const { recurring_gaps, variable_gaps } = coverageGaps;

  if (recurring_gaps.length === 0 && variable_gaps.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Recurring without a budget */}
      {recurring_gaps.length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Recurring expenses without a budget
          </div>
          <div className="space-y-1">
            {recurring_gaps.map((gap) => (
              <div key={gap.id} className="flex items-center justify-between text-xs gap-3">
                <span className="text-muted-foreground min-w-0 truncate">
                  <span className="text-foreground font-medium">{gap.name}</span>
                  {" "}— {gap.recurring_count} recurring transaction{gap.recurring_count !== 1 ? "s" : ""}
                  {" "}· {formatCurrency(gap.projected_amount)}/mo projected
                </span>
                <button
                  type="button"
                  className="shrink-0 text-yellow-400/80 hover:text-yellow-300 transition-colors"
                  onClick={() => onCreateBudget(gap.id)}
                >
                  Create budget →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variable spend without a budget */}
      {variable_gaps.length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Unbudgeted variable spending this month
          </div>
          <div className="space-y-1">
            {variable_gaps.map((gap) => (
              <div key={gap.id} className="flex items-center justify-between text-xs gap-3">
                <span className="text-muted-foreground min-w-0 truncate">
                  <span className="text-foreground font-medium">{gap.name}</span>
                  {" "}— {formatCurrency(gap.variable_spend)} spent,{" "}
                  {gap.transaction_count} transaction{gap.transaction_count !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-yellow-400/80 hover:text-yellow-300 transition-colors"
                  onClick={() => onCreateBudget(gap.id)}
                >
                  Create budget →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
