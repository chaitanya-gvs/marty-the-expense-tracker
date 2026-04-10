"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Transaction, EmailMetadata, EmailDetails, EmailSearchFilters } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { EmailCard } from "./email-card";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, Mail, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { format, addDays, subDays } from "date-fns";
import { formatCurrency, formatDate } from "@/lib/format-utils";

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Search filter state
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

  // ── Auto-search on open ──────────────────────────────────────────
  const handleAutoSearch = useCallback(async () => {
    setIsAutoSearch(true);
    setIsSearching(true);
    setHasSearched(true);

    try {
      const rawDescription = (transaction.original_description || transaction.description)?.toLowerCase() || "";
      const isUPI = rawDescription.includes("upi");

      const filters: EmailSearchFilters = {
        date_offset_days: 1,
        include_amount_filter: true,
      };

      const isSwiggy = rawDescription.includes("swiggy") || rawDescription.includes("instamart") || rawDescription.includes("pyu*swiggy") || rawDescription.includes("pyu*instamart");

      if (isUPI) {
        // UPI: Search for Uber trip emails by keyword + same-day date only.
        // Amount filter is intentionally disabled: Uber emails show the exact decimal fare
        // (e.g. ₹197.72) while the bank debit is the ceiling (₹198). Gmail quoted-exact
        // search cannot match a decimal by its integer prefix, so keyword + date is more
        // reliable and sufficiently precise (one Uber trip per day is the common case).
        filters.custom_search_term = "uber";
        filters.include_amount_filter = false;
        filters.date_offset_days = 0; // Same calendar day only; backend treats offset=0 as [date, date+1)
        filters.verify_body_amount = true; // Post-filter: keep only emails where ceil(fare) ∈ [bank-1, bank+5]
      } else if (isSwiggy) {
        // Swiggy/Instamart: order confirmation emails don't contain the exact bank debit amount.
        // Search by keyword (swiggy OR instamart) within a 1-day window instead.
        filters.custom_search_term = "swiggy OR instamart";
        filters.include_amount_filter = false;
        filters.date_offset_days = 1;
      }

      const response = await apiClient.searchTransactionEmails(transaction.id, filters);
      setSearchResults(response.data);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [transaction.id, transaction.description, transaction.amount]);

  // ── Fetch linked emails ──────────────────────────────────────────
  const fetchLinkedEmails = useCallback(async () => {
    if (!transaction.related_mails || transaction.related_mails.length === 0) {
      setLinkedEmails([]);
      return;
    }

    setIsLoadingLinkedEmails(true);
    try {
      const emailPromises = transaction.related_mails.map(async (messageId) => {
        try {
          const response = await apiClient.getEmailDetails(transaction.id, messageId);
          const { id, subject, sender, date, snippet } = response.data;
          return { id, subject, sender, date, snippet } as EmailMetadata;
        } catch {
          return null;
        }
      });
      const emails = await Promise.all(emailPromises);
      setLinkedEmails(emails.filter((e): e is EmailMetadata => e !== null));
    } catch {
      toast.error("Failed to load linked emails");
    } finally {
      setIsLoadingLinkedEmails(false);
    }
  }, [transaction.id, transaction.related_mails]);

  useEffect(() => {
    if (isOpen && transaction.related_mails && transaction.related_mails.length > 0) {
      fetchLinkedEmails();
    } else if (!isOpen) {
      setLinkedEmails([]);
    }
  }, [isOpen, transaction.related_mails, fetchLinkedEmails]);

  useEffect(() => {
    if (!isOpen) {
      setSearchResults([]);
      setHasSearched(false);
      setIsAutoSearch(false);
      setIsSearching(false);
      setShowAdvanced(false);
      setCustomSearchTerm("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !hasSearched) {
      const hasNoLinks = !transaction.related_mails || transaction.related_mails.length === 0;
      if (hasNoLinks) {
        const timer = setTimeout(() => handleAutoSearch(), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, hasSearched, transaction.related_mails, handleAutoSearch]);

  // ── Manual search ────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setIsAutoSearch(false);
    setIsSearching(true);
    setHasSearched(true);

    try {
      const filters: EmailSearchFilters = { include_amount_filter: includeAmountFilter };

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
      }
    } catch {
      toast.error("Failed to search emails");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [
    includeAmountFilter, useCustomDates, customStartDate, customEndDate,
    dateOffsetDays, customSearchTerm, transaction.id,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isSearching) handleSearch();
  };

  // ── Link / Unlink — card moves between sections ──────────────────
  const handleFetchEmailDetails = async (messageId: string): Promise<EmailDetails> => {
    const response = await apiClient.getEmailDetails(transaction.id, messageId);
    return response.data;
  };

  const handleLinkEmail = async (messageId: string) => {
    const emailToLink = searchResults.find((e) => e.id === messageId);
    try {
      const response = await apiClient.linkEmailToTransaction(transaction.id, messageId);
      onTransactionUpdate(response.data);
      toast.success("Email linked successfully");

      // Optimistically move card: results → linked
      if (emailToLink) {
        setLinkedEmails((prev) => [emailToLink, ...prev]);
        setSearchResults((prev) => prev.filter((e) => e.id !== messageId));
      } else {
        await fetchLinkedEmails();
      }
    } catch (err) {
      toast.error("Failed to link email");
      throw err;
    }
  };

  const handleUnlinkEmail = async (messageId: string) => {
    try {
      const response = await apiClient.unlinkEmailFromTransaction(transaction.id, messageId);
      onTransactionUpdate(response.data);
      toast.success("Email unlinked successfully");
      // Remove from linked section (card animates out)
      setLinkedEmails((prev) => prev.filter((e) => e.id !== messageId));
    } catch (err) {
      toast.error("Failed to unlink email");
      throw err;
    }
  };

  const isEmailLinked = (messageId: string) =>
    transaction.related_mails?.includes(messageId) || false;

  const accountDisplay = transaction.account
    ? transaction.account.split(" ").slice(0, -2).join(" ") || transaction.account
    : null;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Mail className="h-4 w-4" />}
        title="Email Links"
        subtitle={[transaction.description, formatDate(transaction.date), accountDisplay]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
        variant="link-parent"
      />

      <Modal.Body className="scrollbar-none space-y-6">
        {/* ── Zone 1: Linked Emails ─────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Linked{linkedEmails.length > 0 && ` (${linkedEmails.length})`}
          </p>

          {isLoadingLinkedEmails ? (
            <div className="flex items-center gap-2 px-3 py-4 rounded-lg bg-muted/20">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40 flex-shrink-0" />
              <p className="text-sm text-muted-foreground/60">Loading linked emails…</p>
            </div>
          ) : linkedEmails.length > 0 ? (
            <AnimatePresence mode="popLayout" initial={false}>
              {linkedEmails.map((email) => (
                <motion.div
                  key={email.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="mb-3 last:mb-0"
                >
                  <EmailCard
                    email={email}
                    isLinked={true}
                    onLink={handleLinkEmail}
                    onUnlink={handleUnlinkEmail}
                    onFetchDetails={handleFetchEmailDetails}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-4 rounded-lg bg-muted/20 border border-dashed border-border/60">
              <Mail className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
              <p className="text-sm text-muted-foreground/60">
                No emails linked yet · Search below to find related emails
              </p>
            </div>
          )}
        </div>

        {/* ── Zone 2: Search ────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Search & Link
          </p>

          {/* Search bar */}
          <div className="relative flex items-center">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by keyword, merchant name…"
              value={customSearchTerm}
              onChange={(e) => setCustomSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9 pr-24 h-10 bg-muted/50 border-border/50"
            />
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={isSearching}
              className="absolute right-1.5 h-7 text-xs px-3"
            >
              {isSearching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-2.5"
          >
            <SlidersHorizontal className="h-3 w-3" />
            {showAdvanced ? "Hide filters" : "Advanced filters"}
          </button>

          {/* Advanced filter panel */}
          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div
                key="advanced"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 40 }}
                style={{ overflow: "hidden" }}
              >
                <div className="space-y-3 pt-4 pb-1 border-t border-border/40 mt-3">
                  {/* Date range row */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="custom-dates"
                        checked={useCustomDates}
                        onCheckedChange={setUseCustomDates}
                        className="data-[state=checked]:bg-primary"
                      />
                      <Label htmlFor="custom-dates" className="text-sm cursor-pointer">
                        Custom date range
                      </Label>
                    </div>
                    {!useCustomDates && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">±</span>
                        <Input
                          type="number"
                          min="0"
                          max="30"
                          value={dateOffsetDays}
                          onChange={(e) =>
                            setDateOffsetDays(parseInt(e.target.value) || 1)
                          }
                          className="w-14 h-8 text-xs text-center"
                        />
                        <span className="text-xs text-muted-foreground">days</span>
                      </div>
                    )}
                  </div>

                  {/* Custom date inputs */}
                  <AnimatePresence initial={false}>
                    {useCustomDates && (
                      <motion.div
                        key="custom-dates"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 40 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div>
                            <Label
                              htmlFor="start-date"
                              className="text-xs text-muted-foreground mb-1 block"
                            >
                              Start Date
                            </Label>
                            <Input
                              id="start-date"
                              type="date"
                              value={customStartDate}
                              onChange={(e) => setCustomStartDate(e.target.value)}
                              className="h-9 text-sm"
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor="end-date"
                              className="text-xs text-muted-foreground mb-1 block"
                            >
                              End Date
                            </Label>
                            <Input
                              id="end-date"
                              type="date"
                              value={customEndDate}
                              onChange={(e) => setCustomEndDate(e.target.value)}
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Amount filter */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id="amount-filter"
                      checked={includeAmountFilter}
                      onCheckedChange={setIncludeAmountFilter}
                      className="data-[state=checked]:bg-primary"
                    />
                    <Label htmlFor="amount-filter" className="text-sm cursor-pointer">
                      Filter by amount ({formatCurrency(Math.abs(transaction.amount))})
                    </Label>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Search Results ──────────────────────────────────────── */}
          {hasSearched && (
            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {isAutoSearch ? "Suggested" : "Results"}
                {searchResults.length > 0 && ` (${searchResults.length})`}
              </p>

              {isSearching ? (
                <div className="flex items-center gap-2 px-3 py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground/60">Searching…</p>
                </div>
              ) : searchResults.length > 0 ? (
                <AnimatePresence mode="popLayout" initial={false}>
                  {searchResults.map((email) => (
                    <motion.div
                      key={email.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -16, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mb-3 last:mb-0"
                    >
                      <EmailCard
                        email={email}
                        isLinked={isEmailLinked(email.id)}
                        onLink={handleLinkEmail}
                        onUnlink={handleUnlinkEmail}
                        onFetchDetails={handleFetchEmailDetails}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                <div className="flex items-center gap-2.5 px-3 py-4 rounded-lg bg-muted/20 border border-dashed border-border/60">
                  <Search className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground/60">
                    No emails found · Try adjusting your filters
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
