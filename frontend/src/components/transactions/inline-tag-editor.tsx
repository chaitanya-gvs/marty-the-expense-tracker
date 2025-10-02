"use client";

import { useState, useEffect } from "react";
import { Tag } from "@/lib/types";
import { useTags } from "@/hooks/use-tags";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { MultiTagSelector } from "./multi-tag-selector";
import { Button } from "@/components/ui/button";
import { X, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InlineTagEditorProps {
  transactionId: string;
  currentTags: string[];
  onCancel: () => void;
  onSuccess: () => void;
  className?: string;
}

export function InlineTagEditor({
  transactionId,
  currentTags,
  onCancel,
  onSuccess,
  className,
}: InlineTagEditorProps) {
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const { data: allTags = [] } = useTags();
  const updateTransaction = useUpdateTransaction();

  // Convert string tags to Tag objects on mount
  useEffect(() => {
    if (currentTags && currentTags.length > 0 && allTags.length > 0) {
      const tagObjects = currentTags
        .map(tagName => allTags.find(tag => tag.name === tagName))
        .filter((tag): tag is Tag => tag !== undefined);
      setSelectedTags(tagObjects);
    } else {
      setSelectedTags([]);
    }
  }, [currentTags, allTags]);

  const handleSave = async () => {
    try {
      await updateTransaction.mutateAsync({
        id: transactionId,
        updates: {
          tags: selectedTags.map(tag => tag.name),
        },
      });
      
      toast.success("Tags updated successfully");
      onSuccess();
    } catch (error) {
      toast.error("Failed to update tags");
      console.error("Update error:", error);
    }
  };

  return (
    <div className={cn("bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 w-80", className)}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-900 dark:text-white">
          Edit Tags
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-5 w-5 p-0"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      
      <div className="space-y-3">
        <MultiTagSelector
          selectedTags={selectedTags}
          onTagsChange={setSelectedTags}
          placeholder="Select tags..."
        />
        
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={updateTransaction.isPending}
            className="h-7 px-3 text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateTransaction.isPending}
            className="h-7 px-3 text-xs"
          >
            {updateTransaction.isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Save
              </>
            ) : (
              <>
                <Save className="mr-1 h-3 w-3" />
                Save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
