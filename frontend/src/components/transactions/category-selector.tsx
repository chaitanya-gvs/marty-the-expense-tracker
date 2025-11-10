"use client";

import React, { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCategories, useSearchCategories, useCreateCategory } from "@/hooks/use-categories";
import { Category } from "@/lib/types";
import { toast } from "sonner";

interface CategorySelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  transactionDirection?: "debit" | "credit"; // Transaction direction to filter categories
}

export function CategorySelector({
  value,
  onValueChange,
  placeholder = "Select category...",
  className,
  transactionDirection,
}: CategorySelectorProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: "#3B82F6",
  });

  // Filter categories by transaction direction if provided
  const { data: categories = [], isLoading: categoriesLoading, error } = useCategories(transactionDirection);
  const createCategoryMutation = useCreateCategory();

  const handleCreateCategory = async () => {
    if (!newCategory.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    try {
      const response = await createCategoryMutation.mutateAsync({
        name: newCategory.name,
        color: newCategory.color,
        transaction_type: transactionDirection || null, // Set transaction_type based on transaction direction
      });

      onValueChange(response.data.id);
      setShowCreateDialog(false);
      
      // Reset form
      setNewCategory({
        name: "",
        color: "#3B82F6",
      });
    } catch (error) {
      // Error handling is done in the mutation
    }
  };

  const selectedCategory = categories.find(cat => cat.id === value);

  if (error) {
    return (
      <div className="flex gap-0.5 w-full max-w-full overflow-hidden">
        <div className="flex-1 min-w-0 p-1.5 text-xs text-red-600 border border-red-300 rounded truncate">
          Error: {error.message}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="px-1.5 h-8 flex-shrink-0"
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-0.5 w-full max-w-full overflow-hidden">
        <Select value={value} onValueChange={onValueChange} disabled={categoriesLoading}>
          <SelectTrigger className={cn("flex-1 min-w-0 h-8 text-xs", className)}>
            <SelectValue placeholder={categoriesLoading ? "Loading..." : placeholder}>
              {selectedCategory && (
                <div className="flex items-center gap-1 truncate">
                  {selectedCategory.color && (
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: selectedCategory.color }}
                    />
                  )}
                  <span className="truncate text-xs">{selectedCategory.name}</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categories.length === 0 && !categoriesLoading ? (
              <div className="p-2 text-sm text-gray-500">No categories found</div>
            ) : (
              categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  <div className="flex items-center gap-2">
                    {category.color && (
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                    )}
                    <span>{category.name}</span>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="px-1.5 h-8 flex-shrink-0"
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </div>

      {/* Create Category Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>
              Add a new category to organize your transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={newCategory.name}
                onChange={(e) =>
                  setNewCategory(prev => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., Food & Dining"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="color"
                  type="color"
                  value={newCategory.color}
                  onChange={(e) =>
                    setNewCategory(prev => ({ ...prev, color: e.target.value }))
                  }
                  className="w-12 h-10 p-1"
                />
                <Input
                  value={newCategory.color}
                  onChange={(e) =>
                    setNewCategory(prev => ({ ...prev, color: e.target.value }))
                  }
                  placeholder="#3B82F6"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateCategory}>
              Create Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
