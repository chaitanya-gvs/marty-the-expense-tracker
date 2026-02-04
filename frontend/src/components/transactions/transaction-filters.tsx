"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Calendar, Search, X, RotateCcw, Check, ChevronDown, ChevronUp, AlertTriangle, ChevronsUpDown, Plus } from "lucide-react";
import type { TransactionFilters } from "@/lib/types";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { useAccounts } from "@/hooks/use-accounts";
import { useParticipants } from "@/hooks/use-participants";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";

// Helper to check if two arrays are equal
function arraysEqual(a: any[] | undefined, b: any[] | undefined) {
  if (a === b) return true;
  const arrA = a || [];
  const arrB = b || [];
  if (arrA.length !== arrB.length) return false;
  const sortedA = [...arrA].sort();
  const sortedB = [...arrB].sort();
  return sortedA.every((val, index) => val === sortedB[index]);
}

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
  const [excludeCategories, setExcludeCategories] = useState<string[]>(filters.exclude_categories || []);
  const [selectedTags, setSelectedTags] = useState<string[]>(filters.tags || []);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>(filters.accounts || []);
  const [excludeAccounts, setExcludeAccounts] = useState<string[]>(filters.exclude_accounts || []);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(filters.participants || []);
  const [excludeParticipants, setExcludeParticipants] = useState<string[]>(filters.exclude_participants || []);
  const [selectedDirection, setSelectedDirection] = useState<string>(filters.direction || "all");
  const [selectedTransactionType, setSelectedTransactionType] = useState<string>(filters.transaction_type || "all");
  const [includeUncategorized, setIncludeUncategorized] = useState<boolean>(filters.include_uncategorized || false);
  const [flaggedFilter, setFlaggedFilter] = useState<string>(
    filters.flagged === true ? "flagged" : filters.flagged === false ? "not_flagged" : "all"
  );
  const [hideShared, setHideShared] = useState<boolean>(filters.is_shared === false);
  const [splitFilter, setSplitFilter] = useState<string>(
    filters.is_split === false ? "exclude" : filters.is_split === true ? "only" : "all"
  );
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [participantSearchQuery, setParticipantSearchQuery] = useState("");
  const [isAccountPopoverOpen, setIsAccountPopoverOpen] = useState(false);
  const [isCategoryPopoverOpen, setIsCategoryPopoverOpen] = useState(false);
  const [isParticipantPopoverOpen, setIsParticipantPopoverOpen] = useState(false);

  // Debounce text inputs
  const debouncedSearch = useDebounce(searchInput, 500);
  const debouncedAmountMin = useDebounce(amountMinInput, 500);
  const debouncedAmountMax = useDebounce(amountMaxInput, 500);
  const debouncedDateStart = useDebounce(dateRangeStartInput, 500); // Also debounce date text inputs to avoid incomplete dates
  const debouncedDateEnd = useDebounce(dateRangeEndInput, 500);

  // Fetch categories, tags, accounts, and participants data
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { data: accounts = [], isLoading: accountsLoading, error: accountsError } = useAccounts();
  const { participants = [], isLoading: participantsLoading } = useParticipants(participantSearchQuery);

  // Log for debugging
  useEffect(() => {
    if (accountsError) {
      console.error("Error fetching accounts:", accountsError);
    }
    if (accounts.length > 0) {
      console.log("Accounts loaded:", accounts);
    }
  }, [accounts, accountsError]);

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

    // Apply categories (include vs exclude)
    if (selectedCategories.length > 0 && excludeCategories.length > 0) {
      // If both are set, prefer explicit include and clear excludes to avoid conflicts
      newFilters.categories = selectedCategories;
      newFilters.exclude_categories = undefined;
    } else if (selectedCategories.length > 0) {
      newFilters.categories = selectedCategories;
      newFilters.exclude_categories = undefined;
    } else if (excludeCategories.length > 0) {
      newFilters.categories = undefined;
      newFilters.exclude_categories = excludeCategories;
    } else {
      newFilters.categories = undefined;
      newFilters.exclude_categories = undefined;
    }

    // Apply tags
    newFilters.tags = selectedTags.length > 0 ? selectedTags : undefined;

    // Apply participants (include vs exclude)
    if (selectedParticipants.length > 0 && excludeParticipants.length > 0) {
      // If both are set, prefer explicit include and clear excludes to avoid conflicts
      newFilters.participants = selectedParticipants;
      newFilters.exclude_participants = undefined;
    } else if (selectedParticipants.length > 0) {
      newFilters.participants = selectedParticipants;
      newFilters.exclude_participants = undefined;
    } else if (excludeParticipants.length > 0) {
      newFilters.participants = undefined;
      newFilters.exclude_participants = excludeParticipants;
    } else {
      newFilters.participants = undefined;
      newFilters.exclude_participants = undefined;
    }

    // Apply accounts (include vs exclude)
    if (selectedAccounts.length > 0 && excludeAccounts.length > 0) {
      newFilters.accounts = selectedAccounts;
      newFilters.exclude_accounts = undefined;
    } else if (selectedAccounts.length > 0) {
      newFilters.accounts = selectedAccounts;
      newFilters.exclude_accounts = undefined;
    } else if (excludeAccounts.length > 0) {
      newFilters.accounts = undefined;
      newFilters.exclude_accounts = excludeAccounts;
    } else {
      newFilters.accounts = undefined;
      newFilters.exclude_accounts = undefined;
    }

    // Apply direction
    newFilters.direction = selectedDirection !== "all" ? selectedDirection as "debit" | "credit" : undefined;

    // Apply transaction type
    newFilters.transaction_type = selectedTransactionType !== "all" ? selectedTransactionType as "shared" | "refunds" | "transfers" : undefined;

    // Apply uncategorized filter
    newFilters.include_uncategorized = includeUncategorized ? true : undefined;

    // Apply flagged filter
    if (flaggedFilter === "flagged") {
      newFilters.flagged = true;
    } else if (flaggedFilter === "not_flagged") {
      newFilters.flagged = false;
    } else {
      newFilters.flagged = undefined;
    }

    // Apply direct is_shared filter (hide shared)
    newFilters.is_shared = hideShared ? false : undefined;

    // Apply is_split filter
    if (splitFilter === "exclude") {
      newFilters.is_split = false; // Exclude split transactions
    } else if (splitFilter === "only") {
      newFilters.is_split = true; // Show only split transactions
    } else {
      newFilters.is_split = undefined; // Show all
    }

    // Check if filters have actually changed
    const filtersChanged =
      newFilters.search !== filters.search ||
      newFilters.amount_range?.min !== filters.amount_range?.min ||
      newFilters.amount_range?.max !== filters.amount_range?.max ||
      newFilters.date_range?.start !== filters.date_range?.start ||
      newFilters.date_range?.end !== filters.date_range?.end ||
      !arraysEqual(newFilters.categories, filters.categories) ||
      !arraysEqual(newFilters.exclude_categories, filters.exclude_categories) ||
      !arraysEqual(newFilters.tags, filters.tags) ||
      !arraysEqual(newFilters.accounts, filters.accounts) ||
      !arraysEqual(newFilters.exclude_accounts, filters.exclude_accounts) ||
      !arraysEqual(newFilters.participants, filters.participants) ||
      !arraysEqual(newFilters.exclude_participants, filters.exclude_participants) ||
      newFilters.direction !== filters.direction ||
      newFilters.transaction_type !== filters.transaction_type ||
      newFilters.include_uncategorized !== filters.include_uncategorized ||
      newFilters.flagged !== filters.flagged ||
      newFilters.is_shared !== filters.is_shared ||
      newFilters.is_split !== filters.is_split;

    if (filtersChanged) {
      onFiltersChange(newFilters);
      console.log("✅ Filters applied (Auto)!", newFilters);
    } else {
      console.log("⏭️ Filters unchanged, skipping update");
    }
  };

  const resetAllFilters = () => {
    setSearchInput("");
    setAmountMinInput("");
    setAmountMaxInput("");
    setDateRangeStartInput("");
    setDateRangeEndInput("");
    setSelectedDatePreset("custom");
    setSelectedCategories([]);
    setExcludeCategories([]);
    setSelectedTags([]);
    setSelectedAccounts([]);
    setExcludeAccounts([]);
    setSelectedParticipants([]);
    setExcludeParticipants([]);
    setSelectedDirection("all");
    setSelectedTransactionType("all");
    setIncludeUncategorized(false);
    setFlaggedFilter("all");
    setHideShared(false);
    setSplitFilter("all");
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
  // Sync input states with filters when they change externally (e.g., clear all)
  useEffect(() => {
    // Only update state if values differ to avoid infinite loops with auto-apply
    if ((filters.search || "") !== searchInput) setSearchInput(filters.search || "");
    if ((filters.amount_range?.min?.toString() || "") !== amountMinInput) setAmountMinInput(filters.amount_range?.min?.toString() || "");
    if ((filters.amount_range?.max?.toString() || "") !== amountMaxInput) setAmountMaxInput(filters.amount_range?.max?.toString() || "");
    if ((filters.date_range?.start || "") !== dateRangeStartInput) setDateRangeStartInput(filters.date_range?.start || "");
    if ((filters.date_range?.end || "") !== dateRangeEndInput) setDateRangeEndInput(filters.date_range?.end || "");

    // Arrays need deep comparison
    if (!arraysEqual(filters.categories, selectedCategories)) setSelectedCategories(filters.categories || []);
    if (!arraysEqual(filters.exclude_categories, excludeCategories)) setExcludeCategories(filters.exclude_categories || []);
    if (!arraysEqual(filters.tags, selectedTags)) setSelectedTags(filters.tags || []);
    if (!arraysEqual(filters.accounts, selectedAccounts)) setSelectedAccounts(filters.accounts || []);
    if (!arraysEqual(filters.exclude_accounts, excludeAccounts)) setExcludeAccounts(filters.exclude_accounts || []);
    if (!arraysEqual(filters.participants, selectedParticipants)) setSelectedParticipants(filters.participants || []);
    if (!arraysEqual(filters.exclude_participants, excludeParticipants)) setExcludeParticipants(filters.exclude_participants || []);

    if ((filters.direction || "all") !== selectedDirection) setSelectedDirection(filters.direction || "all");
    if ((filters.transaction_type || "all") !== selectedTransactionType) setSelectedTransactionType(filters.transaction_type || "all");
    if ((filters.include_uncategorized || false) !== includeUncategorized) setIncludeUncategorized(filters.include_uncategorized || false);

    const newFlagged = filters.flagged === true ? "flagged" : filters.flagged === false ? "not_flagged" : "all";
    if (newFlagged !== flaggedFilter) setFlaggedFilter(newFlagged);

    const newHideShared = filters.is_shared === false;
    if (newHideShared !== hideShared) setHideShared(newHideShared);

    const newSplitFilter = filters.is_split === false ? "exclude" : filters.is_split === true ? "only" : "all";
    if (newSplitFilter !== splitFilter) setSplitFilter(newSplitFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const hasActiveFilters = Object.values(filters).some(value =>
    value !== undefined && value !== null && value !== ""
  );



  // Auto-apply filters when inputs change
  useEffect(() => {
    applyAllFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearch,
    debouncedAmountMin,
    debouncedAmountMax,
    debouncedDateStart,
    debouncedDateEnd,
    selectedDatePreset, // Ensure preset changes trigger
    selectedCategories,
    selectedTags,
    selectedAccounts,
    selectedParticipants,
    selectedDirection,
    selectedTransactionType,
    includeUncategorized,
    flaggedFilter,
    hideShared,
    splitFilter,
    // Explicitly exclude non-filter state like popover open states
  ]);

  // Keyboard support - Escape only
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
    else if (key === "accounts") {
      setSelectedAccounts([]);
      setExcludeAccounts([]);
    }
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
    else if (key === "categories") {
      setSelectedCategories([]);
      setExcludeCategories([]);
    }
    else if (key === "tags") setSelectedTags([]);
    else if (key === "participants") {
      setSelectedParticipants([]);
      setExcludeParticipants([]);
    }
    else if (key === "include_uncategorized") setIncludeUncategorized(false);
    else if (key === "flagged") setFlaggedFilter("all");
    else if (key === "is_shared") setHideShared(false);
    else if (key === "is_split") setSplitFilter("all");

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
      badges.push({ key: "accounts", label: `Accounts: ${filters.accounts.join(", ")}`, value: filters.accounts });
    }
    if (filters.exclude_accounts && filters.exclude_accounts.length > 0) {
      badges.push({ key: "accounts", label: `Accounts: excluding ${filters.exclude_accounts.join(", ")}`, value: filters.exclude_accounts });
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
      badges.push({ key: "categories", label: `Categories: ${filters.categories.join(", ")}`, value: filters.categories });
    }
    if (filters.exclude_categories && filters.exclude_categories.length > 0) {
      badges.push({ key: "categories", label: `Categories: excluding ${filters.exclude_categories.join(", ")}`, value: filters.exclude_categories });
    }
    if (filters.tags && filters.tags.length > 0) {
      badges.push({ key: "tags", label: `Tags: ${filters.tags.join(", ")}`, value: filters.tags });
    }
    if (filters.participants && filters.participants.length > 0) {
      badges.push({ key: "participants", label: `Participants: ${filters.participants.join(", ")}`, value: filters.participants });
    }
    if (filters.exclude_participants && filters.exclude_participants.length > 0) {
      badges.push({ key: "participants", label: `Exclude participants: ${filters.exclude_participants.join(", ")}`, value: filters.exclude_participants });
    }
    if (filters.include_uncategorized) {
      badges.push({ key: "include_uncategorized", label: "Include Uncategorized", value: true });
    }
    if (filters.flagged !== undefined) {
      badges.push({ key: "flagged", label: filters.flagged ? "Flagged Only" : "Not Flagged", value: filters.flagged });
    }
    if (filters.is_shared === false) {
      badges.push({ key: "is_shared", label: "Hide shared expenses", value: false });
    }
    if (filters.is_split === false) {
      badges.push({ key: "is_split", label: "Exclude split transactions", value: false });
    }
    if (filters.is_split === true) {
      badges.push({ key: "is_split", label: "Split transactions only", value: true });
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
              <Label htmlFor="account" className="text-xs text-slate-400 uppercase tracking-wide">Accounts</Label>
              <Popover
                open={isAccountPopoverOpen}
                onOpenChange={(open) => {
                  setIsAccountPopoverOpen(open);
                  if (!open) setAccountSearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isAccountPopoverOpen}
                    className="h-auto min-h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 justify-between w-full py-2"
                  >
                    <div className="flex flex-wrap gap-1 flex-1 text-left">
                      {selectedAccounts.length === 0 && excludeAccounts.length === 0 ? (
                        <span className="text-slate-400">All accounts</span>
                      ) : (
                        <>
                          {selectedAccounts.map((account) => (
                            <Badge
                              key={`include-${account}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-blue-600/20 text-blue-200 border-blue-500/50"
                            >
                              {account}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAccounts(selectedAccounts.filter((a) => a !== account));
                                }}
                              />
                            </Badge>
                          ))}
                          {excludeAccounts.map((account) => (
                            <Badge
                              key={`exclude-${account}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-red-600/20 text-red-200 border-red-500/50"
                            >
                              Not {account}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-red-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExcludeAccounts(excludeAccounts.filter((a) => a !== account));
                                }}
                              />
                            </Badge>
                          ))}
                        </>
                      )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0 bg-slate-800 border-slate-600" align="start">
                  <div className="flex items-center border-b border-slate-700 px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-slate-400" />
                    <Input
                      placeholder="Search accounts..."
                      value={accountSearchQuery}
                      onChange={(e) => setAccountSearchQuery(e.target.value)}
                      className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 border-0 focus-visible:ring-0 text-slate-200"
                    />
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {accountsLoading ? (
                      <div className="py-6 text-center text-sm text-slate-400">Loading accounts...</div>
                    ) : accountsError ? (
                      <div className="py-6 text-center text-sm text-red-400">Error loading accounts</div>
                    ) : (() => {
                      const filteredAccounts = accounts.filter((account) =>
                        account.toLowerCase().includes(accountSearchQuery.toLowerCase())
                      );
                      return filteredAccounts.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">No accounts found</div>
                      ) : (
                        <div className="p-1">
                          {filteredAccounts.map((account) => {
                            const inInclude = selectedAccounts.includes(account);
                            const inExclude = excludeAccounts.includes(account);
                            const isActive = inInclude || inExclude;
                            return (
                              <div
                                key={account}
                                className={cn(
                                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-700 hover:text-slate-50",
                                  isActive && "bg-slate-700/50"
                                )}
                                onClick={() => {
                                  if (inInclude) {
                                    setSelectedAccounts(selectedAccounts.filter((a) => a !== account));
                                    setExcludeAccounts([...excludeAccounts, account]);
                                  } else if (inExclude) {
                                    setExcludeAccounts(excludeAccounts.filter((a) => a !== account));
                                  } else {
                                    setSelectedAccounts([...selectedAccounts, account]);
                                  }
                                }}
                              >
                                <div
                                  className={cn(
                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                                    inInclude
                                      ? "border-blue-500 bg-blue-500 text-white"
                                      : inExclude
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-slate-500 opacity-50 [&_svg]:invisible"
                                  )}
                                >
                                  <Check className="h-4 w-4" />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className="truncate">{account}</span>
                                  {inInclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/50 text-blue-300">
                                      Include
                                    </Badge>
                                  )}
                                  {inExclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/50 text-red-300">
                                      Exclude
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {(selectedAccounts.length > 0 || excludeAccounts.length > 0) && (
                    <div className="border-t border-slate-700 p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 text-xs">
                          {selectedAccounts.length > 0 && (
                            <span className="text-blue-300">{selectedAccounts.length} included</span>
                          )}
                          {selectedAccounts.length > 0 && excludeAccounts.length > 0 && " · "}
                          {excludeAccounts.length > 0 && (
                            <span className="text-red-300">{excludeAccounts.length} excluded</span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSelectedAccounts([]);
                            setExcludeAccounts([]);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
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
              <Label className="text-xs text-slate-400 uppercase tracking-wide">Categories</Label>
              <Popover
                open={isCategoryPopoverOpen}
                onOpenChange={(open) => {
                  setIsCategoryPopoverOpen(open);
                  if (!open) setCategorySearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isCategoryPopoverOpen}
                    className="h-auto min-h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 justify-between w-full py-2"
                  >
                    <div className="flex flex-wrap gap-1 flex-1 text-left">
                      {selectedCategories.length === 0 && excludeCategories.length === 0 && !includeUncategorized ? (
                        <span className="text-slate-400">All categories</span>
                      ) : (
                        <>
                          {selectedCategories.map((category) => (
                            <Badge
                              key={`include-${category}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-blue-600/20 text-blue-200 border-blue-500/50"
                            >
                              {category}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCategories(selectedCategories.filter((c) => c !== category));
                                }}
                              />
                            </Badge>
                          ))}
                          {excludeCategories.map((category) => (
                            <Badge
                              key={`exclude-${category}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-red-600/20 text-red-200 border-red-500/50"
                            >
                              Not {category}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-red-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExcludeCategories(excludeCategories.filter((c) => c !== category));
                                }}
                              />
                            </Badge>
                          ))}
                          {includeUncategorized && (
                            <Badge
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-purple-600/20 text-purple-200 border-purple-500/50"
                            >
                              Uncategorized
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-purple-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIncludeUncategorized(false);
                                }}
                              />
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0 bg-slate-800 border-slate-600" align="start">
                  <div className="flex items-center border-b border-slate-700 px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-slate-400" />
                    <Input
                      placeholder="Search categories..."
                      value={categorySearchQuery}
                      onChange={(e) => setCategorySearchQuery(e.target.value)}
                      className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 border-0 focus-visible:ring-0 text-slate-200"
                    />
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {categories.length === 0 ? (
                      <div className="py-6 text-center text-sm text-slate-400">No categories found</div>
                    ) : (() => {
                      const filteredCategories = categories.filter((category) =>
                        category.name.toLowerCase().includes(categorySearchQuery.toLowerCase())
                      );
                      return filteredCategories.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">No categories found</div>
                      ) : (
                        <div className="p-1">
                          {filteredCategories.map((category) => {
                            const name = category.name;
                            const inInclude = selectedCategories.includes(name);
                            const inExclude = excludeCategories.includes(name);
                            const isActive = inInclude || inExclude;
                            return (
                              <div
                                key={category.id}
                                className={cn(
                                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-700 hover:text-slate-50",
                                  isActive && "bg-slate-700/50"
                                )}
                                onClick={() => {
                                  if (inInclude) {
                                    setSelectedCategories(selectedCategories.filter((c) => c !== name));
                                    setExcludeCategories([...excludeCategories, name]);
                                  } else if (inExclude) {
                                    setExcludeCategories(excludeCategories.filter((c) => c !== name));
                                  } else {
                                    setSelectedCategories([...selectedCategories, name]);
                                  }
                                }}
                              >
                                <div
                                  className={cn(
                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                                    inInclude
                                      ? "border-blue-500 bg-blue-500 text-white"
                                      : inExclude
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-slate-500 opacity-50 [&_svg]:invisible"
                                  )}
                                >
                                  <Check className="h-4 w-4" />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className="truncate">{name}</span>
                                  {inInclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/50 text-blue-300">
                                      Include
                                    </Badge>
                                  )}
                                  {inExclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/50 text-red-300">
                                      Exclude
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <div className="h-px bg-slate-700 my-1" />
                          <div
                            className={cn(
                              "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-700 hover:text-slate-50",
                              includeUncategorized && "bg-slate-700/50"
                            )}
                            onClick={() => {
                              if (includeUncategorized && selectedCategories.length === 0 && excludeCategories.length === 0) {
                                setIncludeUncategorized(false);
                              } else if (!includeUncategorized && selectedCategories.length === 0 && excludeCategories.length === 0) {
                                setIncludeUncategorized(true);
                              } else {
                                setIncludeUncategorized(!includeUncategorized);
                              }
                            }}
                          >
                            <div
                              className={cn(
                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                                includeUncategorized
                                  ? "border-purple-500 bg-purple-500 text-white"
                                  : "border-slate-500 opacity-50 [&_svg]:invisible"
                              )}
                            >
                              <Check className="h-4 w-4" />
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="truncate">
                                {includeUncategorized && selectedCategories.length === 0 && excludeCategories.length === 0
                                  ? "Uncategorized only"
                                  : includeUncategorized
                                    ? "Also include uncategorized"
                                    : "Include uncategorized"}
                              </span>
                              {includeUncategorized && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-500/50 text-purple-300">
                                  Active
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {(selectedCategories.length > 0 || excludeCategories.length > 0 || includeUncategorized) && (
                    <div className="border-t border-slate-700 p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 text-xs">
                          {selectedCategories.length > 0 && (
                            <span className="text-blue-300">{selectedCategories.length} included</span>
                          )}
                          {selectedCategories.length > 0 && excludeCategories.length > 0 && " · "}
                          {excludeCategories.length > 0 && (
                            <span className="text-red-300">{excludeCategories.length} excluded</span>
                          )}
                          {(selectedCategories.length > 0 || excludeCategories.length > 0) && includeUncategorized && " · "}
                          {includeUncategorized && (
                            <span className="text-purple-300">uncategorized</span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSelectedCategories([]);
                            setExcludeCategories([]);
                            setIncludeUncategorized(false);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wide">Participants</Label>
              <Popover
                open={isParticipantPopoverOpen}
                onOpenChange={(open) => {
                  setIsParticipantPopoverOpen(open);
                  if (!open) setParticipantSearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isParticipantPopoverOpen}
                    className="h-auto min-h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 justify-between w-full py-2"
                  >
                    <div className="flex flex-wrap gap-1 flex-1 text-left">
                      {selectedParticipants.length === 0 && excludeParticipants.length === 0 ? (
                        <span className="text-slate-400">All participants</span>
                      ) : (
                        <>
                          {selectedParticipants.map((participant) => (
                            <Badge
                              key={`include-${participant}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-blue-600/20 text-blue-200 border-blue-500/50"
                            >
                              {participant}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-blue-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedParticipants(selectedParticipants.filter((p) => p !== participant));
                                }}
                              />
                            </Badge>
                          ))}
                          {excludeParticipants.map((participant) => (
                            <Badge
                              key={`exclude-${participant}`}
                              variant="secondary"
                              className="mr-1 mb-0.5 bg-red-600/20 text-red-200 border-red-500/50"
                            >
                              Not {participant}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer hover:text-red-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExcludeParticipants(excludeParticipants.filter((p) => p !== participant));
                                }}
                              />
                            </Badge>
                          ))}
                        </>
                      )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0 bg-slate-800 border-slate-600" align="start">
                  <div className="flex items-center border-b border-slate-700 px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-slate-400" />
                    <Input
                      placeholder="Search participants..."
                      value={participantSearchQuery}
                      onChange={(e) => setParticipantSearchQuery(e.target.value)}
                      className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 border-0 focus-visible:ring-0 text-slate-200"
                    />
                  </div>
                  <div className="max-h-[300px] overflow-auto">
                    {participantsLoading ? (
                      <div className="py-6 text-center text-sm text-slate-400">Loading participants...</div>
                    ) : (() => {
                      const filteredParticipants = participants.filter((participant) =>
                        participant.name.toLowerCase().includes(participantSearchQuery.toLowerCase())
                      );
                      return filteredParticipants.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">No participants found</div>
                      ) : (
                        <div className="p-1">
                          {filteredParticipants.map((participant) => {
                            const name = participant.name;
                            const inInclude = selectedParticipants.includes(name);
                            const inExclude = excludeParticipants.includes(name);
                            const isActive = inInclude || inExclude;
                            return (
                              <div
                                key={participant.id}
                                className={cn(
                                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-slate-700 hover:text-slate-50",
                                  isActive && "bg-slate-700/50"
                                )}
                                onClick={() => {
                                  if (inInclude) {
                                    setSelectedParticipants(selectedParticipants.filter((p) => p !== name));
                                    setExcludeParticipants([...excludeParticipants, name]);
                                  } else if (inExclude) {
                                    setExcludeParticipants(excludeParticipants.filter((p) => p !== name));
                                  } else {
                                    setSelectedParticipants([...selectedParticipants, name]);
                                  }
                                }}
                              >
                                <div
                                  className={cn(
                                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                                    inInclude
                                      ? "border-blue-500 bg-blue-500 text-white"
                                      : inExclude
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-slate-500 opacity-50 [&_svg]:invisible"
                                  )}
                                >
                                  <Check className="h-4 w-4" />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className="truncate">{name}</span>
                                  {inInclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/50 text-blue-300">
                                      Include
                                    </Badge>
                                  )}
                                  {inExclude && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-500/50 text-red-300">
                                      Exclude
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {(selectedParticipants.length > 0 || excludeParticipants.length > 0) && (
                    <div className="border-t border-slate-700 p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 text-xs">
                          {selectedParticipants.length > 0 && (
                            <span className="text-blue-300">{selectedParticipants.length} included</span>
                          )}
                          {selectedParticipants.length > 0 && excludeParticipants.length > 0 && " · "}
                          {excludeParticipants.length > 0 && (
                            <span className="text-red-300">{excludeParticipants.length} excluded</span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSelectedParticipants([]);
                            setExcludeParticipants([]);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
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

          {/* Additional Filter Options */}
          <div className="mt-4 pt-4 border-t border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1 flex-1">
                <Label htmlFor="include-uncategorized" className="text-sm text-slate-300 cursor-pointer">
                  Also Include Uncategorized
                </Label>
                <span className="text-xs text-slate-500">
                  {selectedCategories.length > 0
                    ? "Include uncategorized transactions when filtering by category"
                    : "Show uncategorized transactions (select 'Uncategorized' in dropdown for only uncategorized)"}
                </span>
              </div>
              <Switch
                id="include-uncategorized"
                checked={includeUncategorized}
                onCheckedChange={setIncludeUncategorized}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <Label htmlFor="flagged-filter" className="text-sm text-slate-300 cursor-pointer">
                    Flagged Transactions
                  </Label>
                </div>
                <span className="text-xs text-slate-500">
                  Filter transactions by flagged status
                </span>
              </div>
              <Select
                value={flaggedFilter}
                onValueChange={setFlaggedFilter}
              >
                <SelectTrigger className="h-9 w-[140px] text-sm bg-slate-800 border-slate-600 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="flagged">Flagged Only</SelectItem>
                  <SelectItem value="not_flagged">Not Flagged</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-400" />
                  <Label htmlFor="hide-shared" className="text-sm text-slate-300 cursor-pointer">
                    Hide Shared Expenses
                  </Label>
                </div>
                <span className="text-xs text-slate-500">
                  Filter out transactions where they are marked as shared (show only personal spend)
                </span>
              </div>
              <Switch
                id="hide-shared"
                checked={hideShared}
                onCheckedChange={(checked) => setHideShared(checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-purple-400" />
                  <Label htmlFor="split-filter" className="text-sm text-slate-300 cursor-pointer">
                    Split Transactions
                  </Label>
                </div>
                <span className="text-xs text-slate-500">
                  Filter transactions by split status
                </span>
              </div>
              <Select
                value={splitFilter}
                onValueChange={setSplitFilter}
              >
                <SelectTrigger className="h-9 w-[160px] text-sm bg-slate-800 border-slate-600 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="exclude">Exclude Split</SelectItem>
                  <SelectItem value="only">Split Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
