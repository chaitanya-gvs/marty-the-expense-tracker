"use client";

import { useState } from "react";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { TransactionFilters as TransactionFiltersType } from "@/lib/types";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Download, 
  BarChart3, 
  X,
  TrendingUp,
  TrendingDown
} from "lucide-react";

export function TransactionsPage() {
  const [filters, setFilters] = useState<TransactionFiltersType>({});
  const [sort, setSort] = useState<{ field: keyof any; direction: "asc" | "desc" } | undefined>();

  const handleFiltersChange = (newFilters: TransactionFiltersType) => {
    console.log("🔧 Filters changed:", newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  const removeFilter = (filterKey: keyof TransactionFiltersType) => {
    const newFilters = { ...filters };
    delete newFilters[filterKey];
    setFilters(newFilters);
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

  // Get active filters for display
  const activeFilters = Object.entries(filters).filter(([_, value]) => value !== undefined && value !== "");

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
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Transaction
            </Button>
          </div>
        </div>

        {/* Active Filters */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500 dark:text-gray-400">Filters:</span>
            {activeFilters.map(([key, value]) => {
              // Handle different filter types for display
              let displayValue = "";
              
              if (key === 'direction') {
                displayValue = value === 'debit' ? 'Debit' : 'Credit';
              } else if (key === 'accounts') {
                displayValue = Array.isArray(value) ? value.join(', ') : value;
              } else if (key === 'categories') {
                displayValue = Array.isArray(value) ? value.join(', ') : value;
              } else if (key === 'tags') {
                displayValue = Array.isArray(value) ? value.join(', ') : value;
              } else if (key === 'date_range') {
                const dateRange = value as {start: string, end: string};
                const startDate = dateRange.start ? new Date(dateRange.start).toLocaleDateString() : 'Start';
                const endDate = dateRange.end ? new Date(dateRange.end).toLocaleDateString() : 'End';
                displayValue = `${startDate} - ${endDate}`;
              } else if (key === 'amount_range') {
                const amountRange = value as {min: number, max: number};
                const min = amountRange.min !== undefined ? `₹${amountRange.min}` : 'Min';
                const max = amountRange.max !== undefined ? `₹${amountRange.max}` : 'Max';
                displayValue = `${min} - ${max}`;
              } else if (key === 'transaction_type') {
                displayValue = value === 'shared' ? 'Shared' : value === 'refunds' ? 'Refunds' : value === 'transfers' ? 'Transfers' : value;
              } else {
                displayValue = String(value);
              }

              return (
                <Badge 
                  key={key} 
                  variant="secondary" 
                  className="gap-1 text-xs"
                >
                  {key === 'search' ? `Search: "${displayValue}"` :
                   key === 'accounts' ? `Account: ${displayValue}` :
                   key === 'categories' ? `Category: ${displayValue}` :
                   key === 'tags' ? `Tags: ${displayValue}` :
                   key === 'date_range' ? `Date: ${displayValue}` :
                   key === 'amount_range' ? `Amount: ${displayValue}` :
                   key === 'direction' ? `Direction: ${displayValue}` :
                   key === 'transaction_type' ? `Type: ${displayValue}` :
                   displayValue}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-3 w-3 p-0 ml-1 hover:bg-gray-200 dark:hover:bg-gray-700"
                    onClick={() => removeFilter(key as keyof TransactionFiltersType)}
                  >
                    <X className="h-2 w-2" />
                  </Button>
                </Badge>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              onClick={handleClearFilters}
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Filters and Table */}
      <TransactionFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
      />
      <TransactionsTable filters={filters} sort={sort} />
    </div>
  );
}
