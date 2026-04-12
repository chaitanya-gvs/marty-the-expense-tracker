"use client";

import { BudgetSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, TrendingUp } from "lucide-react";

interface BudgetThresholdAlertsProps {
  budgets: BudgetSummary[];
}

function getAlert(b: BudgetSummary): { level: "critical" | "warning" | "heads-up"; label: string } | null {
  if (b.utilisation_pct >= 95) return { level: "critical", label: b.headroom < 0 ? `Over by ₹${Math.abs(b.headroom).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : "95%+ used" };
  if (b.utilisation_pct >= 75) return { level: "warning", label: `${b.utilisation_pct.toFixed(0)}% used` };
  if (b.utilisation_pct >= 50) return { level: "heads-up", label: `${b.utilisation_pct.toFixed(0)}% used` };
  return null;
}

const levelStyles = {
  critical: { border: "border-red-500/20 bg-red-500/5", text: "text-red-400", icon: AlertCircle },
  warning: { border: "border-orange-500/20 bg-orange-500/5", text: "text-orange-400", icon: AlertTriangle },
  "heads-up": { border: "border-yellow-500/20 bg-yellow-500/5", text: "text-yellow-400", icon: TrendingUp },
};

export function BudgetThresholdAlerts({ budgets }: BudgetThresholdAlertsProps) {
  const alerts = budgets
    .map(b => ({ budget: b, alert: getAlert(b) }))
    .filter((x): x is { budget: BudgetSummary; alert: NonNullable<ReturnType<typeof getAlert>> } => x.alert !== null)
    .sort((a, b) => b.budget.utilisation_pct - a.budget.utilisation_pct);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map(({ budget, alert }) => {
        const styles = levelStyles[alert.level];
        const Icon = styles.icon;
        return (
          <div key={budget.id} className={cn("rounded-lg border px-3 py-2 flex items-center justify-between text-sm", styles.border)}>
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4 shrink-0", styles.text)} />
              <span className="font-medium text-foreground">{budget.name ?? budget.category_name}</span>
              <span className={cn("text-xs", styles.text)}>{alert.label}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              ₹{(budget.committed_spend + budget.variable_spend).toLocaleString('en-IN', { maximumFractionDigits: 0 })} / ₹{budget.effective_limit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
