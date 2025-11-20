"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories, useCreateCategory, useUpdateCategory } from "@/hooks/use-categories";
import { Plus, Edit } from "lucide-react";
import { Category } from "@/lib/types";

type TransactionTypeFilter = "all" | "debit" | "credit";

export function CategoriesManager() {
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<TransactionTypeFilter>("all");
  // Always load all categories, then filter client-side for better UX
  const { data: allCategories, isLoading } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  
  const categories = allCategories || [];
  
  // Filter categories based on selected filter
  const categoriesToDisplay = categories.filter((category) => {
    if (transactionTypeFilter === "all") return true;
    // Show categories that match the filter OR have no transaction_type (applicable to both)
    return category.transaction_type === transactionTypeFilter || !category.transaction_type;
  });

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: "#3b82f6",
    transaction_type: null as "debit" | "credit" | null,
  });
  const [editCategory, setEditCategory] = useState({
    name: "",
    color: "#3b82f6",
    transaction_type: null as "debit" | "credit" | null,
  });

  useEffect(() => {
    if (editingCategory) {
      setEditCategory({
        name: editingCategory.name,
        color: editingCategory.color || "#3b82f6",
        transaction_type: editingCategory.transaction_type || null,
      });
      setIsEditDialogOpen(true);
    }
  }, [editingCategory]);

  const handleCreateCategory = async () => {
    try {
      await createCategory.mutateAsync(newCategory);
      setNewCategory({ name: "", color: "#3b82f6", transaction_type: null });
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error("Failed to create category:", error);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) return;
    try {
      await updateCategory.mutateAsync({
        categoryId: editingCategory.id,
        categoryData: editCategory,
      });
      setEditingCategory(null);
      setEditCategory({ name: "", color: "#3b82f6", transaction_type: null });
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error("Failed to update category:", error);
    }
  };

  const getTransactionTypeBadge = (transactionType: string | null | undefined) => {
    if (!transactionType) {
      return <Badge variant="secondary" className="text-xs">Both</Badge>;
    }
    if (transactionType === "debit") {
      return <Badge variant="destructive" className="text-xs">Debit</Badge>;
    }
    if (transactionType === "credit") {
      return <Badge variant="default" className="text-xs bg-green-600">Credit</Badge>;
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Categories</CardTitle>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Category</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="category-name">Name</Label>
                  <Input
                    id="category-name"
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                    placeholder="Enter category name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category-color">Color</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="category-color"
                      type="color"
                      value={newCategory.color}
                      onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
                      className="w-16 h-10"
                    />
                    <Input
                      value={newCategory.color}
                      onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
                      placeholder="#3b82f6"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category-transaction-type">Transaction Type</Label>
                  <Select
                    value={newCategory.transaction_type || "both"}
                    onValueChange={(value) =>
                      setNewCategory({
                        ...newCategory,
                        transaction_type: value === "both" ? null : (value as "debit" | "credit"),
                      })
                    }
                  >
                    <SelectTrigger id="category-transaction-type">
                      <SelectValue placeholder="Select transaction type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both (Debit & Credit)</SelectItem>
                      <SelectItem value="debit">Debit Only</SelectItem>
                      <SelectItem value="credit">Credit Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Select which transaction types this category applies to
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCategory} disabled={!newCategory.name}>
                    Create Category
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Filter Tabs */}
          <Tabs value={transactionTypeFilter} onValueChange={(value) => setTransactionTypeFilter(value as TransactionTypeFilter)}>
            <TabsList>
              <TabsTrigger value="all">All Categories</TabsTrigger>
              <TabsTrigger value="debit">Debit Only</TabsTrigger>
              <TabsTrigger value="credit">Credit Only</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Categories List */}
          {categoriesToDisplay.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {transactionTypeFilter === "all" 
                ? "No categories created yet. Create your first category to organize your transactions."
                : `No ${transactionTypeFilter} categories found.`}
            </div>
          ) : (
            <div className="space-y-3">
              {categoriesToDisplay.map((category) => (
                <div
                  key={category.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: category.color || "#3b82f6" }}
                      />
                      <h3 className="font-medium">{category.name}</h3>
                      {getTransactionTypeBadge(category.transaction_type)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingCategory(category)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {/* Edit Category Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) {
          setEditingCategory(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category-name">Name</Label>
              <Input
                id="edit-category-name"
                value={editCategory.name}
                onChange={(e) => setEditCategory({ ...editCategory, name: e.target.value })}
                placeholder="Enter category name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-category-color"
                  type="color"
                  value={editCategory.color}
                  onChange={(e) => setEditCategory({ ...editCategory, color: e.target.value })}
                  className="w-16 h-10"
                />
                <Input
                  value={editCategory.color}
                  onChange={(e) => setEditCategory({ ...editCategory, color: e.target.value })}
                  placeholder="#3b82f6"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category-transaction-type">Transaction Type</Label>
              <Select
                value={editCategory.transaction_type || "both"}
                onValueChange={(value) =>
                  setEditCategory({
                    ...editCategory,
                    transaction_type: value === "both" ? null : (value as "debit" | "credit"),
                  })
                }
              >
                <SelectTrigger id="edit-category-transaction-type">
                  <SelectValue placeholder="Select transaction type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both (Debit & Credit)</SelectItem>
                  <SelectItem value="debit">Debit Only</SelectItem>
                  <SelectItem value="credit">Credit Only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select which transaction types this category applies to
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsEditDialogOpen(false);
                setEditingCategory(null);
              }}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCategory} disabled={!editCategory.name}>
                Save Changes
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
