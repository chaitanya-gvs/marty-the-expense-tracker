"use client";

import { useState, useEffect } from "react";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { AddTransactionModal } from "@/components/transactions/add-transaction-modal";
import { TransactionFilters as TransactionFiltersType, TransactionSort } from "@/lib/types";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  Download, 
  BarChart3, 
  TrendingUp,
  TrendingDown
} from "lucide-react";

// Get default date range (This Month)
function getDefaultDateRange() {
  const today = new Date();
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: thisMonthStart.toISOString().split("T")[0],
    end: today.toISOString().split("T")[0]
  };
}

// Load filters from localStorage or use defaults
function getInitialFilters(): TransactionFiltersType {
  if (typeof window === 'undefined') return {};
  
  try {
    const saved = localStorage.getItem('transaction-filters');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading filters from localStorage:', error);
  }
  
  // Default to "This Month" preset if no saved filters
  return {
    date_range: getDefaultDateRange()
  };
}

export function TransactionsPage() {
  const [filters, setFilters] = useState<TransactionFiltersType>(getInitialFilters);
  const [sort, setSort] = useState<TransactionSort | undefined>();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('transaction-filters', JSON.stringify(filters));
    } catch (error) {
      console.error('Error saving filters to localStorage:', error);
    }
  }, [filters]);

  const handleFiltersChange = (newFilters: TransactionFiltersType) => {
    console.log("🔧 Filters changed:", newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  // Get transactions data
  const { data, isLoading, error } = useInfiniteTransactions(filters, sort);

  // Calculate real data from transactions
  const allTransactions = data?.pages?.flatMap(page => page.data || []) || [];
  const totalTransactions = allTransactions.length;
  
  // Calculate date range from actual data with null checks
  const validDates = allTransactions
    .filter(t => t && t.date) // Filter out null/undefined transactions and those without dates
    .map(t => new Date(t.date))
    .filter(date => !isNaN(date.getTime())) // Filter out invalid dates
    .sort((a, b) => a.getTime() - b.getTime());
  
  const dateRange = validDates.length > 0 
    ? `${validDates[0].toLocaleDateString('en-US', { month: 'short' })}–${validDates[validDates.length - 1].toLocaleDateString('en-US', { month: 'short' })} ${validDates[validDates.length - 1].getFullYear()}`
    : totalTransactions > 0 ? "Invalid dates" : "No data";
  
  // Calculate unique accounts with null checks
  const uniqueAccounts = new Set(
    allTransactions
      .filter(t => t && t.account) // Filter out null/undefined transactions and those without accounts
      .map(t => t.account)
  ).size;
  
  // Calculate monthly spending (current month) with null checks
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthlyTransactions = allTransactions.filter(t => {
    if (!t || !t.date) return false; // Skip if transaction or date is null/undefined
    const transactionDate = new Date(t.date);
    return !isNaN(transactionDate.getTime()) && 
           transactionDate.getMonth() === currentMonth && 
           transactionDate.getFullYear() === currentYear;
  });
  
  // Helper function to get effective amount (my share for shared transactions)
  const getEffectiveAmount = (transaction: any) => {
    if (!transaction) return 0;
    const isShared = transaction.is_shared;
    const splitAmount = transaction.split_share_amount;
    return isShared && splitAmount ? splitAmount : transaction.amount || 0;
  };

  const monthlySpent = monthlyTransactions
    .filter(t => t && t.direction === 'debit')
    .reduce((sum, t) => sum + getEffectiveAmount(t), 0);
  
  const monthlyRefunded = monthlyTransactions
    .filter(t => t && t.direction === 'credit')
    .reduce((sum, t) => sum + getEffectiveAmount(t), 0);

  // Show loading state while data is being fetched
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                Transactions
              </h1>
              <div className="space-y-1">
                <p className="text-lg text-gray-600 dark:text-gray-300">
                  Loading transactions...
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state if there's an error
  if (error) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                Transactions
              </h1>
              <div className="space-y-1">
                <p className="text-lg text-red-600 dark:text-red-400">
                  Error loading transactions: {error.message || 'Unknown error'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enhanced Header */}
      <div className="space-y-4">
        {/* Title and Actions Row */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              Transactions
            </h1>
            <div className="space-y-1">
              <p className="text-lg text-gray-600 dark:text-gray-300">
                {totalTransactions} transactions · {dateRange} · across {uniqueAccounts} accounts
              </p>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <TrendingDown className="h-4 w-4" />
                  <span>This month: ₹{monthlySpent.toLocaleString()} spent</span>
                </div>
                <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <TrendingUp className="h-4 w-4" />
                  <span>₹{monthlyRefunded.toLocaleString()} refunded</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Insights
            </Button>
            <Button 
              size="sm" 
              className="gap-2"
              onClick={() => setIsAddModalOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Transaction
            </Button>
          </div>
        </div>
      </div>

      {/* Filters and Table */}
      <TransactionFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
      />
      <TransactionsTable filters={filters} sort={sort} />

      {/* Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
    </div>
  );
}
