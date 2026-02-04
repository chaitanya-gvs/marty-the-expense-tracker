export interface Transaction {
  id: string;
  date: string;
  account: string;
  description: string;
  category: string;
  subcategory?: string;
  direction: "debit" | "credit";
  amount: number;
  net_amount?: number;
  split_share_amount: number;
  tags: string[];
  notes?: string;
  is_shared: boolean;
  is_refund: boolean;
  is_split: boolean;
  is_transfer: boolean;
  is_flagged?: boolean;
  split_breakdown?: SplitBreakdown;
  paid_by?: string;
  link_parent_id?: string | null;
  transaction_group_id?: string | null;
  related_mails?: string[]; // Array of Gmail message IDs
  source_file?: string;
  raw_data?: any;
  created_at: string;
  updated_at: string;
  status: "reviewed" | "needs_review" | "uncertain";
  is_deleted?: boolean;
  deleted_at?: string | null;
}

export interface MissingEmailTransaction {
  id: string;
  date: string;
  account: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  reference_number?: string | null;
}

export interface SplitEntry {
  participant: string;
  amount: number | null;
  paid_share?: number; // Amount this participant actually paid
  net_balance?: number; // Net balance for this participant
}

export interface SplitBreakdown {
  mode: "equal" | "custom";
  include_me: boolean;
  entries: SplitEntry[];
  paid_by?: string; // Who actually paid for this transaction
  total_participants?: number; // Total number of participants
}

export interface RelatedMail {
  id: string;
  subject: string;
  date: string;
  gmail_link: string;
}

export interface Budget {
  id: string;
  category: string;
  subcategory?: string;
  monthly_limit: number;
  current_spend: number;
  period: string; // YYYY-MM format
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  color?: string;
  parent_id?: string;
  sort_order: number;
  is_active: boolean;
  transaction_type?: "debit" | "credit" | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  usage_count: number;
}

export interface SettlementEntry {
  participant: string;
  amount_owed_to_me: number;
  amount_i_owe: number;
  net_balance: number;
  transaction_count: number;
}

export interface SettlementSummary {
  total_amount_owed_to_me: number;
  total_amount_i_owe: number;
  net_total_balance: number;
  participant_count: number;
  settlements: SettlementEntry[];
}

export interface SettlementTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  my_share: number;
  participant_share: number;
  paid_by: string;
  split_breakdown: SplitBreakdown;
}

export interface SettlementDetail {
  participant: string;
  net_balance: number;
  transactions: SettlementTransaction[];
  total_shared_amount: number;
}

export interface TransactionFilters {
  date_range?: {
    start: string;
    end: string;
  };
  accounts?: string[];
  /**
   * Accounts to explicitly exclude from results.
   * Only one of accounts or exclude_accounts should typically be set.
   */
  exclude_accounts?: string[];
  categories?: string[];
  /**
   * Categories to explicitly exclude from results.
   * Only one of categories or exclude_categories should typically be set.
   */
  exclude_categories?: string[];
  tags?: string[];
  participants?: string[];
  /**
   * Participants to explicitly exclude from results.
   * Only one of participants or exclude_participants should typically be set.
   */
  exclude_participants?: string[];
  amount_range?: {
    min: number;
    max: number;
  };
  direction?: "debit" | "credit";
  transaction_type?: "all" | "shared" | "refunds" | "transfers";
  search?: string;
  include_uncategorized?: boolean;
  /**
   * Filter by flagged status. When set to true, only flagged transactions are shown.
   * When set to false, only non-flagged transactions are shown.
   * When undefined, all transactions are shown.
   */
  flagged?: boolean;
  /**
   * Direct filter by shared status. When set to false, only personal (non-shared) expenses are returned.
   */
  is_shared?: boolean;
  /**
   * Filter by split status. When set to false, split transactions (is_split=true) are excluded.
   * When set to true, only split transactions are shown.
   * When undefined, all transactions are shown.
   */
  is_split?: boolean;
  /**
   * Show linked refund transactions (credit transactions with link_parent_id).
   * When set to true, linked refunds are shown in the table.
   * When set to false or undefined, linked refunds are hidden (default behavior).
   */
  show_linked_refunds?: boolean;
}

export interface TransactionSort {
  field: keyof Transaction;
  direction: "asc" | "desc";
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  message?: string;
}

export interface TransferSuggestion {
  transactions: Transaction[];
  confidence: number;
  reason: string;
}

export interface RefundSuggestion {
  parent: Transaction;
  child: Transaction;
  confidence: number;
  reason: string;
}

export interface EmailMetadata {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  account?: string; // "primary" or "secondary"
}

export interface EmailAttachment {
  filename: string;
  mime_type: string;
  size: number;
  attachment_id?: string;
}

export interface UberTripInfo {
  amount?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  from_location?: string;
  to_location?: string;
  distance?: string;
  duration?: string;
  vehicle_type?: string;
}

export interface SwiggyOrderInfo {
  amount?: string;
  restaurant_name?: string;
  order_id?: string;
  delivery_address?: string;
  order_time?: string;
  order_date?: string;  // Full date (e.g., "Jan 26, 2026")
  order_type?: string;  // "Dineout" or "Food Delivery"
  items?: Array<{       // Order items (for food delivery)
    name: string;
    quantity?: number;
  }>;
  num_diners?: number;  // Number of diners (for Dineout)
  savings?: string;     // Discount/savings amount
}

export interface MerchantInfo {
  merchant_name: string;
  merchant_type: 'food_delivery' | 'ride_sharing' | 'ecommerce' | 'other';
  amount?: string;
  order_id?: string;
}

export interface EmailDetails extends EmailMetadata {
  body: string;
  attachments?: EmailAttachment[];
  raw_message?: any;
  uber_trip_info?: UberTripInfo;
  swiggy_order_info?: SwiggyOrderInfo;
  merchant_info?: MerchantInfo;
}

export interface EmailSearchFilters {
  date_offset_days?: number;
  start_date?: string;
  end_date?: string;
  include_amount_filter: boolean;
  custom_search_term?: string;
  search_amount?: number; // Optional override for search amount (e.g., rounded amount for UPI)
  also_search_amount_minus_one?: boolean; // Also search for amount-1 (for UPI rounding scenarios)
}

export interface ExpenseAnalyticsItem {
  group_key: string;
  color?: string | null;
  amount: number;
  count: number;
  category?: string;
  tag?: string;
  month?: string;
}

export interface ExpenseAnalytics {
  group_by: "category" | "tag" | "month" | "account" | "category_month" | "tag_month" | "tag_category";
  data: ExpenseAnalyticsItem[];
  summary: {
    total_amount: number;
    total_count: number;
    average_amount: number;
  };
}

export interface ExpenseAnalyticsFilters {
  date_range?: {
    start: string;
    end: string;
  };
  accounts?: string[];
  exclude_accounts?: string[];
  categories?: string[];
  exclude_categories?: string[];
  tags?: string[];
  exclude_tags?: string[];
  direction?: "debit" | "credit";
  group_by?: "category" | "tag" | "month" | "account" | "category_month" | "tag_month" | "tag_category";
}
