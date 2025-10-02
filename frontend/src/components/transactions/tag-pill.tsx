"use client";

import { Tag } from "@/lib/types";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagPillProps {
  tag: Tag;
  onRemove?: (tagId: string) => void;
  variant?: "default" | "compact";
  className?: string;
}

export function TagPill({ tag, onRemove, variant = "default", className }: TagPillProps) {
  const isCompact = variant === "compact";
  
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs font-medium transition-colors",
        isCompact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs",
        className
      )}
      style={{
        backgroundColor: tag.color ? `${tag.color}20` : undefined,
        borderColor: tag.color ? `${tag.color}40` : undefined,
        color: tag.color || undefined,
      }}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          onClick={() => onRemove(tag.id)}
          className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
          aria-label={`Remove ${tag.name} tag`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

interface TagPillsProps {
  tags: Tag[];
  onRemove?: (tagId: string) => void;
  variant?: "default" | "compact";
  maxVisible?: number;
  className?: string;
}

export function TagPills({ 
  tags, 
  onRemove, 
  variant = "default", 
  maxVisible = 3,
  className 
}: TagPillsProps) {
  const visibleTags = tags.slice(0, maxVisible);
  const remainingCount = tags.length - maxVisible;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visibleTags.map((tag) => (
        <TagPill
          key={tag.id}
          tag={tag}
          onRemove={onRemove}
          variant={variant}
        />
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-muted-foreground">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}
