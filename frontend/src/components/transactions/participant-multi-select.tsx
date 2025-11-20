"use client";

import React, { useState } from "react";
import { Check, ChevronsUpDown, UserPlus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useParticipants } from "@/hooks/use-participants";

interface ParticipantMultiSelectProps {
  selectedParticipants: string[];
  onChange: (participants: string[]) => void;
  placeholder?: string;
  excludeParticipants?: string[];
  disabled?: boolean;
  container?: HTMLElement | null;
}

export function ParticipantMultiSelect({
  selectedParticipants,
  onChange,
  placeholder = "Select participants...",
  excludeParticipants = [],
  disabled = false,
  container,
}: ParticipantMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { participants, isLoading } = useParticipants(searchQuery);

  // Filter out already selected participants and "me"
  const availableParticipants = participants.filter(
    (p) => p.name !== "me" && !excludeParticipants.includes(p.name)
  );

  const handleToggle = (participantName: string) => {
    if (selectedParticipants.includes(participantName)) {
      onChange(selectedParticipants.filter((p) => p !== participantName));
    } else {
      onChange([...selectedParticipants, participantName]);
    }
  };

  const handleRemove = (participantName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedParticipants.filter((p) => p !== participantName));
  };

  const handleAddNew = () => {
    if (searchQuery.trim() && !selectedParticipants.includes(searchQuery.trim())) {
      onChange([...selectedParticipants, searchQuery.trim()]);
      setSearchQuery("");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between min-h-10 h-auto py-2"
          disabled={disabled}
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedParticipants.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              selectedParticipants.map((participant) => (
                <Badge
                  key={participant}
                  variant="secondary"
                  className="mr-1 mb-1"
                >
                  {participant}
                  <span
                    className="ml-1 ring-offset-background rounded-full outline-none cursor-pointer focus:ring-2 focus:ring-ring focus:ring-offset-2 inline-flex items-center"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleRemove(participant, e as any);
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => handleRemove(participant, e)}
                    role="button"
                    tabIndex={0}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[400px] p-0" 
        align="start"
        container={container}
        onInteractOutside={(e) => {
          // Prevent closing when clicking on dialog
          const target = e.target as HTMLElement;
          if (target.closest('[role="dialog"]') || target.closest('[data-slot="dialog-overlay"]')) {
            e.preventDefault();
          }
        }}
      >
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search participants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-0 focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery.trim()) {
                handleAddNew();
              }
            }}
          />
        </div>
        <div className="max-h-[300px] overflow-auto">
          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : availableParticipants.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                No participants found
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mx-2"
                  onClick={handleAddNew}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add "{searchQuery}" as participant
                </Button>
              )}
            </div>
          ) : (
            <div className="p-1">
              {availableParticipants.map((participant) => {
                const isSelected = selectedParticipants.includes(participant.name);
                return (
                  <div
                    key={participant.id}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    onClick={() => handleToggle(participant.name)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary text-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate">{participant.name}</span>
                      {participant.splitwise_id && (
                        <span className="text-xs text-muted-foreground">
                          Splitwise ID: {participant.splitwise_id}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {searchQuery && !availableParticipants.some((p) => p.name === searchQuery) && (
                <>
                  <div className="h-px bg-border my-1" />
                  <div
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    onClick={handleAddNew}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add "{searchQuery}" as participant
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {selectedParticipants.length > 0 && (
          <div className="border-t p-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {selectedParticipants.length} participant{selectedParticipants.length !== 1 ? 's' : ''} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
