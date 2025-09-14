import { MainLayout } from "@/components/layout/main-layout";
import { BudgetsOverview } from "@/components/budgets/budgets-overview";
import { BudgetsList } from "@/components/budgets/budgets-list";

export default function BudgetsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Budgets</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Manage your monthly spending budgets and track progress
          </p>
        </div>
        
        <BudgetsOverview />
        <BudgetsList />
      </div>
    </MainLayout>
  );
}
