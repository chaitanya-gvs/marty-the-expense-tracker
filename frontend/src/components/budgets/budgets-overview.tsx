"use client";

import { BudgetsSummaryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetsOverviewProps {
  data: BudgetsSummaryResponse | undefined;
  isLoading: boolean;
}

function getHealthStroke(pct: number): string {
  if (pct >= 95) return "#ef4444"; // red-500
  if (pct >= 75) return "#f97316"; // orange-500
  if (pct >= 50) return "#eab308"; // yellow-500
  return "#22c55e";                 // green-500
}

export function BudgetsOverview({ data, isLoading }: BudgetsOverviewProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex gap-6 items-center">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="w-px self-stretch bg-border shrink-0" />
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2 bg-muted rounded animate-pulse w-16" />
              <div className="h-6 bg-muted rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const budgets = data?.budgets ?? [];
  const totalLimit = budgets.reduce((s, b) => s + b.effective_limit, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.committed_spend, 0);
  const totalVariable = budgets.reduce((s, b) => s + b.variable_spend, 0);
  const totalHeadroom = totalLimit - totalCommitted - totalVariable;
  const overCount = budgets.filter(b => b.headroom < 0).length;

  const totalSpend = totalCommitted + totalVariable;
  const utilisationPct = totalLimit > 0 ? (totalSpend / totalLimit) * 100 : 0;
  const healthStroke = getHealthStroke(utilisationPct);

  // SVG ring math
  const r = 38;
  const circumference = 2 * Math.PI * r;
  const committedFrac = totalLimit > 0 ? Math.min(totalCommitted / totalLimit, 1) : 0;
  const variableFrac = totalLimit > 0
    ? Math.min(totalVariable / totalLimit, Math.max(0, 1 - committedFrac))
    : 0;
  const committedArc = committedFrac * circumference;
  const variableArc = variableFrac * circumference;
  const variableStartDeg = committedFrac * 360;

  const stats = [
    { label: "Total Budget", value: formatCurrency(totalLimit), color: "text-foreground" },
    { label: "Committed",    value: formatCurrency(totalCommitted), color: "text-indigo-400" },
    {
      label: "Variable",
      value: formatCurrency(totalVariable),
      color: overCount > 0 ? "text-red-400" : "text-orange-400",
    },
    {
      label: "Headroom",
      value: formatCurrency(totalHeadroom),
      color: totalHeadroom >= 0 ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-6">

        {/* Ring chart */}
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 96 96" className="w-24 h-24">
            <g transform="rotate(-90 48 48)">
              {/* Track */}
              <circle
                cx="48" cy="48" r={r}
                fill="none"
                strokeWidth="9"
                className="stroke-muted"
              />
              {/* Committed segment */}
              {committedArc > 0 && (
                <circle
                  cx="48" cy="48" r={r}
                  fill="none"
                  strokeWidth="9"
                  stroke="#6366f1"
                  strokeLinecap="butt"
                  strokeDasharray={`${committedArc} ${circumference}`}
                />
              )}
              {/* Variable segment */}
              {variableArc > 0 && (
                <circle
                  cx="48" cy="48" r={r}
                  fill="none"
                  strokeWidth="9"
                  stroke={healthStroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${variableArc} ${circumference}`}
                  transform={`rotate(${variableStartDeg} 48 48)`}
                />
              )}
            </g>
          </svg>

          {/* Centre text overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-sm font-bold font-mono text-foreground leading-none">
              {Math.round(utilisationPct)}%
            </span>
            <span className="text-[8px] text-muted-foreground leading-none">used</span>
            {overCount > 0 && (
              <span className="text-[8px] text-red-400 leading-none">{overCount} over</span>
            )}
          </div>
        </div>

        {/* Vertical divider */}
        <div className="w-px self-stretch bg-border shrink-0" />

        {/* Stats 2×2 grid */}
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {stats.map(stat => (
            <div key={stat.label}>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {stat.label}
              </div>
              <div className={`text-xl font-bold font-mono ${stat.color}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
