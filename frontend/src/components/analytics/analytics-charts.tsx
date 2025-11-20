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
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
  "#FFC658",
  "#FF7C7C",
  "#8DD1E1",
  "#D084D0",
];

interface AnalyticsChartsProps {
  analytics: ExpenseAnalytics;
}

export function AnalyticsCharts({ analytics }: AnalyticsChartsProps) {
  const { data, group_by } = analytics;

  // Prepare data for charts
  const chartData = data.map((item) => ({
    name: item.group_key,
    value: item.amount,
    count: item.count,
    color: item.color || COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  // For month-based groupings, prepare line chart data
  const isTimeBased = group_by === "month" || group_by === "category_month" || group_by === "tag_month";
  
  let lineChartData: any[] = [];
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
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="font-semibold">{payload[0].name}</p>
          <p className="text-blue-600 dark:text-blue-400">
            Amount: {formatCurrency(payload[0].value)}
          </p>
          {payload[0].payload.count !== undefined && (
            <p className="text-gray-600 dark:text-gray-400">
              Transactions: {payload[0].payload.count}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Pie Chart - for category, tag, account */}
      {(group_by === "category" || group_by === "tag" || group_by === "account") && (
        <Card>
          <CardHeader>
            <CardTitle>
              {group_by === "category" && "Spending by Category"}
              {group_by === "tag" && "Spending by Tag"}
              {group_by === "account" && "Spending by Account"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name.substring(0, 20)}${name.length > 20 ? "..." : ""} ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={120}
                  fill="#8884d8"
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
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Bar Chart - for all types */}
      <Card>
        <CardHeader>
          <CardTitle>
            {group_by === "category" && "Spending by Category (Bar)"}
            {group_by === "tag" && "Spending by Tag (Bar)"}
            {group_by === "month" && "Spending by Month"}
            {group_by === "account" && "Spending by Account (Bar)"}
            {group_by === "category_month" && "Spending by Category and Month"}
            {group_by === "tag_month" && "Spending by Tag and Month"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={100}
                interval={0}
              />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" fill="#8884d8">
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

      {/* Line Chart - for time-based groupings */}
      {isTimeBased && lineChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {group_by === "month" && "Spending Trend Over Time"}
              {group_by === "category_month" && "Category Spending Trends"}
              {group_by === "tag_month" && "Tag Spending Trends"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip
                  formatter={(value: any) => formatCurrency(value)}
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                  }}
                />
                <Legend />
                {group_by === "month" ? (
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#8884d8"
                    strokeWidth={2}
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
          <CardTitle>Detailed Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Name</th>
                  <th className="text-right p-2">Amount</th>
                  <th className="text-right p-2">Count</th>
                  <th className="text-right p-2">Percentage</th>
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
                      <tr key={index} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {item.color && (
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                            )}
                            {item.group_key}
                          </div>
                        </td>
                        <td className="text-right p-2 font-medium">
                          {formatCurrency(item.amount)}
                        </td>
                        <td className="text-right p-2">{item.count}</td>
                        <td className="text-right p-2">
                          {percentage.toFixed(1)}%
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

