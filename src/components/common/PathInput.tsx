"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderOpen, FileKey } from "lucide-react";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { cn } from "@/lib/utils";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called when the value should be persisted: on the inner input's `onBlur`
   * and immediately after a browse selection. Lets callers debounce/save
   * without wiring their own blur handler.
   */
  onCommit?: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  inputClassName?: string;
  browserTitle?: string;
  browserDescription?: string;
  disabled?: boolean;
  /**
   * Directory the browser opens at when the field is empty. Falls back to the
   * current value, then the browser's default (HOME).
   */
  initialPath?: string;
  /** Mode: 'directory' for folder selection, 'file' for file selection */
  mode?: "directory" | "file";
  /** Show hidden files/folders in browser */
  showHidden?: boolean;
}

/**
 * PathInput - A text input with a browse button for file/directory selection
 *
 * Combines a regular text input for manual path entry with a button that
 * opens a browser modal for visual navigation.
 */
export function PathInput({
  value,
  onChange,
  onCommit,
  placeholder,
  id,
  className,
  inputClassName,
  browserTitle,
  browserDescription,
  disabled = false,
  initialPath,
  mode = "directory",
  showHidden = false,
}: PathInputProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

  const handleBrowseSelect = (path: string) => {
    onChange(path);
    onCommit?.(path);
  };

  const isFileMode = mode === "file";
  const Icon = isFileMode ? FileKey : FolderOpen;
  const defaultPlaceholder = isFileMode ? "/path/to/file" : "/path/to/directory";
  const buttonTitle = isFileMode ? "Browse files" : "Browse directories";

  return (
    <>
      <div className={cn("flex gap-2", className)}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          placeholder={placeholder || defaultPlaceholder}
          disabled={disabled}
          className={cn(
            "bg-card/50 border-border focus:border-primary flex-1",
            inputClassName
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setBrowserOpen(true)}
          disabled={disabled}
          className="px-3 text-muted-foreground hover:text-foreground hover:bg-accent border border-border"
          title={buttonTitle}
        >
          <Icon className="w-4 h-4" />
        </Button>
      </div>

      <DirectoryBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={handleBrowseSelect}
        initialPath={value || initialPath || undefined}
        title={browserTitle}
        description={browserDescription}
        mode={mode}
        showHidden={showHidden}
      />
    </>
  );
}
