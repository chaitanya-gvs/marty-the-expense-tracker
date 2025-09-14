"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "lucide-react";
import { TransactionFilters } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TransactionFiltersProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
  onClearFilters: () => void;
}

export function TransactionFilters({
  filters,
  onFiltersChange,
  onClearFilters,
}: TransactionFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const updateFilter = (key: keyof TransactionFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const hasActiveFilters = Object.values(filters).some(value => 
    value !== undefined && value !== null && value !== ""
  );

  return (
    <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Filters</h3>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearFilters}
            >
              Clear All
            </Button>
          )}
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Calendar className="h-4 w-4 mr-2" />
                Date Range
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date" className="text-gray-900 dark:text-white">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={filters.date_range?.start || ""}
                    onChange={(e) =>
                      updateFilter("date_range", {
                        ...filters.date_range,
                        start: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date" className="text-gray-900 dark:text-white">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={filters.date_range?.end || ""}
                    onChange={(e) =>
                      updateFilter("date_range", {
                        ...filters.date_range,
                        end: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                      updateFilter("date_range", {
                        start: lastMonth.toISOString().split("T")[0],
                        end: today.toISOString().split("T")[0],
                      });
                    }}
                  >
                    Last Month
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const today = new Date();
                      const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                      updateFilter("date_range", {
                        start: lastWeek.toISOString().split("T")[0],
                        end: today.toISOString().split("T")[0],
                      });
                    }}
                  >
                    Last Week
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="space-y-2">
          <Label htmlFor="search" className="text-gray-900 dark:text-white">Search</Label>
          <Input
            id="search"
            placeholder="Search transactions..."
            value={filters.search || ""}
            onChange={(e) => updateFilter("search", e.target.value || undefined)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="account" className="text-gray-900 dark:text-white">Account</Label>
          <Select
            value={filters.accounts?.[0] || "all"}
            onValueChange={(value) => updateFilter("accounts", value === "all" ? undefined : [value])}
          >
            <SelectTrigger>
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="Splitwise">Splitwise</SelectItem>
              <SelectItem value="Swiggy HDFC Credit Card">Swiggy HDFC Credit Card</SelectItem>
              <SelectItem value="Yes Bank Savings Account">Yes Bank Savings Account</SelectItem>
              <SelectItem value="Axis Bank Savings Account">Axis Bank Savings Account</SelectItem>
              <SelectItem value="Axis Atlas Credit Card">Axis Atlas Credit Card</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="direction" className="text-gray-900 dark:text-white">Direction</Label>
          <Select
            value={filters.direction || "all"}
            onValueChange={(value) => updateFilter("direction", value === "all" ? undefined : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All directions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              <SelectItem value="debit">Debit</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transaction-type" className="text-gray-900 dark:text-white">Type</Label>
          <Select
            value={filters.transaction_type || "all"}
            onValueChange={(value) => updateFilter("transaction_type", value === "all" ? undefined : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="shared">Shared only</SelectItem>
              <SelectItem value="refunds">Refunds only</SelectItem>
              <SelectItem value="transfers">Transfers only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount-min" className="text-gray-900 dark:text-white">Amount Range</Label>
          <div className="flex gap-2">
            <Input
              id="amount-min"
              type="number"
              placeholder="Min"
              value={filters.amount_range?.min || ""}
              onChange={(e) =>
                updateFilter("amount_range", {
                  ...filters.amount_range,
                  min: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            <Input
              type="number"
              placeholder="Max"
              value={filters.amount_range?.max || ""}
              onChange={(e) =>
                updateFilter("amount_range", {
                  ...filters.amount_range,
                  max: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
