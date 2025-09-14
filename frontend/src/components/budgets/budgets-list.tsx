"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useBudgets, useCreateBudget, useUpdateBudget, useDeleteBudget } from "@/hooks/use-budgets";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Budget } from "@/lib/types";

export function BudgetsList() {
  const { data: budgetsData, isLoading } = useBudgets();
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const deleteBudget = useDeleteBudget();
  
  const budgets = budgetsData?.data || [];
  const [editingBudget, setEditingBudget] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this budget?")) {
      await deleteBudget.mutateAsync(id);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">Monthly Budgets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-gray-900 dark:text-white">Monthly Budgets</CardTitle>
          <Button onClick={() => createBudget.mutate({
            category: "New Category",
            monthly_limit: 0,
            current_spend: 0,
            period: new Date().toISOString().slice(0, 7), // YYYY-MM format
          })}>
            <Plus className="h-4 w-4 mr-2" />
            Add Budget
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {budgets.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No budgets set up yet. Create your first budget to start tracking your spending.
            </div>
          ) : (
            budgets.map((budget) => {
              const utilization = budget.monthly_limit > 0 ? (budget.current_spend / budget.monthly_limit) * 100 : 0;
              const isOverBudget = budget.current_spend > budget.monthly_limit;
              
              return (
                <div
                  key={budget.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium text-gray-900 dark:text-white">{budget.category}</h3>
                      {budget.subcategory && (
                        <Badge variant="outline">{budget.subcategory}</Badge>
                      )}
                      <Badge variant="outline">{budget.period}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingBudget(budget.id)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(budget.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                      <span>Spent: ₹{budget.current_spend.toLocaleString()}</span>
                      <span>Budget: ₹{budget.monthly_limit.toLocaleString()}</span>
                      <span className={isOverBudget ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                        {utilization.toFixed(1)}%
                      </span>
                    </div>
                    
                    <Progress 
                      value={Math.min(utilization, 100)} 
                      className={`h-2 ${isOverBudget ? '[&>div]:bg-red-500' : utilization > 80 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-green-500'}`}
                    />
                    
                    {isOverBudget && (
                      <div className="text-sm text-red-600 dark:text-red-400 font-medium">
                        Over budget by ₹{(budget.current_spend - budget.monthly_limit).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
