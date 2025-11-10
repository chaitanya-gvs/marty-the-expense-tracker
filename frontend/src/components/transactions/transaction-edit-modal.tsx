"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateTransaction, useTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { Transaction, Tag } from "@/lib/types";
import { format } from "date-fns";
import { X, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { RefundAdjustmentSection } from "./refund-adjustment-section";
import { TransferGroupSection } from "./transfer-group-section";

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

  // Initialize form data when transaction loads
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
      });
      
      // Convert string tags to Tag objects
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
    value: string | number | boolean | string[]
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleTagsChange = (tags: Tag[]) => {
    setSelectedTags(tags);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await updateTransaction.mutateAsync({
        id: transactionId,
        updates: {
          ...formData,
          tags: selectedTags.map(tag => tag.name),
        },
      });
      
      toast.success("Transaction updated successfully");
      onClose();
    } catch (error) {
      toast.error("Failed to update transaction");
      console.error("Update error:", error);
    }
  };


  if (transactionLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading transaction...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!transaction) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <div className="text-center py-8">
            <p className="text-gray-500">Transaction not found</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 p-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Basic Information */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date || ""}
                    onChange={(e) => handleInputChange("date", e.target.value)}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description || ""}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    placeholder="Transaction description"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="account">Account</Label>
                  <Input
                    id="account"
                    value={formData.account || ""}
                    onChange={(e) => handleInputChange("account", e.target.value)}
                    placeholder="Account name"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={formData.amount || ""}
                    onChange={(e) => handleInputChange("amount", parseFloat(e.target.value))}
                    placeholder="0.00"
                    required
                  />
                </div>
              </CardContent>
            </Card>

            {/* Category & Direction */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Category & Direction</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <Label htmlFor="direction">Direction</Label>
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
                </div>

                <div>
                  <Label htmlFor="category">Category</Label>
                  <CategorySelector
                    value={formData.category || ""}
                    onValueChange={(value) => handleInputChange("category", value)}
                    placeholder="Select category"
                    className="w-full"
                    transactionDirection={formData.direction}
                  />
                </div>

                <div>
                  <Label htmlFor="split_share_amount">Split Share Amount</Label>
                  <Input
                    id="split_share_amount"
                    type="number"
                    step="0.01"
                    value={formData.split_share_amount || ""}
                    onChange={(e) => handleInputChange("split_share_amount", parseFloat(e.target.value))}
                    placeholder="Your share of the transaction"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tags */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <MultiTagSelector
                selectedTags={selectedTags}
                onTagsChange={handleTagsChange}
                placeholder="Select or create tags..."
              />
            </CardContent>
          </Card>

          {/* Notes & Flags */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Notes & Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes || ""}
                  onChange={(e) => handleInputChange("notes", e.target.value)}
                  placeholder="Additional notes about this transaction"
                  rows={3}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="is_shared"
                    checked={formData.is_shared || false}
                    onChange={(e) => handleInputChange("is_shared", e.target.checked)}
                    className="rounded h-4 w-4"
                  />
                  <Label htmlFor="is_shared" className="text-sm">Shared Transaction</Label>
                </div>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="is_refund"
                    checked={formData.is_refund || false}
                    onChange={(e) => handleInputChange("is_refund", e.target.checked)}
                    className="rounded h-4 w-4"
                  />
                  <Label htmlFor="is_refund" className="text-sm">Refund</Label>
                </div>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="is_transfer"
                    checked={formData.is_transfer || false}
                    onChange={(e) => handleInputChange("is_transfer", e.target.checked)}
                    className="rounded h-4 w-4"
                  />
                  <Label htmlFor="is_transfer" className="text-sm">Transfer</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Refunds & Adjustments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Refunds & Adjustments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <RefundAdjustmentSection 
                transaction={transaction}
                allTransactions={[]} // This would need to be passed from parent
                onLinkRefund={async (childId: string, parentId: string) => {
                  try {
                    await updateTransaction.mutateAsync({
                      id: childId,
                      updates: {
                        link_parent_id: parentId,
                        is_refund: true,
                      },
                    });
                    toast.success("Refund linked successfully");
                  } catch (error) {
                    toast.error("Failed to link refund");
                  }
                }}
                onUnlinkRefund={async (childId: string) => {
                  try {
                    await updateTransaction.mutateAsync({
                      id: childId,
                      updates: {
                        link_parent_id: undefined,
                        is_refund: false,
                      },
                    });
                    toast.success("Refund unlinked successfully");
                  } catch (error) {
                    toast.error("Failed to unlink refund");
                  }
                }}
              />
            </CardContent>
          </Card>

          {/* Transfer Group */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Transfer Group</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <TransferGroupSection
                transaction={transaction}
                allTransactions={[]} // This would need to be passed from parent
                onGroupTransfer={async (transactionIds: string[]) => {
                  try {
                    await apiClient.groupTransfer(transactionIds);
                    toast.success(`Grouped ${transactionIds.length} transactions as a transfer`);
                  } catch (error) {
                    toast.error("Failed to group transfer");
                  }
                }}
                onUngroupTransfer={async (transactionId: string) => {
                  try {
                    await updateTransaction.mutateAsync({
                      id: transactionId,
                      updates: { transaction_group_id: undefined },
                    });
                    toast.success("Transfer ungrouped successfully");
                  } catch (error) {
                    toast.error("Failed to ungroup transfer");
                  }
                }}
                onAddToTransferGroup={async (transactionIds: string[]) => {
                  try {
                    const targetGroupId = transaction.transaction_group_id;
                    const updatePromises = transactionIds.map((id: string) => 
                      updateTransaction.mutateAsync({
                        id,
                        updates: { transaction_group_id: targetGroupId },
                      })
                    );
                    await Promise.all(updatePromises);
                    toast.success(`Added ${transactionIds.length} transactions to transfer group`);
                  } catch (error) {
                    toast.error("Failed to add to transfer group");
                  }
                }}
                onRemoveFromTransferGroup={async (transactionId: string) => {
                  try {
                    await updateTransaction.mutateAsync({
                      id: transactionId,
                      updates: { transaction_group_id: undefined },
                    });
                    toast.success("Transaction removed from transfer group");
                  } catch (error) {
                    toast.error("Failed to remove from transfer group");
                  }
                }}
              />
            </CardContent>
          </Card>

          <DialogFooter className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateTransaction.isPending}
              className="min-w-[120px]"
            >
              {updateTransaction.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
