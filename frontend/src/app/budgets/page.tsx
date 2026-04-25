"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { BudgetsOverview } from "@/components/budgets/budgets-overview";
import { BudgetsList } from "@/components/budgets/budgets-list";
import { BudgetThresholdAlerts } from "@/components/budgets/budget-threshold-alerts";
import { NoBudgetWarning } from "@/components/budgets/no-budget-warning";
import { BudgetCreateModal } from "@/components/budgets/budget-create-modal";
import { useBudgetsSummary } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

function getPeriod(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export default function BudgetsPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const period = getPeriod(monthOffset);
  const { data, isLoading } = useBudgetsSummary(period);

  // Modal state (shared between "Add Budget" button and coverage-gap shortcuts)
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetSummary | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);

  const summaryData = data?.data;
  const budgets = summaryData?.budgets ?? [];
  const coverageGaps = summaryData?.coverage_gaps ?? { recurring_gaps: [], variable_gaps: [] };

  const handleAddBudget = () => {
    setEditingBudget(null);
    setDefaultCategoryId(null);
    setCreateOpen(true);
  };

  const handleEditBudget = (budget: BudgetSummary) => {
    setEditingBudget(budget);
    setDefaultCategoryId(null);
    setCreateOpen(true);
  };

  const handleCreateFromGap = (categoryId: string) => {
    setEditingBudget(null);
    setDefaultCategoryId(categoryId);
    setCreateOpen(true);
  };

  const handleModalClose = () => {
    setCreateOpen(false);
    setEditingBudget(null);
    setDefaultCategoryId(null);
  };

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        {/* Header + period nav */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Budgets</h1>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Manage your monthly spending limits and track progress
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMonthOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {formatPeriodLabel(period)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMonthOffset((o) => o + 1)}
              disabled={monthOffset >= 0}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Overview stats */}
        <BudgetsOverview data={summaryData} isLoading={isLoading} />

        {/* Threshold alerts */}
        {budgets.length > 0 && <BudgetThresholdAlerts budgets={budgets} />}

        {/* Coverage gap warnings */}
        <NoBudgetWarning
          coverageGaps={coverageGaps}
          onCreateBudget={handleCreateFromGap}
        />

        {/* Budget cards list */}
        <BudgetsList
          budgets={budgets}
          isLoading={isLoading}
          period={period}
          onAddBudget={handleAddBudget}
          onEditBudget={handleEditBudget}
        />

        {/* Shared create/edit modal */}
        <BudgetCreateModal
          isOpen={createOpen}
          onClose={handleModalClose}
          editingBudget={editingBudget}
          defaultCategoryId={defaultCategoryId}
        />
      </div>
    </MainLayout>
  );
}
