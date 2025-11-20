"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ExpenseAnalyticsFilters } from "@/lib/types";

interface AnalyticsFiltersProps {
  filters: ExpenseAnalyticsFilters;
  onFiltersChange: (filters: Partial<ExpenseAnalyticsFilters>) => void;
}

export function AnalyticsFilters({ filters, onFiltersChange }: AnalyticsFiltersProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Group By */}
      <div className="space-y-2">
        <Label htmlFor="group-by">Group By</Label>
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
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="account">Account</SelectItem>
            <SelectItem value="category_month">Category by Month</SelectItem>
            <SelectItem value="tag_month">Tag by Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Direction */}
      <div className="space-y-2">
        <Label htmlFor="direction">Direction</Label>
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
        <Label htmlFor="start-date">Start Date</Label>
        <Input
          id="start-date"
          type="date"
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
      </div>

      {/* End Date */}
      <div className="space-y-2">
        <Label htmlFor="end-date">End Date</Label>
        <Input
          id="end-date"
          type="date"
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
      </div>
    </div>
  );
}

