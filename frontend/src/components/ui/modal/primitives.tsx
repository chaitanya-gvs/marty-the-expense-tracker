"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface FieldRowProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldRow({
  label,
  required,
  hint,
  error,
  children,
  className,
}: FieldRowProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label className="text-[10px] uppercase tracking-wider text-[var(--modal-muted)]">
        {label}
        {required && <span className="text-[var(--modal-danger)] ml-1">*</span>}
      </Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-[var(--modal-muted)]">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-[var(--modal-danger)]">{error}</p>
      )}
    </div>
  );
}

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  currency?: string;
  onValueChange?: (value: number) => void;
}

export function MoneyInput({
  currency = "₹",
  value,
  onValueChange,
  onChange,
  className,
  ...props
}: MoneyInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numValue = parseFloat(e.target.value) || 0;
    onValueChange?.(numValue);
    onChange?.(e);
  };

  const formatValue = (val: string | number | readonly string[] | undefined) => {
    if (val === undefined || val === "") return "";
    const num = typeof val === "string" ? parseFloat(val) : Number(val);
    if (isNaN(num)) return "";
    return num.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--modal-muted)]">
        {currency}
      </span>
      <Input
        {...props}
        type="number"
        step="0.01"
        value={value}
        onChange={handleChange}
        className={cn(
          "h-10 bg-slate-800/60 border-slate-700 rounded-lg pl-8 pr-3",
          "text-right text-[var(--modal-text)] font-mono",
          "focus:outline-none focus:ring-2 focus:ring-slate-600",
          className
        )}
      />
    </div>
  );
}

export interface CategorySelectProps {
  value?: string;
  onChange?: (value: string) => void;
  categories: Array<{ id: string; name: string; color?: string }>;
  placeholder?: string;
  className?: string;
}

export function CategorySelect({
  value,
  onChange,
  categories,
  placeholder = "Select category",
  className,
}: CategorySelectProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {categories.map((category) => {
        const isSelected = value === category.name;
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onChange?.(category.name)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-all",
              "border-2 min-w-[100px]",
              isSelected
                ? "border-[var(--modal-accent)] bg-[var(--modal-accent)]/20 text-[var(--modal-accent)]"
                : "border-slate-700 bg-slate-800/60 text-[var(--modal-muted)] hover:border-slate-600"
            )}
            style={
              isSelected && category.color
                ? {
                    borderColor: category.color,
                    backgroundColor: `${category.color}20`,
                    color: category.color,
                  }
                : undefined
            }
          >
            {category.name}
          </button>
        );
      })}
      {categories.length === 0 && (
        <span className="text-sm text-[var(--modal-muted)]">{placeholder}</span>
      )}
    </div>
  );
}

export interface SummaryStatProps {
  label: string;
  value: string | number;
  valueColor?: "default" | "success" | "danger" | "warning";
  className?: string;
}

export function SummaryStat({
  label,
  value,
  valueColor = "default",
  className,
}: SummaryStatProps) {
  const colorClasses = {
    default: "text-[var(--modal-text)]",
    success: "text-[var(--modal-success)]",
    danger: "text-[var(--modal-danger)]",
    warning: "text-[#f59e0b]",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between py-2 text-sm",
        className
      )}
    >
      <span className="text-[var(--modal-muted)]">{label}</span>
      <span
        className={cn("font-mono font-semibold", colorClasses[valueColor])}
      >
        {value}
      </span>
    </div>
  );
}

export interface ResultItemProps {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  asButton?: boolean;
}

export function ResultItem({
  selected,
  onClick,
  children,
  className,
  asButton = false,
}: ResultItemProps) {
  const baseClasses = cn(
    "w-full text-left p-3 rounded-lg transition-all",
    "border hover:border-slate-600",
    selected
      ? "border-[var(--modal-accent)] bg-[var(--modal-accent)]/10"
      : "border-slate-700 bg-slate-800/40 hover:bg-slate-800/60",
    className
  );

  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={baseClasses}>
        {children}
      </button>
    );
  }

  return (
    <div className={baseClasses}>
      {children}
    </div>
  );
}

export interface RemainingBarProps {
  remaining: number;
  total: number;
  className?: string;
}

export function RemainingBar({ remaining, total, className }: RemainingBarProps) {
  const isComplete = Math.abs(remaining) < 0.01;
  const percentage = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--modal-muted)]">Progress</span>
        <span
          className={cn(
            "font-mono font-semibold",
            isComplete ? "text-[var(--modal-success)]" : "text-[var(--modal-danger)]"
          )}
        >
          {isComplete ? "Complete" : `₹${remaining.toFixed(2)} remaining`}
        </span>
      </div>
      <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-300",
            isComplete ? "bg-[var(--modal-success)]" : "bg-[var(--modal-accent)]"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export interface KeepOriginalToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}

export function KeepOriginalToggle({
  value,
  onChange,
  className,
}: KeepOriginalToggleProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg",
        "bg-slate-900/70 border border-slate-800",
        className
      )}
    >
      <input
        type="checkbox"
        id="keep-original"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-800/60 text-[var(--modal-accent)] focus:ring-2 focus:ring-[var(--modal-accent)] focus:ring-offset-0"
      />
      <div className="flex-1">
        <label
          htmlFor="keep-original"
          className="text-sm font-medium text-[var(--modal-text)] cursor-pointer block"
        >
          Keep original transaction
        </label>
        <p className="text-xs text-[var(--modal-muted)] mt-1">
          {value
            ? "Original will be marked as split. You can restore it by removing the split group."
            : "⚠️ Original will be deleted. Only split parts will remain. You cannot restore the original later."}
        </p>
      </div>
    </div>
  );
}

