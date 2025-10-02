"use client";

import { useState, useEffect } from "react";
import { Tag } from "@/lib/types";
import { useTags, useUpsertTag } from "@/hooks/use-tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TagPill } from "./tag-pill";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CompactTagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  placeholder?: string;
  className?: string;
}

export function CompactTagSelector({
  selectedTags,
  onTagsChange,
  placeholder = "Add tags...",
  className,
}: CompactTagSelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  
  const { data: allTags = [] } = useTags();
  const upsertTagMutation = useUpsertTag();

  // Filter available tags (exclude already selected)
  const availableTags = allTags.filter(
    (tag) => !selectedTags.some((selected) => selected.id === tag.id)
  );

  // Check if current input matches any existing tag
  const exactMatch = allTags.find(
    (tag) => tag.name.toLowerCase() === inputValue.toLowerCase()
  );

  const canCreateNew = inputValue.trim() && !exactMatch && inputValue.length >= 1;

  const handleSelectTag = (tag: Tag) => {
    onTagsChange([...selectedTags, tag]);
  };

  const handleRemoveTag = (tagId: string) => {
    onTagsChange(selectedTags.filter((tag) => tag.id !== tagId));
  };

  const handleCreateTag = async () => {
    if (!canCreateNew || isCreating) return;

    setIsCreating(true);
    try {
      // Generate a random color for new tags
      const colors = [
        "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
        "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
        "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
        "#ec4899", "#f43f5e"
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const response = await upsertTagMutation.mutateAsync({
        name: inputValue.trim(),
        color: randomColor,
      });

      // Find the created tag in the list using the returned ID
      const createdTag = allTags.find((tag) => tag.id === response.data.id);
      if (createdTag) {
        handleSelectTag(createdTag);
      }
      setInputValue("");
    } catch (error) {
      console.error("Failed to create tag:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canCreateNew) {
      e.preventDefault();
      handleCreateTag();
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Selected Tags Display */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tag) => (
            <TagPill
              key={tag.id}
              tag={tag}
              onRemove={handleRemoveTag}
              variant="compact"
            />
          ))}
        </div>
      )}

      {/* Input for creating new tags */}
      <div className="flex gap-1">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-7 text-xs"
          disabled={isCreating}
        />
        <Button
          size="sm"
          onClick={handleCreateTag}
          disabled={!canCreateNew || isCreating}
          className="h-7 px-2 text-xs"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Available tags to select */}
      {availableTags.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Available tags:</div>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {availableTags.slice(0, 10).map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className="cursor-pointer text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => handleSelectTag(tag)}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
