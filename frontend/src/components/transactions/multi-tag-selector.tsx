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
import { Input } from "@/components/ui/input";
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTag, setNewTag] = useState({
    name: "",
    color: "#3B82F6",
  });

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

      const tagId = response.data?.id || (response.data as any)?.id;

      if (!tagId) {
        throw new Error("Tag ID not returned from server");
      }

      let createdTag: Tag | null = null;
      try {
        const tagResponse = await apiClient.getTag(tagId);
        createdTag = tagResponse.data;
      } catch (fetchError) {
        createdTag = {
          id: tagId,
          name: newTag.name,
          color: newTag.color,
          usage_count: 0,
        };
      }

      if (createdTag) {
        onTagsChange([...selectedTags, createdTag]);
        toast.success(`Tag "${newTag.name}" created`);
      }

      setShowCreateForm(false);
      setNewTag({ name: "", color: "#3B82F6" });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.detail || error?.message || "Failed to create tag";
      toast.error(errorMessage);
    }
  };

  const handleSelectTag = (tag: Tag) => {
    const isSelected = selectedTags.some(selected => selected.id === tag.id);
    if (isSelected) {
      onTagsChange(selectedTags.filter(t => t.id !== tag.id));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleRemoveTag = (tagId: string) => {
    onTagsChange(selectedTags.filter(t => t.id !== tagId));
  };

  if (error) {
    return (
      <div className="p-1.5 text-xs text-destructive border border-destructive/30 rounded">
        Error loading tags: {error.message}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Selected Tags */}
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
                type="button"
                onClick={() => handleRemoveTag(tag.id)}
                className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Tag Selector + Add Button */}
      <div className="flex gap-0.5 w-full max-w-full overflow-hidden">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn("flex-1 min-w-0 h-8 text-xs justify-between", className)}
              disabled={tagsLoading}
            >
              {selectedTags.length === 0
                ? (tagsLoading ? "Loading..." : placeholder)
                : `${selectedTags.length} tag${selectedTags.length === 1 ? "" : "s"} selected`}
              <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <div className="p-2">
              {allTags.length === 0 && !tagsLoading ? (
                <div className="p-2 text-sm text-muted-foreground">No tags found</div>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {allTags.map((tag) => {
                    const isSelected = selectedTags.some(s => s.id === tag.id);
                    return (
                      <div
                        key={tag.id}
                        className="flex items-center space-x-2 p-2 hover:bg-primary/10 rounded cursor-pointer"
                        onClick={() => handleSelectTag(tag)}
                      >
                        <div className="flex items-center gap-2 flex-1">
                          {tag.color && (
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                          )}
                          <span className="text-sm">{tag.name}</span>
                          {tag.usage_count > 0 && (
                            <Badge variant="outline" className="text-xs">{tag.usage_count}</Badge>
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
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCreateForm(v => !v)}
          className="px-1.5 h-8 flex-shrink-0"
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </div>

      {/* Inline Create Tag Form */}
      {showCreateForm && (
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">New tag</p>
          <div className="flex gap-2">
            <Input
              value={newTag.name}
              onChange={(e) => setNewTag(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Tag name"
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); }
                if (e.key === "Escape") { setShowCreateForm(false); setNewTag({ name: "", color: "#3B82F6" }); }
              }}
              autoFocus
            />
            <input
              type="color"
              value={newTag.color}
              onChange={(e) => setNewTag(prev => ({ ...prev, color: e.target.value }))}
              className="h-7 w-7 rounded border border-border cursor-pointer bg-transparent p-0.5"
              title="Tag color"
            />
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => { setShowCreateForm(false); setNewTag({ name: "", color: "#3B82F6" }); }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={handleCreateTag}
              disabled={createTagMutation.isPending || !newTag.name.trim()}
            >
              {createTagMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
