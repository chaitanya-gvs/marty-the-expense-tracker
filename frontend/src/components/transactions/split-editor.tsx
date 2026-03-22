"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Users, Calculator } from "lucide-react";
import { Transaction, SplitBreakdown, SplitEntry } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
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
      const totalAmount = transaction.net_amount ?? transaction.amount;
      return totalAmount / entries.length;
    }
    return 0;
  };

  const calculateCustomTotal = () => {
    return entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  };

  const getRemainingAmount = () => {
    if (mode === "equal") {
      return 0;
    }
    const totalAmount = transaction.net_amount ?? transaction.amount;
    return totalAmount - calculateCustomTotal();
  };

  const isBalanced = () => {
    if (mode === "equal") {
      return entries.length > 0;
    }
    return Math.abs(getRemainingAmount()) < 0.01;
  };

  const calculateMyShare = () => {
    if (!includeMe) {
      return 0;
    }

    if (mode === "equal") {
      const totalAmount = transaction.net_amount ?? transaction.amount;
      return totalAmount / entries.length;
    } else {
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

    const myShareAmount = calculateMyShare();
    onSave(splitBreakdown, myShareAmount);
    onClose();
  };

  const handleModeChange = (newMode: "equal" | "custom") => {
    setMode(newMode);
    setEntries(entries.map(entry => ({
      participant: entry.participant,
      amount: newMode === "equal" ? null : (entry.amount || 0)
    })));
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Users className="h-4 w-4" />}
        title="Share Expenses"
        onClose={onClose}
        variant="share"
      />

      <Modal.Body className="space-y-5">
        {/* Transaction Summary */}
        <div className="bg-muted/50 border border-border p-4 rounded-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium text-sm">{transaction.description}</p>
              <p className="text-xs text-muted-foreground">{formatDate(transaction.date)}</p>
              {transaction.net_amount !== undefined && transaction.net_amount !== transaction.amount && (
                <p className="text-xs text-primary mt-1">
                  Original: {formatCurrency(transaction.amount)} • Net after refunds: {formatCurrency(transaction.net_amount)}
                </p>
              )}
            </div>
            <Badge variant="outline" className="text-lg font-semibold">
              {formatCurrency(transaction.net_amount ?? transaction.amount)}
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
          <Checkbox
            id="includeMe"
            checked={includeMe}
            onCheckedChange={(checked) => setIncludeMe(checked === true)}
          />
          <Label htmlFor="includeMe" className="text-sm">
            Include me in the split
          </Label>
        </div>

        {/* Paid By Selector */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Who paid for this transaction?</Label>
          <Select value={paidBy} onValueChange={setPaidBy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entries.map((entry) => (
                <SelectItem key={entry.participant} value={entry.participant}>
                  {entry.participant === "me" ? "Me" : entry.participant}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Participants */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Participants</Label>

          <ParticipantMultiSelect
            selectedParticipants={selectedParticipants}
            onChange={(participants) => {
              setSelectedParticipants(participants);
              addParticipants(participants);
            }}
            placeholder="Select participants..."
            excludeParticipants={includeMe ? ["me"] : []}
          />

          {/* Participant List */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {entries.map((entry, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted/50 border border-border rounded">
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {entry.participant === "me" ? "Me" : entry.participant}
                  </span>
                  {entry.participant === paidBy && (
                    <span className="text-xs bg-emerald-500/15 text-emerald-500 px-2 py-1 rounded-full">
                      Paid
                    </span>
                  )}
                </div>

                {mode === "custom" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">₹</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={entry.amount || ""}
                      onChange={(e) => updateParticipantAmount(index, parseFloat(e.target.value) || 0)}
                      className="w-24 text-right"
                      placeholder="0.00"
                    />
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
                    className="h-6 w-6 p-0 text-destructive/70 hover:text-destructive"
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
          <div className="bg-primary/8 border border-primary/20 p-3 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Split:</span>
              <span className="font-mono font-medium">{formatCurrency(calculateCustomTotal())}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining:</span>
              <span className={`font-mono font-medium ${getRemainingAmount() === 0 ? "text-emerald-500" : "text-destructive"}`}>
                {formatCurrency(getRemainingAmount())}
              </span>
            </div>
          </div>
        )}

        {/* My Share Summary */}
        {includeMe && (
          <div className="bg-emerald-500/8 border border-emerald-500/20 p-3 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Share:</span>
              <span className="font-mono font-semibold text-emerald-500">
                {formatCurrency(calculateMyShare())}
              </span>
            </div>
            {mode === "equal" && (
              <div className="text-xs text-muted-foreground mt-1">
                Equal split among {entries.length} participants
              </div>
            )}
          </div>
        )}

        {/* Validation Message */}
        {!isBalanced() && (
          <div className="text-sm text-destructive">
            {mode === "custom"
              ? "Custom amounts must equal the total transaction amount"
              : "At least one participant is required for equal split"
            }
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <div className="flex justify-between w-full">
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
        </div>
      </Modal.Footer>
    </Modal>
  );
}
