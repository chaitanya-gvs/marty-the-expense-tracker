/**
 * Utility functions for formatting that are safe for SSR/hydration
 */
import { format } from "date-fns";

/**
 * Safely format a number with locale-specific formatting
 * Returns a fallback string during SSR to prevent hydration mismatches
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '₹0';
  
  // During SSR or if window is not available, use a simple format
  if (typeof window === 'undefined') {
    const formatted = amount.toFixed(2);
    // Trim trailing zeros
    return `₹${formatted.replace(/\.?0+$/, '')}`;
  }
  
  // On client side, use locale formatting and trim trailing zeros
  const formatted = amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  return `₹${formatted}`;
}

/**
 * Compact Indian-numbering currency format for tight spaces (e.g. mobile stat bars).
 * ₹999 stays as-is; ₹1,000–₹99,999 → ₹1.2K; ₹1,00,000+ → ₹6.9L; ₹1,00,00,000+ → ₹2.3Cr.
 * SSR-safe: no locale APIs, pure arithmetic + string formatting.
 */
export function formatCurrencyCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '₹0';

  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (abs < 1000) {
    return `${sign}₹${Math.round(abs)}`;
  }
  if (abs < 100000) {
    // thousands: 1.2K
    const val = abs / 1000;
    return `${sign}₹${trimTrailingZero(val)}K`;
  }
  if (abs < 10000000) {
    // lakhs: 6.9L
    const val = abs / 100000;
    return `${sign}₹${trimTrailingZero(val)}L`;
  }
  // crores: 2.3Cr
  const val = abs / 10000000;
  return `${sign}₹${trimTrailingZero(val)}Cr`;
}

function trimTrailingZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/**
 * Safely format a date
 * Uses a consistent format during SSR to prevent hydration mismatches
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    
    // During SSR or if window is not available, use a simple format
    if (typeof window === 'undefined') {
      return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
    
    // On client side, use date-fns for better formatting
    return format(date, "MMM dd, yyyy");
  } catch {
    return dateString; // Return original string if parsing fails
  }
}
