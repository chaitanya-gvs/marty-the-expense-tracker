"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldAutocomplete } from "./field-autocomplete";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddTransactionModal({
  isOpen,
  onClose,
}: AddTransactionModalProps) {
  const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [account, setAccount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [isShared, setIsShared] = useState<boolean>(false);
  const [isRefund, setIsRefund] = useState<boolean>(false);
  const [isFlagged, setIsFlagged] = useState<boolean>(false);

  const createTransaction = useCreateTransaction();

  useEffect(() => {
    if (isOpen) {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setAccount("");
      setDescription("");
      setCategory("");
      setDirection("debit");
      setAmount("");
      setTags([]);
      setNotes("");
      setIsShared(false);
      setIsRefund(false);
      setIsFlagged(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!account.trim()) { toast.error("Account is required"); return; }
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error("Amount must be greater than 0"); return; }

    try {
      await createTransaction.mutateAsync({
        date,
        account: account.trim(),
        description: description.trim(),
        category: category || undefined,
        direction,
        amount: parseFloat(amount),
        tags,
        notes: notes.trim() || undefined,
        is_shared: isShared,
        is_refund: isRefund,
        is_split: false,
        is_transfer: false,
        is_flagged: isFlagged,
        split_share_amount: undefined,
        split_breakdown: undefined,
        paid_by: undefined,
        link_parent_id: undefined,
        transaction_group_id: undefined,
        related_mails: [],
        source_file: undefined,
        raw_data: undefined,
      });

      toast.success("Transaction created successfully");
      onClose();
    } catch (error: any) {
      console.error("Failed to create transaction:", error);
      toast.error(error?.message || "Failed to create transaction");
    }
  };

  const isValid =
    account.trim() !== "" &&
    description.trim() !== "" &&
    amount !== "" &&
    parseFloat(amount) > 0;

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Plus className="h-4 w-4" />}
        title="Add Transaction"
        subtitle="Create a new transaction manually"
        onClose={onClose}
        variant="share"
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="space-y-4">
            {/* Date | Amount | Direction */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (₹) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Direction</Label>
                <div className="flex rounded-md border border-border overflow-hidden h-9 text-sm">
                  <button
                    type="button"
                    onClick={() => setDirection("debit")}
                    className={cn(
                      "flex-1 transition-colors text-xs font-medium",
                      direction === "debit"
                        ? "bg-destructive/20 text-destructive"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Debit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection("credit")}
                    className={cn(
                      "flex-1 transition-colors text-xs font-medium border-l border-border",
                      direction === "credit"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Credit
                  </button>
                </div>
              </div>
            </div>

            {/* Account */}
            <div className="space-y-2">
              <Label htmlFor="account">Account *</Label>
              <FieldAutocomplete
                fieldName="account"
                value={account}
                onValueChange={setAccount}
                placeholder="Select or type account name..."
                className="w-full"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter transaction description..."
                required
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label>Category</Label>
              <CategorySelector
                value={category}
                onValueChange={setCategory}
                placeholder="Select category..."
                transactionDirection={direction}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <MultiTagSelector
                selectedTags={tags}
                onTagsChange={setTags}
                placeholder="Select or add tags..."
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional notes..."
                rows={2}
              />
            </div>

            {/* Flags */}
            <div className="flex items-center gap-2 pt-1 border-t border-border flex-wrap">
              {[
                { id: "is_shared", label: "Shared", value: isShared, set: setIsShared },
                { id: "is_refund", label: "Refund", value: isRefund, set: setIsRefund },
                { id: "is_flagged", label: "Flagged", value: isFlagged, set: setIsFlagged },
              ].map(({ id, label, value, set }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set(!value)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    value
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-transparent border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={createTransaction.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid || createTransaction.isPending}>
            {createTransaction.isPending ? "Creating..." : "Create Transaction"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
