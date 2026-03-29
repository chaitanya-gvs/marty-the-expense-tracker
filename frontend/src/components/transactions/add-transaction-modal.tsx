"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldAutocomplete } from "./field-autocomplete";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { Tag } from "@/lib/types";
import { toast } from "sonner";
import { Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive/80 ml-0.5">*</span>}
    </p>
  );
}

export function AddTransactionModal({ isOpen, onClose }: AddTransactionModalProps) {
  const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [account, setAccount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState<string>("");
  const [tags, setTags] = useState<Tag[]>([]);

  const createTransaction = useCreateTransaction();

  useEffect(() => {
    if (isOpen) {
      setDate(format(new Date(), "yyyy-MM-dd"));
      setAccount("");
      setDescription("");
      setCategory("");
      setDirection("debit");
      setAmount("");
      setTags([] as Tag[]);
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
        category: category || "",
        direction,
        amount: parseFloat(amount),
        tags: tags.map((t) => t.name),
        notes: undefined,
        is_shared: false,
        is_refund: false,
        is_split: false,
        is_transfer: false,
        is_flagged: false,
        split_share_amount: 0,
        split_breakdown: undefined,
        paid_by: undefined,
        transaction_group_id: undefined,
        related_mails: [],
        source_file: undefined,
        raw_data: undefined,
      });
      toast.success("Transaction created");
      onClose();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Failed to create transaction");
    }
  };

  const isValid = account.trim() !== "" && description.trim() !== "" && amount !== "" && parseFloat(amount) > 0;

  return (
    <Modal open={isOpen} onClose={onClose} size="md">
      <Modal.Header
        icon={<Plus className="h-4 w-4" />}
        title="Add Transaction"
        subtitle="Create a new transaction manually"
        onClose={onClose}
        variant="share"
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="space-y-3">

            {/* ── Row 1: Date · Amount · Direction ── */}
            <div className="grid grid-cols-[auto_1fr_160px] gap-3 items-end">

              {/* Date */}
              <div>
                <FieldLabel>Date</FieldLabel>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-auto text-sm"
                  required
                />
              </div>

              {/* Amount */}
              <div>
                <FieldLabel required>Amount</FieldLabel>
                <div className="relative">
                  <span className="pointer-events-none select-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
                    ₹
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 font-mono text-sm tabular-nums"
                    required
                  />
                </div>
              </div>

              {/* Direction toggle */}
              <div>
                <FieldLabel>Direction</FieldLabel>
                <div className="relative flex h-9 rounded-md overflow-hidden border border-border bg-muted text-xs font-medium">
                  {/* sliding bg */}
                  <div
                    className={cn(
                      "absolute inset-y-0 w-1/2 transition-[left] duration-200 ease-out",
                      direction === "debit"
                        ? "left-0 bg-destructive/15"
                        : "left-1/2 bg-emerald-500/15"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setDirection("debit")}
                    className={cn(
                      "relative z-10 flex-1 flex items-center justify-center gap-1.5 transition-colors",
                      direction === "debit" ? "text-destructive" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ArrowDownLeft className="h-3 w-3" />
                    Debit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection("credit")}
                    className={cn(
                      "relative z-10 flex-1 flex items-center justify-center gap-1.5 transition-colors border-l border-border",
                      direction === "credit" ? "text-emerald-500" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    Credit
                  </button>
                </div>
              </div>
            </div>


            {/* ── Row 2: Account ── */}
            <div>
              <FieldLabel required>Account</FieldLabel>
              <FieldAutocomplete
                fieldName="account"
                value={account}
                onValueChange={setAccount}
                placeholder="Select or type account name…"
                className="w-full"
              />
            </div>

            {/* ── Row 3: Description ── */}
            <div>
              <FieldLabel required>Description</FieldLabel>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter transaction description…"
                className="text-sm"
                required
              />
            </div>

            {/* ── Row 4: Category + Tags ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Category</FieldLabel>
                <CategorySelector
                  value={category}
                  onValueChange={setCategory}
                  placeholder="Select category…"
                  transactionDirection={direction}
                />
              </div>
              <div>
                <FieldLabel>Tags</FieldLabel>
                <MultiTagSelector
                  selectedTags={tags}
                  onTagsChange={setTags}
                  placeholder="Select or add tags…"
                />
              </div>
            </div>

          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={createTransaction.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid || createTransaction.isPending}>
            {createTransaction.isPending ? "Creating…" : "Create Transaction"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
