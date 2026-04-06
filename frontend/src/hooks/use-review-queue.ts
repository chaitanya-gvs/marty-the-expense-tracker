import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export function useReviewQueue(review_type?: string) {
  return useQuery({
    queryKey: ["review-queue", review_type],
    queryFn: () => apiClient.getReviewQueue(review_type),
    staleTime: 30_000,
  });
}

export function useConfirmReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      edits,
    }: {
      itemId: string;
      edits?: Record<string, unknown>;
    }) => apiClient.confirmReviewItem(itemId, edits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Transaction confirmed");
    },
    onError: () => toast.error("Failed to confirm transaction"),
  });
}

export function useLinkReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      transactionId,
    }: {
      itemId: string;
      transactionId: string;
    }) => apiClient.linkReviewItem(itemId, transactionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Transaction linked");
    },
    onError: () => toast.error("Failed to link transaction"),
  });
}

export function useDeleteReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => apiClient.deleteReviewItem(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Item removed");
    },
  });
}

export function useBulkConfirmReviewItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => apiClient.bulkConfirmReviewItems(itemIds),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(`${data.confirmed} transactions confirmed`);
    },
  });
}

export function useRunEmailIngestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { since_date?: string; account_ids?: string[] }) =>
      apiClient.runEmailIngestion(params),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success(
        `Ingestion complete — ${data.inserted} inserted, ${data.skipped} skipped`
      );
    },
    onError: () => toast.error("Email ingestion failed"),
  });
}
