/**
 * Utility functions for formatting that are safe for SSR/hydration
 */

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
    const { format } = require('date-fns');
    return format(date, "MMM dd, yyyy");
  } catch (error) {
    return dateString; // Return original string if parsing fails
  }
}
