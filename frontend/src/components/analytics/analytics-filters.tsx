"use client";

import { useState } from "react";
import { ExpenseAnalyticsFilters } from "@/lib/types";
import { CalendarDays, ArrowDownLeft, ArrowUpRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const DATE_PRESETS = [
  { value: "last_month", label: "Last Mo" },
  { value: "this_month", label: "This Mo" },
  { value: "last_3_months", label: "3 Mo" },
  { value: "last_6_months", label: "6 Mo" },
  { value: "this_year", label: "YTD" },
] as const;

const GROUP_BY_OPTIONS = [
  { value: "category", label: "Category" },
  { value: "tag", label: "Tag" },
  { value: "tag_category", label: "Tag × Category" },
  { value: "month", label: "Month" },
  { value: "account", label: "Account" },
  { value: "category_month", label: "Cat × Month" },
  { value: "tag_month", label: "Tag × Month" },
] as const;

function formatDateShort(dateStr?: string) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

interface AnalyticsFiltersProps {
  filters: ExpenseAnalyticsFilters;
  onFiltersChange: (filters: Partial<ExpenseAnalyticsFilters>) => void;
}

export function AnalyticsFilters({ filters, onFiltersChange }: AnalyticsFiltersProps) {
  const [activePreset, setActivePreset] = useState<string | null>("last_month");
  const [showCustomDates, setShowCustomDates] = useState(false);

  const setDateRange = (range: typeof DATE_PRESETS[number]["value"]) => {
    const today = new Date();
    let start = new Date();
    let end = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    switch (range) {
      case "this_month":
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "last_month":
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case "last_3_months":
        start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
        break;
      case "last_6_months":
        start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
        break;
      case "this_year":
        start = new Date(today.getFullYear(), 0, 1);
        break;
    }

    onFiltersChange({ date_range: { start: formatDate(start), end: formatDate(end) } });
  };

  return (
    <div className="flex flex-col">
      {/* Row 1: Period + Date Range + Direction */}
      <div className="flex items-center justify-between gap-3 px-5 py-3">

        {/* Date preset segmented group */}
        <div className="flex items-center bg-muted/50 rounded-md p-0.5 gap-0.5 shrink-0">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => {
                setDateRange(preset.value);
                setActivePreset(preset.value);
                setShowCustomDates(false);
              }}
              className={cn(
                "px-2.5 h-6 text-xs font-medium rounded transition-all duration-150 whitespace-nowrap",
                activePreset === preset.value
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Right side: date display + direction */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Date range display / toggle custom dates */}
          <button
            onClick={() => setShowCustomDates((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs transition-colors border",
              showCustomDates
                ? "border-border bg-muted/50 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30"
            )}
          >
            <CalendarDays className="h-3 w-3 shrink-0" />
            <span className="font-mono tabular-nums">
              {formatDateShort(filters.date_range?.start)}
              <span className="mx-1 text-muted-foreground/50">→</span>
              {formatDateShort(filters.date_range?.end)}
            </span>
          </button>

          <div className="h-4 w-px bg-border/60" />

          {/* Direction toggle */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5 gap-0.5">
            <button
              onClick={() => onFiltersChange({ direction: "debit" })}
              className={cn(
                "flex items-center gap-1 px-2.5 h-6 text-xs font-medium rounded transition-all duration-150",
                filters.direction === "debit"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowDownLeft className="h-3 w-3" />
              Debit
            </button>
            <button
              onClick={() => onFiltersChange({ direction: "credit" })}
              className={cn(
                "flex items-center gap-1 px-2.5 h-6 text-xs font-medium rounded transition-all duration-150",
                filters.direction === "credit"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowUpRight className="h-3 w-3" />
              Credit
            </button>
          </div>
        </div>
      </div>

      {/* Expandable custom date inputs */}
      {showCustomDates && (
        <div className="flex items-center gap-3 px-5 pb-3 pt-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-10 shrink-0">Start</span>
            <input
              type="date"
              className="bg-muted/40 border border-border/60 rounded-md px-2.5 h-7 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={filters.date_range?.start || ""}
              onChange={(e) => {
                setActivePreset(null);
                onFiltersChange({
                  date_range: { start: e.target.value || undefined, end: filters.date_range?.end },
                });
              }}
            />
          </div>
          <div className="h-px w-3 bg-border/60" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-10 shrink-0">End</span>
            <input
              type="date"
              className="bg-muted/40 border border-border/60 rounded-md px-2.5 h-7 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={filters.date_range?.end || ""}
              onChange={(e) => {
                setActivePreset(null);
                onFiltersChange({
                  date_range: { start: filters.date_range?.start, end: e.target.value || undefined },
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border/50 mx-5" />

      {/* Row 2: Group By */}
      <div className="flex items-center gap-1.5 px-5 py-2.5">
        <div className="flex items-center gap-1 mr-1 text-muted-foreground/60 shrink-0">
          <Layers className="h-3 w-3" />
          <span className="text-xs">Group</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {GROUP_BY_OPTIONS.map((opt) => {
            const isActive = (filters.group_by || "category") === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onFiltersChange({ group_by: opt.value as ExpenseAnalyticsFilters["group_by"] })}
                className={cn(
                  "px-3.5 h-6 text-xs rounded transition-all duration-150 whitespace-nowrap font-medium",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
