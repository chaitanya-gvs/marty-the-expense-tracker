import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Transaction, TransactionFilters, TransactionSort, PaginationParams, SplitBreakdown } from "@/lib/types";

export function useTransactions(
  filters?: TransactionFilters,
  sort?: TransactionSort,
  pagination?: PaginationParams
) {
  return useQuery({
    queryKey: ["transactions", filters, sort, pagination],
    queryFn: () => apiClient.getTransactions(filters, sort, pagination),
  });
}

export function useInfiniteTransactions(
  filters?: TransactionFilters,
  sort?: TransactionSort
) {
  return useInfiniteQuery({
    queryKey: ["transactions-infinite", filters, sort],
    queryFn: ({ pageParam = 1 }) => 
      apiClient.getTransactions(filters, sort, { page: pageParam - 1, limit: 500 }),
    getNextPageParam: (lastPage) => {
      const { pagination } = lastPage;
      return pagination && pagination.page < pagination.total_pages ? pagination.page + 2 : undefined;
    },
    initialPageParam: 1,
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: ["transaction", id],
    queryFn: () => apiClient.getTransaction(id),
    enabled: !!id,
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Transaction> }) =>
      apiClient.updateTransaction(id, updates),
    onSuccess: (data, variables) => {
      // Force complete refetch of all transaction data
      queryClient.removeQueries({ queryKey: ["transactions"] });
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      queryClient.removeQueries({ queryKey: ["transaction", variables.id] });
      // Remove all infinite transaction queries to force fresh data
      queryClient.removeQueries({ 
        predicate: (query) => {
          return query.queryKey[0] === "transactions-infinite";
        }
      });
    },
  });
}

export function useLinkRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ childId, parentId }: { childId: string; parentId: string }) =>
      apiClient.linkRefund(childId, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
    },
  });
}

export function useGroupTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionIds: string[]) =>
      apiClient.groupTransfer(transactionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
    },
  });
}

export function useUpdateTransactionSplit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, splitBreakdown, myShareAmount }: { id: string; splitBreakdown: SplitBreakdown; myShareAmount: number }) =>
      apiClient.updateTransactionSplit(id, splitBreakdown, myShareAmount),
    onSuccess: (data, variables) => {
      // Invalidate and refetch all transaction queries
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["transaction", variables.id] });
    },
  });
}

export function useClearTransactionSplit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.clearTransactionSplit(id),
    onSuccess: (data, variables) => {
      // Invalidate and refetch all transaction queries
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["transaction", variables] });
    },
  });
}
