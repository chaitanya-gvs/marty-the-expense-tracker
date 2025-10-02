"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Category } from "@/lib/types";
import { toast } from "sonner";

// Query keys
const CATEGORIES_QUERY_KEY = ["categories"];

// Get all categories
export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => apiClient.getCategories(),
    select: (response) => response.data || [],
  });
}

// Search categories
export function useSearchCategories(query: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...CATEGORIES_QUERY_KEY, "search", query],
    queryFn: () => apiClient.searchCategories(query),
    select: (response) => response.data || [],
    enabled: enabled && query.length > 0,
  });
}

// Get single category
export function useCategory(categoryId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: [...CATEGORIES_QUERY_KEY, categoryId],
    queryFn: () => apiClient.getCategory(categoryId),
    select: (response) => response.data,
    enabled: enabled && !!categoryId,
  });
}

// Create category mutation
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryData: {
      name: string;
      color?: string;
      parent_id?: string;
      sort_order?: number;
    }) => apiClient.createCategory(categoryData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      toast.success("Category created successfully");
    },
    onError: (error: any) => {
      console.error("Failed to create category:", error);
      toast.error("Failed to create category");
    },
  });
}

// Update category mutation
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      categoryId,
      categoryData,
    }: {
      categoryId: string;
      categoryData: {
        name?: string;
        color?: string;
        parent_id?: string;
        sort_order?: number;
      };
    }) => apiClient.updateCategory(categoryId, categoryData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      toast.success("Category updated successfully");
    },
    onError: (error: any) => {
      console.error("Failed to update category:", error);
      toast.error("Failed to update category");
    },
  });
}

// Delete category mutation
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryId: string) => apiClient.deleteCategory(categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      toast.success("Category deleted successfully");
    },
    onError: (error: any) => {
      console.error("Failed to delete category:", error);
      toast.error("Failed to delete category");
    },
  });
}

// Upsert category mutation
export function useUpsertCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryData: {
      name: string;
      color?: string;
      parent_id?: string;
      sort_order?: number;
    }) => apiClient.upsertCategory(categoryData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      toast.success("Category saved successfully");
    },
    onError: (error: any) => {
      console.error("Failed to save category:", error);
      toast.error("Failed to save category");
    },
  });
}