import { MainLayout } from "@/components/layout/main-layout";
import { ReviewQueue } from "@/components/review/review-queue";

export default function ReviewPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Review Queue</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Review and approve uncertain transactions
          </p>
        </div>
        
        <ReviewQueue />
      </div>
    </MainLayout>
  );
}
