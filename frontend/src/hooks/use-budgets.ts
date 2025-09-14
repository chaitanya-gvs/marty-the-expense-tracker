import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Budget } from "@/lib/types";

export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: () => apiClient.getBudgets(),
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (budget: Omit<Budget, "id" | "created_at" | "updated_at">) =>
      apiClient.createBudget(budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Budget> }) =>
      apiClient.updateBudget(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
