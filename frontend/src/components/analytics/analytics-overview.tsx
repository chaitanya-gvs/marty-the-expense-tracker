"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useExpenseAnalytics } from "@/hooks/use-analytics";
import { ExpenseAnalyticsFilters } from "@/lib/types";
import { AnalyticsCharts } from "./analytics-charts";
import { AnalyticsFilters } from "./analytics-filters";
import { formatCurrency } from "@/lib/format-utils";
import { Loader2 } from "lucide-react";

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
    <div className="space-y-6">
      {/* Summary Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-100 dark:border-blue-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">
                Total Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                {formatCurrency(analytics.summary.total_amount)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-100 dark:border-emerald-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Transaction Count
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                {analytics.summary.total_count}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-100 dark:border-amber-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Average Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">
                {formatCurrency(analytics.summary.average_amount)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
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
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-96 space-y-4">
            <div className="text-red-500 font-semibold">Error loading analytics data</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 max-w-md text-center">
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

