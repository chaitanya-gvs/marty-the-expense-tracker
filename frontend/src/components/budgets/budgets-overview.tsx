"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetsSummaryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetsOverviewProps {
  data: BudgetsSummaryResponse | undefined;
  isLoading: boolean;
}

export function BudgetsOverview({ data, isLoading }: BudgetsOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-3 bg-muted rounded animate-pulse w-24" />
            </CardHeader>
            <CardContent>
              <div className="h-7 bg-muted rounded animate-pulse w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const budgets = data?.budgets ?? [];
  const totalLimit = budgets.reduce((s, b) => s + b.effective_limit, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.committed_spend, 0);
  const totalVariable = budgets.reduce((s, b) => s + b.variable_spend, 0);
  const totalHeadroom = totalLimit - totalCommitted - totalVariable;

  const stats = [
    { label: "Total Budget", value: formatCurrency(totalLimit), color: "text-foreground" },
    { label: "Committed", value: formatCurrency(totalCommitted), color: "text-indigo-400" },
    { label: "Variable Spend", value: formatCurrency(totalVariable), color: "text-orange-400" },
    { label: "Headroom", value: formatCurrency(totalHeadroom), color: totalHeadroom >= 0 ? "text-green-400" : "text-red-400" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map(stat => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {stat.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
