import { MainLayout } from "@/components/layout/main-layout";
import { TransactionsPage as TransactionsPageComponent } from "@/components/transactions/transactions-page";

export default function TransactionsPage() {
  return (
    <MainLayout>
      <TransactionsPageComponent />
    </MainLayout>
  );
}
