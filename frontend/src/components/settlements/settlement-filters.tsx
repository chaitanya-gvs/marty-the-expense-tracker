"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, X, RotateCcw, Check, Users } from "lucide-react";
import { useSettlementParticipants } from "@/hooks/use-settlements";

interface SettlementFilters {
  date_range_start?: string;
  date_range_end?: string;
  min_amount?: number;
  participant?: string;
  participants?: string[];
  show_owed_to_me_only?: boolean;
  show_shared_only?: boolean;
}

interface SettlementFiltersProps {
  filters: SettlementFilters;
  onFiltersChange: (filters: SettlementFilters) => void;
  onClearFilters: () => void;
}

export function SettlementFilters({
  filters,
  onFiltersChange,
  onClearFilters,
}: SettlementFiltersProps) {
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [minAmountInput, setMinAmountInput] = useState(filters.min_amount?.toString() || "");
  const [dateRangeStartInput, setDateRangeStartInput] = useState(filters.date_range_start || "");
  const [dateRangeEndInput, setDateRangeEndInput] = useState(filters.date_range_end || "");
  const [selectedDatePreset, setSelectedDatePreset] = useState<string>("custom");
  const [selectedParticipant, setSelectedParticipant] = useState<string>(filters.participant || "all");
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(filters.participants || []);
  const [showOwedToMeOnly, setShowOwedToMeOnly] = useState<boolean>(filters.show_owed_to_me_only || false);
  const [showSharedOnly, setShowSharedOnly] = useState<boolean>(filters.show_shared_only || false);

  // Fetch participants data
  const { participants = [] } = useSettlementParticipants();

  const updateFilter = (key: keyof SettlementFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const applyAllFilters = () => {
    // Build the complete filter object
    const newFilters: SettlementFilters = { ...filters };

    // Apply min amount
    const minAmount = minAmountInput ? Number(minAmountInput) : undefined;
    newFilters.min_amount = minAmount;

    // Apply date range
    if (dateRangeStartInput || dateRangeEndInput) {
      newFilters.date_range_start = dateRangeStartInput;
      newFilters.date_range_end = dateRangeEndInput;
    } else {
      newFilters.date_range_start = undefined;
      newFilters.date_range_end = undefined;
    }

    // Apply participant
    newFilters.participant = selectedParticipant !== "all" ? selectedParticipant : undefined;
    newFilters.participants = selectedParticipants.length > 0 ? selectedParticipants : undefined;
    newFilters.show_owed_to_me_only = showOwedToMeOnly;
    newFilters.show_shared_only = showSharedOnly;

    // Apply all filters at once
    onFiltersChange(newFilters);
  };

  const resetAllFilters = () => {
    setMinAmountInput("");
    setDateRangeStartInput("");
    setDateRangeEndInput("");
    setSelectedDatePreset("custom");
    setSelectedParticipant("all");
    setSelectedParticipants([]);
    setShowOwedToMeOnly(false);
    setShowSharedOnly(false);
    onClearFilters();
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
    setMinAmountInput(filters.min_amount?.toString() || "");
    setDateRangeStartInput(filters.date_range_start || "");
    setDateRangeEndInput(filters.date_range_end || "");
    setSelectedParticipant(filters.participant || "all");
  }, [filters]);

  const hasActiveFilters = Object.values(filters).some(value => 
    value !== undefined && value !== null && value !== ""
  );

  const hasUnappliedChanges = 
    minAmountInput !== (filters.min_amount?.toString() || "") ||
    dateRangeStartInput !== (filters.date_range_start || "") ||
    dateRangeEndInput !== (filters.date_range_end || "") ||
    selectedParticipant !== (filters.participant || "all");

  // Get active filter badges
  const getActiveFilterBadges = () => {
    const badges = [];
    
    if (filters.participant) {
      badges.push({ key: "participant", label: `Participant: ${filters.participant}`, value: filters.participant });
    }
    if (filters.participants && filters.participants.length > 0) {
      badges.push({ key: "participants", label: `Multiple: ${filters.participants.join(", ")}`, value: filters.participants });
    }
    if (filters.date_range_start || filters.date_range_end) {
      const start = filters.date_range_start ? new Date(filters.date_range_start).toLocaleDateString() : "Start";
      const end = filters.date_range_end ? new Date(filters.date_range_end).toLocaleDateString() : "End";
      badges.push({ key: "date_range", label: `Date: ${start} - ${end}`, value: { start: filters.date_range_start, end: filters.date_range_end } });
    }
    if (filters.min_amount !== undefined) {
      badges.push({ key: "min_amount", label: `Min Amount: ₹${filters.min_amount}`, value: filters.min_amount });
    }
    if (filters.show_owed_to_me_only) {
      badges.push({ key: "owed_to_me", label: "Owed to Me Only", value: true });
    }
    if (filters.show_shared_only) {
      badges.push({ key: "shared_only", label: "Shared Transactions Only", value: true });
    }
    
    return badges;
  };

  // Quick filter actions
  const quickFilters = [
    {
      label: "Owed to Me",
      icon: "💰",
      action: () => {
        setShowOwedToMeOnly(!showOwedToMeOnly);
        setShowSharedOnly(false);
      },
      active: showOwedToMeOnly
    },
    {
      label: "Shared Only",
      icon: "🤝",
      action: () => {
        setShowSharedOnly(!showSharedOnly);
        setShowOwedToMeOnly(false);
      },
      active: showSharedOnly
    },
    {
      label: "This Month",
      icon: "📅",
      action: () => {
        handleDatePreset("this_month");
        applyAllFilters();
      },
      active: selectedDatePreset === "this_month"
    }
  ];

  const activeFilterBadges = getActiveFilterBadges();

  return (
    <div className="space-y-4">
      {/* Quick Filter Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-400">Quick filters:</span>
        {quickFilters.map((filter) => (
          <Button
            key={filter.label}
            variant={filter.active ? "default" : "outline"}
            size="sm"
            onClick={filter.action}
            className={`h-8 px-3 text-xs transition-all duration-200 ${
              filter.active 
                ? "bg-blue-600 hover:bg-blue-700 text-white" 
                : "border-slate-600 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span className="mr-1">{filter.icon}</span>
            {filter.label}
          </Button>
        ))}
      </div>

      {/* Main Filters Grid */}
      <div className="bg-slate-900/70 rounded-xl p-4 border border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-200">FILTERS</h3>
          <div className="flex items-center gap-2">
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
              className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
        </div>

        {/* 2-Row Grid Layout */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Row 1 */}
          <div className="space-y-1">
            <Label htmlFor="participant" className="text-xs text-slate-400 uppercase tracking-wide">Participant</Label>
            <Select
              value={selectedParticipant}
              onValueChange={(value) => setSelectedParticipant(value)}
            >
              <SelectTrigger className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="All participants" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all">All participants</SelectItem>
                {participants.map((participant) => (
                  <SelectItem key={participant} value={participant}>
                    {participant}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
            <Label htmlFor="min-amount" className="text-xs text-slate-400 uppercase tracking-wide">Min Amount</Label>
            <Input
              id="min-amount"
              type="number"
              placeholder="₹0.00"
              value={minAmountInput}
              onChange={(e) => setMinAmountInput(e.target.value)}
              className="h-9 text-sm bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Empty space for grid alignment */}
          <div></div>
        </div>
      </div>

      {/* Active Filter Badges */}
      {activeFilterBadges.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-400">Active filters:</span>
          {activeFilterBadges.map((badge) => (
            <Badge 
              key={badge.key} 
              variant="secondary" 
              className="gap-1 text-xs bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700"
            >
              {badge.label}
              <Button
                variant="ghost"
                size="sm"
                className="h-3 w-3 p-0 ml-1 hover:bg-slate-600"
                onClick={() => {
                  if (badge.key === "participant") {
                    updateFilter("participant", undefined);
                  } else if (badge.key === "date_range") {
                    updateFilter("date_range_start", undefined);
                    updateFilter("date_range_end", undefined);
                  } else if (badge.key === "min_amount") {
                    updateFilter("min_amount", undefined);
                  }
                }}
              >
                <X className="h-2 w-2" />
              </Button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={onClearFilters}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
