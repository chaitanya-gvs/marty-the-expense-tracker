"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// Query keys
const ACCOUNTS_QUERY_KEY = ["accounts"];

// Get all unique account values
export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiClient.getFieldValues("account", undefined, 100);
      console.log("Accounts API response:", response);
      return response;
    },
    select: (response) => {
      const accounts = response.data || [];
      console.log("Extracted accounts:", accounts);
      return accounts;
    },
  });
}

