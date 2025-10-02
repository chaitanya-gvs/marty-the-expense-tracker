"use client";

import { useState, useEffect, useRef } from "react";
import { Tag } from "@/lib/types";
import { useTags, useSearchTags, useUpsertTag } from "@/hooks/use-tags";
import { TagPill } from "./tag-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Plus, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TagSelector({
  selectedTags,
  onTagsChange,
  placeholder = "Select tags...",
  className,
  disabled = false,
}: TagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  
  const { data: allTags = [] } = useTags();
  const searchTagsMutation = useSearchTags();
  const upsertTagMutation = useUpsertTag();
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter available tags (exclude already selected)
  const availableTags = allTags.filter(
    (tag) => !selectedTags.some((selected) => selected.id === tag.id)
  );

  // Search tags when input changes
  useEffect(() => {
    if (inputValue.trim() && inputValue.length >= 1) {
      searchTagsMutation.mutate({ query: inputValue });
    }
  }, [inputValue, searchTagsMutation]);

  const searchResults = searchTagsMutation.data || [];
  const filteredResults = searchResults.filter(
    (tag) => !selectedTags.some((selected) => selected.id === tag.id)
  );

  // Check if current input matches any existing tag
  const exactMatch = allTags.find(
    (tag) => tag.name.toLowerCase() === inputValue.toLowerCase()
  );

  const canCreateNew = inputValue.trim() && !exactMatch && inputValue.length >= 1;

  const handleSelectTag = (tag: Tag) => {
    onTagsChange([...selectedTags, tag]);
    setInputValue("");
    setIsCreating(false);
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
    } else if (e.key === "Escape") {
      setOpen(false);
      setInputValue("");
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

      {/* Tag Selector */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            {selectedTags.length === 0 ? placeholder : `${selectedTags.length} tag${selectedTags.length === 1 ? '' : 's'} selected`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput
              ref={inputRef}
              placeholder="Search or create tags..."
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <CommandList>
              <CommandEmpty>
                {inputValue.trim() ? (
                  <div className="py-2">
                    {canCreateNew ? (
                      <Button
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={handleCreateTag}
                        disabled={isCreating}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {isCreating ? "Creating..." : `Create "${inputValue.trim()}"`}
                      </Button>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Tag already exists
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Start typing to search or create tags
                  </div>
                )}
              </CommandEmpty>
              
              {/* Search Results */}
              {filteredResults.length > 0 && (
                <CommandGroup heading="Search Results">
                  {filteredResults.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => handleSelectTag(tag)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span>{tag.name}</span>
                        {tag.usage_count > 0 && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {tag.usage_count}
                          </Badge>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Available Tags */}
              {availableTags.length > 0 && !inputValue.trim() && (
                <CommandGroup heading="All Tags">
                  {availableTags.slice(0, 10).map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => handleSelectTag(tag)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span>{tag.name}</span>
                        {tag.usage_count > 0 && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {tag.usage_count}
                          </Badge>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
