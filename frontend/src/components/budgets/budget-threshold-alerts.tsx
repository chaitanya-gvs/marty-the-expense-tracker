"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

interface BudgetThresholdAlertsProps {
  budgets: BudgetSummary[];
}

function isAlertBudget(b: BudgetSummary): boolean {
  return b.utilisation_pct >= 50;
}

function alertMessage(b: BudgetSummary): string {
  const name = b.name ?? b.category_name;
  const spent = formatCurrency(b.committed_spend + b.variable_spend);
  const limit = formatCurrency(b.effective_limit);
  return b.headroom < 0
    ? `${name} is over budget by ${formatCurrency(Math.abs(b.headroom))} — ${spent} spent of ${limit} limit`
    : `${name} at ${b.utilisation_pct.toFixed(0)}% — ${spent} spent of ${limit} limit`;
}

export function BudgetThresholdAlerts({ budgets }: BudgetThresholdAlertsProps) {
  const [expanded, setExpanded] = useState(false);

  const alerts = budgets
    .filter(isAlertBudget)
    .sort((a, b) => b.utilisation_pct - a.utilisation_pct);

  if (alerts.length === 0) return null;

  const moreCount = alerts.length - 1;
  const visible = expanded ? alerts : [alerts[0]];

  return (
    <div className="rounded-xl bg-red-950/20 border border-red-500/30 overflow-hidden">
      {visible.map((b, idx) => (
        <div
          key={b.id}
          className={cn(
            "px-4 py-2.5 flex items-center justify-between gap-4",
            idx < visible.length - 1 && "border-b border-red-500/20",
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" aria-hidden="true" />
            <span className="text-xs text-red-400 truncate">{alertMessage(b)}</span>
          </div>
          {/* Show expand button only on the last visible row when there are more */}
          {idx === visible.length - 1 && moreCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="shrink-0 flex items-center gap-0.5 text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
              aria-label={expanded ? "Show fewer alerts" : `Show ${moreCount} more alerts`}
            >
              {expanded ? "less" : `+${moreCount} more`}
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
