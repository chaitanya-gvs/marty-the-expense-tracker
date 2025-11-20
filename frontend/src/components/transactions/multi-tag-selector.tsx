"use client";

import React, { useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { useTags, useCreateTag } from "@/hooks/use-tags";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Tag } from "@/lib/types";
import { toast } from "sonner";

interface MultiTagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiTagSelector({
  selectedTags,
  onTagsChange,
  placeholder = "Select tags...",
  className,
}: MultiTagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTag, setNewTag] = useState({
    name: "",
    color: "#3B82F6",
  });

  // Use hooks for data fetching
  const { data: allTags = [], isLoading: tagsLoading, error } = useTags();
  const queryClient = useQueryClient();
  const createTagMutation = useCreateTag();

  const handleCreateTag = async () => {
    if (!newTag.name.trim()) {
      toast.error("Tag name is required");
      return;
    }

    try {
      const response = await createTagMutation.mutateAsync({
        name: newTag.name,
        color: newTag.color,
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
          name: newTag.name,
          color: newTag.color,
          usage_count: 0,
        };
      }
      
      if (createdTag) {
        onTagsChange([...selectedTags, createdTag]);
        toast.success(`Tag "${newTag.name}" created successfully`);
      }
      
      setShowCreateDialog(false);
      
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

  const handleSelectTag = (tag: Tag) => {
    const isSelected = selectedTags.some(selected => selected.id === tag.id);
    if (isSelected) {
      // Remove tag
      onTagsChange(selectedTags.filter(t => t.id !== tag.id));
    } else {
      // Add tag
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleRemoveTag = (tagId: string) => {
    onTagsChange(selectedTags.filter(t => t.id !== tagId));
  };

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
      <div className={cn("space-y-2", className)}>
        {/* Selected Tags Display */}
        {selectedTags.length > 0 && (
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
        )}

        {/* Tag Selector */}
        <div className="flex gap-0.5 w-full max-w-full overflow-hidden">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className={cn("flex-1 min-w-0 h-8 text-xs justify-between", className)}
                disabled={tagsLoading}
              >
                {selectedTags.length === 0 
                  ? (tagsLoading ? "Loading..." : placeholder)
                  : `${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'} selected`
                }
                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <div className="p-2">
                {allTags.length === 0 && !tagsLoading ? (
                  <div className="p-2 text-sm text-gray-500">No tags found</div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {allTags.map((tag) => {
                      const isSelected = selectedTags.some(selected => selected.id === tag.id);
                      return (
                        <div
                          key={tag.id}
                          className="flex items-center space-x-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer"
                          onClick={() => handleSelectTag(tag)}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            {tag.color && (
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            <span className="text-sm">{tag.name}</span>
                            {tag.usage_count > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {tag.usage_count}
                              </Badge>
                            )}
                          </div>
                          {isSelected && <Check className="h-4 w-4" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            className="px-1.5 h-8 flex-shrink-0"
          >
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Create Tag Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px]">
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
            <Button onClick={handleCreateTag}>
              Create Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
