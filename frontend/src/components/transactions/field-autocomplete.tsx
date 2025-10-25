"use client";

import React, { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";

interface FieldAutocompleteProps {
  fieldName: string;
  value: string;
  onValueChange: (value: string) => void;
  onSave?: (value?: string) => void;
  onCancel?: () => void;
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
  placeholder = "Type to search...",
  className,
  disabled = false,
}: FieldAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
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
    if (!showSuggestions || filteredSuggestions.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave?.(inputValue);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
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
      case 'Enter':
        e.preventDefault();
        if (hoveredIndex >= 0 && hoveredIndex < filteredSuggestions.length) {
          selectSuggestion(filteredSuggestions[hoveredIndex]);
        } else {
          onSave?.(inputValue);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (showSuggestions) {
          setShowSuggestions(false);
        } else {
          onCancel?.();
        }
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

  const handleBlur = (e: React.FocusEvent) => {
    // Don't hide suggestions if clicking on suggestions
    if (suggestionsRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setShowSuggestions(false);
  };

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
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

      {/* Suggestions dropdown */}
      {showSuggestions && (filteredSuggestions.length > 0 || isLoading) && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 z-50 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto min-w-full"
          onMouseLeave={() => setHoveredIndex(-1)}
        >
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading suggestions...
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              No suggestions found
            </div>
          ) : (
            filteredSuggestions.map((suggestion, index) => (
              <div
                key={`${suggestion}-${index}`}
                className={cn(
                  "px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none text-sm",
                  hoveredIndex === index && "bg-gray-100 dark:bg-gray-700"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectSuggestion(suggestion);
                }}
                onMouseEnter={() => setHoveredIndex(index)}
              >
                {suggestion}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

