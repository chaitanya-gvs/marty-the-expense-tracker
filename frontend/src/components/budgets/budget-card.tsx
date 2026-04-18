"use client";

import { Button } from "@/components/ui/button";
import { Replace, Edit2, Trash2, Repeat } from "lucide-react";
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

function getUtilisationBorderColor(pct: number): string {
  if (pct >= 95) return "border-l-red-500";
  if (pct >= 75) return "border-l-orange-500";
  if (pct >= 50) return "border-l-yellow-500";
  return "border-l-green-500";
}

export function BudgetCard({ budget, onEdit, onDelete, onOverride }: BudgetCardProps) {
  const isOverBudget = budget.headroom < 0;
  const totalSpend = budget.committed_spend + budget.variable_spend;

  // Progress bar widths
  const committedPct = budget.effective_limit > 0
    ? (budget.committed_spend / budget.effective_limit) * 100
    : 0;
  const variablePct = budget.effective_limit > 0
    ? (Math.min(budget.variable_spend, Math.max(0, budget.effective_limit - budget.committed_spend))
        / budget.effective_limit) * 100
    : 0;

  const healthBg     = getUtilisationColor(budget.utilisation_pct);
  const healthText   = getUtilisationTextColor(budget.utilisation_pct);
  const healthBorder = getUtilisationBorderColor(budget.utilisation_pct);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card border-l-[3px] p-4 space-y-3",
        healthBorder,
        isOverBudget && "border-t border-t-red-500/20",
      )}
    >
      {/* Card header */}
      <div>
        <div className="flex items-center gap-2">

          {/* Name + Override badge */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="font-semibold text-foreground truncate">
              {budget.name ?? budget.category_name}
            </span>
            {budget.has_override && (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/30 text-indigo-400">
                Override
              </span>
            )}
          </div>

          {/* Spent amount + headroom badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("text-base font-bold font-mono", healthText)}>
              {formatCurrency(totalSpend)}
            </span>
            {isOverBudget ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                Over {formatCurrency(Math.abs(budget.headroom))}
              </span>
            ) : (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {formatCurrency(budget.headroom)} left
              </span>
            )}
          </div>

          {/* Action buttons — always visible */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md"
              onClick={() => onOverride(budget)}
              title="Set monthly override"
            >
              <Replace className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md"
              onClick={() => onEdit(budget)}
              title="Edit budget"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 rounded-md text-destructive/60 hover:text-destructive"
              onClick={() => onDelete(budget.id)}
              title="Delete budget"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

        </div>

        {/* Limit subtitle */}
        <div className="text-xs text-muted-foreground mt-0.5">
          Limit: {formatCurrency(budget.effective_limit)} / month
        </div>
      </div>

      {/* Stacked progress bar */}
      <div className="h-[10px] rounded-full bg-muted overflow-hidden flex">
        {isOverBudget ? (
          <div className="h-full w-full bg-gradient-to-r from-orange-500 to-red-500" />
        ) : (
          <>
            {committedPct > 0 && (
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${committedPct}%` }}
              />
            )}
            {variablePct > 0 && (
              <div
                className={cn("h-full transition-all", healthBg)}
                style={{ width: `${variablePct}%` }}
              />
            )}
          </>
        )}
      </div>

      {/* Legend row */}
      <div className="flex items-center gap-4 flex-wrap">
        <span
          className={cn(
            "flex items-center gap-1 text-[10px] text-indigo-400",
            budget.committed_spend === 0 && "opacity-40",
          )}
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-indigo-500 shrink-0" />
          Committed {formatCurrency(budget.committed_spend)}
        </span>

        <span
          className={cn(
            "flex items-center gap-1 text-[10px]",
            healthText,
            budget.variable_spend === 0 && "opacity-40",
          )}
        >
          <span className={cn("inline-block h-[7px] w-[7px] rounded-full shrink-0", healthBg)} />
          Variable {formatCurrency(budget.variable_spend)}
        </span>

        {isOverBudget ? (
          <span className="flex items-center gap-1 text-[10px] text-red-400 ml-auto">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground/30 shrink-0" />
            −{formatCurrency(Math.abs(budget.headroom))} over
          </span>
        ) : (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] text-muted-foreground ml-auto",
              budget.headroom === 0 && "opacity-40",
            )}
          >
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground/30 shrink-0" />
            {formatCurrency(budget.headroom)} free
          </span>
        )}
      </div>

      {/* Committed items block — only when recurring items exist */}
      {budget.committed_items.length > 0 && (
        <div className="bg-background/60 rounded-lg border border-border/50 p-3 space-y-2">

          <div className="flex items-center gap-1.5">
            <Repeat className="h-3 w-3 text-indigo-400 shrink-0" />
            <span className="text-[8px] uppercase tracking-wider text-muted-foreground font-medium">
              Recurring · {budget.committed_items.length} item{budget.committed_items.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="h-px bg-border/50" />

          <div className="space-y-1.5">
            {budget.committed_items.map((item, i) => (
              <div key={item.recurring_key ?? i} className="flex items-center justify-between gap-2">

                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      "text-xs truncate",
                      item.is_projected
                        ? "text-muted-foreground italic"
                        : "text-foreground/80",
                    )}
                  >
                    {item.description}
                  </span>
                  {item.recurrence_period && (
                    <span className="shrink-0 text-[8px] bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 px-1 rounded capitalize">
                      {item.recurrence_period}
                    </span>
                  )}
                  {item.is_projected && (
                    <span className="shrink-0 text-[8px] text-muted-foreground/60 bg-muted/50 px-1 rounded">
                      projected
                    </span>
                  )}
                </div>

                <span
                  className={cn(
                    "shrink-0 text-xs font-mono",
                    item.is_projected ? "text-muted-foreground" : "text-indigo-400",
                  )}
                >
                  {formatCurrency(item.amount)}
                </span>

              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
