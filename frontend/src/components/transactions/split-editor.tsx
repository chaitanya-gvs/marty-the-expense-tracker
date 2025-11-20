"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Minus, Users, Calculator } from "lucide-react";
import { Transaction, SplitBreakdown, SplitEntry } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { ParticipantMultiSelect } from "./participant-multi-select";

interface SplitEditorProps {
  transaction: Transaction;
  isOpen: boolean;
  isLoading?: boolean;
  onClose: () => void;
  onSave: (splitBreakdown: SplitBreakdown, myShareAmount: number) => void;
  onClearSplit?: () => void;
}

export function SplitEditor({ transaction, isOpen, isLoading = false, onClose, onSave, onClearSplit }: SplitEditorProps) {
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [includeMe, setIncludeMe] = useState(true);
  const [entries, setEntries] = useState<SplitEntry[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [paidBy, setPaidBy] = useState<string>("me");

  // Initialize entries when transaction changes
  useEffect(() => {
    if (transaction.split_breakdown) {
      setMode(transaction.split_breakdown.mode);
      setIncludeMe(transaction.split_breakdown.include_me);
      setEntries(transaction.split_breakdown.entries);
      setPaidBy(transaction.split_breakdown.paid_by || "me");
      // Initialize selected participants (exclude "me")
      const participantNames = transaction.split_breakdown.entries
        .filter(e => e.participant !== "me")
        .map(e => e.participant);
      setSelectedParticipants(participantNames);
    } else {
      // Default initialization
      setMode("equal");
      setIncludeMe(true);
      setEntries([{ participant: "me", amount: null }]);
      setPaidBy(transaction.paid_by || "me");
      setSelectedParticipants([]);
    }
  }, [transaction]);

  // Handle includeMe toggle - add/remove "me" from participants
  useEffect(() => {
    setEntries(currentEntries => {
      if (includeMe) {
        // Add "me" if not already present
        const hasMe = currentEntries.some(entry => entry.participant === "me");
        if (!hasMe) {
          const amount = mode === "custom" ? 0 : null;
          return [{ participant: "me", amount }, ...currentEntries];
        }
        return currentEntries;
      } else {
        // Remove "me" from participants
        return currentEntries.filter(entry => entry.participant !== "me");
      }
    });
  }, [includeMe, mode]);

  const addParticipants = (participantNames: string[]) => {
    setEntries(currentEntries => {
      // Keep "me" entry if includeMe is true
      const meEntry = currentEntries.find(e => e.participant === "me");
      const keepMe = includeMe && meEntry ? [meEntry] : [];
      
      // Keep existing entries that are still selected
      const existingEntries = currentEntries.filter(
        e => e.participant !== "me" && participantNames.includes(e.participant)
      );
      
      // Add new participants that aren't already in entries
      const newParticipantNames = participantNames.filter(
        name => !currentEntries.some(e => e.participant === name)
      );
      
      const newEntries = newParticipantNames.map(name => ({
        participant: name,
        amount: mode === "custom" ? 0 : null,
      }));
      
      // Combine all entries: me first (if included), then existing, then new
      return [...keepMe, ...existingEntries, ...newEntries];
    });
  };

  const removeParticipant = (index: number) => {
    const removedEntry = entries[index];
    setEntries(entries.filter((_, i) => i !== index));
    // Also remove from selectedParticipants if it's not "me"
    if (removedEntry.participant !== "me") {
      setSelectedParticipants(selectedParticipants.filter(p => p !== removedEntry.participant));
    }
  };

  const updateParticipantAmount = (index: number, amount: number | null) => {
    const newEntries = [...entries];
    newEntries[index].amount = amount;
    setEntries(newEntries);
  };

  const calculateEqualSplit = () => {
    if (mode === "equal" && entries.length > 0) {
      const totalAmount = transaction.amount;
      const splitAmount = totalAmount / entries.length;
      return splitAmount;
    }
    return 0;
  };

  const calculateCustomTotal = () => {
    return entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  };

  const getRemainingAmount = () => {
    if (mode === "equal") {
      return 0; // Equal split always balances
    }
    return transaction.amount - calculateCustomTotal();
  };

  const isBalanced = () => {
    if (mode === "equal") {
      return entries.length > 0;
    }
    return Math.abs(getRemainingAmount()) < 0.01; // Allow for small rounding differences
  };

  const calculateMyShare = () => {
    if (!includeMe) {
      return 0; // If not included, my share is 0
    }

    if (mode === "equal") {
      // Equal split: total amount divided by number of participants
      return transaction.amount / entries.length;
    } else {
      // Custom split: find my specific amount
      const myEntry = entries.find(entry => entry.participant === "me");
      return myEntry?.amount || 0;
    }
  };

  const handleSave = () => {
    if (!isBalanced()) {
      return;
    }

    const splitBreakdown: SplitBreakdown = {
      mode,
      include_me: includeMe,
      entries: entries.map(entry => ({
        participant: entry.participant,
        amount: mode === "equal" ? null : entry.amount,
        paid_share: entry.paid_share,
        net_balance: entry.net_balance
      })),
      paid_by: paidBy,
      total_participants: entries.length
    };

    // Calculate my share amount
    const myShareAmount = calculateMyShare();

    onSave(splitBreakdown, myShareAmount);
    onClose();
  };

  const handleModeChange = (newMode: "equal" | "custom") => {
    setMode(newMode);
    // Update amounts based on new mode
    setEntries(entries.map(entry => ({
      participant: entry.participant,
      amount: newMode === "equal" ? null : (entry.amount || 0)
    })));
  };

  const [dialogContainer, setDialogContainer] = React.useState<HTMLDivElement | null>(null);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <div ref={setDialogContainer} className="contents">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Share Expenses
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Transaction Summary */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium text-sm">{transaction.description}</p>
                <p className="text-xs text-gray-500">{transaction.date}</p>
              </div>
              <Badge variant="outline" className="text-lg font-semibold">
                {formatCurrency(transaction.amount)}
              </Badge>
            </div>
          </div>

          {/* Split Mode Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Split Mode</Label>
            <RadioGroup value={mode} onValueChange={handleModeChange} className="flex gap-6">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="equal" id="equal" />
                <Label htmlFor="equal" className="flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Equal Split
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="custom" />
                <Label htmlFor="custom" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Custom Amounts
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Include Me Toggle */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="includeMe"
              checked={includeMe}
              onChange={(e) => setIncludeMe(e.target.checked)}
              className="rounded border-gray-300"
            />
            <Label htmlFor="includeMe" className="text-sm">
              Include me in the split
            </Label>
          </div>

          {/* Paid By Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Who paid for this transaction?</Label>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {/* Show all participants from entries */}
              {entries.map((entry) => (
                <option key={entry.participant} value={entry.participant}>
                  {entry.participant === "me" ? "Me" : entry.participant}
                </option>
              ))}
            </select>
          </div>

          {/* Participants */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Participants</Label>
            
            {/* Add Participants */}
            <ParticipantMultiSelect
              selectedParticipants={selectedParticipants}
              onChange={(participants) => {
                setSelectedParticipants(participants);
                addParticipants(participants);
              }}
              placeholder="Select participants..."
              excludeParticipants={includeMe ? ["me"] : []}
              container={dialogContainer}
            />

            {/* Participant List */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {entries.map((entry, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {entry.participant === "me" ? "Me" : entry.participant}
                    </span>
                    {entry.participant === paidBy && (
                      <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded-full">
                        Paid
                      </span>
                    )}
                  </div>
                  
                  {mode === "custom" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={entry.amount || ""}
                        onChange={(e) => updateParticipantAmount(index, parseFloat(e.target.value) || 0)}
                        className="w-24 text-right"
                        placeholder="0.00"
                      />
                      <span className="text-xs text-gray-500">₹</span>
                    </div>
                  ) : (
                    <div className="text-sm font-medium text-right w-24">
                      {formatCurrency(calculateEqualSplit())}
                    </div>
                  )}
                  
                  {entry.participant !== "me" && (
                    <Button
                      onClick={() => removeParticipant(index)}
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Balance Summary */}
          {mode === "custom" && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>Total Split:</span>
                <span className="font-medium">{formatCurrency(calculateCustomTotal())}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Remaining:</span>
                <span className={`font-medium ${getRemainingAmount() === 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatCurrency(getRemainingAmount())}
                </span>
              </div>
            </div>
          )}

          {/* My Share Summary */}
          {includeMe && (
            <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
              <div className="flex justify-between text-sm">
                <span>Your Share:</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(calculateMyShare())}
                </span>
              </div>
              {mode === "equal" && (
                <div className="text-xs text-gray-500 mt-1">
                  Equal split among {entries.length} participants
                </div>
              )}
            </div>
          )}

          {/* Validation Message */}
          {!isBalanced() && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {mode === "custom" 
                ? "Custom amounts must equal the total transaction amount"
                : "At least one participant is required for equal split"
              }
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <div>
            {transaction.is_shared && onClearSplit && (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={onClearSplit}
                disabled={isLoading}
              >
                Clear Split
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!isBalanced() || entries.length === 0 || isLoading}
            >
              {isLoading ? "Saving..." : "Save Split"}
            </Button>
          </div>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
