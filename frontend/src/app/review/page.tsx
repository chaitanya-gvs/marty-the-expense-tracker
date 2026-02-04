import { MainLayout } from "@/components/layout/main-layout";
import { ReviewQueue } from "@/components/review/review-queue";
import { MissingEmailTransactions } from "@/components/review/missing-email-transactions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        
        <Tabs defaultValue="review">
          <TabsList>
            <TabsTrigger value="review">Review Queue</TabsTrigger>
            <TabsTrigger value="missing">Missing From Email</TabsTrigger>
          </TabsList>
          <TabsContent value="review">
            <ReviewQueue />
          </TabsContent>
          <TabsContent value="missing">
            <MissingEmailTransactions />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
