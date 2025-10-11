"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Transaction } from "@/lib/types";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Search, Link, Unlink, X } from "lucide-react";

interface RefundPopoverProps {
  transaction: Transaction;
  parentTransaction?: Transaction;
  isOpen: boolean;
  onClose: () => void;
  onLink: (parentId: string) => void;
  onUnlink: () => void;
}

interface RefundSuggestion {
  id: string;
  description: string;
  date: string;
  amount: number;
  account: string;
  confidence: number;
  reason: string;
}

export function RefundPopover({
  transaction,
  parentTransaction,
  isOpen,
  onClose,
  onLink,
  onUnlink,
}: RefundPopoverProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<RefundSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<RefundSuggestion[]>([]);

  // Load suggestions when popover opens
  useEffect(() => {
    if (isOpen && !parentTransaction) {
      loadSuggestions();
    }
  }, [isOpen, parentTransaction]);

  const loadSuggestions = async () => {
    setIsLoading(true);
    try {
      // This would call a new API endpoint for refund suggestions
      // For now, we'll simulate with existing search functionality
      const response = await apiClient.searchTransactions(
        `debit ${Math.abs(transaction.amount)}`,
        5,
        0
      );
      
      // Filter and format suggestions
      const formattedSuggestions: RefundSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id &&
          Math.abs(Math.abs(t.amount) - Math.abs(transaction.amount)) < Math.abs(transaction.amount) * 0.1 // 10% tolerance
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '), // Remove last 2 words
          confidence: 0.8, // Placeholder confidence
          reason: "Similar amount and opposite direction"
        }))
        .slice(0, 5);

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to load refund suggestions:", error);
      toast.error("Failed to load suggestions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    try {
      const response = await apiClient.searchTransactions(searchQuery, 10, 0);
      
      const formattedResults: RefundSuggestion[] = response.data
        .filter((t: Transaction) => 
          t.direction === "debit" && 
          t.id !== transaction.id
        )
        .map((t: Transaction) => ({
          id: t.id,
          description: t.description,
          date: t.date,
          amount: t.amount,
          account: t.account.split(' ').slice(0, -2).join(' '),
          confidence: 0.6,
          reason: "Search result"
        }));

      setSearchResults(formattedResults);
    } catch (error) {
      console.error("Failed to search transactions:", error);
      toast.error("Failed to search transactions");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLink = async (parentId: string) => {
    try {
      await apiClient.linkRefund(transaction.id, parentId);
      onLink(parentId);
      onClose();
      toast.success("Refund linked successfully", {
        action: {
          label: "Undo",
          onClick: () => handleUnlink(),
        },
      });
    } catch (error) {
      console.error("Failed to link refund:", error);
      toast.error("Failed to link refund");
    }
  };

  const handleUnlink = async () => {
    try {
      // Update transaction to remove link_parent_id
      await apiClient.updateTransaction(transaction.id, {
        link_parent_id: undefined,
        is_refund: false,
      });
      onUnlink();
      onClose();
      toast.success("Refund unlinked successfully", {
        action: {
          label: "Undo",
          onClick: () => handleLink(transaction.link_parent_id!),
        },
      });
    } catch (error) {
      console.error("Failed to unlink refund:", error);
      toast.error("Failed to unlink refund");
    }
  };

  const displaySuggestions = searchQuery.trim() ? searchResults : suggestions;

  return (
    <Popover open={isOpen} onOpenChange={onClose}>
      <PopoverTrigger asChild>
        <div />
      </PopoverTrigger>
      <PopoverContent 
        className="w-[360px] p-3 rounded-xl bg-slate-900 shadow-lg border border-slate-800"
        align="start"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Link to parent purchase</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {parentTransaction ? (
            // Show parent summary if already linked
            <div className="space-y-3">
              <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                <div className="text-sm font-medium text-white mb-2">Current parent:</div>
                <div className="space-y-1 text-sm">
                  <div className="text-slate-300">
                    <span className="font-medium">{parentTransaction.description}</span>
                  </div>
                  <div className="text-slate-400">
                    {formatDate(parentTransaction.date)} · {formatCurrency(Math.abs(parentTransaction.amount))} · {parentTransaction.account.split(' ').slice(0, -2).join(' ')}
                  </div>
                </div>
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                className="w-full border-red-500 text-red-400 hover:bg-red-500/10"
              >
                <Unlink className="h-4 w-4 mr-2" />
                Unlink refund
              </Button>
            </div>
          ) : (
            // Show linking interface
            <div className="space-y-3">
              {/* Search input */}
              <div className="flex gap-2">
                <Input
                  placeholder="Search for parent transaction..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-400"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSearch}
                  disabled={isLoading || !searchQuery.trim()}
                  className="border-slate-700 text-slate-300 hover:bg-slate-700"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>

              {/* Suggestions */}
              {isLoading ? (
                <div className="text-center py-4 text-slate-400 text-sm">
                  Loading suggestions...
                </div>
              ) : displaySuggestions.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {displaySuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="p-2 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700 cursor-pointer"
                      onClick={() => handleLink(suggestion.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {suggestion.description}
                          </div>
                          <div className="text-xs text-slate-400">
                            {formatDate(suggestion.date)} · {formatCurrency(Math.abs(suggestion.amount))} · {suggestion.account}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 h-8 px-2 text-emerald-400 hover:text-emerald-300"
                        >
                          <Link className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-slate-400 text-sm">
                  {searchQuery.trim() ? "No transactions found" : "No suggestions available"}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


