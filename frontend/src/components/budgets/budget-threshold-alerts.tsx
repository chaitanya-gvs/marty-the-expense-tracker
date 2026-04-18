"use client";

import { AlertTriangle } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetThresholdAlertsProps {
  budgets: BudgetSummary[];
}

function isAlertBudget(b: BudgetSummary): boolean {
  return b.utilisation_pct >= 50;
}

export function BudgetThresholdAlerts({ budgets }: BudgetThresholdAlertsProps) {
  const alerts = budgets
    .filter(isAlertBudget)
    .sort((a, b) => b.utilisation_pct - a.utilisation_pct);

  if (alerts.length === 0) return null;

  const worst = alerts[0];
  const moreCount = alerts.length - 1;

  // Build the inline message for the worst offender.
  const name = worst.name ?? worst.category_name;
  const spent = formatCurrency(worst.committed_spend + worst.variable_spend);
  const limit = formatCurrency(worst.effective_limit);
  const message = worst.headroom < 0
    ? `${name} is over budget by ${formatCurrency(Math.abs(worst.headroom))} — ${spent} spent of ${limit} limit`
    : `${name} at ${worst.utilisation_pct.toFixed(0)}% — ${spent} spent of ${limit} limit`;

  return (
    <div className="rounded-xl bg-red-950/20 border border-red-500/30 px-4 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        <span className="text-xs text-red-400 truncate">{message}</span>
      </div>
      {moreCount > 0 && (
        <span className="shrink-0 text-[10px] text-red-400/70">+{moreCount} more</span>
      )}
    </div>
  );
}
