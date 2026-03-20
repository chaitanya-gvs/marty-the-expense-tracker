"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseAnalytics } from "@/lib/types";
import {
  PieChart,
  Pie,
  Cell,
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

const COLORS = [
  "#DC2626", // red (primary)
  "#D97706", // amber (accent)
  "#0D9488", // teal
  "#7C3AED", // violet
  "#64748B", // slate
  "#EC4899", // pink
  "#0EA5E9", // sky
  "#F97316", // orange
  "#22C55E", // green
  "#A855F7", // purple
];

interface AnalyticsChartsProps {
  analytics: ExpenseAnalytics;
}

export function AnalyticsCharts({ analytics }: AnalyticsChartsProps) {
  const { data, group_by } = analytics;

  // Prepare data for pie/simple bar charts
  const chartData = data.map((item) => ({
    name: item.group_key,
    value: item.amount,
    count: item.count,
    color: item.color || COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  // For month-based groupings, prepare line chart data
  const isTimeBased = group_by === "month" || group_by === "category_month" || group_by === "tag_month";
  
  // For stacked bar charts (tag > category)
  const isStacked = group_by === "tag_category";

  let lineChartData: any[] = [];
  let stackedBarData: any[] = [];
  let stackedKeys: string[] = [];

  if (isTimeBased) {
    if (group_by === "month") {
      lineChartData = data.map((item) => ({
        month: item.group_key,
        amount: item.amount,
      }));
    } else if (group_by === "category_month") {
      // Group by month, then aggregate categories
      const monthMap = new Map<string, any>();
      data.forEach((item) => {
        const month = item.month || "";
        if (!monthMap.has(month)) {
          monthMap.set(month, { month, data: [] });
        }
        monthMap.get(month).data.push({
          category: item.category,
          amount: item.amount,
        });
      });
      // Get unique categories
      const categories = new Set(data.map((d) => d.category).filter(Boolean));
      lineChartData = Array.from(monthMap.values()).map((monthData) => {
        const result: any = { month: monthData.month };
        categories.forEach((cat) => {
          const item = monthData.data.find((d: any) => d.category === cat);
          result[cat || "Uncategorized"] = item ? item.amount : 0;
        });
        return result;
      });
    } else if (group_by === "tag_month") {
      // Similar to category_month but for tags
      const monthMap = new Map<string, any>();
      data.forEach((item) => {
        const month = item.month || "";
        if (!monthMap.has(month)) {
          monthMap.set(month, { month, data: [] });
        }
        monthMap.get(month).data.push({
          tag: item.tag,
          amount: item.amount,
        });
      });
      const tags = new Set(data.map((d) => d.tag).filter(Boolean));
      lineChartData = Array.from(monthMap.values()).map((monthData) => {
        const result: any = { month: monthData.month };
        tags.forEach((tag) => {
          const item = monthData.data.find((d: any) => d.tag === tag);
          result[tag || "Untagged"] = item ? item.amount : 0;
        });
        return result;
      });
    }
  } else if (isStacked) {
    // Handle tag_category: Group by Tag, stack by Category
    const tagMap = new Map<string, any>();
    const categories = new Set<string>();
    
    data.forEach((item) => {
      const tag = item.tag || "Untagged";
      const category = item.category || "Uncategorized";
      categories.add(category);
      
      if (!tagMap.has(tag)) {
        tagMap.set(tag, { name: tag });
      }
      
      tagMap.get(tag)[category] = item.amount;
    });
    
    stackedBarData = Array.from(tagMap.values());
    stackedKeys = Array.from(categories);
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-3 rounded-md shadow-lg z-50 text-sm">
          <p className="font-medium text-foreground mb-1.5">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="font-mono font-medium text-foreground">
                {formatCurrency(entry.value)}
              </span>
            </div>
          ))}
          {payload[0].payload.count !== undefined && (
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {payload[0].payload.count} transactions
              </p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart - for simple groupings */}
        {(group_by === "category" || group_by === "tag" || group_by === "account") && (
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-medium">Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color || COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    layout="vertical" 
                    verticalAlign="middle" 
                    align="right"
                    wrapperStyle={{ fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Bar Chart - for simple groupings */}
        {!isStacked && !isTimeBased && (
          <Card className={group_by === "category" || group_by === "tag" || group_by === "account" ? "col-span-1" : "col-span-2"}>
            <CardHeader>
              <CardTitle className="text-base font-medium">Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tickFormatter={(value) => `₹${value/1000}k`} />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={180} 
                    tick={{ fontSize: 12 }}
                    interval={0}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color || COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stacked Bar Chart - for Tag > Category */}
      {isStacked && (
        <Card>
          <CardHeader>
            <CardTitle>Category Breakdown by Tag</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={450}>
              <BarChart data={stackedBarData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => `₹${value/1000}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {stackedKeys.map((key, index) => (
                  <Bar 
                    key={key} 
                    dataKey={key} 
                    stackId="a" 
                    fill={COLORS[index % COLORS.length]} 
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Line Chart - for time-based groupings */}
      {isTimeBased && lineChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Spending Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value) => `₹${value/1000}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {group_by === "month" ? (
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#D97706"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    name="Amount"
                  />
                ) : (
                  Object.keys(lineChartData[0] || {})
                    .filter((key) => key !== "month")
                    .map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={key}
                      />
                    ))
                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Detailed Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Amount</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Count</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Share</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .sort((a, b) => b.amount - a.amount)
                  .map((item, index) => {
                    const percentage =
                      analytics.summary.total_amount > 0
                        ? (item.amount / analytics.summary.total_amount) * 100
                        : 0;
                    return (
                      <tr key={index} className="border-b border-border hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: item.color || COLORS[index % COLORS.length]
                              }}
                            />
                            <span className="font-medium text-foreground">
                              {item.group_key}
                            </span>
                          </div>
                        </td>
                        <td className="text-right p-3 font-mono font-medium text-foreground">
                          {formatCurrency(item.amount)}
                        </td>
                        <td className="text-right p-3 text-muted-foreground font-mono">
                          {item.count}
                        </td>
                        <td className="text-right p-3">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-muted-foreground w-12 text-right font-mono">
                              {percentage.toFixed(1)}%
                            </span>
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${percentage}%`,
                                  backgroundColor: item.color || COLORS[index % COLORS.length]
                                }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

