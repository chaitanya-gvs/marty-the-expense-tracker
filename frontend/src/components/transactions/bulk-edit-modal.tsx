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
import { Switch } from "@/components/ui/switch";
import { useBulkUpdateTransactions } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { Transaction, Tag } from "@/lib/types";
import { Loader2, Users, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { cn } from "@/lib/utils";

interface BulkEditModalProps {
  selectedTransactions: Transaction[];
  isOpen: boolean;
  onClose: () => void;
}

export function BulkEditModal({
  selectedTransactions,
  isOpen,
  onClose,
}: BulkEditModalProps) {
  const [formData, setFormData] = useState<Partial<Transaction>>({});
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [updateFields, setUpdateFields] = useState<Set<string>>(new Set());
  const [isTransactionsExpanded, setIsTransactionsExpanded] = useState(false);

  const bulkUpdateTransactions = useBulkUpdateTransactions();
  const { data: categories = [] } = useCategories();
  const { data: tagsData } = useTags();

  const allTags = tagsData || [];

  // Initialize form data when modal opens
  useEffect(() => {
    if (isOpen && selectedTransactions.length > 0) {
      setFormData({});
      setSelectedTags([]);
      setUpdateFields(new Set());
      setIsTransactionsExpanded(false);
    }
  }, [isOpen, selectedTransactions]);

  const handleInputChange = (
    field: keyof Transaction,
    value: string | number | boolean | string[]
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    
    // Track which fields are being updated
    if (value !== undefined && value !== null && value !== "") {
      setUpdateFields(prev => new Set([...prev, field]));
    } else {
      setUpdateFields(prev => {
        const newSet = new Set(prev);
        newSet.delete(field);
        return newSet;
      });
    }
  };

  const handleTagsChange = (tags: Tag[]) => {
    setSelectedTags(tags);
    setUpdateFields(prev => new Set([...prev, "tags"]));
  };

  const handleFieldToggle = (field: keyof Transaction) => {
    setUpdateFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(field)) {
        newSet.delete(field);
        // Clear the field value when toggling off
        setFormData(prevData => {
          const newData = { ...prevData };
          delete newData[field];
          return newData;
        });
        if (field === "tags") {
          setSelectedTags([]);
        }
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (updateFields.size === 0) {
      toast.error("Please select at least one field to update");
      return;
    }

    try {
      const updates: Partial<Transaction> = {};
      
      // Only include fields that are marked for update
      updateFields.forEach(field => {
        if (field === "tags") {
          updates.tags = selectedTags.map(tag => tag.name);
        } else if (formData[field as keyof Transaction] !== undefined) {
          (updates as any)[field] = formData[field as keyof Transaction];
        }
      });

      const transactionIds = selectedTransactions.map(t => t.id);
      
      console.log("Bulk update - Transaction IDs:", transactionIds);
      console.log("Bulk update - Updates:", updates);
      
      await bulkUpdateTransactions.mutateAsync({
        transactionIds,
        updates,
      });

      // Show success toast with undo button
      toast.success(`Updated ${selectedTransactions.length} transaction${selectedTransactions.length !== 1 ? 's' : ''}`, {
        action: {
          label: "Undo",
          onClick: () => {
            // TODO: Implement undo functionality
            toast.info("Undo feature coming soon");
          },
        },
      });
      
      onClose();
    } catch (error) {
      toast.error("Failed to update transactions");
      console.error("Bulk update error:", error);
    }
  };

  // Get preview text of what will be updated
  const getUpdatePreview = () => {
    const fieldsToUpdate: string[] = [];
    if (updateFields.has("description")) fieldsToUpdate.push("Description");
    if (updateFields.has("category")) fieldsToUpdate.push("Category");
    if (updateFields.has("tags")) fieldsToUpdate.push("Tags");
    
    if (fieldsToUpdate.length === 0) return null;
    return `Will update: ${fieldsToUpdate.join(", ")}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="!max-w-2xl sm:!max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col rounded-2xl bg-slate-900 p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-white">
                <Users className="h-5 w-5" />
                Bulk Edit Transactions ({selectedTransactions.length} selected)
              </DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Choose which fields to update. Others stay unchanged.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 hover:bg-slate-800"
            >
              <X className="h-4 w-4 text-slate-400" />
            </Button>
          </div>
        </DialogHeader>

        {/* Body - Scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 space-y-4">
          {/* Update Fields Section */}
          <div className="space-y-3">
            {/* Description Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/60">
              <Switch
                checked={updateFields.has("description")}
                onCheckedChange={() => handleFieldToggle("description")}
                className="data-[state=checked]:bg-blue-600"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-white">Description</label>
                {updateFields.has("description") ? (
                  <Input
                    value={formData.description || ""}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    placeholder="Enter new description"
                    className="mt-2 flex-1 rounded-lg bg-slate-800 border-slate-700 px-3 py-2 text-white placeholder:text-slate-500 focus:ring-2 focus:ring-slate-600"
                  />
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Click to enable</p>
                )}
              </div>
            </div>

            {/* Category Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/60">
              <Switch
                checked={updateFields.has("category")}
                onCheckedChange={() => handleFieldToggle("category")}
                className="data-[state=checked]:bg-blue-600"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-white">Category</label>
                {updateFields.has("category") ? (
                  <div className="mt-2">
                    <CategorySelector
                      value={formData.category || ""}
                      onValueChange={(category) => handleInputChange("category", category)}
                      placeholder="Select category"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Click to enable</p>
                )}
              </div>
            </div>

            {/* Tags Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/60">
              <Switch
                checked={updateFields.has("tags")}
                onCheckedChange={() => handleFieldToggle("tags")}
                className="data-[state=checked]:bg-blue-600"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-white">Tags</label>
                {updateFields.has("tags") ? (
                  <div className="mt-2">
                    <MultiTagSelector
                      selectedTags={selectedTags}
                      onTagsChange={handleTagsChange}
                      placeholder="Select tags"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Click to enable</p>
                )}
              </div>
            </div>
          </div>

          {/* Collapsible Selected Transactions */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setIsTransactionsExpanded(!isTransactionsExpanded)}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              {isTransactionsExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span>{selectedTransactions.length} selected transactions</span>
            </button>
            
            {isTransactionsExpanded && (
              <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                {selectedTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="p-2 rounded bg-slate-800/40 text-xs text-slate-300"
                  >
                    <span className="font-medium">{transaction.description}</span>
                    <span className="text-slate-500"> · {transaction.date} · ₹{transaction.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {getUpdatePreview() && (
            <div className="text-xs text-slate-400 mt-2 pt-3 border-t border-slate-800">
              {getUpdatePreview()}
            </div>
          )}
        </form>

        {/* Footer - Sticky */}
        <DialogFooter className="sticky bottom-0 bg-slate-900 px-6 py-4 border-t border-slate-800 flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={bulkUpdateTransactions.isPending || updateFields.size === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkUpdateTransactions.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                Update {selectedTransactions.length} Transaction{selectedTransactions.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
