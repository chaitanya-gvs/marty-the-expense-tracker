"use client";

import React, { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useParticipants } from "@/hooks/use-participants";

interface ParticipantComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onAddNew?: () => void;
  placeholder?: string;
  excludeParticipants?: string[];
  disabled?: boolean;
  container?: HTMLElement | null;
}

export function ParticipantCombobox({
  value,
  onChange,
  onAddNew,
  placeholder = "Select participant...",
  excludeParticipants = [],
  disabled = false,
  container,
}: ParticipantComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { participants, isLoading } = useParticipants(searchQuery);

  // Filter out already selected participants and "me"
  const availableParticipants = participants.filter(
    (p) => p.name !== "me" && !excludeParticipants.includes(p.name)
  );

  const handleSelect = (participantName: string) => {
    onChange(participantName === value ? "" : participantName);
    setOpen(false);
    setSearchQuery("");
  };

  const displayValue = value || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {displayValue}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[300px] p-0" 
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
        <Command shouldFilter={false} onPointerDownOutside={(e) => e.preventDefault()}>
          <CommandInput
            placeholder="Search participants..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : availableParticipants.length === 0 ? (
              <CommandEmpty>
                <div className="py-2 text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    No participants found
                  </p>
                  {onAddNew && searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        onChange(searchQuery);
                        setOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add "{searchQuery}" as participant
                    </Button>
                  )}
                </div>
              </CommandEmpty>
            ) : (
              <div className="p-1">
                {availableParticipants.map((participant) => (
                  <div
                    key={participant.id}
                    role="option"
                    aria-selected={value === participant.name}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    onClick={() => handleSelect(participant.name)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === participant.name ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="truncate">{participant.name}</span>
                      {participant.splitwise_id && (
                        <span className="text-xs text-muted-foreground">
                          Splitwise ID: {participant.splitwise_id}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {onAddNew && searchQuery && (
                  <>
                    <div className="h-px bg-border my-1" />
                    <div
                      role="option"
                      className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        onChange(searchQuery);
                        setOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add "{searchQuery}" as participant
                    </div>
                  </>
                )}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

