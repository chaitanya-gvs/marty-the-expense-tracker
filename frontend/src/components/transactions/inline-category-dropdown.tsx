"use client";

import React, { useState, useEffect } from "react";
import { Category } from "@/lib/types";
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from "@/hooks/use-categories";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus, X, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

interface InlineCategoryDropdownProps {
  transactionId: string;
  currentCategory: string;
  onCancel: () => void;
  onSuccess: () => void;
}

export function InlineCategoryDropdown({
  transactionId,
  currentCategory,
  onCancel,
  onSuccess,
}: InlineCategoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: "#3B82F6",
  });
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", color: "#3B82F6" });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: string; name: string } | null>(null);
  
  const { data: allCategories = [] } = useCategories();
  const updateTransaction = useUpdateTransaction();
  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const deleteCategoryMutation = useDeleteCategory();

  useEffect(() => {
    if (allCategories.length > 0 && currentCategory) {
      const category = allCategories.find(cat => cat.name === currentCategory);
      setSelectedCategory(category || null);
    }
  }, [currentCategory, allCategories]);


  // Auto-open the popover when component mounts
  useEffect(() => {
    setOpen(true);
  }, []);

  // Focus the search input when the popover opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure the popover is fully rendered
      const timer = setTimeout(() => {
        const searchInput = document.querySelector('input[placeholder="Type to search or create..."]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleSelectCategory = (category: Category) => {
    setSelectedCategory(category);
  };

  const handleClearCategory = () => {
    setSelectedCategory(null);
  };

  const handleCreateCategory = async (categoryName?: string, categoryColor?: string) => {
    const nameToCreate = categoryName || newCategory.name.trim();
    const colorToUse = categoryColor || newCategory.color;

    if (!nameToCreate) {
      toast.error("Category name is required");
      return;
    }

    try {
      const response = await createCategoryMutation.mutateAsync({
        name: nameToCreate,
        color: colorToUse,
      });

      // Find the created category in the list using the returned ID
      const createdCategory = allCategories.find((cat) => cat.id === response.data.id);
      if (createdCategory) {
        setSelectedCategory(createdCategory);
      }
      
      setShowCreateDialog(false);
      setSearchQuery("");
      
      // Reset form
      setNewCategory({
        name: "",
        color: "#3B82F6",
      });
    } catch (error) {
      // Error handling is done in the mutation
    }
  };

  const handleCreateFromSearch = () => {
    if (searchQuery.trim()) {
      // Generate a random color for quick creation
      const colors = [
        "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
        "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
        "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
        "#ec4899", "#f43f5e"
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      handleCreateCategory(searchQuery.trim(), randomColor);
    }
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category.id);
    setEditForm({ name: category.name, color: category.color || "#3B82F6" });
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    try {
      await updateCategoryMutation.mutateAsync({
        categoryId: editingCategory,
        categoryData: {
          name: editForm.name,
          color: editForm.color,
        },
      });
      
      setEditingCategory(null);
      setEditForm({ name: "", color: "#3B82F6" });
    } catch (error) {
      console.error("Update category error:", error);
    }
  };

  const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
    setCategoryToDelete({ id: categoryId, name: categoryName });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;
    
    try {
      await deleteCategoryMutation.mutateAsync(categoryToDelete.id);
      
      // Clear the category if it was selected
      if (selectedCategory?.id === categoryToDelete.id) {
        setSelectedCategory(null);
      }
    } catch (error) {
      console.error("Delete category error:", error);
    } finally {
      setCategoryToDelete(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditForm({ name: "", color: "#3B82F6" });
  };

  const handleSave = async () => {
    try {
      await updateTransaction.mutateAsync({
        id: transactionId,
        updates: {
          category: selectedCategory?.name || "",
        },
      });
      toast.success("Category updated successfully");
      setOpen(false); // Close the popover
      onSuccess();
    } catch (error) {
      toast.error("Failed to update category");
      console.error("Update category error:", error);
    }
  };

  const handleCancel = () => {
    setOpen(false); // Close the popover
    onCancel(); // This will unmount the component and return to the transaction view
  };

  const availableCategories = allCategories.filter(
    (category) => 
      searchQuery === "" || category.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if search query matches any existing category
  const exactMatch = allCategories.find(
    (category) => category.name.toLowerCase() === searchQuery.toLowerCase()
  );

  const canCreateFromSearch = searchQuery.trim() && !exactMatch && searchQuery.length >= 1;

  return (
    <>
      <div className="flex gap-1 w-full max-w-[200px]">
        <Popover 
          open={open} 
          modal={false}
          onOpenChange={(newOpen) => {
            setOpen(newOpen);
            if (!newOpen) {
              // If popover is being closed, call onCancel to return to transaction view
              onCancel();
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="flex-1 min-w-0 h-7 text-xs justify-between"
            >
              {!selectedCategory 
                ? "Select category..."
                : selectedCategory.name
              }
              <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent 
            className="w-64 p-2" 
            align="start"
            onInteractOutside={(e) => {
              // Prevent closing when clicking on dialogs
              const target = e.target as HTMLElement;
              if (target.closest('[role="dialog"]')) {
                e.preventDefault();
              }
            }}
          >
          <div className="space-y-2">
            {/* Search Input */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Search or create category:
              </div>
              <div className="flex gap-1">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type to search or create..."
                  className="h-7 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canCreateFromSearch) {
                      e.preventDefault();
                      handleCreateFromSearch();
                    }
                  }}
                />
                {canCreateFromSearch && (
                  <Button
                    size="sm"
                    onClick={handleCreateFromSearch}
                    className="h-7 px-2 text-xs"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {/* Selected Category Display */}
            {selectedCategory && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Selected:
                </div>
                <div className="flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className="inline-flex items-center gap-1 text-xs"
                    style={{
                      backgroundColor: selectedCategory.color ? `${selectedCategory.color}20` : undefined,
                      borderColor: selectedCategory.color ? `${selectedCategory.color}40` : undefined,
                      color: selectedCategory.color || undefined,
                    }}
                  >
                    <span>{selectedCategory.name}</span>
                    <button
                      onClick={handleClearCategory}
                      className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                </div>
              </div>
            )}

            {/* Available Categories */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {searchQuery ? "Search Results:" : "Available:"}
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {availableCategories.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    {searchQuery ? "No matching categories found" : "No categories available"}
                  </div>
                ) : (
                  availableCategories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center space-x-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer group"
                      onMouseEnter={() => setHoveredCategoryId(category.id)}
                      onMouseLeave={() => setHoveredCategoryId(null)}
                    >
                      <div 
                        className="flex items-center gap-2 flex-1 cursor-pointer"
                        onClick={() => handleSelectCategory(category)}
                      >
                        {category.color && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                        )}
                        <span className="text-xs">{category.name}</span>
                        {selectedCategory?.id === category.id && (
                          <Check className="ml-auto h-3 w-3 text-blue-600" />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleEditCategory(category);
                          }}
                          className={cn(
                            "h-5 w-5 p-0 transition-opacity",
                            hoveredCategoryId === category.id ? "opacity-100" : "opacity-0"
                          )}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteCategory(category.id, category.name);
                          }}
                          className={cn(
                            "inline-flex items-center justify-center h-5 w-5 p-0 rounded-md transition-opacity hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 hover:text-red-700",
                            hoveredCategoryId === category.id ? "opacity-100" : "opacity-0"
                          )}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Create Category Button */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowCreateDialog(true);
                }}
                className="w-full h-6 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                Create New Category
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={updateTransaction.isPending}
                className="h-6 px-2 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateTransaction.isPending}
                className="h-6 px-2 text-xs"
              >
                Save
              </Button>
            </div>
          </div>
          </PopoverContent>
        </Popover>
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
                placeholder="e.g., Food & Dining, Transport"
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
            <Button onClick={() => handleCreateCategory()}>
              Create Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog 
        open={!!editingCategory} 
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            handleCancelEdit();
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>
              Update the category name and color.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm(prev => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., Food & Dining, Transport"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-color"
                  type="color"
                  value={editForm.color}
                  onChange={(e) =>
                    setEditForm(prev => ({ ...prev, color: e.target.value }))
                  }
                  className="w-12 h-10 p-1"
                />
                <Input
                  value={editForm.color}
                  onChange={(e) =>
                    setEditForm(prev => ({ ...prev, color: e.target.value }))
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
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateCategory}>
              Update Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Category"
        description={`Are you sure you want to delete the category "${categoryToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete Category"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setCategoryToDelete(null)}
      />
    </>
  );
}

