import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export function useMissingEmailTransactions(params?: {
  start_date?: string;
  end_date?: string;
  account?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["email-alerts-missing", params],
    queryFn: () => apiClient.getMissingEmailTransactions(params),
  });
}
