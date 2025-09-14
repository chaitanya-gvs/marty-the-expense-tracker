"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBudgets } from "@/hooks/use-budgets";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function BudgetsOverview() {
  const { data: budgetsData, isLoading } = useBudgets();
  const budgets = budgetsData?.data || [];

  // Calculate overview stats
  const totalBudget = budgets.reduce((sum, budget) => sum + budget.monthly_limit, 0);
  const totalSpent = budgets.reduce((sum, budget) => sum + budget.current_spend, 0);
  const remainingBudget = totalBudget - totalSpent;
  const budgetUtilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  // Prepare data for charts
  const pieData = budgets.map(budget => ({
    name: budget.category,
    value: budget.current_spend,
    limit: budget.monthly_limit,
  }));

  const lineData = [
    { month: 'Jan', spent: 1200, budget: 1500 },
    { month: 'Feb', spent: 1900, budget: 1500 },
    { month: 'Mar', spent: 3000, budget: 1500 },
    { month: 'Apr', spent: 2800, budget: 1500 },
    { month: 'May', spent: 1890, budget: 1500 },
    { month: 'Jun', spent: 2390, budget: 1500 },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Budget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">₹{totalBudget.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Spent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">₹{totalSpent.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${remainingBudget >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              ₹{remainingBudget.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">Utilization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${budgetUtilization > 80 ? 'text-red-600 dark:text-red-400' : budgetUtilization > 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
              {budgetUtilization.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Spend by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Spend Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="spent" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="budget" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
