"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Edit, Trash2, Calendar } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetCardProps {
  budget: BudgetSummary;
  onEdit: (budget: BudgetSummary) => void;
  onDelete: (id: string) => void;
  onOverride: (budget: BudgetSummary) => void;
}

function getUtilisationColor(pct: number): string {
  if (pct >= 95) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

function getUtilisationTextColor(pct: number): string {
  if (pct >= 95) return "text-red-400";
  if (pct >= 75) return "text-orange-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-green-400";
}

export function BudgetCard({ budget, onEdit, onDelete, onOverride }: BudgetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isOverBudget = budget.headroom < 0;
  const committedPct = budget.effective_limit > 0 ? (budget.committed_spend / budget.effective_limit) * 100 : 0;
  const variablePct = budget.effective_limit > 0 ? (budget.variable_spend / budget.effective_limit) * 100 : 0;

  return (
    <Card className={cn("transition-colors", isOverBudget && "border-red-500/30")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {budget.name ?? budget.category_name}
            </span>
            {budget.has_override && (
              <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-400">
                Override
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOverride(budget)} title="Set monthly override">
              <Calendar className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit(budget)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(budget.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Limit: {formatCurrency(budget.effective_limit)} / month
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stacked progress bar */}
        <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
          {committedPct > 0 && (
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(committedPct, 100)}%` }}
            />
          )}
          {variablePct > 0 && (
            <div
              className={cn("h-full transition-all", getUtilisationColor(budget.utilisation_pct))}
              style={{ width: `${Math.min(variablePct, 100 - committedPct)}%` }}
            />
          )}
        </div>

        {/* Inline legend */}
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <span className="flex items-center gap-1 text-indigo-400">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
            Committed {formatCurrency(budget.committed_spend)}
          </span>
          <span className={cn("flex items-center gap-1", getUtilisationTextColor(budget.utilisation_pct))}>
            <span className={cn("inline-block h-2 w-2 rounded-full", getUtilisationColor(budget.utilisation_pct))} />
            Variable {formatCurrency(budget.variable_spend)}
          </span>
          <span className={cn(
            "flex items-center gap-1 ml-auto font-medium",
            isOverBudget ? "text-red-400" : "text-muted-foreground"
          )}>
            {isOverBudget ? `Over by ${formatCurrency(Math.abs(budget.headroom))}` : `${formatCurrency(budget.headroom)} left`}
          </span>
        </div>

        {/* Committed items breakdown */}
        {budget.committed_items.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {budget.committed_items.length} recurring item{budget.committed_items.length !== 1 ? "s" : ""}
            </button>

            {expanded && (
              <div className="mt-2 space-y-1">
                {budget.committed_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-foreground/80", item.is_projected && "text-muted-foreground italic")}>
                        {item.description}
                      </span>
                      {item.recurrence_period && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
                          {item.recurrence_period}
                        </Badge>
                      )}
                      {item.is_projected && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">
                          projected
                        </Badge>
                      )}
                    </div>
                    <span className={cn("font-mono", item.is_projected ? "text-muted-foreground" : "text-foreground")}>
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
