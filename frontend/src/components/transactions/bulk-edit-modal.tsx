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
      console.log("Bulk update - Selected tags:", selectedTags);
      
      try {
        const response = await bulkUpdateTransactions.mutateAsync({
        transactionIds,
        updates,
      });
        
        console.log("Bulk update response:", response);
        console.log("Bulk update response.data:", response?.data);
        console.log("Bulk update response.data type:", typeof response?.data);
        console.log("Bulk update response.data is array:", Array.isArray(response?.data));
        
        if (response?.data && Array.isArray(response.data)) {
          console.log("Number of updated transactions:", response.data.length);
          response.data.forEach((tx, idx) => {
            console.log(`Transaction ${idx + 1} (${tx.id}):`, {
              tags: tx.tags,
              description: tx.description
            });
          });
        }
      } catch (error) {
        console.error("Bulk update mutation error:", error);
        throw error;
      }

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
      
      // Small delay to ensure queries are refetched before closing
      await new Promise(resolve => setTimeout(resolve, 200));
      
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
        className="!max-w-2xl sm:!max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col rounded-2xl bg-card p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Users className="h-5 w-5 text-primary" />
                Bulk Edit Transactions ({selectedTransactions.length} selected)
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Choose which fields to update. Others stay unchanged.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Body - Scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Update Fields Section */}
          <div className="space-y-2">
            {/* Description Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
              <Switch
                checked={updateFields.has("description")}
                onCheckedChange={() => handleFieldToggle("description")}
                className="data-[state=checked]:bg-primary"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground">Description</label>
                {updateFields.has("description") ? (
                  <Input
                    value={formData.description || ""}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    placeholder="Enter new description"
                    className="mt-2"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">Click to enable</p>
                )}
              </div>
            </div>

            {/* Category Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
              <Switch
                checked={updateFields.has("category")}
                onCheckedChange={() => handleFieldToggle("category")}
                className="data-[state=checked]:bg-primary"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground">Category</label>
                {updateFields.has("category") ? (
                  <div className="mt-2">
                    <CategorySelector
                      value={formData.category || ""}
                      onValueChange={(category) => handleInputChange("category", category)}
                      placeholder="Select category"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">Click to enable</p>
                )}
              </div>
            </div>

            {/* Tags Field */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
              <Switch
                checked={updateFields.has("tags")}
                onCheckedChange={() => handleFieldToggle("tags")}
                className="data-[state=checked]:bg-primary"
              />
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground">Tags</label>
                {updateFields.has("tags") ? (
                  <div className="mt-2">
                    <MultiTagSelector
                      selectedTags={selectedTags}
                      onTagsChange={handleTagsChange}
                      placeholder="Select tags"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">Click to enable</p>
                )}
              </div>
            </div>
          </div>

          {/* Collapsible Selected Transactions */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsTransactionsExpanded(!isTransactionsExpanded)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
                    className="p-2 rounded-md bg-muted/30 border border-border/40 text-xs"
                  >
                    <span className="font-medium text-foreground">{transaction.description}</span>
                    <span className="text-muted-foreground font-mono"> · {transaction.date} · ₹{transaction.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {getUpdatePreview() && (
            <div className="text-xs text-muted-foreground pt-3 border-t border-border">
              {getUpdatePreview()}
            </div>
          )}
        </form>

        {/* Footer - Sticky */}
        <DialogFooter className="px-6 py-4 border-t border-border flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={bulkUpdateTransactions.isPending || updateFields.size === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
