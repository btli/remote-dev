"use client";

import { useState, useCallback } from "react";
import { Trash2, Plus, Key, Edit2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface KeyValueEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
  className?: string;
  maxEntries?: number;
}

interface EditingEntry {
  originalKey: string;
  key: string;
  value: string;
}

/**
 * KeyValueEditor - A reusable component for editing key-value pairs
 *
 * Used for:
 * - env (environment variables)
 * - mcpServers.*.env
 * - Custom provider configs
 */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  disabled = false,
  className,
  maxEntries,
}: KeyValueEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editing, setEditing] = useState<EditingEntry | null>(null);

  const entries = Object.entries(value);

  const addEntry = useCallback(() => {
    const trimmedKey = newKey.trim();
    const trimmedValue = newValue.trim();

    if (!trimmedKey || !trimmedValue) return;
    if (value[trimmedKey] !== undefined) return; // Key exists
    if (maxEntries && entries.length >= maxEntries) return;

    onChange({ ...value, [trimmedKey]: trimmedValue });
    setNewKey("");
    setNewValue("");
  }, [newKey, newValue, value, onChange, maxEntries, entries.length]);

  const removeEntry = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = value;
      onChange(rest);
    },
    [value, onChange]
  );

  const startEditing = useCallback((key: string, val: string) => {
    setEditing({ originalKey: key, key, value: val });
  }, []);

  const saveEditing = useCallback(() => {
    if (!editing) return;

    const trimmedKey = editing.key.trim();
    const trimmedValue = editing.value.trim();

    if (!trimmedKey || !trimmedValue) return;

    // Remove old key if it changed
    const { [editing.originalKey]: _, ...rest } = value;

    // Check for duplicate key (if key changed)
    if (trimmedKey !== editing.originalKey && rest[trimmedKey] !== undefined) {
      return;
    }

    onChange({ ...rest, [trimmedKey]: trimmedValue });
    setEditing(null);
  }, [editing, value, onChange]);

  const cancelEditing = useCallback(() => {
    setEditing(null);
  }, []);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Existing entries */}
      {entries.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-muted/30 border border-border p-2">
          {entries.map(([key, val]) => (
            <div
              key={key}
              className="flex items-center gap-2 p-1.5 rounded bg-background/50"
            >
              {editing?.originalKey === key ? (
                <>
                  <Input
                    value={editing.key}
                    onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                    className="flex-1 h-8 text-sm font-mono bg-input"
                    placeholder={keyPlaceholder}
                    autoFocus
                  />
                  <span className="text-muted-foreground">=</span>
                  <Input
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    className="flex-1 h-8 text-sm font-mono bg-input"
                    placeholder={valuePlaceholder}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={saveEditing}
                    className="h-7 w-7 text-emerald-500 hover:text-emerald-400"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={cancelEditing}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5 text-primary shrink-0" />
                  <code className="text-xs font-mono text-foreground flex-1 truncate">
                    {key}
                  </code>
                  <span className="text-muted-foreground">=</span>
                  <code className="text-xs font-mono text-muted-foreground flex-1 truncate">
                    {val}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => startEditing(key, val)}
                    disabled={disabled}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeEntry(key)}
                    disabled={disabled}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new entry */}
      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={keyPlaceholder}
          disabled={disabled || (maxEntries !== undefined && entries.length >= maxEntries)}
          className="flex-1 h-9 font-mono text-sm bg-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addEntry();
            }
          }}
        />
        <span className="text-muted-foreground">=</span>
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={valuePlaceholder}
          disabled={disabled || (maxEntries !== undefined && entries.length >= maxEntries)}
          className="flex-1 h-9 font-mono text-sm bg-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addEntry();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={addEntry}
          disabled={
            disabled ||
            !newKey.trim() ||
            !newValue.trim() ||
            (maxEntries !== undefined && entries.length >= maxEntries)
          }
          className="h-9 w-9 shrink-0"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {maxEntries && (
        <p className="text-xs text-muted-foreground">
          {entries.length}/{maxEntries} entries
        </p>
      )}
    </div>
  );
}
