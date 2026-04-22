"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

interface Props {
  value: string | null;
  onChange: (projectId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ProjectPickerCombobox({
  value,
  onChange,
  placeholder = "Select a project…",
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const tree = useProjectTree();
  const selected = value ? tree.getProject(value) : null;
  const selectedGroup = selected ? tree.getGroup(selected.groupId) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between bg-card/50 border-border hover:border-primary/50",
            className,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span className="truncate text-foreground">{selected.name}</span>
              {selectedGroup ? (
                <span className="truncate text-xs text-muted-foreground">
                  in {selectedGroup.name}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover/95 backdrop-blur-xl border-border"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search projects…" />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              {tree.projects.map((p) => {
                const group = tree.getGroup(p.groupId);
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} ${group?.name ?? ""} ${p.id}`}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{p.name}</span>
                    {group ? (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">
                        {group.name}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
