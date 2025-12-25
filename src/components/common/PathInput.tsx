"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { DirectoryBrowser } from "./DirectoryBrowser";
import { cn } from "@/lib/utils";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  inputClassName?: string;
  browserTitle?: string;
  browserDescription?: string;
  disabled?: boolean;
}

/**
 * PathInput - A text input with a browse button for directory selection
 *
 * Combines a regular text input for manual path entry with a button that
 * opens a directory browser modal for visual navigation.
 */
export function PathInput({
  value,
  onChange,
  placeholder = "/path/to/directory",
  id,
  className,
  inputClassName,
  browserTitle,
  browserDescription,
  disabled = false,
}: PathInputProps) {
  const [browserOpen, setBrowserOpen] = useState(false);

  const handleBrowseSelect = (path: string) => {
    onChange(path);
  };

  return (
    <>
      <div className={cn("flex gap-2", className)}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "bg-slate-800/50 border-white/10 focus:border-violet-500 flex-1",
            inputClassName
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setBrowserOpen(true)}
          disabled={disabled}
          className="px-3 text-slate-400 hover:text-white hover:bg-slate-700/50 border border-white/10"
          title="Browse directories"
        >
          <FolderOpen className="w-4 h-4" />
        </Button>
      </div>

      <DirectoryBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={handleBrowseSelect}
        initialPath={value || undefined}
        title={browserTitle}
        description={browserDescription}
      />
    </>
  );
}
