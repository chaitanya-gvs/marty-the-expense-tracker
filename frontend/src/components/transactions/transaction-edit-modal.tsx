"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateTransaction, useTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { Transaction, Tag } from "@/lib/types";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { TransferGroupSection } from "./transfer-group-section";
import { FieldAutocomplete } from "./field-autocomplete";

interface TransactionEditModalProps {
  transactionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TransactionEditModal({
  transactionId,
  isOpen,
  onClose,
}: TransactionEditModalProps) {
  const [formData, setFormData] = useState<Partial<Transaction>>({});
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

  const { data: transactionData, isLoading: transactionLoading } = useTransaction(transactionId);
  const { data: categories = [] } = useCategories();
  const { data: tagsData } = useTags();
  const updateTransaction = useUpdateTransaction();

  const transaction = transactionData?.data;
  const allTags = tagsData || [];

  useEffect(() => {
    if (transaction) {
      setFormData({
        date: transaction.date,
        account: transaction.account,
        description: transaction.description,
        category: transaction.category,
        subcategory: transaction.subcategory,
        direction: transaction.direction,
        amount: transaction.amount,
        split_share_amount: transaction.split_share_amount,
        notes: transaction.notes,
        is_shared: transaction.is_shared,
        is_refund: transaction.is_refund,
        is_transfer: transaction.is_transfer,
        is_recurring: transaction.is_recurring ?? false,
        recurrence_period: transaction.recurrence_period ?? null,
      });

      if (transaction.tags && transaction.tags.length > 0 && allTags.length > 0) {
        const tagObjects = transaction.tags
          .map(tagName => allTags.find(tag => tag.name === tagName))
          .filter((tag): tag is Tag => tag !== undefined);
        setSelectedTags(tagObjects);
      } else {
        setSelectedTags([]);
      }
    }
  }, [transaction, allTags]);

  const handleInputChange = (
    field: keyof Transaction,
    value: string | number | boolean | string[] | null
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateTransaction.mutateAsync({
        id: transactionId,
        updates: { ...formData, tags: selectedTags.map(tag => tag.name) },
      });
      if (transaction && (formData.is_recurring !== transaction.is_recurring ||
          formData.recurrence_period !== transaction.recurrence_period)) {
        await apiClient.setRecurring(transaction.id, {
          is_recurring: !!formData.is_recurring,
          recurrence_period: formData.is_recurring ? (formData.recurrence_period ?? null) : null,
        });
      }
      toast.success("Transaction updated successfully");
      onClose();
    } catch {
      toast.error("Failed to update transaction");
    }
  };

  if (transactionLoading) {
    return (
      <Modal open={isOpen} onClose={onClose} size="lg">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-sm text-muted-foreground">Loading transaction…</span>
        </div>
      </Modal>
    );
  }

  if (!transaction) {
    return (
      <Modal open={isOpen} onClose={onClose} size="lg">
        <div className="text-center py-16">
          <p className="text-muted-foreground">Transaction not found</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Save className="h-4 w-4" />}
        title="Edit Transaction"
        subtitle={transaction.description}
        onClose={onClose}
        variant="split"
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-4">
          {/* Row 1: Date + Amount */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Date" required>
              <Input
                type="date"
                value={formData.date || ""}
                onChange={(e) => handleInputChange("date", e.target.value)}
                required
              />
            </FieldRow>
            <FieldRow label="Amount" required>
              <div className="relative">
                <span className="pointer-events-none select-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₹</span>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount || ""}
                  onChange={(e) => handleInputChange("amount", parseFloat(e.target.value))}
                  placeholder="0.00"
                  className="pl-7 font-mono tabular-nums"
                  required
                />
              </div>
            </FieldRow>
          </div>

          {/* Description */}
          <FieldRow label="Description" required>
            <FieldAutocomplete
              fieldName="description"
              value={formData.description || ""}
              onValueChange={(val) => handleInputChange("description", val)}
              placeholder="Transaction description"
              onSave={async (val) => {
                if (val && !formData.category) {
                  try {
                    const prediction = await apiClient.predictCategory(val);
                    if (prediction.data) {
                      handleInputChange("category", prediction.data.name);
                      toast.info(`Auto-categorized as ${prediction.data.name}`);
                    }
                  } catch { /* non-critical */ }
                }
              }}
            />
          </FieldRow>

          {/* Account */}
          <FieldRow label="Account">
            <FieldAutocomplete
              fieldName="account"
              value={formData.account || ""}
              onValueChange={(val) => handleInputChange("account", val)}
              placeholder="Account name"
            />
          </FieldRow>

          {/* Row 2: Direction + Category */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Direction">
              <Select
                value={formData.direction || ""}
                onValueChange={(value) => handleInputChange("direction", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Debit (Money Out)</SelectItem>
                  <SelectItem value="credit">Credit (Money In)</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Split Share Amount">
              <div className="relative">
                <span className="pointer-events-none select-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₹</span>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.split_share_amount || ""}
                  onChange={(e) => handleInputChange("split_share_amount", parseFloat(e.target.value))}
                  placeholder="Your share"
                  className="pl-7 font-mono tabular-nums"
                />
              </div>
            </FieldRow>
          </div>

          {/* Category */}
          <FieldRow label="Category">
            <CategorySelector
              value={formData.category || ""}
              onValueChange={(value) => handleInputChange("category", value)}
              placeholder="Select category"
              className="w-full"
              transactionDirection={formData.direction}
            />
          </FieldRow>

          {/* Tags */}
          <FieldRow label="Tags">
            <MultiTagSelector
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              placeholder="Select or create tags…"
            />
          </FieldRow>

          {/* Notes */}
          <FieldRow label="Notes">
            <Textarea
              value={formData.notes || ""}
              onChange={(e) => handleInputChange("notes", e.target.value)}
              placeholder="Additional notes about this transaction"
              rows={3}
            />
          </FieldRow>

          {/* Flags */}
          <div className="rounded-lg bg-muted/40 border border-border/50 p-3 space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Flags</p>
            {[
              { id: "is_shared", label: "Shared Transaction" },
              { id: "is_refund", label: "Refund" },
              { id: "is_transfer", label: "Transfer" },
            ].map(({ id, label }) => (
              <div key={id} className="flex items-center gap-2.5">
                <Checkbox
                  id={id}
                  checked={(formData[id as keyof Transaction] as boolean) || false}
                  onCheckedChange={(checked) => handleInputChange(id as keyof Transaction, checked === true)}
                />
                <Label htmlFor={id} className="text-sm cursor-pointer">{label}</Label>
              </div>
            ))}
            {/* Recurring */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_recurring"
                checked={!!formData.is_recurring}
                onCheckedChange={(checked) => {
                  handleInputChange("is_recurring", !!checked);
                  if (!checked) handleInputChange("recurrence_period", null);
                }}
              />
              <label htmlFor="is_recurring" className={cn(
                "text-sm cursor-pointer",
                formData.is_recurring ? "text-indigo-400 font-medium" : "text-muted-foreground"
              )}>
                Recurring
              </label>
              {formData.is_recurring && (
                <Select
                  value={formData.recurrence_period ?? ""}
                  onValueChange={(v) => handleInputChange("recurrence_period", v)}
                >
                  <SelectTrigger className="h-7 w-28 text-xs border-indigo-500/30 text-indigo-400">
                    <SelectValue placeholder="Period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Transfer Group */}
          <div className="rounded-lg bg-muted/40 border border-border/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Transfer Group</p>
            <TransferGroupSection
              transaction={transaction}
              allTransactions={[]}
              onGroupTransfer={async (transactionIds: string[]) => {
                try {
                  await apiClient.groupTransfer(transactionIds);
                  toast.success(`Grouped ${transactionIds.length} transactions as a transfer`);
                } catch {
                  toast.error("Failed to group transfer");
                }
              }}
              onUngroupTransfer={async (transactionId: string) => {
                try {
                  await updateTransaction.mutateAsync({ id: transactionId, updates: { transaction_group_id: undefined } });
                  toast.success("Transfer ungrouped successfully");
                } catch {
                  toast.error("Failed to ungroup transfer");
                }
              }}
              onAddToTransferGroup={async (transactionIds: string[]) => {
                try {
                  const targetGroupId = transaction.transaction_group_id;
                  await Promise.all(transactionIds.map((id: string) =>
                    updateTransaction.mutateAsync({ id, updates: { transaction_group_id: targetGroupId } })
                  ));
                  toast.success(`Added ${transactionIds.length} transactions to transfer group`);
                } catch {
                  toast.error("Failed to add to transfer group");
                }
              }}
              onRemoveFromTransferGroup={async (transactionId: string) => {
                try {
                  await updateTransaction.mutateAsync({ id: transactionId, updates: { transaction_group_id: undefined } });
                  toast.success("Transaction removed from transfer group");
                } catch {
                  toast.error("Failed to remove from transfer group");
                }
              }}
            />
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={updateTransaction.isPending} className="min-w-[120px]">
            {updateTransaction.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
