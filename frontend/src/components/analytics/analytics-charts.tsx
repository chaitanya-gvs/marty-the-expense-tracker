"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpenseAnalytics, ExpenseAnalyticsFilters } from "@/lib/types";
import { useTransactions } from "@/hooks/use-transactions";
import {
  PieChart,
  Pie,
  Cell,
  Sector,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { formatCurrency } from "@/lib/format-utils";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = [
  "#DC2626", // red
  "#D97706", // amber
  "#0D9488", // teal
  "#7C3AED", // violet
  "#64748B", // slate
  "#EC4899", // pink
  "#0EA5E9", // sky
  "#F97316", // orange
  "#22C55E", // green
  "#A855F7", // purple
];

function getChartColor(index: number, override?: string | null): string {
  if (override) return override;
  return COLORS[index % COLORS.length];
}

interface AnalyticsChartsProps {
  analytics: ExpenseAnalytics;
  analyticsFilters: ExpenseAnalyticsFilters;
}

export function AnalyticsCharts({ analytics, analyticsFilters }: AnalyticsChartsProps) {
  const { data, group_by } = analytics;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Build transaction filters for the drill-down
  const drillDownFilters = expandedGroup ? {
    date_range: analyticsFilters.date_range,
    direction: analyticsFilters.direction,
    ...(group_by === "category" && expandedGroup !== "Uncategorized" && { categories: [expandedGroup] }),
    ...(group_by === "category" && expandedGroup === "Uncategorized" && { include_uncategorized: true }),
    ...(group_by === "account" && { accounts: [expandedGroup] }),
    ...(group_by === "tag" && { tags: [expandedGroup] }),
  } : undefined;

  const { data: txData, isLoading: txLoading } = useTransactions(
    drillDownFilters,
    { field: "date", direction: "desc" },
    { page: 0, limit: 200 }
  );

  // Empty state
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-64 space-y-3 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No data for this period</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your date range or changing the direction filter
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data with deterministic colors
  const chartData = data.map((item, index) => ({
    name: item.group_key,
    value: item.amount,
    count: item.count,
    color: getChartColor(index, item.color),
  }));

  const isTimeBased = group_by === "month" || group_by === "category_month" || group_by === "tag_month";
  const isStacked = group_by === "tag_category";

  type ChartDataPoint = Record<string, string | number>;
  let lineChartData: ChartDataPoint[] = [];
  let stackedBarData: ChartDataPoint[] = [];
  let stackedKeys: string[] = [];

  if (isTimeBased) {
    if (group_by === "month") {
      lineChartData = data.map((item) => ({
        month: item.group_key,
        amount: item.amount,
      }));
    } else if (group_by === "category_month") {
      const monthMap = new Map<string, { month: string; data: { category: string | undefined; amount: number }[] }>();
      data.forEach((item) => {
        const month = item.month || "";
        if (!monthMap.has(month)) monthMap.set(month, { month, data: [] });
        monthMap.get(month)!.data.push({ category: item.category, amount: item.amount });
      });
      const categories = new Set(data.map((d) => d.category).filter(Boolean));
      lineChartData = Array.from(monthMap.values()).map((monthData) => {
        const result: ChartDataPoint = { month: monthData.month };
        categories.forEach((cat) => {
          const item = monthData.data.find((d) => d.category === cat);
          result[cat || "Uncategorized"] = item ? item.amount : 0;
        });
        return result;
      });
    } else if (group_by === "tag_month") {
      const monthMap = new Map<string, { month: string; data: { tag: string | undefined; amount: number }[] }>();
      data.forEach((item) => {
        const month = item.month || "";
        if (!monthMap.has(month)) monthMap.set(month, { month, data: [] });
        monthMap.get(month)!.data.push({ tag: item.tag, amount: item.amount });
      });
      const tags = new Set(data.map((d) => d.tag).filter(Boolean));
      lineChartData = Array.from(monthMap.values()).map((monthData) => {
        const result: ChartDataPoint = { month: monthData.month };
        tags.forEach((tag) => {
          const item = monthData.data.find((d) => d.tag === tag);
          result[tag || "Untagged"] = item ? item.amount : 0;
        });
        return result;
      });
    }
  } else if (isStacked) {
    const tagMap = new Map<string, ChartDataPoint>();
    const categories = new Set<string>();
    data.forEach((item) => {
      const tag = item.tag || "Untagged";
      const category = item.category || "Uncategorized";
      categories.add(category);
      if (!tagMap.has(tag)) tagMap.set(tag, { name: tag });
      const tagEntry = tagMap.get(tag);
      if (tagEntry) tagEntry[category] = item.amount;
    });
    stackedBarData = Array.from(tagMap.values());
    stackedKeys = Array.from(categories);
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number; payload: { count?: number } }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-3 rounded-md shadow-lg z-50 text-sm">
          <p className="font-medium text-foreground mb-1.5">{label}</p>
          {payload.map((entry, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="font-mono font-medium text-foreground">{formatCurrency(entry.value)}</span>
            </div>
          ))}
          {payload[0].payload.count !== undefined && (
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">{payload[0].payload.count} transactions</p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const topItem = chartData[0];
  const topPct = topItem && analytics.summary.total_amount > 0
    ? ((topItem.value / analytics.summary.total_amount) * 100).toFixed(0)
    : "0";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart — for simple groupings */}
        {(group_by === "category" || group_by === "tag" || group_by === "account") && (
          <Card className="col-span-1">
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Spend Distribution</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {chartData.length} groups · top is{" "}
                    <span className="text-foreground font-medium">{topItem?.name}</span>
                    {" "}at {topPct}%
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-xs font-mono shrink-0">
                  {chartData.length} items
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-2 pb-4">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={2}
                    dataKey="value"
                    activeShape={(unknownProps: unknown) => {
                      const props = unknownProps as { cx: number; cy: number; innerRadius: number; outerRadius: number; startAngle: number; endAngle: number; fill: string };
                      const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
                      return (
                        <Sector
                          cx={cx}
                          cy={cy}
                          innerRadius={innerRadius}
                          outerRadius={outerRadius + 7}
                          startAngle={startAngle}
                          endAngle={endAngle}
                          fill={fill}
                          style={{ filter: "brightness(1.15)", cursor: "pointer" }}
                        />
                      );
                    }}
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  {/* Dynamic center label */}
                  <text
                    x="50%"
                    y="43%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: "11px", fill: "var(--muted-foreground)" }}
                  >
                    {activeIndex !== null
                      ? chartData[activeIndex].name.length > 14
                        ? chartData[activeIndex].name.slice(0, 13) + "…"
                        : chartData[activeIndex].name
                      : "total"}
                  </text>
                  <text
                    x="50%"
                    y="54%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      fill: "var(--foreground)",
                      fontFamily: "DM Mono, monospace",
                    }}
                  >
                    {activeIndex !== null
                      ? formatCurrency(chartData[activeIndex].value)
                      : formatCurrency(analytics.summary.total_amount)}
                  </text>
                  {activeIndex !== null && (
                    <text
                      x="50%"
                      y="65%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ fontSize: "10px", fill: "var(--muted-foreground)" }}
                    >
                      {analytics.summary.total_amount > 0
                        ? ((chartData[activeIndex].value / analytics.summary.total_amount) * 100).toFixed(1) + "% of total"
                        : ""}
                    </text>
                  )}
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Proportion bar */}
              <div className="flex h-1.5 rounded-full overflow-hidden mx-1 mb-3">
                {chartData.map((item, i) => {
                  const pct = analytics.summary.total_amount > 0
                    ? (item.value / analytics.summary.total_amount) * 100
                    : 0;
                  return (
                    <div
                      key={i}
                      className="transition-all duration-200"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: item.color,
                        opacity: activeIndex === null || activeIndex === i ? 1 : 0.3,
                      }}
                    />
                  );
                })}
              </div>

              {/* Interactive category list */}
              <div className="space-y-0.5 max-h-[156px] overflow-y-auto pr-0.5">
                {chartData.map((item, i) => {
                  const pct = analytics.summary.total_amount > 0
                    ? (item.value / analytics.summary.total_amount) * 100
                    : 0;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors cursor-default select-none",
                        activeIndex === i ? "bg-muted/70" : "hover:bg-muted/40"
                      )}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex(null)}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0 transition-transform duration-150"
                        style={{
                          backgroundColor: item.color,
                          transform: activeIndex === i ? "scale(1.35)" : "scale(1)",
                        }}
                      />
                      <span className={cn(
                        "text-xs flex-1 truncate transition-colors",
                        activeIndex === i ? "text-foreground font-medium" : "text-muted-foreground"
                      )}>
                        {item.name}
                      </span>
                      <span className="text-xs font-mono text-foreground tabular-nums">
                        {formatCurrency(item.value)}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground/60 tabular-nums w-9 text-right">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Breakdown — custom interactive bar list */}
        {!isStacked && !isTimeBased && (
          <Card
            className={
              group_by === "category" || group_by === "tag" || group_by === "account"
                ? "col-span-1"
                : "col-span-2"
            }
          >
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Breakdown</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {activeBar !== null ? (
                      <>
                        <span className="text-foreground font-medium">{chartData[activeBar].name}</span>
                        {" · "}
                        {analytics.summary.total_amount > 0
                          ? ((chartData[activeBar].value / analytics.summary.total_amount) * 100).toFixed(1)
                          : "0"}% of total
                      </>
                    ) : (
                      <>{topItem?.name} leads at {topPct}% · {chartData.length} groups</>
                    )}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-xs font-mono shrink-0">
                  {chartData.length} items
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-3 pb-4">
              <div className="space-y-0.5">
                {chartData.map((item, i) => {
                  const pct = analytics.summary.total_amount > 0
                    ? (item.value / analytics.summary.total_amount) * 100
                    : 0;
                  const relPct = chartData[0].value > 0
                    ? (item.value / chartData[0].value) * 100
                    : 0;
                  const isExpanded = expandedGroup === item.name;
                  return (
                    <div key={i}>
                    <div
                      className={cn(
                        "flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors cursor-pointer select-none",
                        isExpanded ? "bg-muted/70" : activeBar === i ? "bg-muted/70" : "hover:bg-muted/40"
                      )}
                      onMouseEnter={() => setActiveBar(i)}
                      onMouseLeave={() => setActiveBar(null)}
                      onClick={() => setExpandedGroup(isExpanded ? null : item.name)}
                    >
                      {/* Rank */}
                      <span className="text-xs font-mono text-muted-foreground/40 w-5 text-right tabular-nums flex-shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {/* Color dot */}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0 transition-transform duration-150"
                        style={{
                          backgroundColor: item.color,
                          transform: activeBar === i ? "scale(1.35)" : "scale(1)",
                        }}
                      />
                      {/* Name */}
                      <span className={cn(
                        "text-xs w-28 flex-shrink-0 truncate transition-colors",
                        activeBar === i ? "text-foreground font-medium" : "text-muted-foreground"
                      )}>
                        {item.name}
                      </span>
                      {/* Bar */}
                      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${relPct}%`,
                            backgroundColor: item.color,
                            opacity: activeBar === null || activeBar === i ? 1 : 0.3,
                          }}
                        />
                      </div>
                      {/* Amount */}
                      <span className="text-xs font-mono text-foreground tabular-nums w-20 text-right flex-shrink-0">
                        {formatCurrency(item.value)}
                      </span>
                      {/* Txns */}
                      <span className="text-xs font-mono text-muted-foreground/50 tabular-nums w-7 text-right flex-shrink-0">
                        {item.count}
                      </span>
                      {/* % */}
                      <span className="text-xs font-mono text-muted-foreground/60 tabular-nums w-9 text-right flex-shrink-0">
                        {pct.toFixed(0)}%
                      </span>
                    </div>

                    {/* Inline expanded transactions */}
                    {isExpanded && (
                      <div className="ml-8 mr-2 mb-1 border-l-2 pl-3"
                        style={{ borderColor: item.color + "60" }}>
                        {txLoading ? (
                          <div className="space-y-0">
                            {Array.from({ length: 4 }).map((_, k) => (
                              <div key={k} className="flex items-center gap-3 py-2">
                                <Skeleton className="h-2.5 w-12 flex-shrink-0" />
                                <Skeleton className="h-2.5 flex-1" />
                                <Skeleton className="h-2.5 w-16 flex-shrink-0" />
                              </div>
                            ))}
                          </div>
                        ) : txData?.data.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No transactions</p>
                        ) : (
                          <div className="space-y-0">
                            {txData?.data.map((tx) => {
                              const d = new Date(tx.date);
                              const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
                              return (
                                <div key={tx.id} className="flex items-center gap-3 py-1.5 group">
                                  <span className="text-xs font-mono text-muted-foreground/50 tabular-nums w-12 flex-shrink-0">
                                    {dateStr}
                                  </span>
                                  <span className="text-xs text-muted-foreground flex-1 truncate group-hover:text-foreground transition-colors">
                                    {tx.description}
                                  </span>
                                  <span className="text-xs font-mono tabular-nums flex-shrink-0"
                                    style={{ color: tx.direction === "credit" ? "var(--chart-3)" : "var(--foreground)" }}>
                                    {tx.direction === "credit" ? "+" : ""}{formatCurrency(tx.is_shared && tx.split_share_amount ? tx.split_share_amount : tx.amount)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stacked Bar Chart — for Tag > Category */}
      {isStacked && (
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Category Breakdown by Tag</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Stacked by category within each tag
                </CardDescription>
              </div>
              <Badge variant="secondary" className="text-xs font-mono shrink-0">
                {stackedKeys.length} categories
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={stackedBarData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(value) => `₹${value / 1000}k`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {stackedKeys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={getChartColor(index)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Line Chart — for time-based groupings (not month, which uses MonthlyNetChart) */}
      {isTimeBased && group_by !== "month" && lineChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Spending Trends</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Showing {lineChartData.length} month{lineChartData.length !== 1 ? "s" : ""} of data
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis tickFormatter={(value) => `₹${value / 1000}k`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {Object.keys(lineChartData[0] || {})
                    .filter((key) => key !== "month")
                    .map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={getChartColor(index)}
                        strokeWidth={2}
                        dot={{ r: 3, fill: "var(--background)", strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: getChartColor(index) }}
                        name={key}
                      />
                    ))
                }
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
