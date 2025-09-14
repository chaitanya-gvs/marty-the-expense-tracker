"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCategories, useCreateCategory, useUpdateCategory } from "@/hooks/use-categories";
import { Plus, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { Category, Subcategory } from "@/lib/types";

export function CategoriesManager() {
  const { data: categoriesData, isLoading } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  
  const categories = categoriesData?.data || [];
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: "#3b82f6",
    subcategories: [],
    is_hidden: false,
  });

  const handleCreateCategory = async () => {
    await createCategory.mutateAsync(newCategory);
    setNewCategory({ name: "", color: "#3b82f6", subcategories: [], is_hidden: false });
    setIsCreateDialogOpen(false);
  };

  const handleToggleVisibility = async (category: Category) => {
    await updateCategory.mutateAsync({
      id: category.id,
      updates: { is_hidden: !category.is_hidden }
    });
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
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCategory} disabled={!newCategory.name}>
                    Create Category
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {categories.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No categories created yet. Create your first category to organize your transactions.
            </div>
          ) : (
            categories.map((category) => (
              <div
                key={category.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    <h3 className="font-medium">{category.name}</h3>
                    {category.is_hidden && (
                      <Badge variant="outline" className="text-xs">
                        Hidden
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingCategory(category)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleVisibility(category)}
                    >
                      {category.is_hidden ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                
                {category.subcategories && category.subcategories.length > 0 && (
                  <div className="ml-7">
                    <h4 className="text-sm font-medium text-gray-600 mb-2">Subcategories</h4>
                    <div className="flex flex-wrap gap-2">
                      {category.subcategories.map((subcategory) => (
                        <div
                          key={subcategory.id}
                          className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-sm"
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: subcategory.color }}
                          />
                          <span>{subcategory.name}</span>
                          {subcategory.is_hidden && (
                            <EyeOff className="h-3 w-3 text-gray-400" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
