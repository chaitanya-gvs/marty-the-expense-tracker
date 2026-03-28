"use client";

import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

interface FieldAutocompleteProps {
  fieldName: string;
  value: string;
  onValueChange: (value: string) => void;
  onSave?: (value?: string) => void;
  onCancel?: () => void;
  onTabNext?: () => void;
  onTabPrevious?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function FieldAutocomplete({
  fieldName,
  value,
  onValueChange,
  onSave,
  onCancel,
  onTabNext,
  onTabPrevious,
  placeholder = "Type to search...",
  className,
  disabled = false,
}: FieldAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch suggestions based on current input
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["field-values", fieldName, inputValue],
    queryFn: async () => {
      const response = await apiClient.getFieldValues(
        fieldName,
        inputValue.trim() || undefined,
        20
      );
      return response.data || [];
    },
    enabled: showSuggestions,
    staleTime: 60000, // Cache for 1 minute
  });

  // Filter suggestions to show only those that aren't exact matches
  const filteredSuggestions = suggestions.filter(
    (suggestion) => suggestion.toLowerCase() !== inputValue.toLowerCase()
  );

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onValueChange(newValue);
    setHoveredIndex(-1);
    setShowSuggestions(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // Always prevent default and stop propagation to avoid form submission
      e.preventDefault();
      e.stopPropagation();

      if (!showSuggestions || filteredSuggestions.length === 0) {
        onSave?.(inputValue);
        return;
      }

      // Handle Enter with suggestions
      if (hoveredIndex >= 0 && hoveredIndex < filteredSuggestions.length) {
        selectSuggestion(filteredSuggestions[hoveredIndex]);
      } else {
        onSave?.(inputValue);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      // If suggestions are active and an item is hovered, select it
      if (showSuggestions && hoveredIndex >= 0 && hoveredIndex < filteredSuggestions.length) {
        const suggestion = filteredSuggestions[hoveredIndex];
        setInputValue(suggestion);
        onValueChange(suggestion);
        // Save using the suggestion logic but we handle navigation manually here
        onSave?.(suggestion);
      } else {
        // Just save current input
        onSave?.(inputValue);
      }

      // Navigate
      if (e.shiftKey) {
        onTabPrevious?.();
      } else {
        onTabNext?.();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (showSuggestions) {
        setShowSuggestions(false);
      } else {
        onCancel?.();
      }
      return;
    }

    if (!showSuggestions || filteredSuggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHoveredIndex((prev) => (prev + 1) % filteredSuggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHoveredIndex((prev) =>
          prev <= 0 ? filteredSuggestions.length - 1 : prev - 1
        );
        break;
    }
  };

  const selectSuggestion = (suggestion: string) => {
    setInputValue(suggestion);
    onValueChange(suggestion);
    setShowSuggestions(false);
    // Automatically save when a suggestion is selected
    setTimeout(() => {
      onSave?.(suggestion);
    }, 0);
  };

  const handleFocus = () => {
    setShowSuggestions(true);
  };

  const handleBlur = () => {
    setShowSuggestions(false);
  };

  return (
    <Popover open={showSuggestions && (filteredSuggestions.length > 0 || isLoading)}>
      <PopoverAnchor asChild>
        <div className="w-full">
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            className={cn("w-full", className)}
            autoFocus
            disabled={disabled}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 max-h-60 overflow-y-auto"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseLeave={() => setHoveredIndex(-1)}
      >
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading suggestions...
          </div>
        ) : (
          filteredSuggestions.map((suggestion, index) => (
            <div
              key={`${suggestion}-${index}`}
              className={cn(
                "px-3 py-2 cursor-pointer select-none text-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                hoveredIndex === index && "bg-accent text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(suggestion);
              }}
              onMouseEnter={() => setHoveredIndex(index)}
            >
              {suggestion}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

