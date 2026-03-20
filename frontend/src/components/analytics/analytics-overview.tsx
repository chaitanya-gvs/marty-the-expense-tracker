"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useExpenseAnalytics } from "@/hooks/use-analytics";
import { ExpenseAnalyticsFilters } from "@/lib/types";
import { AnalyticsCharts } from "./analytics-charts";
import { AnalyticsFilters } from "./analytics-filters";
import { formatCurrency } from "@/lib/format-utils";
import { Loader2, TrendingDown, Hash, BarChart3 } from "lucide-react";

// Get default date range (Last Month)
function getDefaultDateRange() {
  const today = new Date();
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    start: formatDate(lastMonthStart),
    end: formatDate(lastMonthEnd)
  };
}

export function AnalyticsOverview() {
  const [filters, setFilters] = useState<ExpenseAnalyticsFilters>({
    date_range: getDefaultDateRange(),
    direction: "debit",
    group_by: "category"
  });

  const { data: analyticsData, isLoading, error } = useExpenseAnalytics(filters);

  const handleFiltersChange = (newFilters: Partial<ExpenseAnalyticsFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const analytics = analyticsData?.data;

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      {analytics && (
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-5 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Total Amount
            </p>
            <p className="font-mono text-xl font-semibold text-foreground tabular-nums">
              {formatCurrency(analytics.summary.total_amount)}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Transactions
            </p>
            <p className="font-mono text-xl font-semibold text-foreground tabular-nums">
              {analytics.summary.total_count}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              Average
            </p>
            <p className="font-mono text-xl font-semibold text-foreground tabular-nums">
              {formatCurrency(analytics.summary.average_amount)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-5">
          <AnalyticsFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />
        </CardContent>
      </Card>

      {/* Charts */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center h-96">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-96 space-y-3">
            <div className="text-destructive text-sm font-medium">Error loading analytics data</div>
            <div className="text-xs text-muted-foreground max-w-md text-center">
              {error instanceof Error ? error.message : String(error)}
            </div>
          </CardContent>
        </Card>
      ) : analytics ? (
        <AnalyticsCharts analytics={analytics} />
      ) : null}
    </div>
  );
}
