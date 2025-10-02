import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Tag } from "@/lib/types";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const response = await apiClient.getTags();
      return response.data;
    },
  });
}

export function useSearchTags() {
  return useMutation({
    mutationFn: async ({ query, limit = 20 }: { query: string; limit?: number }) => {
      const response = await apiClient.searchTags(query, limit);
      return response.data;
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: Omit<Tag, "id" | "usage_count">) =>
      apiClient.createTag(tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Tag> }) =>
      apiClient.updateTag(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useUpsertTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: Omit<Tag, "id" | "usage_count">) =>
      apiClient.upsertTag(tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}
