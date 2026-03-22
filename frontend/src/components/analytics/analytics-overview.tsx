"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useExpenseAnalytics } from "@/hooks/use-analytics";
import { ExpenseAnalytics, ExpenseAnalyticsFilters } from "@/lib/types";
import { AnalyticsCharts } from "./analytics-charts";
import { AnalyticsFilters } from "./analytics-filters";
import { formatCurrency } from "@/lib/format-utils";
import { TrendingDown, Hash, BarChart3 } from "lucide-react";

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

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      {/* KPI Card skeletons */}
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="py-5">
            <CardContent className="px-5 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart area skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-52" />
            <div className="flex items-center justify-center h-[320px]">
              <div className="relative flex items-center justify-center">
                <Skeleton className="h-[210px] w-[210px] rounded-full" />
                <div className="absolute inset-[33px] rounded-full bg-card" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-44" />
            <div className="space-y-3 pt-2">
              {[80, 65, 55, 45, 40, 30, 25].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-24 flex-shrink-0" />
                  <Skeleton className="h-5 rounded-sm" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table skeleton */}
      <Card>
        <CardContent className="pt-5">
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="space-y-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-border/60 last:border-0">
                <Skeleton className="h-3 w-5 flex-shrink-0" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20 ml-auto" />
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-2 w-24 rounded-full" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCards({ analytics }: { analytics: ExpenseAnalytics }) {
  const topItem = [...analytics.data].sort((a, b) => b.amount - a.amount)[0];

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="py-5">
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Spent</p>
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary">
              <TrendingDown className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="font-mono text-lg font-semibold text-foreground tabular-nums tracking-tight">
            {formatCurrency(analytics.summary.total_amount)}
          </p>
          <p className="text-xs text-muted-foreground">
            across {analytics.summary.total_count} transactions
          </p>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Transactions</p>
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#0D9488]/10 text-[#0D9488]">
              <Hash className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="font-mono text-lg font-semibold text-foreground tabular-nums tracking-tight">
            {analytics.summary.total_count}
          </p>
          <p className="text-xs text-muted-foreground">
            {topItem ? <>Top: <span className="text-foreground font-medium">{topItem.group_key}</span></> : "No data"}
          </p>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Average</p>
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#D97706]/10 text-[#D97706]">
              <BarChart3 className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="font-mono text-lg font-semibold text-foreground tabular-nums tracking-tight">
            {formatCurrency(analytics.summary.average_amount)}
          </p>
          <p className="text-xs text-muted-foreground">per transaction this period</p>
        </CardContent>
      </Card>
    </div>
  );
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
      {/* Filters — always visible */}
      <Card className="overflow-hidden py-0">
        <AnalyticsFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
        />
      </Card>

      {/* Data: skeleton, error, or content */}
      {isLoading ? (
        <AnalyticsSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-3">
            <div className="text-destructive text-sm font-medium">Error loading analytics data</div>
            <div className="text-xs text-muted-foreground max-w-md text-center">
              {error instanceof Error ? error.message : String(error)}
            </div>
          </CardContent>
        </Card>
      ) : analytics ? (
        <>
          <SummaryCards analytics={analytics} />
          <AnalyticsCharts analytics={analytics} analyticsFilters={filters} />
        </>
      ) : null}
    </div>
  );
}
