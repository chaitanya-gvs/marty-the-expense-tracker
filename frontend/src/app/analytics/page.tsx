import { MainLayout } from "@/components/layout/main-layout";
import { AnalyticsOverview } from "@/components/analytics/analytics-overview";

export default function AnalyticsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze your expenses by category, tag, month, and more
          </p>
        </div>
        
        <AnalyticsOverview />
      </div>
    </MainLayout>
  );
}

