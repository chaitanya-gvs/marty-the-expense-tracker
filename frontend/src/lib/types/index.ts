export interface Transaction {
  id: string;
  date: string;
  account: string;
  description: string;
  category: string;
  subcategory?: string;
  direction: "debit" | "credit";
  amount: number;
  split_share_amount: number;
  tags: string[];
  notes?: string;
  is_shared: boolean;
  is_refund: boolean;
  is_transfer: boolean;
  split_breakdown?: SplitBreakdown;
  link_parent_id?: string;
  transfer_group_id?: string;
  related_mails?: RelatedMail[];
  source_file?: string;
  raw_data?: any;
  created_at: string;
  updated_at: string;
  status: "reviewed" | "needs_review" | "uncertain";
}

export interface SplitEntry {
  participant: string;
  amount: number | null;
}

export interface SplitBreakdown {
  mode: "equal" | "custom";
  include_me: boolean;
  entries: SplitEntry[];
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
  created_at: string;
  updated_at: string;
}

export interface Subcategory {
  id: string;
  name: string;
  color: string;
  is_hidden: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  usage_count: number;
}

export interface TransactionFilters {
  date_range?: {
    start: string;
    end: string;
  };
  accounts?: string[];
  categories?: string[];
  subcategories?: string[];
  tags?: string[];
  amount_range?: {
    min: number;
    max: number;
  };
  direction?: "debit" | "credit";
  transaction_type?: "all" | "shared" | "refunds" | "transfers";
  search?: string;
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
