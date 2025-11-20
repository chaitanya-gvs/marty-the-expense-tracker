"use client";

import React, { useState, useEffect } from "react";
import { Tag } from "@/lib/types";
import { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "@/hooks/use-tags";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface InlineTagDropdownProps {
  transactionId: string;
  currentTags: string[];
  onCancel: () => void;
  onSuccess: () => void;
}

export function InlineTagDropdown({
  transactionId,
  currentTags,
  onCancel,
  onSuccess,
}: InlineTagDropdownProps) {
  const [open, setOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  // Debug: Log when showCreateDialog changes
  useEffect(() => {
    console.log("showCreateDialog changed to:", showCreateDialog);
  }, [showCreateDialog]);
  const [newTag, setNewTag] = useState({
    name: "",
    color: "#3B82F6",
  });
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", color: "#3B82F6" });
  
  const { data: allTags = [] } = useTags();
  const queryClient = useQueryClient();
  const updateTransaction = useUpdateTransaction();
  const createTagMutation = useCreateTag();
  const updateTagMutation = useUpdateTag();
  const deleteTagMutation = useDeleteTag();

  useEffect(() => {
    if (allTags.length > 0) {
      const initialTags = currentTags
        .map(tagName => allTags.find(tag => tag.name === tagName))
        .filter((tag): tag is Tag => tag !== undefined);
      setSelectedTags(initialTags);
    }
  }, [currentTags, allTags]);

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

  const handleSelectTag = (tag: Tag) => {
    const isSelected = selectedTags.some(selected => selected.id === tag.id);
    if (isSelected) {
      setSelectedTags(selectedTags.filter(t => t.id !== tag.id));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleRemoveTag = (tagId: string) => {
    setSelectedTags(selectedTags.filter(t => t.id !== tagId));
  };

  const handleCreateTag = async (tagName?: string, tagColor?: string) => {
    const nameToCreate = tagName || newTag.name.trim();
    const colorToUse = tagColor || newTag.color;

    if (!nameToCreate) {
      toast.error("Tag name is required");
      return;
    }

    try {
      const response = await createTagMutation.mutateAsync({
        name: nameToCreate,
        color: colorToUse,
      });

      // The backend returns {id: tag_id}, so we need to fetch the full tag
      const tagId = response.data?.id || (response.data as any)?.id;
      
      if (!tagId) {
        throw new Error("Tag ID not returned from server");
      }

      // Fetch the full tag details
      let createdTag: Tag | null = null;
      try {
        const tagResponse = await apiClient.getTag(tagId);
        createdTag = tagResponse.data;
      } catch (fetchError) {
        console.error("Failed to fetch created tag:", fetchError);
        // Fallback: create a temporary tag object
        createdTag = {
          id: tagId,
          name: nameToCreate,
          color: colorToUse,
          usage_count: 0,
        };
      }
      
      if (createdTag) {
        setSelectedTags([...selectedTags, createdTag]);
        toast.success(`Tag "${nameToCreate}" created successfully`);
      }
      
      setShowCreateDialog(false);
      setSearchQuery("");
      
      // Reset form
      setNewTag({
        name: "",
        color: "#3B82F6",
      });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || "Failed to create tag";
      toast.error(errorMessage);
      console.error("Create tag error:", error);
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
      handleCreateTag(searchQuery.trim(), randomColor);
    }
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag.id);
    setEditForm({ name: tag.name, color: tag.color || "#3B82F6" });
  };

  const handleUpdateTag = async () => {
    if (!editingTag || !editForm.name.trim()) {
      toast.error("Tag name is required");
      return;
    }

    try {
      await updateTagMutation.mutateAsync({
        id: editingTag,
        updates: {
          name: editForm.name,
          color: editForm.color,
        },
      });
      
      toast.success("Tag updated successfully");
      setEditingTag(null);
      setEditForm({ name: "", color: "#3B82F6" });
    } catch (error) {
      toast.error("Failed to update tag");
      console.error("Update tag error:", error);
    }
  };

  const handleDeleteTag = async (tagId: string, tagName: string) => {
    try {
      await deleteTagMutation.mutateAsync(tagId);
      
      // Remove the tag from selected tags if it was selected
      setSelectedTags(selectedTags.filter(tag => tag.id !== tagId));
      
      toast.success(`Tag "${tagName}" deleted successfully`);
    } catch (error) {
      toast.error(`Failed to delete tag "${tagName}"`);
      console.error("Delete tag error:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditForm({ name: "", color: "#3B82F6" });
  };

  const handleSave = async () => {
    try {
      await updateTransaction.mutateAsync({
        id: transactionId,
        updates: {
          tags: selectedTags.map(tag => tag.name),
        },
      });
      toast.success("Tags updated successfully");
      setOpen(false); // Close the popover
      onSuccess();
    } catch (error) {
      toast.error("Failed to update tags");
      console.error("Update tags error:", error);
    }
  };

  const handleCancel = () => {
    setOpen(false); // Close the popover
    onCancel(); // This will unmount the component and return to the transaction view
  };

  const availableTags = allTags.filter(
    (tag) => !selectedTags.some((selected) => selected.id === tag.id) &&
    (searchQuery === "" || tag.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Check if search query matches any existing tag
  const exactMatch = allTags.find(
    (tag) => tag.name.toLowerCase() === searchQuery.toLowerCase()
  );

  const canCreateFromSearch = searchQuery.trim() && !exactMatch && searchQuery.length >= 1;

  return (
    <div className="flex gap-1 w-full max-w-[200px]">
      <Popover open={open} onOpenChange={(newOpen) => {
        // Don't close the popover if the create dialog is opening
        if (!newOpen && !showCreateDialog) {
        setOpen(newOpen);
          // If popover is being closed, call onCancel to return to transaction view
          onCancel();
        } else if (newOpen) {
          setOpen(newOpen);
        }
      }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="flex-1 min-w-0 h-7 text-xs justify-between"
          >
            {selectedTags.length === 0 
              ? "Select tags..."
              : `${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'}`
            }
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-64 p-2" 
          align="start"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on dialog
            const target = e.target as HTMLElement;
            if (target.closest('[role="dialog"]') || target.closest('[data-slot="dialog-overlay"]')) {
              e.preventDefault();
            }
          }}
        >
          <div className="space-y-2">
            {/* Search Input */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Search or create tags:
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

            {/* Selected Tags Display */}
            {selectedTags.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Selected:
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="inline-flex items-center gap-1 text-xs"
                      style={{
                        backgroundColor: tag.color ? `${tag.color}20` : undefined,
                        borderColor: tag.color ? `${tag.color}40` : undefined,
                        color: tag.color || undefined,
                      }}
                    >
                      <span>{tag.name}</span>
                      <button
                        onClick={() => handleRemoveTag(tag.id)}
                        className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Available Tags */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {searchQuery ? "Search Results:" : "Available:"}
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {availableTags.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    {searchQuery ? "No matching tags found" : "No tags available"}
                  </div>
                ) : (
                  availableTags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center space-x-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer group"
                      onMouseEnter={() => setHoveredTagId(tag.id)}
                      onMouseLeave={() => setHoveredTagId(null)}
                    >
                      <div 
                        className="flex items-center gap-2 flex-1 cursor-pointer"
                        onClick={() => handleSelectTag(tag)}
                      >
                        {tag.color && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                        )}
                        <span className="text-xs">{tag.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditTag(tag);
                          }}
                          className={cn(
                            "h-5 w-5 p-0 transition-opacity",
                            hoveredTagId === tag.id ? "opacity-100" : "opacity-0"
                          )}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                "h-5 w-5 p-0 transition-opacity text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20",
                                hoveredTagId === tag.id ? "opacity-100" : "opacity-0"
                              )}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Tag</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete the tag "{tag.name}"? 
                                {tag.usage_count && tag.usage_count > 0 && (
                                  <span className="block mt-2 text-amber-600 dark:text-amber-400 font-medium">
                                    ⚠️ This tag is currently used in {tag.usage_count} transaction{tag.usage_count === 1 ? '' : 's'}. 
                                    Deleting it will remove the tag from all those transactions.
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteTag(tag.id, tag.name)}
                                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                              >
                                Delete Tag
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Create Tag Button */}
            <div 
              className="pt-2 border-t border-gray-100 dark:border-gray-700"
              onClick={(e) => {
                console.log("Create Tag button container clicked!", e);
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                console.log("Create Tag button container mouseDown!", e);
                e.stopPropagation();
              }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowCreateDialog(true);
                }}
                className="w-full h-6 text-xs"
                type="button"
              >
                <Plus className="mr-1 h-3 w-3" />
                Create New Tag
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

      {/* Create Tag Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog} modal={true}>
        <DialogContent className="sm:max-w-[425px] z-[200]">
          <DialogHeader>
            <DialogTitle>Create New Tag</DialogTitle>
            <DialogDescription>
              Add a new tag to organize your transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={newTag.name}
                onChange={(e) =>
                  setNewTag(prev => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., Business, Personal, Travel"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="color"
                  type="color"
                  value={newTag.color}
                  onChange={(e) =>
                    setNewTag(prev => ({ ...prev, color: e.target.value }))
                  }
                  className="w-12 h-10 p-1"
                />
                <Input
                  value={newTag.color}
                  onChange={(e) =>
                    setNewTag(prev => ({ ...prev, color: e.target.value }))
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
            <Button onClick={() => handleCreateTag()}>
              Create Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tag Dialog */}
      <Dialog open={!!editingTag} onOpenChange={handleCancelEdit}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Tag</DialogTitle>
            <DialogDescription>
              Update the tag name and color.
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
                placeholder="e.g., Business, Personal, Travel"
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
            <Button onClick={handleUpdateTag}>
              Update Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
