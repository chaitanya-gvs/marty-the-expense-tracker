"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Calendar, X, RotateCcw, Check } from "lucide-react";
import { useSettlementParticipants } from "@/hooks/use-settlements";
import { cn } from "@/lib/utils";

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

  const { participants = [] } = useSettlementParticipants();

  const updateFilter = (key: keyof SettlementFilters, value: unknown) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const applyAllFilters = () => {
    const newFilters: SettlementFilters = { ...filters };
    const minAmount = minAmountInput ? Number(minAmountInput) : undefined;
    newFilters.min_amount = minAmount;
    if (dateRangeStartInput || dateRangeEndInput) {
      newFilters.date_range_start = dateRangeStartInput;
      newFilters.date_range_end = dateRangeEndInput;
    } else {
      newFilters.date_range_start = undefined;
      newFilters.date_range_end = undefined;
    }
    newFilters.participant = selectedParticipant !== "all" ? selectedParticipant : undefined;
    newFilters.participants = selectedParticipants.length > 0 ? selectedParticipants : undefined;
    newFilters.show_owed_to_me_only = showOwedToMeOnly;
    newFilters.show_shared_only = showSharedOnly;
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
      case "this_month": {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        setDateRangeStartInput(start.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      }
      case "last_month": {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        setDateRangeStartInput(start.toISOString().split("T")[0]);
        setDateRangeEndInput(end.toISOString().split("T")[0]);
        break;
      }
      case "last_3_months": {
        const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
        setDateRangeStartInput(start.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      }
      case "this_year": {
        const start = new Date(today.getFullYear(), 0, 1);
        setDateRangeStartInput(start.toISOString().split("T")[0]);
        setDateRangeEndInput(today.toISOString().split("T")[0]);
        break;
      }
    }
  };

  useEffect(() => {
    setMinAmountInput(filters.min_amount?.toString() || "");
    setDateRangeStartInput(filters.date_range_start || "");
    setDateRangeEndInput(filters.date_range_end || "");
    setSelectedParticipant(filters.participant || "all");
  }, [filters]);

  const hasUnappliedChanges =
    minAmountInput !== (filters.min_amount?.toString() || "") ||
    dateRangeStartInput !== (filters.date_range_start || "") ||
    dateRangeEndInput !== (filters.date_range_end || "") ||
    selectedParticipant !== (filters.participant || "all");

  const getActiveFilterBadges = () => {
    const badges = [];
    if (filters.participant) {
      badges.push({ key: "participant", label: `Participant: ${filters.participant}` });
    }
    if (filters.date_range_start || filters.date_range_end) {
      const start = filters.date_range_start ? new Date(filters.date_range_start).toLocaleDateString() : "Start";
      const end = filters.date_range_end ? new Date(filters.date_range_end).toLocaleDateString() : "End";
      badges.push({ key: "date_range", label: `${start} – ${end}` });
    }
    if (filters.min_amount !== undefined) {
      badges.push({ key: "min_amount", label: `Min ₹${filters.min_amount}` });
    }
    if (filters.show_owed_to_me_only) {
      badges.push({ key: "owed_to_me", label: "Owed to Me" });
    }
    if (filters.show_shared_only) {
      badges.push({ key: "shared_only", label: "Shared Only" });
    }
    return badges;
  };

  const activeFilterBadges = getActiveFilterBadges();

  const dateLabel =
    selectedDatePreset === "this_month" ? "This Month" :
    selectedDatePreset === "last_month" ? "Last Month" :
    selectedDatePreset === "last_3_months" ? "Last 3 Months" :
    selectedDatePreset === "this_year" ? "This Year" : "Custom Range";

  return (
    <div className="space-y-3">
      {/* Quick filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Quick filters:</span>
        <div className="flex items-center bg-muted/50 rounded-md p-0.5 gap-0.5">
          <button
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded transition-colors",
              showOwedToMeOnly
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => {
              setShowOwedToMeOnly(v => !v);
              setShowSharedOnly(false);
            }}
          >
            Owed to Me
          </button>
          <button
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded transition-colors",
              showSharedOnly
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => {
              setShowSharedOnly(v => !v);
              setShowOwedToMeOnly(false);
            }}
          >
            Shared Only
          </button>
          <button
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded transition-colors",
              selectedDatePreset === "this_month"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => handleDatePreset("this_month")}
          >
            This Month
          </button>
        </div>
      </div>

      {/* Main filter panel */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetAllFilters}
              className="h-7 px-2.5 text-xs gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={applyAllFilters}
              disabled={!hasUnappliedChanges}
              className="h-7 px-2.5 text-xs gap-1"
            >
              <Check className="h-3 w-3" />
              Apply
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Participant */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Participant</Label>
            <Select value={selectedParticipant} onValueChange={setSelectedParticipant}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All participants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All participants</SelectItem>
                {participants.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Date Range</Label>
            <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 text-sm justify-start w-full font-normal">
                  <Calendar className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  {dateLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Presets</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { label: "This Month", value: "this_month" },
                        { label: "Last Month", value: "last_month" },
                        { label: "Last 3 Months", value: "last_3_months" },
                        { label: "This Year", value: "this_year" },
                      ].map(preset => (
                        <Button
                          key={preset.value}
                          size="sm"
                          variant={selectedDatePreset === preset.value ? "default" : "outline"}
                          onClick={() => handleDatePreset(preset.value)}
                          className="h-8 text-xs"
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom Range</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Start</Label>
                        <input
                          type="date"
                          value={dateRangeStartInput}
                          onChange={e => setDateRangeStartInput(e.target.value)}
                          className="w-full bg-muted/40 border border-border/60 rounded-md px-2.5 h-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">End</Label>
                        <input
                          type="date"
                          value={dateRangeEndInput}
                          onChange={e => setDateRangeEndInput(e.target.value)}
                          className="w-full bg-muted/40 border border-border/60 rounded-md px-2.5 h-8 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Min Amount */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Min Amount</Label>
            <Input
              type="number"
              placeholder="₹0.00"
              value={minAmountInput}
              onChange={e => setMinAmountInput(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          <div />
        </div>
      </div>

      {/* Active filter badges */}
      {activeFilterBadges.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Active:</span>
          {activeFilterBadges.map(badge => (
            <Badge key={badge.key} variant="secondary" className="gap-1 text-xs h-6 px-2">
              {badge.label}
              <button
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => {
                  if (badge.key === "participant") updateFilter("participant", undefined);
                  else if (badge.key === "date_range") {
                    onFiltersChange({ ...filters, date_range_start: undefined, date_range_end: undefined });
                  } else if (badge.key === "min_amount") updateFilter("min_amount", undefined);
                  else if (badge.key === "owed_to_me") updateFilter("show_owed_to_me_only", undefined);
                  else if (badge.key === "shared_only") updateFilter("show_shared_only", undefined);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClearFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
