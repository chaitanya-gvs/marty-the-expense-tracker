import { ApiResponse, Transaction, Budget, Category, Tag, TransactionFilters, TransactionSort, PaginationParams, TransferSuggestion, RefundSuggestion, SplitBreakdown } from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(url, config);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    // Handle empty responses (like 204 No Content)
    const contentType = response.headers.get('content-type');
    if (response.status === 204 || !contentType?.includes('application/json')) {
      return {} as ApiResponse<T>;
    }

    return response.json();
  }

  // Transactions
  async getTransactions(
    filters?: TransactionFilters,
    sort?: TransactionSort,
    pagination?: PaginationParams
  ): Promise<ApiResponse<Transaction[]>> {
    const params = new URLSearchParams();
    
    if (filters) {
      // Map frontend filter structure to backend query parameters
      if (filters.date_range) {
        params.append("date_range_start", filters.date_range.start);
        params.append("date_range_end", filters.date_range.end);
      }
      if (filters.accounts) {
        params.append("accounts", filters.accounts.join(","));
      }
      if (filters.categories) {
        params.append("categories", filters.categories.join(","));
      }
      if (filters.subcategories) {
        params.append("subcategories", filters.subcategories.join(","));
      }
      if (filters.tags) {
        params.append("tags", filters.tags.join(","));
      }
      if (filters.amount_range) {
        params.append("amount_min", String(filters.amount_range.min));
        params.append("amount_max", String(filters.amount_range.max));
      }
      if (filters.direction) {
        params.append("direction", filters.direction);
      }
      if (filters.transaction_type) {
        params.append("transaction_type", filters.transaction_type);
      }
      if (filters.search) {
        params.append("search", filters.search);
      }
    }

    if (sort) {
      params.append("sort_field", sort.field);
      params.append("sort_direction", sort.direction);
    }

    if (pagination) {
      params.append("page", String(pagination.page + 1)); // Convert 0-based to 1-based
      params.append("limit", String(pagination.limit));
    }

    return this.request<Transaction[]>(`/transactions/?${params.toString()}`);
  }

  async getTransaction(id: string): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}`);
  }

  async updateTransaction(
    id: string,
    updates: Partial<Transaction>
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async updateTransactionSplit(
    id: string,
    splitBreakdown: SplitBreakdown,
    myShareAmount: number
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        split_breakdown: splitBreakdown,
        split_share_amount: myShareAmount,
        is_shared: true
      }),
    });
  }

  async clearTransactionSplit(id: string): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        split_breakdown: null,
        split_share_amount: null,
        is_shared: false
      }),
    });
  }

  async linkRefund(
    childId: string,
    parentId: string
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>("/transactions/link-refund", {
      method: "POST",
      body: JSON.stringify({ child_id: childId, parent_id: parentId }),
    });
  }

  async groupTransfer(
    transactionIds: string[]
  ): Promise<ApiResponse<Transaction[]>> {
    return this.request<Transaction[]>("/transactions/group-transfer", {
      method: "POST",
      body: JSON.stringify({ transaction_ids: transactionIds }),
    });
  }

  async bulkUpdateTransactions(
    transactionIds: string[],
    updates: Partial<Transaction>
  ): Promise<ApiResponse<Transaction[]>> {
    return this.request<Transaction[]>("/transactions/bulk-update", {
      method: "PATCH",
      body: JSON.stringify({ 
        transaction_ids: transactionIds, 
        updates 
      }),
    });
  }

  async deleteTransaction(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/transactions/${id}`, {
      method: "DELETE",
    });
  }

  async searchTransactions(
    query: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ApiResponse<Transaction[]>> {
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<Transaction[]>(`/transactions/search/?${params.toString()}`);
  }

  // Budgets
  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    return this.request<Budget[]>("/budgets");
  }

  async createBudget(budget: Omit<Budget, "id" | "created_at" | "updated_at">): Promise<ApiResponse<Budget>> {
    return this.request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(budget),
    });
  }

  async updateBudget(
    id: string,
    updates: Partial<Budget>
  ): Promise<ApiResponse<Budget>> {
    return this.request<Budget>(`/budgets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async deleteBudget(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/budgets/${id}`, {
      method: "DELETE",
    });
  }


  // Tags (now under transactions)
  async getTags(): Promise<ApiResponse<Tag[]>> {
    return this.request<Tag[]>("/transactions/tags/");
  }

  async createTag(tag: Omit<Tag, "id" | "usage_count">): Promise<ApiResponse<Tag>> {
    return this.request<Tag>("/transactions/tags/", {
      method: "POST",
      body: JSON.stringify(tag),
    });
  }

  async updateTag(
    id: string,
    updates: Partial<Tag>
  ): Promise<ApiResponse<Tag>> {
    return this.request<Tag>(`/transactions/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async deleteTag(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/transactions/tags/${id}`, {
      method: "DELETE",
    });
  }

  async searchTags(query: string, limit: number = 20): Promise<ApiResponse<Tag[]>> {
    return this.request<Tag[]>(`/transactions/tags/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getTag(tagId: string): Promise<ApiResponse<Tag>> {
    return this.request<Tag>(`/transactions/tags/${tagId}`);
  }

  async upsertTag(tag: Omit<Tag, "id" | "usage_count">): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>("/transactions/tags/upsert", {
      method: "POST",
      body: JSON.stringify(tag),
    });
  }

  // Categories
  async getCategories(): Promise<ApiResponse<Category[]>> {
    return this.request<Category[]>("/transactions/categories/");
  }

  async searchCategories(query: string, limit: number = 20): Promise<ApiResponse<Category[]>> {
    return this.request<Category[]>(`/transactions/categories/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getCategory(categoryId: string): Promise<ApiResponse<Category>> {
    return this.request<Category>(`/transactions/categories/${categoryId}`);
  }

  async createCategory(categoryData: {
    name: string;
    color?: string;
    parent_id?: string;
    sort_order?: number;
  }): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>("/transactions/categories/", {
      method: "POST",
      body: JSON.stringify(categoryData),
    });
  }

  async updateCategory(
    categoryId: string,
    categoryData: {
      name?: string;
      color?: string;
      parent_id?: string;
      sort_order?: number;
    }
  ): Promise<ApiResponse<any>> {
    return this.request<any>(`/transactions/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify(categoryData),
    });
  }

  async deleteCategory(categoryId: string): Promise<void> {
    await this.request<void>(`/transactions/categories/${categoryId}`, {
      method: "DELETE",
    });
  }

  async upsertCategory(categoryData: {
    name: string;
    color?: string;
    parent_id?: string;
    sort_order?: number;
  }): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>("/transactions/categories/upsert", {
      method: "POST",
      body: JSON.stringify(categoryData),
    });
  }

  // Suggestions (now under transactions)
  async getTransferSuggestions(): Promise<ApiResponse<TransferSuggestion[]>> {
    return this.request<TransferSuggestion[]>("/transactions/suggestions/transfers");
  }

  async getRefundSuggestions(): Promise<ApiResponse<RefundSuggestion[]>> {
    return this.request<RefundSuggestion[]>("/transactions/suggestions/refunds");
  }

  async getSuggestionsSummary(): Promise<ApiResponse<any>> {
    return this.request<any>("/transactions/suggestions/summary");
  }

  // File upload
  async getUploadUrl(filename: string): Promise<ApiResponse<{ upload_url: string; file_id: string }>> {
    return this.request<{ upload_url: string; file_id: string }>("/upload/url", {
      method: "POST",
      body: JSON.stringify({ filename }),
    });
  }

  // Sync
  async syncGmail(): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>("/sync/gmail", {
      method: "POST",
    });
  }

  async syncSplitwise(): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>("/sync/splitwise", {
      method: "POST",
    });
  }
}

export const apiClient = new ApiClient();
