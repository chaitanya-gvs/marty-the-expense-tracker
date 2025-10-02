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
import { Badge } from "@/components/ui/badge";
import { useBulkUpdateTransactions } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { Transaction, Tag, Category } from "@/lib/types";
import { Save, Loader2, Users, Calendar, ShoppingCart, Building2, Tag as TagIcon } from "lucide-react";
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
      
      await bulkUpdateTransactions.mutateAsync({
        transactionIds,
        updates,
      });

      toast.success(`Successfully updated ${selectedTransactions.length} transactions`);
      onClose();
    } catch (error) {
      toast.error("Failed to update transactions");
      console.error("Bulk update error:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!max-w-[1400px] sm:!max-w-[1400px] w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Bulk Edit Transactions ({selectedTransactions.length} selected)
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Horizontal transaction-like layout */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Update fields for all selected transactions:
            </div>
            
            {/* Transaction row layout */}
            <div className="flex items-center gap-4 w-full min-w-[800px]">
              {/* Description */}
              <div className="flex-1 min-w-[300px]">
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                  <ShoppingCart className="h-3 w-3" />
                  Description
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={updateFields.has("description") ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFieldToggle("description")}
                    className="text-xs"
                  >
                    {updateFields.has("description") ? "✓" : "○"}
                  </Button>
                  {updateFields.has("description") && (
                    <Input
                      value={formData.description || ""}
                      onChange={(e) => handleInputChange("description", e.target.value)}
                      placeholder="Enter new description"
                      className="text-sm"
                    />
                  )}
                </div>
              </div>

              {/* Category */}
              <div className="min-w-[120px]">
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                  <TagIcon className="h-3 w-3" />
                  Category
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={updateFields.has("category") ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFieldToggle("category")}
                    className="text-xs"
                  >
                    {updateFields.has("category") ? "✓" : "○"}
                  </Button>
                  {updateFields.has("category") && (
                    <CategorySelector
                      value={formData.category || ""}
                      onValueChange={(category) => handleInputChange("category", category)}
                      placeholder="Select"
                    />
                  )}
                </div>
              </div>

              {/* Tags */}
              <div className="min-w-[150px]">
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                  <TagIcon className="h-3 w-3" />
                  Tags
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={updateFields.has("tags") ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFieldToggle("tags")}
                    className="text-xs"
                  >
                    {updateFields.has("tags") ? "✓" : "○"}
                  </Button>
                  {updateFields.has("tags") && (
                    <MultiTagSelector
                      selectedTags={selectedTags}
                      onTagsChange={handleTagsChange}
                      placeholder="Select tags"
                    />
                  )}
                </div>
              </div>

              {/* Shared Status */}
              <div className="min-w-[80px]">
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                  <Users className="h-3 w-3" />
                  Shared
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={updateFields.has("is_shared") ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleFieldToggle("is_shared")}
                    className="text-xs"
                  >
                    {updateFields.has("is_shared") ? "✓" : "○"}
                  </Button>
                  {updateFields.has("is_shared") && (
                    <select
                      value={formData.is_shared?.toString() || ""}
                      onChange={(e) => handleInputChange("is_shared", e.target.value === "true")}
                      className="text-xs px-2 py-1 border rounded"
                    >
                      <option value="">Select</option>
                      <option value="true">Shared</option>
                      <option value="false">Personal</option>
                    </select>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Selected transactions preview */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Selected Transactions ({selectedTransactions.length}):
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {selectedTransactions.slice(0, 5).map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{transaction.description}</div>
                    <div className="text-gray-500 text-xs">
                      {transaction.date} • ₹{transaction.amount}
                    </div>
                  </div>
                </div>
              ))}
              {selectedTransactions.length > 5 && (
                <div className="text-xs text-gray-500 text-center py-1">
                  ... and {selectedTransactions.length - 5} more
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={bulkUpdateTransactions.isPending || updateFields.size === 0}
            >
              {bulkUpdateTransactions.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Update {selectedTransactions.length} Transactions
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
