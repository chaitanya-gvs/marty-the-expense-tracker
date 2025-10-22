"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Calendar, Search, X, RotateCcw, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { TransactionFilters } from "@/lib/types";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { cn } from "@/lib/utils";

// Custom hook for localStorage persistence
function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error);
    }
  }, [key]);

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error saving ${key} to localStorage:`, error);
    }
  };

  return [storedValue, setValue] as const;
}

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
  // Collapse/Expand state
  const [expanded, setExpanded] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.search || "");
  const [amountMinInput, setAmountMinInput] = useState(filters.amount_range?.min?.toString() || "");
  const [amountMaxInput, setAmountMaxInput] = useState(filters.amount_range?.max?.toString() || "");
  const [dateRangeStartInput, setDateRangeStartInput] = useState(filters.date_range?.start || "");
  const [dateRangeEndInput, setDateRangeEndInput] = useState(filters.date_range?.end || "");
  const [selectedDatePreset, setSelectedDatePreset] = useState<string>("custom");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(filters.categories || []);
  const [selectedTags, setSelectedTags] = useState<string[]>(filters.tags || []);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(filters.accounts || []);
  const [selectedDirection, setSelectedDirection] = useState<string>(filters.direction || "all");
  const [selectedTransactionType, setSelectedTransactionType] = useState<string>(filters.transaction_type || "all");

  // Fetch categories and tags data
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();

  const updateFilter = (key: keyof TransactionFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const applyAllFilters = () => {
    console.log("🔄 Applying filters...", {
      searchInput,
      amountMinInput,
      amountMaxInput,
      dateRangeStartInput,
      dateRangeEndInput,
      selectedCategories,
      selectedTags
    });

    // Build the complete filter object
    const newFilters: TransactionFilters = { ...filters };

    // Apply search
    newFilters.search = searchInput.trim() || undefined;
    
    // Apply amount range
    const min = amountMinInput ? Number(amountMinInput) : undefined;
    const max = amountMaxInput ? Number(amountMaxInput) : undefined;
    if (min !== undefined || max !== undefined) {
      newFilters.amount_range = { 
        min: min!, 
        max: max! 
      };
    } else {
      newFilters.amount_range = undefined;
    }

    // Apply date range
    if (dateRangeStartInput || dateRangeEndInput) {
      newFilters.date_range = {
        start: dateRangeStartInput!,
        end: dateRangeEndInput!,
      };
    } else {
      newFilters.date_range = undefined;
    }

    // Apply categories
    newFilters.categories = selectedCategories.length > 0 ? selectedCategories : undefined;

    // Apply tags
    newFilters.tags = selectedTags.length > 0 ? selectedTags : undefined;

    // Apply accounts
    newFilters.accounts = selectedAccounts.length > 0 ? selectedAccounts : undefined;

    // Apply direction
    newFilters.direction = selectedDirection !== "all" ? selectedDirection as "debit" | "credit" : undefined;

    // Apply transaction type
    newFilters.transaction_type = selectedTransactionType !== "all" ? selectedTransactionType as "shared" | "refunds" | "transfers" : undefined;

    // Apply all filters at once
    onFiltersChange(newFilters);

    console.log("✅ Filters applied!", newFilters);
    
    // Collapse panel after applying
    setExpanded(false);
    
    // Return focus to filters button
    setTimeout(() => filtersButtonRef.current?.focus(), 100);
  };

  const resetAllFilters = () => {
    setSearchInput("");
    setAmountMinInput("");
    setAmountMaxInput("");
    setDateRangeStartInput("");
    setDateRangeEndInput("");
    setSelectedDatePreset("custom");
    setSelectedCategories([]);
    setSelectedTags([]);
    setSelectedAccounts([]);
    setSelectedDirection("all");
    setSelectedTransactionType("all");
    onClearFilters();
    
    // Collapse panel after reset
    setExpanded(false);
    
    // Return focus to filters button
    setTimeout(() => filtersButtonRef.current?.focus(), 100);
  };

  const handleDatePreset = (preset: string) => {
    setSelectedDatePreset(preset);
    const today = new Date();
    
    switch (preset) {
      case "this_month":
        const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        setDateRangeStartInput(thisMonthStart.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      case "last_month":
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        setDateRangeStartInput(lastMonthStart.toISOString().split("T")[0]);
        setDateRangeEndInput(lastMonthEnd.toISOString().split("T")[0]);
        break;
      case "last_3_months":
        const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
        setDateRangeStartInput(threeMonthsAgo.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      case "this_year":
        const yearStart = new Date(today.getFullYear(), 0, 1);
        setDateRangeStartInput(yearStart.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      case "custom":
        // Keep current values
        break;
    }
  };

  // Sync input states with filters when they change externally (e.g., clear all)
  useEffect(() => {
    setSearchInput(filters.search || "");
    setAmountMinInput(filters.amount_range?.min?.toString() || "");
    setAmountMaxInput(filters.amount_range?.max?.toString() || "");
    setDateRangeStartInput(filters.date_range?.start || "");
    setDateRangeEndInput(filters.date_range?.end || "");
    setSelectedCategories(filters.categories || []);
    setSelectedTags(filters.tags || []);
    setSelectedAccounts(filters.accounts || []);
    setSelectedDirection(filters.direction || "all");
    setSelectedTransactionType(filters.transaction_type || "all");
  }, [filters]);

  const hasActiveFilters = Object.values(filters).some(value => 
    value !== undefined && value !== null && value !== ""
  );

  const hasUnappliedChanges = 
    searchInput !== (filters.search || "") ||
    amountMinInput !== (filters.amount_range?.min?.toString() || "") ||
    amountMaxInput !== (filters.amount_range?.max?.toString() || "") ||
    dateRangeStartInput !== (filters.date_range?.start || "") ||
    dateRangeEndInput !== (filters.date_range?.end || "") ||
    JSON.stringify(selectedCategories.sort()) !== JSON.stringify((filters.categories || []).sort()) ||
    JSON.stringify(selectedTags.sort()) !== JSON.stringify((filters.tags || []).sort()) ||
    JSON.stringify(selectedAccounts.sort()) !== JSON.stringify((filters.accounts || []).sort()) ||
    selectedDirection !== (filters.direction || "all") ||
    selectedTransactionType !== (filters.transaction_type || "all");

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
        filtersButtonRef.current?.focus();
      }
    };

    if (expanded) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [expanded]);

  // Clear a specific filter and apply immediately
  const clearFilter = (key: keyof TransactionFilters) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    
    // Also update local state
    if (key === "search") setSearchInput("");
    else if (key === "accounts") setSelectedAccounts([]);
    else if (key === "direction") setSelectedDirection("all");
    else if (key === "transaction_type") setSelectedTransactionType("all");
    else if (key === "date_range") {
      setDateRangeStartInput("");
      setDateRangeEndInput("");
      setSelectedDatePreset("custom");
    }
    else if (key === "amount_range") {
      setAmountMinInput("");
      setAmountMaxInput("");
    }
    else if (key === "categories") setSelectedCategories([]);
    else if (key === "tags") setSelectedTags([]);
    
    onFiltersChange(newFilters);
  };

  // Expand panel and focus on a specific control
  const expandAndFocusControl = (key: string) => {
    setExpanded(true);
    // Focus will be handled by the browser naturally when the panel expands
  };

  // Quick date preset handlers
  const applyQuickDatePreset = (preset: "this_month" | "last_30") => {
    const today = new Date();
    
    if (preset === "this_month") {
      const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const newFilters = {
        ...filters,
        date_range: {
          start: thisMonthStart.toISOString().split("T")[0],
          end: today.toISOString().split("T")[0]
        }
      };
      
      setDateRangeStartInput(newFilters.date_range.start);
      setDateRangeEndInput(newFilters.date_range.end);
      setSelectedDatePreset("this_month");
      onFiltersChange(newFilters);
    } else if (preset === "last_30") {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const newFilters = {
        ...filters,
        date_range: {
          start: thirtyDaysAgo.toISOString().split("T")[0],
          end: today.toISOString().split("T")[0]
        }
      };
      
      setDateRangeStartInput(newFilters.date_range.start);
      setDateRangeEndInput(newFilters.date_range.end);
      setSelectedDatePreset("custom");
      onFiltersChange(newFilters);
    }
  };

  // Get active filter badges
  const getActiveFilterBadges = () => {
    const badges = [];
    
    if (filters.search) {
      badges.push({ key: "search", label: `Search: "${filters.search}"`, value: filters.search });
    }
    if (filters.accounts && filters.accounts.length > 0) {
      badges.push({ key: "accounts", label: `Account: ${filters.accounts[0]}`, value: filters.accounts[0] });
    }
    if (filters.direction) {
      badges.push({ key: "direction", label: `Direction: ${filters.direction}`, value: filters.direction });
    }
    if (filters.transaction_type) {
      badges.push({ key: "transaction_type", label: `Type: ${filters.transaction_type}`, value: filters.transaction_type });
    }
    if (filters.date_range && (filters.date_range.start || filters.date_range.end)) {
      const start = filters.date_range.start ? new Date(filters.date_range.start).toLocaleDateString() : "Start";
      const end = filters.date_range.end ? new Date(filters.date_range.end).toLocaleDateString() : "End";
      badges.push({ key: "date_range", label: `Date: ${start} - ${end}`, value: filters.date_range });
    }
    if (filters.amount_range && (filters.amount_range.min !== undefined || filters.amount_range.max !== undefined)) {
      const min = filters.amount_range.min !== undefined ? `₹${filters.amount_range.min}` : "Min";
      const max = filters.amount_range.max !== undefined ? `₹${filters.amount_range.max}` : "Max";
      badges.push({ key: "amount_range", label: `Amount: ${min} - ${max}`, value: filters.amount_range });
    }
    if (filters.categories && filters.categories.length > 0) {
      badges.push({ key: "categories", label: `Category: ${filters.categories.join(", ")}`, value: filters.categories });
    }
    if (filters.tags && filters.tags.length > 0) {
      badges.push({ key: "tags", label: `Tags: ${filters.tags.join(", ")}`, value: filters.tags });
    }
    
    return badges;
  };

  const activeFilterBadges = getActiveFilterBadges();

  return (
    <div className="space-y-2">
      {/* Collapsed Bar (Always Visible) */}
      <div className="sticky top-0 z-20 bg-slate-900/70 backdrop-blur border-b border-slate-800 px-4 py-2 flex items-center gap-2 text-sm">
        <button
          ref={filtersButtonRef}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="filters-panel"
          className="rounded-full bg-slate-800 hover:bg-slate-700 px-3 py-1 text-slate-200 flex items-center gap-1 transition-colors"
        >
          Filters
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {/* Active Filter Chips */}
        <div className="flex flex-wrap gap-2 items-center">
          {activeFilterBadges.length === 0 ? (
            <span className="text-xs text-slate-500">No filters applied</span>
          ) : (
            activeFilterBadges.map((badge) => (
              <button
                key={badge.key}
                onClick={() => expandAndFocusControl(badge.key)}
                className="rounded-full bg-blue-700/40 text-blue-200 border border-blue-600 px-2 py-0.5 text-xs flex items-center gap-1 hover:bg-blue-700/60 transition-colors"
              >
                {badge.label}
                <X
                  className="h-3 w-3 hover:text-blue-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFilter(badge.key as keyof TransactionFilters);
                  }}
                />
              </button>
            ))
          )}
        </div>

        {/* Quick Presets (Desktop Only) */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          <button
            onClick={() => applyQuickDatePreset("this_month")}
            className="rounded-md px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            This month
          </button>
          <button
            onClick={() => applyQuickDatePreset("last_30")}
            className="rounded-md px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Last 30d
          </button>
        </div>
      </div>

      {/* Expanded Panel (Animated) */}
      <div
        id="filters-panel"
        ref={panelRef}
        data-open={expanded}
        className={cn(
          "transition-all duration-200 ease-out overflow-hidden",
          expanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 mt-2">

        {/* 2-Row Grid Layout */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Row 1 */}
          <div className="space-y-1">
            <Label htmlFor="search" className="text-xs text-slate-400 uppercase tracking-wide">Search</Label>
            <div className="flex gap-2">
              <Input
                id="search"
                placeholder="Search transactions..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="account" className="text-xs text-slate-400 uppercase tracking-wide">Account</Label>
            <Select
              value={selectedAccounts[0] || "all"}
              onValueChange={(value) => {
                if (value === "all") {
                  setSelectedAccounts([]);
                } else {
                  setSelectedAccounts([value]);
                }
              }}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All accounts</SelectItem>
                <SelectItem value="Splitwise">Splitwise</SelectItem>
                <SelectItem value="Swiggy HDFC Credit Card">Swiggy HDFC Credit Card</SelectItem>
                <SelectItem value="Yes Bank Savings Account">Yes Bank Savings Account</SelectItem>
                <SelectItem value="Axis Bank Savings Account">Axis Bank Savings Account</SelectItem>
                <SelectItem value="Axis Atlas Credit Card">Axis Atlas Credit Card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="direction" className="text-xs text-slate-400 uppercase tracking-wide">Direction</Label>
            <Select
              value={selectedDirection}
              onValueChange={(value) => setSelectedDirection(value)}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All directions" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All directions</SelectItem>
                <SelectItem value="debit">Debit</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="transaction-type" className="text-xs text-slate-400 uppercase tracking-wide">Type</Label>
            <Select
              value={selectedTransactionType}
              onValueChange={(value) => setSelectedTransactionType(value)}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="shared">Shared only</SelectItem>
                <SelectItem value="refunds">Refunds only</SelectItem>
                <SelectItem value="transfers">Transfers only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Row 2 */}
          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Date Range</Label>
            <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 justify-start"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  {selectedDatePreset === "custom" ? "Custom Range" : 
                   selectedDatePreset === "this_month" ? "This Month" :
                   selectedDatePreset === "last_month" ? "Last Month" :
                   selectedDatePreset === "last_3_months" ? "Last 3 Months" :
                   selectedDatePreset === "this_year" ? "This Year" : "Custom Range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 bg-slate-800 border-slate-600" align="start">
                <div className="space-y-4">
                  {/* Quick Presets */}
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-400 uppercase tracking-wide">Quick Presets</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={selectedDatePreset === "this_month" ? "default" : "outline"}
                        onClick={() => handleDatePreset("this_month")}
                        className="text-xs h-8"
                      >
                        This Month
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedDatePreset === "last_month" ? "default" : "outline"}
                        onClick={() => handleDatePreset("last_month")}
                        className="text-xs h-8"
                      >
                        Last Month
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedDatePreset === "last_3_months" ? "default" : "outline"}
                        onClick={() => handleDatePreset("last_3_months")}
                        className="text-xs h-8"
                      >
                        Last 3 Months
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedDatePreset === "this_year" ? "default" : "outline"}
                        onClick={() => handleDatePreset("this_year")}
                        className="text-xs h-8"
                      >
                        This Year
                      </Button>
                    </div>
                  </div>

                  {/* Custom Range */}
                  <div className="space-y-2 pt-2 border-t border-slate-600">
                    <Label className="text-xs text-slate-400 uppercase tracking-wide">Custom Range</Label>
                    <Button
                      size="sm"
                      variant={selectedDatePreset === "custom" ? "default" : "outline"}
                      onClick={() => handleDatePreset("custom")}
                      className="w-full text-xs h-8"
                    >
                      Custom Range
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="start-date" className="text-xs text-slate-300">Start Date</Label>
                        <Input
                          id="start-date"
                          type="date"
                          value={dateRangeStartInput}
                          onChange={(e) => setDateRangeStartInput(e.target.value)}
                          className="h-8 text-sm bg-slate-700 border-slate-600 text-slate-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="end-date" className="text-xs text-slate-300">End Date</Label>
                        <Input
                          id="end-date"
                          type="date"
                          value={dateRangeEndInput}
                          onChange={(e) => setDateRangeEndInput(e.target.value)}
                          className="h-8 text-sm bg-slate-700 border-slate-600 text-slate-200"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Amount Range</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={amountMinInput}
                onChange={(e) => setAmountMinInput(e.target.value)}
                className="h-9 text-sm w-[100px] bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
              />
              <span className="text-slate-400 self-center text-sm">-</span>
              <Input
                type="number"
                placeholder="Max"
                value={amountMaxInput}
                onChange={(e) => setAmountMaxInput(e.target.value)}
                className="h-9 text-sm w-[100px] bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Category</Label>
            <Select
              value={selectedCategories[0] || "all"}
              onValueChange={(value) => {
                if (value === "all") {
                  setSelectedCategories([]);
                } else {
                  setSelectedCategories([value]);
                }
              }}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Tags</Label>
            <Select
              value={selectedTags[0] || "all"}
              onValueChange={(value) => {
                if (value === "all") {
                  setSelectedTags([]);
                } else {
                  setSelectedTags([value]);
                }
              }}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="+ Select tags" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All tags</SelectItem>
                {tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.name}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

          {/* Sticky Actions Footer */}
          <div className="sticky bottom-0 mt-3 pt-3 bg-gradient-to-t from-slate-900 to-transparent flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetAllFilters}
              className="h-8 px-3 text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={applyAllFilters}
              disabled={!hasUnappliedChanges}
              className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
