import { MainLayout } from "@/components/layout/main-layout";
import { AnalyticsOverview } from "@/components/analytics/analytics-overview";

export default function AnalyticsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Analyze your expenses by category, tag, month, and more
          </p>
        </div>
        
        <AnalyticsOverview />
      </div>
    </MainLayout>
  );
}

