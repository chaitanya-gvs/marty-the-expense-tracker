"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ExpenseAnalyticsFilters } from "@/lib/types";
import { CalendarIcon } from "lucide-react";

interface AnalyticsFiltersProps {
  filters: ExpenseAnalyticsFilters;
  onFiltersChange: (filters: Partial<ExpenseAnalyticsFilters>) => void;
}

export function AnalyticsFilters({ filters, onFiltersChange }: AnalyticsFiltersProps) {
  const setDateRange = (range: "this_month" | "last_month" | "last_3_months" | "last_6_months" | "this_year") => {
    const today = new Date();
    let start = new Date();
    let end = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Helper to format date as YYYY-MM-DD
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    switch (range) {
      case "this_month":
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        // Keep end as today
        break;
      case "last_month":
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case "last_3_months":
        start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
        break;
      case "last_6_months":
        start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
        break;
      case "this_year":
        start = new Date(today.getFullYear(), 0, 1);
        break;
    }

    onFiltersChange({
      date_range: {
        start: formatDate(start),
        end: formatDate(end),
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setDateRange("last_month")}
          className="text-xs"
        >
          Last Month
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setDateRange("this_month")}
          className="text-xs"
        >
          This Month
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setDateRange("last_3_months")}
          className="text-xs"
        >
          Last 3 Months
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setDateRange("this_year")}
          className="text-xs"
        >
          This Year
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Group By */}
        <div className="space-y-2">
          <Label htmlFor="group-by" className="text-xs text-muted-foreground">Group By</Label>
          <Select
            value={filters.group_by || "category"}
            onValueChange={(value) => onFiltersChange({ group_by: value as any })}
          >
            <SelectTrigger id="group-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Category</SelectItem>
              <SelectItem value="tag">Tag</SelectItem>
              <SelectItem value="tag_category">Tag &gt; Category</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="account">Account</SelectItem>
              <SelectItem value="category_month">Category by Month</SelectItem>
              <SelectItem value="tag_month">Tag by Month</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Direction */}
        <div className="space-y-2">
          <Label htmlFor="direction" className="text-xs text-muted-foreground">Direction</Label>
          <Select
            value={filters.direction || "debit"}
            onValueChange={(value) => onFiltersChange({ direction: value as "debit" | "credit" })}
          >
            <SelectTrigger id="direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debit">Debit (Expenses)</SelectItem>
              <SelectItem value="credit">Credit (Income)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Start Date */}
        <div className="space-y-2">
          <Label htmlFor="start-date" className="text-xs text-muted-foreground">Start Date</Label>
          <div className="relative">
            <Input
              id="start-date"
              type="date"
              className="pl-9"
              value={filters.date_range?.start || ""}
              onChange={(e) =>
                onFiltersChange({
                  date_range: {
                    start: e.target.value || undefined,
                    end: filters.date_range?.end,
                  },
                })
              }
            />
            <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* End Date */}
        <div className="space-y-2">
          <Label htmlFor="end-date" className="text-xs text-muted-foreground">End Date</Label>
          <div className="relative">
            <Input
              id="end-date"
              type="date"
              className="pl-9"
              value={filters.date_range?.end || ""}
              onChange={(e) =>
                onFiltersChange({
                  date_range: {
                    start: filters.date_range?.start,
                    end: e.target.value || undefined,
                  },
                })
              }
            />
            <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}

