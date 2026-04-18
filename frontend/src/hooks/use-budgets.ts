import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ── Budget templates ──────────────────────────────────────────────────────────

export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: () => apiClient.getBudgets(),
    staleTime: 60_000,
  });
}

export function useBudgetsSummary(period?: string) {
  return useQuery({
    queryKey: ["budgets", "summary", period ?? "current"],
    queryFn: () => apiClient.getBudgetsSummary(period),
    staleTime: 30_000,
  });
}

export function useBudgetSummary(id: string, period?: string) {
  return useQuery({
    queryKey: ["budgets", id, "summary", period ?? "current"],
    queryFn: () => apiClient.getBudgetSummary(id, period),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (budget: { category_id: string; monthly_limit: number; name?: string }) =>
      apiClient.createBudget(budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { monthly_limit?: number; name?: string } }) =>
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

// ── Overrides ─────────────────────────────────────────────────────────────────

export function useUpsertBudgetOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, period, monthlyLimit }: { budgetId: string; period: string; monthlyLimit: number }) =>
      apiClient.upsertBudgetOverride(budgetId, period, monthlyLimit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudgetOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, period }: { budgetId: string; period: string }) =>
      apiClient.deleteBudgetOverride(budgetId, period),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

// ── Recurring ─────────────────────────────────────────────────────────────────

export function useSetRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionId,
      is_recurring,
      recurrence_period,
      recurring_key,
    }: {
      transactionId: string;
      is_recurring: boolean;
      recurrence_period?: string | null;
      recurring_key?: string | null;
    }) => apiClient.setRecurring(transactionId, { is_recurring, recurrence_period, recurring_key }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
