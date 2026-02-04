import { ApiResponse, Transaction, Budget, Category, Tag, TransactionFilters, TransactionSort, PaginationParams, TransferSuggestion, RefundSuggestion, SplitBreakdown, EmailMetadata, EmailDetails, EmailSearchFilters, ExpenseAnalytics, ExpenseAnalyticsFilters, MissingEmailTransaction } from "@/lib/types";

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
        if (filters.date_range.start) {
          params.append("date_range_start", filters.date_range.start);
        }
        if (filters.date_range.end) {
          params.append("date_range_end", filters.date_range.end);
        }
      }
      if (filters.accounts && filters.accounts.length > 0) {
        params.append("accounts", filters.accounts.join(","));
      }
      if (filters.exclude_accounts && filters.exclude_accounts.length > 0) {
        params.append("exclude_accounts", filters.exclude_accounts.join(","));
      }
      if (filters.categories && filters.categories.length > 0) {
        params.append("categories", filters.categories.join(","));
      }
      if (filters.exclude_categories && filters.exclude_categories.length > 0) {
        params.append("exclude_categories", filters.exclude_categories.join(","));
      }
      if (filters.tags) {
        params.append("tags", filters.tags.join(","));
      }
      if (filters.participants && filters.participants.length > 0) {
        params.append("participants", filters.participants.join(","));
      }
      if (filters.exclude_participants && filters.exclude_participants.length > 0) {
        params.append("exclude_participants", filters.exclude_participants.join(","));
      }
      if (filters.amount_range) {
        if (filters.amount_range.min !== undefined && filters.amount_range.min !== null) {
          params.append("amount_min", String(filters.amount_range.min));
        }
        if (filters.amount_range.max !== undefined && filters.amount_range.max !== null) {
          params.append("amount_max", String(filters.amount_range.max));
        }
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
      if (filters.include_uncategorized) {
        params.append("include_uncategorized", "true");
      }
      if (filters.flagged !== undefined) {
        params.append("is_flagged", String(filters.flagged));
      }
      if (filters.is_shared !== undefined) {
        params.append("is_shared", String(filters.is_shared));
      }
      if (filters.is_split !== undefined) {
        params.append("is_split", String(filters.is_split));
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

  async getMissingEmailTransactions(params?: {
    start_date?: string;
    end_date?: string;
    account?: string;
    limit?: number;
  }): Promise<ApiResponse<MissingEmailTransaction[]>> {
    const query = new URLSearchParams();
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    if (params?.account) query.append("account", params.account);
    if (params?.limit) query.append("limit", String(params.limit));
    return this.request<MissingEmailTransaction[]>(`/email-alerts/missing?${query.toString()}`);
  }

  async getTransaction(id: string): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}`);
  }

  async getRelatedTransactions(id: string): Promise<ApiResponse<{
    transaction: Transaction;
    parent: Transaction | null;
    children: Transaction[];
    group: Transaction[];
  }>> {
    return this.request<{
      transaction: Transaction;
      parent: Transaction | null;
      children: Transaction[];
      group: Transaction[];
    }>(`/transactions/${id}/related`);
  }

  async getParentTransaction(id: string): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(`/transactions/${id}/parent`);
  }

  async getChildTransactions(id: string): Promise<ApiResponse<Transaction[]>> {
    return this.request<Transaction[]>(`/transactions/${id}/children`);
  }

  async getGroupTransactions(id: string): Promise<ApiResponse<Transaction[]>> {
    return this.request<Transaction[]>(`/transactions/${id}/group`);
  }

  async createTransaction(
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at" | "status">
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>("/transactions/", {
      method: "POST",
      body: JSON.stringify(transaction),
    });
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
        paid_by: splitBreakdown.paid_by,
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

  async splitTransaction(
    transactionId: string,
    parts: Array<{
      description: string;
      amount: number;
      category?: string;
      subcategory?: string;
      tags?: string[];
      notes?: string;
    }>,
    deleteOriginal: boolean = false
  ): Promise<ApiResponse<{ split_group_id: string; transactions: Transaction[] }>> {
    return this.request<{ split_group_id: string; transactions: Transaction[] }>(
      "/transactions/split-transaction",
      {
        method: "POST",
        body: JSON.stringify({
          transaction_id: transactionId,
          parts,
          delete_original: deleteOriginal,
        }),
      }
    );
  }

  async ungroupSplit(
    transactionGroupId: string
  ): Promise<ApiResponse<Transaction | { deleted_count: number }>> {
    return this.request<Transaction | { deleted_count: number }>(
      "/transactions/ungroup-split",
      {
        method: "POST",
        body: JSON.stringify({ transaction_group_id: transactionGroupId }),
      }
    );
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
    return this.request<Transaction[]>(`/transactions/search?${params.toString()}`);
  }

  async getFieldValues(
    fieldName: string,
    query?: string,
    limit: number = 20
  ): Promise<ApiResponse<string[]>> {
    const params = new URLSearchParams();
    if (query) {
      params.append("query", query);
    }
    params.append("limit", String(limit));
    return this.request<string[]>(`/transactions/field-values/${fieldName}?${params.toString()}`);
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
  async getCategories(transactionType?: "debit" | "credit"): Promise<ApiResponse<Category[]>> {
    const params = new URLSearchParams();
    if (transactionType) {
      params.append("transaction_type", transactionType);
    }
    const queryString = params.toString();
    const url = `/transactions/categories/${queryString ? `?${queryString}` : ""}`;
    return this.request<Category[]>(url);
  }

  async searchCategories(
    query: string,
    limit: number = 20,
    transactionType?: "debit" | "credit"
  ): Promise<ApiResponse<Category[]>> {
    const params = new URLSearchParams();
    params.append("query", query);
    params.append("limit", limit.toString());
    if (transactionType) {
      params.append("transaction_type", transactionType);
    }
    return this.request<Category[]>(`/transactions/categories/search?${params.toString()}`);
  }

  async getCategory(categoryId: string): Promise<ApiResponse<Category>> {
    return this.request<Category>(`/transactions/categories/${categoryId}`);
  }

  async createCategory(categoryData: {
    name: string;
    color?: string;
    parent_id?: string;
    sort_order?: number;
    transaction_type?: "debit" | "credit" | null;
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
      transaction_type?: "debit" | "credit" | null;
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
    transaction_type?: "debit" | "credit" | null;
  }): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>("/transactions/categories/upsert", {
      method: "POST",
      body: JSON.stringify(categoryData),
    });
  }

  async predictCategory(description: string): Promise<ApiResponse<Category | null>> {
    const params = new URLSearchParams({ description });
    return this.request<Category | null>(`/transactions/predict-category?${params.toString()}`);
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

  // Settlements
  async getSettlementSummary(filters?: {
    date_range_start?: string;
    date_range_end?: string;
    min_amount?: number;
  }): Promise<ApiResponse<any>> {
    const params = new URLSearchParams();
    if (filters?.date_range_start) params.append('date_range_start', filters.date_range_start);
    if (filters?.date_range_end) params.append('date_range_end', filters.date_range_end);
    if (filters?.min_amount !== undefined) params.append('min_amount', filters.min_amount.toString());

    return this.request<any>(`/settlements/summary?${params.toString()}`);
  }

  async getSettlementDetail(
    participant: string,
    filters?: {
      date_range_start?: string;
      date_range_end?: string;
      min_amount?: number;
    }
  ): Promise<ApiResponse<any>> {
    const params = new URLSearchParams();
    if (filters?.date_range_start) params.append('date_range_start', filters.date_range_start);
    if (filters?.date_range_end) params.append('date_range_end', filters.date_range_end);
    if (filters?.min_amount !== undefined) params.append('min_amount', filters.min_amount.toString());

    return this.request<any>(`/settlements/participant/${encodeURIComponent(participant)}?${params.toString()}`);
  }

  async getSettlementParticipants(): Promise<ApiResponse<{ participants: string[] }>> {
    return this.request<{ participants: string[] }>('/settlements/participants');
  }

  // Email linking
  async searchTransactionEmails(
    transactionId: string,
    filters: EmailSearchFilters
  ): Promise<ApiResponse<EmailMetadata[]>> {
    const params = new URLSearchParams();

    if (filters.date_offset_days !== undefined) {
      params.append('date_offset_days', filters.date_offset_days.toString());
    }
    if (filters.include_amount_filter !== undefined) {
      params.append('include_amount_filter', filters.include_amount_filter.toString());
    }
    if (filters.start_date) {
      params.append('start_date', filters.start_date);
    }
    if (filters.end_date) {
      params.append('end_date', filters.end_date);
    }
    if (filters.custom_search_term) {
      params.append('custom_search_term', filters.custom_search_term);
    }
    if (filters.search_amount !== undefined) {
      params.append('search_amount', filters.search_amount.toString());
    }
    if (filters.also_search_amount_minus_one !== undefined) {
      params.append('also_search_amount_minus_one', filters.also_search_amount_minus_one.toString());
    }

    return this.request<EmailMetadata[]>(
      `/transactions/${transactionId}/emails/search?${params.toString()}`
    );
  }

  async getEmailDetails(
    transactionId: string,
    messageId: string
  ): Promise<ApiResponse<EmailDetails>> {
    return this.request<EmailDetails>(
      `/transactions/${transactionId}/emails/${messageId}`
    );
  }

  async linkEmailToTransaction(
    transactionId: string,
    messageId: string
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(
      `/transactions/${transactionId}/emails/link`,
      {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId }),
      }
    );
  }

  async unlinkEmailFromTransaction(
    transactionId: string,
    messageId: string
  ): Promise<ApiResponse<Transaction>> {
    return this.request<Transaction>(
      `/transactions/${transactionId}/emails/${messageId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async getTransactionSourcePdf(transactionId: string): Promise<Blob> {
    const url = `${this.baseUrl}/transactions/${transactionId}/source-pdf`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}. ${errorText}`);
    }

    return response.blob();
  }

  // Analytics
  async getExpenseAnalytics(
    filters?: ExpenseAnalyticsFilters
  ): Promise<ApiResponse<ExpenseAnalytics>> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.date_range) {
        if (filters.date_range.start) {
          params.append("date_range_start", filters.date_range.start);
        }
        if (filters.date_range.end) {
          params.append("date_range_end", filters.date_range.end);
        }
      }
      if (filters.accounts && filters.accounts.length > 0) {
        params.append("accounts", filters.accounts.join(","));
      }
      if (filters.exclude_accounts && filters.exclude_accounts.length > 0) {
        params.append("exclude_accounts", filters.exclude_accounts.join(","));
      }
      if (filters.categories && filters.categories.length > 0) {
        params.append("categories", filters.categories.join(","));
      }
      if (filters.exclude_categories && filters.exclude_categories.length > 0) {
        params.append("exclude_categories", filters.exclude_categories.join(","));
      }
      if (filters.tags && filters.tags.length > 0) {
        params.append("tags", filters.tags.join(","));
      }
      if (filters.exclude_tags && filters.exclude_tags.length > 0) {
        params.append("exclude_tags", filters.exclude_tags.join(","));
      }
      if (filters.direction) {
        params.append("direction", filters.direction);
      }
      if (filters.group_by) {
        params.append("group_by", filters.group_by);
      }
    }

    return this.request<ExpenseAnalytics>(`/transactions/analytics?${params.toString()}`);
  }
}

export const apiClient = new ApiClient();
