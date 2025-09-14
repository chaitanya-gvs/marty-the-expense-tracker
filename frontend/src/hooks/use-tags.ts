import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Tag } from "@/lib/types";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => apiClient.getTags(),
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
