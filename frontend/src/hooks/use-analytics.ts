import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ExpenseAnalyticsFilters } from "@/lib/types";

export function useExpenseAnalytics(filters?: ExpenseAnalyticsFilters) {
  return useQuery({
    queryKey: ["expense-analytics", filters],
    queryFn: () => apiClient.getExpenseAnalytics(filters),
    staleTime: 30000, // 30 seconds
  });
}

