"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useExpenseAnalytics } from "@/hooks/use-analytics";
import { ExpenseAnalytics, ExpenseAnalyticsFilters } from "@/lib/types";
import { AnalyticsCharts } from "./analytics-charts";
import { AnalyticsFilters } from "./analytics-filters";
import { formatCurrency } from "@/lib/format-utils";
import { TrendingDown, Hash, BarChart3 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

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

function MonthlyNetChart({ filters }: { filters: ExpenseAnalyticsFilters }) {
  const debitFilters = useMemo(
    () => ({ ...filters, group_by: "month" as const, direction: "debit" as const }),
    [filters]
  );
  const creditFilters = useMemo(
    () => ({ ...filters, group_by: "month" as const, direction: "credit" as const }),
    [filters]
  );

  const { data: debitData } = useExpenseAnalytics(debitFilters);
  const { data: creditData } = useExpenseAnalytics(creditFilters);

  const { chartData, totalGrossSpend, totalCredits, totalNet } = useMemo(() => {
    const debitMap = new Map<string, number>(
      (debitData?.data.data ?? []).map((d) => [d.group_key, d.amount])
    );
    const creditMap = new Map<string, number>(
      (creditData?.data.data ?? []).map((d) => [d.group_key, d.amount])
    );
    const months = [...new Set([...debitMap.keys(), ...creditMap.keys()])].sort();
    const rows = months.map((m) => {
      const net = debitMap.get(m) ?? 0;       // direction=debit returns (debits - credits)
      const credits = creditMap.get(m) ?? 0;
      const grossSpend = net + credits;        // recover gross debits
      return {
        month: m,
        label: new Date(m + "-15").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        grossSpend,
        credits,
        net,
      };
    });
    const totalGrossSpend = rows.reduce((s, r) => s + r.grossSpend, 0);
    const totalCredits = rows.reduce((s, r) => s + r.credits, 0);
    const totalNet = rows.reduce((s, r) => s + r.net, 0);
    return { chartData: rows, totalGrossSpend, totalCredits, totalNet };
  }, [debitData, creditData]);

  if (chartData.length < 1) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Monthly Cash Flow</CardTitle>
        {/* Period totals summary */}
        <div className="flex items-center gap-5 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#D97706] flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Spent</span>
            <span className="text-xs font-mono font-medium text-foreground tabular-nums">{formatCurrency(totalGrossSpend)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#0D9488] flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Received</span>
            <span className="text-xs font-mono font-medium text-[#0D9488] tabular-nums">+{formatCurrency(totalCredits)}</span>
          </div>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Net</span>
            <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: totalNet >= 0 ? "#D97706" : "#0D9488" }}>
              {totalNet >= 0 ? "" : "+"}{formatCurrency(Math.abs(totalNet))}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pr-2">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `₹${v / 1000}k`}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const grossSpend = (payload.find((p) => p.dataKey === "grossSpend")?.value as number) ?? 0;
                const credits = (payload.find((p) => p.dataKey === "credits")?.value as number) ?? 0;
                const net = grossSpend - credits;
                return (
                  <div className="rounded-lg border bg-card shadow-md px-3 py-2 text-xs space-y-1.5 min-w-[150px]">
                    <p className="font-medium text-foreground">{label}</p>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Spent</span>
                      <span className="font-mono tabular-nums text-[#D97706]">{formatCurrency(grossSpend)}</span>
                    </div>
                    {credits > 0 && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Received</span>
                        <span className="font-mono tabular-nums text-[#0D9488]">+{formatCurrency(credits)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 border-t border-border pt-1">
                      <span className="text-muted-foreground">Net</span>
                      <span className="font-mono tabular-nums font-medium text-foreground">{formatCurrency(net)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="grossSpend" fill="#D97706" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={36} name="Spent" />
            <Bar dataKey="credits" fill="#0D9488" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={36} name="Received" />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
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
          {filters.group_by === "month" && <MonthlyNetChart filters={filters} />}
          <AnalyticsCharts analytics={analytics} analyticsFilters={filters} />
        </>
      ) : null}
    </div>
  );
}
