"use client";

import { useMemo } from "react";
import { useCategories } from "./use-categories";

/**
 * Maps category name -> its configured color (Category.color, set in Settings).
 * Transaction.category is a plain name string, not a joined object, so this
 * hook does the client-side join. Falls back to undefined for uncategorized
 * or unknown category names (callers should render a neutral default dot).
 */
export function useCategoryColorMap(): Record<string, string | undefined> {
  const { data: categories = [] } = useCategories();

  return useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const category of categories) {
      map[category.name] = category.color;
    }
    return map;
  }, [categories]);
}
