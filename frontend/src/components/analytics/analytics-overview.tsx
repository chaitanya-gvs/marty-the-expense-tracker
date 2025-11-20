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

// Get default date range (This Month)
function getDefaultDateRange() {
  const today = new Date();
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: thisMonthStart.toISOString().split("T")[0],
    end: today.toISOString().split("T")[0]
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
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Customize your expense analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(analytics.summary.total_amount)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Transaction Count
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {analytics.summary.total_count}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Average Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(analytics.summary.average_amount)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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

