"use client";

import { useState, useCallback, type KeyboardEvent } from "react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxTags?: number;
  validate?: (tag: string) => boolean;
}

/**
 * TagInput - A reusable component for editing string arrays
 *
 * Used for:
 * - permissions.allow, permissions.ask, permissions.deny
 * - sandbox.excludedCommands
 * - tools.shell.allowedCommands
 * - autoAccept.patterns
 */
export function TagInput({
  value,
  onChange,
  placeholder = "Add item...",
  disabled = false,
  className,
  maxTags,
  validate,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addTag = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    if (maxTags && value.length >= maxTags) return;
    if (validate && !validate(trimmed)) return;

    onChange([...value, trimmed]);
    setInputValue("");
  }, [inputValue, value, onChange, maxTags, validate]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onChange(value.filter((tag) => tag !== tagToRemove));
    },
    [value, onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag();
      } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
        removeTag(value[value.length - 1]);
      }
    },
    [addTag, inputValue, value, removeTag]
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || (maxTags !== undefined && value.length >= maxTags)}
          className="flex-1 bg-input border-border text-foreground"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={addTag}
          disabled={disabled || !inputValue.trim() || (maxTags !== undefined && value.length >= maxTags)}
          className="shrink-0"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="pr-1 gap-1 font-mono text-xs bg-muted hover:bg-muted"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {maxTags && (
        <p className="text-xs text-muted-foreground">
          {value.length}/{maxTags} items
        </p>
      )}
    </div>
  );
}
