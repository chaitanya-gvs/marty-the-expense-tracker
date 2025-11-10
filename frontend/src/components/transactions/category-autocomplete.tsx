"use client";

import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/hooks/use-categories";
import { cn } from "@/lib/utils";
import { Check, X, Plus, Edit2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useUpdateCategory } from "@/hooks/use-categories";

interface CategoryAutocompleteProps {
  value: string;
  onValueChange: (value: string) => void;
  onSave?: (value?: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  transactionDirection?: "debit" | "credit"; // Transaction direction to filter categories
}

export function CategoryAutocomplete({
  value,
  onValueChange,
  onSave,
  onCancel,
  placeholder = "Type category...",
  className,
  transactionDirection,
}: CategoryAutocompleteProps) {
  // console.log("CategoryAutocomplete rendered with value:", value);
  const [inputValue, setInputValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", color: "#3B82F6" });
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", color: "#3B82F6" });
  
  // Debug: Log when creatingCategory state changes
  useEffect(() => {
    console.log("creatingCategory state changed to:", creatingCategory);
  }, [creatingCategory]);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  // Filter categories by transaction direction if provided
  const { data: categories = [], isLoading } = useCategories(transactionDirection);
  const createCategoryMutation = useCreateCategory();
  const updateCategoryMutation = useUpdateCategory();
  const deleteCategoryMutation = useDeleteCategory();

  // Filter categories based on input (exclude "uncategorized" as it's handled specially)
  const filteredCategories = categories.filter(category =>
    category.name.toLowerCase() !== "uncategorized" &&
    (inputValue.trim() === "" || 
     (category.name.toLowerCase().includes(inputValue.toLowerCase()) &&
      category.name.toLowerCase() !== inputValue.toLowerCase()))
  );

  // Check if current input matches an existing category (excluding "uncategorized")
  const exactMatch = categories.find(cat => 
    cat.name.toLowerCase() === inputValue.toLowerCase() &&
    cat.name.toLowerCase() !== "uncategorized"
  );

  // Check if we should show "create new" option
  const shouldShowCreate = inputValue.trim() && !exactMatch;
  
  // Debug logging
  // console.log("Debug - inputValue:", inputValue, "exactMatch:", exactMatch, "shouldShowCreate:", shouldShowCreate);
  // console.log("Debug - filteredCategories:", filteredCategories.map(c => c.name));
  // console.log("Debug - all categories:", categories.map(c => c.name));

  useEffect(() => {
    // If the value is "uncategorized" (case-insensitive), set to empty string
    if (value && value.toLowerCase() === "uncategorized") {
      setInputValue("");
    } else {
      setInputValue(value);
    }
  }, [value]);

  useEffect(() => {
    setShowSuggestions(true);
  }, [inputValue]);

  // Debug: Log when categories change
  // useEffect(() => {
  //   console.log("Categories loaded:", categories.length, categories.map(c => c.name));
  // }, [categories]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onValueChange(newValue);
    setHoveredIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    const hasUncategorized = inputValue.trim() === "";
    const totalItems = filteredCategories.length + (hasUncategorized ? 1 : 0) + (shouldShowCreate ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHoveredIndex(prev => (prev + 1) % totalItems);
        // Update hoveredCategoryId for keyboard navigation
        const nextIndex = (hoveredIndex + 1) % totalItems;
        if (nextIndex < filteredCategories.length) {
          setHoveredCategoryId(filteredCategories[nextIndex].id);
        } else {
          setHoveredCategoryId(null);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHoveredIndex(prev => prev <= 0 ? totalItems - 1 : prev - 1);
        // Update hoveredCategoryId for keyboard navigation
        const prevIndex = hoveredIndex <= 0 ? totalItems - 1 : hoveredIndex - 1;
        if (prevIndex < filteredCategories.length) {
          setHoveredCategoryId(filteredCategories[prevIndex].id);
        } else {
          setHoveredCategoryId(null);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (hoveredIndex >= 0) {
          if (hoveredIndex < filteredCategories.length) {
            selectCategory(filteredCategories[hoveredIndex].name);
          } else if (hasUncategorized && hoveredIndex === filteredCategories.length) {
            selectCategory("uncategorized");
          } else if (shouldShowCreate) {
            handleCreateCategory();
          }
        } else if (exactMatch) {
          onSave?.();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onCancel?.();
        break;
    }
  };

  const selectCategory = (categoryName: string) => {
    console.log("selectCategory called with:", categoryName);
    console.log("onSave function:", onSave);
    console.log("onValueChange function:", onValueChange);
    
    // If "uncategorized" is selected, clear the input and set to empty
    if (categoryName.toLowerCase() === "uncategorized") {
      setInputValue("");
      onValueChange(""); // Send empty string to backend
      console.log("Setting to uncategorized (empty)");
      setShowSuggestions(false);
      // Call onSave with the correct value
      console.log("Calling onSave with empty string");
      onSave?.("");
    } else {
      setInputValue(categoryName);
      onValueChange(categoryName);
      console.log("Setting category to:", categoryName);
      setShowSuggestions(false);
      // Call onSave with the correct value
      console.log("Calling onSave with category name:", categoryName);
      onSave?.(categoryName);
    }
  };

  const handleCreateCategory = () => {
    console.log("handleCreateCategory called with inputValue:", inputValue);
    if (!inputValue.trim()) {
      console.log("No input value, returning");
      return;
    }
    
    console.log("Setting creatingCategory to true and createForm");
    // Show the create category dialog
    setCreatingCategory(true);
    setCreateForm({ name: inputValue.trim(), color: "#3B82F6" });
  };

  const handleConfirmCreateCategory = async () => {
    if (!createForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    try {
      setIsCreating(true);
      await createCategoryMutation.mutateAsync({
        name: createForm.name.trim(),
        color: createForm.color,
        transaction_type: transactionDirection || null, // Set transaction_type based on transaction direction
      });
      
      toast.success(`Category "${createForm.name.trim()}" created successfully`);
      setInputValue(createForm.name.trim());
      onValueChange(createForm.name.trim());
      setShowSuggestions(false);
      setCreatingCategory(false);
      setCreateForm({ name: "", color: "#3B82F6" });
      
      // Call onSave when a new category is created
      setTimeout(() => {
        onSave?.();
      }, 100);
    } catch (error) {
      toast.error("Failed to create category");
      console.error("Create category error:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelCreate = () => {
    console.log("handleCancelCreate called");
    setCreatingCategory(false);
    setCreateForm({ name: "", color: "#3B82F6" });
  };

  const handleEditCategory = (category: any) => {
    setEditingCategory(category.id);
    setEditForm({ name: category.name, color: category.color || "#3B82F6" });
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editForm.name.trim()) return;

    try {
      await updateCategoryMutation.mutateAsync({
        categoryId: editingCategory,
        categoryData: {
          name: editForm.name.trim(),
          color: editForm.color,
        },
      });
      
      toast.success(`Category "${editForm.name.trim()}" updated successfully`);
      setEditingCategory(null);
      setEditForm({ name: "", color: "#3B82F6" });
    } catch (error) {
      toast.error("Failed to update category");
      console.error("Update category error:", error);
    }
  };

  const handleDeleteCategory = async () => {
    if (!editingCategory) return;

    try {
      await deleteCategoryMutation.mutateAsync(editingCategory);
      
      toast.success("Category deleted successfully");
      setEditingCategory(null);
      setEditForm({ name: "", color: "#3B82F6" });
      
      // Clear the input if the deleted category was selected
      if (inputValue === categories.find(c => c.id === editingCategory)?.name) {
        setInputValue("");
        onValueChange("");
      }
    } catch (error) {
      toast.error("Failed to delete category");
      console.error("Delete category error:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditForm({ name: "", color: "#3B82F6" });
  };

  const handleRemoveCategory = () => {
    setInputValue("");
    onValueChange("");
    // Call onSave when category is removed
    setTimeout(() => {
      onSave?.();
    }, 100);
  };

  const handleFocus = () => {
    setShowSuggestions(true);
  };

  const handleClick = () => {
    setShowSuggestions(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't hide suggestions if clicking on suggestions
    if (suggestionsRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setShowSuggestions(false);
  };

  const getCategoryColor = (categoryName: string) => {
    const category = categories.find(cat => cat.name === categoryName);
    return category?.color || "#3B82F6";
  };

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-1 w-full">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onClick={handleClick}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={cn("flex-1 h-8 text-xs", className)}
          autoFocus
        />
        
        {/* Hover actions */}
        <div className="flex gap-0.5 flex-shrink-0">
          {exactMatch && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRemoveCategory}
              className="h-6 w-6 p-0 opacity-0 hover:opacity-100 transition-opacity"
              title="Remove category"
            >
              <X className="h-3 w-3 text-red-600" />
            </Button>
          )}
          
          {inputValue.trim() && !exactMatch && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSave?.()}
              className="h-6 w-6 p-0 opacity-0 hover:opacity-100 transition-opacity"
              title="Save category"
            >
              <Check className="h-3 w-3 text-green-600" />
            </Button>
          )}
        </div>
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 z-50 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto min-w-[200px] w-max"
          onMouseLeave={() => {
            setHoveredCategoryId(null);
            setHoveredIndex(-1);
          }}
        >
          {filteredCategories.length === 0 && inputValue.trim() === "" ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              {isLoading ? "Loading categories..." : "No categories available"}
            </div>
          ) : (
            <>
              {filteredCategories.map((category, index) => (
                <div
                  key={category.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none",
                    hoveredIndex === index && "bg-gray-100 dark:bg-gray-700"
                  )}
       onMouseDown={(e) => {
         e.preventDefault();
         e.stopPropagation();
         selectCategory(category.name);
       }}
                  onMouseEnter={() => {
                    setHoveredIndex(index);
                    setHoveredCategoryId(category.id);
                  }}
                  onMouseLeave={() => {
                    // Don't clear hoveredCategoryId immediately to allow clicking the pencil
                    // It will be cleared when mouse enters another category or leaves the dropdown
                  }}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: category.color || "#3B82F6" }}
                  />
                  <span 
                    className="text-sm flex-1 cursor-pointer"
         onClick={(e) => {
           e.preventDefault();
           e.stopPropagation();
           selectCategory(category.name);
         }}
                  >
                    {category.name}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      console.log("Edit button clicked for:", category.name);
                      handleEditCategory(category);
                    }}
                    className={cn(
                      "h-5 w-5 p-0 transition-opacity",
                      hoveredCategoryId === category.id ? "opacity-100" : "opacity-0"
                    )}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </>
          )}
          
          {/* Special "Uncategorized" option */}
          {inputValue.trim() === "" && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 select-none",
                hoveredIndex === filteredCategories.length && "bg-gray-100 dark:bg-gray-700"
              )}
              onMouseEnter={() => setHoveredIndex(filteredCategories.length)}
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0 bg-gray-300 dark:bg-gray-600" />
              <span 
                className="text-sm flex-1"
                onClick={() => {
                  console.log("Uncategorized clicked");
                  selectCategory("uncategorized");
                }}
              >
                Uncategorized
              </span>
            </div>
          )}
          
          {shouldShowCreate && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 select-none",
                hoveredIndex === filteredCategories.length + (inputValue.trim() === "" ? 1 : 0) && "bg-gray-100 dark:bg-gray-700"
              )}
              onMouseEnter={() => setHoveredIndex(filteredCategories.length + (inputValue.trim() === "" ? 1 : 0))}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("Create category clicked for:", inputValue.trim());
                handleCreateCategory();
              }}
            >
              <Plus className="w-3 h-3" />
              <span className="text-sm flex-1">
                {isCreating ? "Creating..." : `Create "${inputValue.trim()}"`}
              </span>
            </div>
          )}
          {!shouldShowCreate && inputValue.trim() && (
            <div className="px-3 py-2 text-sm text-gray-500">
              Debug: shouldShowCreate is false for "{inputValue.trim()}"
            </div>
          )}
        </div>
      )}

      {/* Edit Category Dialog */}
      <Dialog open={!!editingCategory} onOpenChange={handleCancelEdit}>
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
                placeholder="e.g., Food & Dining"
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
          <DialogFooter className="flex justify-between">
            <Button
              variant="destructive"
              onClick={handleDeleteCategory}
              disabled={deleteCategoryMutation.isPending}
            >
              {deleteCategoryMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCancelEdit}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateCategory}
                disabled={updateCategoryMutation.isPending || !editForm.name.trim()}
              >
                {updateCategoryMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Edit2 className="mr-2 h-4 w-4" />
                )}
                Update
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Category Dialog */}
      <Dialog open={creatingCategory}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>
              Create a new category with a custom name and color.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="create-name">Name *</Label>
              <Input
                id="create-name"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm(prev => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., Miscellaneous"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="create-color"
                  type="color"
                  value={createForm.color}
                  onChange={(e) =>
                    setCreateForm(prev => ({ ...prev, color: e.target.value }))
                  }
                  className="w-12 h-10 p-1"
                />
                <Input
                  value={createForm.color}
                  onChange={(e) =>
                    setCreateForm(prev => ({ ...prev, color: e.target.value }))
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
              onClick={handleCancelCreate}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmCreateCategory}
              disabled={isCreating || !createForm.name.trim()}
            >
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
