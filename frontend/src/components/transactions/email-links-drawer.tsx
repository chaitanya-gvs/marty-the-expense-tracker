"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Transaction, EmailMetadata, EmailDetails, EmailSearchFilters } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { EmailCard } from "./email-card";
import { cn } from "@/lib/utils";
import { Search, Loader2, Mail, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format, addDays, subDays } from "date-fns";

interface EmailLinksDrawerProps {
  transaction: Transaction;
  isOpen: boolean;
  onClose: () => void;
  onTransactionUpdate: (transaction: Transaction) => void;
}

export function EmailLinksDrawer({
  transaction,
  isOpen,
  onClose,
  onTransactionUpdate,
}: EmailLinksDrawerProps) {
  const [searchResults, setSearchResults] = useState<EmailMetadata[]>([]);
  const [linkedEmails, setLinkedEmails] = useState<EmailMetadata[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingLinkedEmails, setIsLoadingLinkedEmails] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isAutoSearch, setIsAutoSearch] = useState(false);

  // Search filters state
  const transactionDate = new Date(transaction.date);
  const [dateOffsetDays, setDateOffsetDays] = useState(1);
  const [includeAmountFilter, setIncludeAmountFilter] = useState(true);
  const [customStartDate, setCustomStartDate] = useState(
    format(subDays(transactionDate, 1), "yyyy-MM-dd")
  );
  const [customEndDate, setCustomEndDate] = useState(
    format(addDays(transactionDate, 1), "yyyy-MM-dd")
  );
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [customSearchTerm, setCustomSearchTerm] = useState("");

  // Helper function to extract merchant name from UPI description
  const extractMerchantFromUPI = (description: string): string | null => {
    // Common UPI transaction patterns:
    // "UPI/merchant_name@paytm"
    // "UPI-merchant-name-123456"
    // "merchant_name UPI"
    // "UPI merchant_name"
    
    const lowerDesc = description.toLowerCase();
    
    // Try to extract merchant name after UPI/
    const upiMatch = description.match(/upi[\/-]([a-z0-9]+)/i);
    if (upiMatch && upiMatch[1]) {
      return upiMatch[1];
    }
    
    // Try to extract merchant before/after UPI keyword
    const parts = description.split(/upi/i);
    if (parts.length > 1) {
      // Check part before UPI
      if (parts[0].trim().length > 0 && parts[0].trim().length < 30) {
        return parts[0].trim().toLowerCase();
      }
      // Check part after UPI
      if (parts[1].trim().length > 0 && parts[1].trim().length < 30) {
        const afterUPI = parts[1].trim().split(/[@\s\-]/)[0];
        if (afterUPI.length > 0 && afterUPI.length < 30) {
          return afterUPI.toLowerCase();
        }
      }
    }
    
    // Common merchants in UPI transactions - check if mentioned
    const commonMerchants = ['uber', 'ola', 'swiggy', 'zomato', 'amazon', 'flipkart', 'bigbasket'];
    for (const merchant of commonMerchants) {
      if (lowerDesc.includes(merchant)) {
        return merchant;
      }
    }
    
    return null;
  };

  // Define handleAutoSearch before useEffect hooks that use it
  const handleAutoSearch = useCallback(async () => {
    setIsAutoSearch(true);
    setIsSearching(true);
    setHasSearched(true);

    try {
      const description = transaction.description?.toLowerCase() || "";
      const isSwiggy = description.includes("swiggy");
      const isUPI = description.includes("upi");
      
      const filters: EmailSearchFilters = {
        date_offset_days: 1, // Default to ±1 day for all
        include_amount_filter: true, // Default to enabled
      };

      if (isSwiggy) {
        // Swiggy: Search with exact amount
        filters.include_amount_filter = true;
        // Amount filter is already exact, so just enable it
      } else if (isUPI) {
        // UPI: Always search for Uber emails + exact amount + amount-1
        // Use the exact transaction amount as that's what appears in emails
        // Also search for amount-1 because original might have been ₹101.56 and paid ₹102
        // Always search for "uber" for UPI transactions
        // (Many UPI transactions are Uber rides, and we want to show them in suggestions)
        filters.custom_search_term = "uber";
        
        // Use exact amount for search (not rounded)
        filters.include_amount_filter = true; // Enable amount filter with exact amount
        filters.also_search_amount_minus_one = true; // Also search for amount-1 (for rounding scenarios)
      } else {
        // Default: Use exact amount with amount filter
        filters.include_amount_filter = true;
      }

      const response = await apiClient.searchTransactionEmails(transaction.id, filters);
      setSearchResults(response.data);
      
      // Don't show toast for auto-search to avoid noise
    } catch (error) {
      console.error("Failed to auto-search emails:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [transaction.id, transaction.description, transaction.amount]);

  const fetchLinkedEmails = async () => {
    if (!transaction.related_mails || transaction.related_mails.length === 0) {
      setLinkedEmails([]);
      return;
    }

    setIsLoadingLinkedEmails(true);
    try {
      // Fetch details for each linked email
      // Note: related_mails is an array of message IDs (strings)
      const emailPromises = transaction.related_mails.map(async (messageId) => {
        try {
          const response = await apiClient.getEmailDetails(transaction.id, messageId);
          // Return just the metadata part for the list
          const { id, subject, sender, date, snippet } = response.data;
          return { id, subject, sender, date, snippet };
        } catch (error) {
          console.error(`Failed to fetch email ${messageId}:`, error);
          return null;
        }
      });

      const emails = await Promise.all(emailPromises);
      setLinkedEmails(emails.filter((e): e is EmailMetadata => e !== null));
    } catch (error) {
      console.error("Failed to fetch linked emails:", error);
      toast.error("Failed to load linked emails");
    } finally {
      setIsLoadingLinkedEmails(false);
    }
  };

  // Fetch linked emails when drawer opens
  useEffect(() => {
    if (isOpen && transaction.related_mails && transaction.related_mails.length > 0) {
      fetchLinkedEmails();
    } else {
      setLinkedEmails([]);
    }
  }, [isOpen, transaction.related_mails]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setSearchResults([]);
      setHasSearched(false);
      setIsAutoSearch(false);
      setIsSearching(false);
    }
  }, [isOpen]);

  // Auto-search for suggested emails when drawer opens (if no linked emails)
  useEffect(() => {
    if (isOpen && !hasSearched) {
      // Only auto-search if transaction has no linked emails yet
      const hasNoLinks = !transaction.related_mails || transaction.related_mails.length === 0;
      if (hasNoLinks) {
        // Auto-search with default filters after a short delay
        const timer = setTimeout(() => {
          handleAutoSearch();
        }, 300); // Small delay to let drawer open smoothly
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, hasSearched, transaction.related_mails, handleAutoSearch]);

  const handleSearch = async () => {
    setIsAutoSearch(false); // Manual search, not auto
    setIsSearching(true);
    setHasSearched(true);

    try {
      const filters: EmailSearchFilters = {
        include_amount_filter: includeAmountFilter,
      };

      if (useCustomDates) {
        filters.start_date = customStartDate;
        filters.end_date = customEndDate;
      } else {
        filters.date_offset_days = dateOffsetDays;
      }

      if (customSearchTerm.trim()) {
        filters.custom_search_term = customSearchTerm.trim();
      }

      const response = await apiClient.searchTransactionEmails(transaction.id, filters);
      setSearchResults(response.data);
      
      if (response.data.length === 0) {
        toast.info("No emails found matching the criteria");
      } else {
        toast.success(`Found ${response.data.length} emails`);
      }
    } catch (error) {
      console.error("Failed to search emails:", error);
      toast.error("Failed to search emails");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleFetchEmailDetails = async (messageId: string): Promise<EmailDetails> => {
    const response = await apiClient.getEmailDetails(transaction.id, messageId);
    return response.data;
  };

  const handleLinkEmail = async (messageId: string) => {
    try {
      const response = await apiClient.linkEmailToTransaction(transaction.id, messageId);
      onTransactionUpdate(response.data);
      toast.success("Email linked successfully");
      
      // Refresh linked emails
      await fetchLinkedEmails();
    } catch (error) {
      console.error("Failed to link email:", error);
      toast.error("Failed to link email");
      throw error;
    }
  };

  const handleUnlinkEmail = async (messageId: string) => {
    try {
      const response = await apiClient.unlinkEmailFromTransaction(transaction.id, messageId);
      onTransactionUpdate(response.data);
      toast.success("Email unlinked successfully");
      
      // Refresh linked emails
      await fetchLinkedEmails();
      
      // Also refresh search results to update link status
      if (hasSearched) {
        // Don't show loading state, just refresh in background
        const filters: EmailSearchFilters = {
          include_amount_filter: includeAmountFilter,
        };
        if (useCustomDates) {
          filters.start_date = customStartDate;
          filters.end_date = customEndDate;
        } else {
          filters.date_offset_days = dateOffsetDays;
        }
        const response = await apiClient.searchTransactionEmails(transaction.id, filters);
        setSearchResults(response.data);
      }
    } catch (error) {
      console.error("Failed to unlink email:", error);
      toast.error("Failed to unlink email");
      throw error;
    }
  };

  const isEmailLinked = (messageId: string): boolean => {
    return transaction.related_mails?.includes(messageId) || false;
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Email Links</SheetTitle>
          <SheetDescription>
            Search and link emails related to this transaction
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Transaction Info */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
            <div className="text-sm font-medium">Transaction Details</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <div className="flex justify-between">
                <span>Description:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {transaction.description}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Amount:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  ₹{transaction.amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {format(new Date(transaction.date), "MMM dd, yyyy")}
                </span>
              </div>
            </div>
          </div>

          {/* Linked Emails Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Linked Emails
                {linkedEmails.length > 0 && (
                  <Badge variant="secondary">{linkedEmails.length}</Badge>
                )}
              </h3>
            </div>

            {isLoadingLinkedEmails ? (
              <div className="flex items-center justify-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading linked emails...</span>
              </div>
            ) : linkedEmails.length > 0 ? (
              <div className="space-y-3">
                {linkedEmails.map((email) => (
                  <EmailCard
                    key={email.id}
                    email={email}
                    isLinked={true}
                    onLink={handleLinkEmail}
                    onUnlink={handleUnlinkEmail}
                    onFetchDetails={handleFetchEmailDetails}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Mail className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500">No emails linked yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Use the search below to find and link related emails
                </p>
              </div>
            )}
          </div>

          {/* Search Section */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search & Link Emails
            </h3>

            <div className="space-y-4">
              {/* Date Range Controls */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="custom-dates"
                    checked={useCustomDates}
                    onCheckedChange={setUseCustomDates}
                  />
                  <Label htmlFor="custom-dates" className="text-sm">
                    Use custom date range
                  </Label>
                </div>

                {useCustomDates ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="start-date" className="text-xs">
                        Start Date
                      </Label>
                      <Input
                        id="start-date"
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="end-date" className="text-xs">
                        End Date
                      </Label>
                      <Input
                        id="end-date"
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="date-offset" className="text-xs">
                      Days before/after transaction (±{dateOffsetDays} days)
                    </Label>
                    <Input
                      id="date-offset"
                      type="number"
                      min="0"
                      max="30"
                      value={dateOffsetDays}
                      onChange={(e) => setDateOffsetDays(parseInt(e.target.value) || 1)}
                      className="text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Amount Filter Toggle */}
              <div className="flex items-center space-x-2">
                <Switch
                  id="amount-filter"
                  checked={includeAmountFilter}
                  onCheckedChange={setIncludeAmountFilter}
                />
                <Label htmlFor="amount-filter" className="text-sm">
                  Filter by amount (₹{transaction.amount.toFixed(2)})
                </Label>
              </div>

              {/* Custom Search Term */}
              <div className="space-y-2">
                <Label htmlFor="custom-search" className="text-sm font-medium">
                  Custom Search Term (Optional)
                </Label>
                <Input
                  id="custom-search"
                  type="text"
                  placeholder="e.g., Uber, Ola, Swiggy, Amazon..."
                  value={customSearchTerm}
                  onChange={(e) => setCustomSearchTerm(e.target.value)}
                  className="text-sm"
                />
                <p className="text-xs text-gray-500">
                  Search for specific keywords in email subject or content. This will override amount filtering.
                </p>
              </div>

              {/* Search Button */}
              <Button
                onClick={handleSearch}
                disabled={isSearching}
                className="w-full"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search Emails
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Search Results / Suggested Emails */}
          {hasSearched && (
            <div className="border-t pt-6">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                {isAutoSearch ? (
                  <>
                    <Mail className="h-4 w-4" />
                    Suggested Emails
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Search Results
                  </>
                )}
                {searchResults.length > 0 && (
                  <Badge variant="secondary">{searchResults.length}</Badge>
                )}
              </h3>
              {isAutoSearch && (
                <p className="text-xs text-gray-500 mb-3">
                  We found these emails that might be related to this transaction. You can refine your search using the filters above.
                </p>
              )}

              {searchResults.length > 0 ? (
                <div className="space-y-3">
                  {searchResults.map((email) => (
                    <EmailCard
                      key={email.id}
                      email={email}
                      isLinked={isEmailLinked(email.id)}
                      onLink={handleLinkEmail}
                      onUnlink={handleUnlinkEmail}
                      onFetchDetails={handleFetchEmailDetails}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <AlertCircle className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-sm text-gray-500">No emails found</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try adjusting your search filters
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

