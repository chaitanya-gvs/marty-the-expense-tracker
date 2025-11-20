import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Transaction, TransactionFilters, TransactionSort, PaginationParams, SplitBreakdown } from "@/lib/types";

// Import useTags to invalidate tags query

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
      // pagination.page is 1-based from the API
      // pageParam is also 1-based (starts at 1)
      // So the next pageParam should be pagination.page + 1
      return pagination && pagination.page < pagination.total_pages ? pagination.page + 1 : undefined;
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

export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transaction: Omit<Transaction, "id" | "created_at" | "updated_at" | "status">) =>
      apiClient.createTransaction(transaction),
    onSuccess: () => {
      // Force complete refetch of all transaction data
      queryClient.removeQueries({ queryKey: ["transactions"] });
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      // Remove all infinite transaction queries to force fresh data
      queryClient.removeQueries({ 
        predicate: (query) => {
          return query.queryKey[0] === "transactions-infinite";
        }
      });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Transaction> }) =>
      apiClient.updateTransaction(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ["transactions-infinite"] });
      await queryClient.cancelQueries({ queryKey: ["transactions"] });
      await queryClient.cancelQueries({ queryKey: ["transaction", id] });

      // Snapshot the previous value for rollback
      const previousInfiniteQueries = queryClient.getQueriesData({ 
        queryKey: ["transactions-infinite"] 
      });
      const previousQueries = queryClient.getQueriesData({ 
        queryKey: ["transactions"] 
      });
      const previousTransaction = queryClient.getQueryData(["transaction", id]);

      // Optimistically update all infinite query caches
      queryClient.setQueriesData<{ pages: Array<{ data: Transaction[] }> }>(
        { queryKey: ["transactions-infinite"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((transaction) =>
                transaction.id === id
                  ? { ...transaction, ...updates }
                  : transaction
              ),
            })),
          };
        }
      );

      // Optimistically update regular query caches
      queryClient.setQueriesData<{ data: Transaction[] }>(
        { queryKey: ["transactions"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((transaction) =>
              transaction.id === id
                ? { ...transaction, ...updates }
                : transaction
            ),
          };
        }
      );

      // Optimistically update single transaction cache
      queryClient.setQueryData<Transaction>(
        ["transaction", id],
        (old) => (old ? { ...old, ...updates } : old)
      );

      return { previousInfiniteQueries, previousQueries, previousTransaction };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousInfiniteQueries) {
        context.previousInfiniteQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousTransaction) {
        queryClient.setQueryData(["transaction", variables.id], context.previousTransaction);
      }
    },
    onSuccess: (data, variables) => {
      // Update cache with the actual response from the server
      const updatedTransaction = data.data;

      // Update all infinite query caches with the actual response
      queryClient.setQueriesData<{ pages: Array<{ data: Transaction[] }> }>(
        { queryKey: ["transactions-infinite"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((transaction) =>
                transaction.id === variables.id
                  ? updatedTransaction
                  : transaction
              ),
            })),
          };
        }
      );

      // Update regular query caches with the actual response
      queryClient.setQueriesData<{ data: Transaction[] }>(
        { queryKey: ["transactions"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((transaction) =>
              transaction.id === variables.id
                ? updatedTransaction
                : transaction
            ),
          };
        }
      );

      // Update single transaction cache
      queryClient.setQueryData(["transaction", variables.id], updatedTransaction);
    },
  });
}

export function useLinkRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ childId, parentId }: { childId: string; parentId: string }) =>
      apiClient.linkRefund(childId, parentId),
    onSuccess: async () => {
      // Use refetchQueries to wait for the refetch to complete
      await queryClient.refetchQueries({ queryKey: ["transactions-infinite"] });
      await queryClient.refetchQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useGroupTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionIds: string[]) =>
      apiClient.groupTransfer(transactionIds),
    onSuccess: async () => {
      // Use refetchQueries to wait for the refetch to complete
      await queryClient.refetchQueries({ queryKey: ["transactions-infinite"] });
      await queryClient.refetchQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useSplitTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      transactionId, 
      parts, 
      deleteOriginal 
    }: { 
      transactionId: string; 
      parts: Array<{
        description: string;
        amount: number;
        category?: string;
        subcategory?: string;
        tags?: string[];
        notes?: string;
      }>;
      deleteOriginal?: boolean;
    }) =>
      apiClient.splitTransaction(transactionId, parts, deleteOriginal),
    onSuccess: async () => {
      // Force complete refetch of all transaction data by removing cached queries
      queryClient.removeQueries({ queryKey: ["transactions"] });
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      // Remove all infinite transaction queries to force fresh data
      queryClient.removeQueries({ 
        predicate: (query) => {
          return query.queryKey[0] === "transactions-infinite";
        }
      });
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

export function useBulkUpdateTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ transactionIds, updates }: { transactionIds: string[]; updates: Partial<Transaction> }) =>
      apiClient.bulkUpdateTransactions(transactionIds, updates),
    onSuccess: async (response) => {
      console.log("=== BULK UPDATE SUCCESS CALLBACK ===");
      console.log("Full response:", response);
      console.log("Response.data:", response?.data);
      console.log("Response.data type:", typeof response?.data);
      console.log("Is array?", Array.isArray(response?.data));
      
      // Invalidate tags query in case new tags were created
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      
      // Get updated transactions from response
      // Handle both direct array and wrapped response
      let updatedTransactions: Transaction[] = [];
      
      if (Array.isArray(response?.data)) {
        updatedTransactions = response.data;
      } else if (response?.data?.updated_transactions && Array.isArray(response.data.updated_transactions)) {
        // Handle case where response is wrapped in an object
        updatedTransactions = response.data.updated_transactions;
      } else if (response?.data?.data && Array.isArray(response.data.data)) {
        // Handle nested data structure
        updatedTransactions = response.data.data;
      }
      
      console.log("Extracted updatedTransactions:", updatedTransactions);
      console.log("Number of transactions:", updatedTransactions.length);
      
      if (updatedTransactions.length > 0) {
        updatedTransactions.forEach((tx, idx) => {
          console.log(`Transaction ${idx + 1}:`, {
            id: tx.id,
            tags: tx.tags,
            tagsLength: tx.tags?.length || 0
          });
        });
        
        // Update infinite query cache with the returned data
        queryClient.setQueriesData<{ pages: Array<{ data: Transaction[]; pagination?: any }> }>(
          { queryKey: ["transactions-infinite"] },
          (old) => {
            if (!old) {
              console.log("No old infinite query data to update");
              return old;
            }
            console.log("Updating infinite query cache with", updatedTransactions.length, "transactions");
            const updated = {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                data: page.data.map((transaction) => {
                  const updatedTx = updatedTransactions.find(t => t.id === transaction.id);
                  if (updatedTx) {
                    console.log(`Updating transaction ${transaction.id} tags:`, transaction.tags, "->", updatedTx.tags);
                    return updatedTx;
                  }
                  return transaction;
                })
              }))
            };
            console.log("Updated infinite query cache");
            return updated;
          }
        );
        
        // Update regular query cache
        queryClient.setQueriesData<{ data: Transaction[] }>(
          { queryKey: ["transactions"] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.map((transaction) => {
                const updated = updatedTransactions.find(t => t.id === transaction.id);
                return updated || transaction;
              })
            };
          }
        );
      }
      
      // Invalidate to trigger refetch for any queries that weren't updated
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
      
      console.log("=== END BULK UPDATE SUCCESS ===");
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteTransaction(id),
    onSuccess: () => {
      // Force complete refetch of all transaction data
      queryClient.removeQueries({ queryKey: ["transactions"] });
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      // Remove all infinite transaction queries to force fresh data
      queryClient.removeQueries({ 
        predicate: (query) => {
          return query.queryKey[0] === "transactions-infinite";
        }
      });
    },
  });
}

export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionIds: string[]) => {
      // Use bulk update to set is_deleted = true for all transactions
      return apiClient.bulkUpdateTransactions(transactionIds, { is_deleted: true });
    },
    onSuccess: () => {
      // Force complete refetch of all transaction data
      queryClient.removeQueries({ queryKey: ["transactions"] });
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      // Remove all infinite transaction queries to force fresh data
      queryClient.removeQueries({ 
        predicate: (query) => {
          return query.queryKey[0] === "transactions-infinite";
        }
      });
    },
  });
}
