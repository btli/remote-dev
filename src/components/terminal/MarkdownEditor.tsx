"use client";

/**
 * MarkdownEditor - Split-pane editor for markdown files
 *
 * Features:
 * - Left pane: raw text editor (textarea or Monaco)
 * - Right pane: rendered markdown preview
 * - Auto-save on blur
 * - Manual save button
 * - Dirty indicator
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Save, Eye, Code, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  filePath: string;
  fileName: string;
  isAgentConfig?: boolean;
  initialContent?: string;
  onSave?: (content: string) => Promise<void>;
  fontSize?: number;
  fontFamily?: string;
  autoSaveDelay?: number;
}

export function MarkdownEditor({
  filePath,
  fileName,
  isAgentConfig = false,
  initialContent = "",
  onSave,
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  autoSaveDelay = 2000,
}: MarkdownEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [originalContent, setOriginalContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<"split" | "edit" | "preview">("split");
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load file content
  useEffect(() => {
    async function loadContent() {
      try {
        const response = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        if (response.ok) {
          const data = await response.json();
          setContent(data.content);
          setOriginalContent(data.content);
        }
      } catch (error) {
        console.error("Failed to load file:", error);
      }
    }

    if (!initialContent) {
      loadContent();
    }
  }, [filePath, initialContent]);

  // Track dirty state
  useEffect(() => {
    setIsDirty(content !== originalContent);
  }, [content, originalContent]);

  // Handle manual save (defined before scheduleAutoSave to satisfy dependency order)
  const handleSave = useCallback(async () => {
    if (!isDirty) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      if (onSave) {
        await onSave(content);
      } else {
        // Default save via API
        const response = await fetch("/api/files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath, content }),
        });

        if (!response.ok) {
          throw new Error("Failed to save file");
        }
      }

      setOriginalContent(content);
      setLastSavedAt(new Date());
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [content, filePath, isDirty, onSave]);

  // Auto-save on blur with delay
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    if (isDirty && autoSaveDelay > 0) {
      autoSaveTimeoutRef.current = setTimeout(async () => {
        await handleSave();
      }, autoSaveDelay);
    }
  }, [isDirty, autoSaveDelay, handleSave]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Cleanup auto-save on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{fileName}</span>
          {isAgentConfig && (
            <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">
              Agent Config
            </span>
          )}
          {isDirty && (
            <span className="text-xs text-yellow-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Unsaved
            </span>
          )}
          {lastSavedAt && !isDirty && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex rounded-md border border-border">
            <button
              className={cn(
                "px-2 py-1 text-xs",
                viewMode === "edit" && "bg-primary text-primary-foreground"
              )}
              onClick={() => setViewMode("edit")}
            >
              <Code className="w-3 h-3" />
            </button>
            <button
              className={cn(
                "px-2 py-1 text-xs border-x border-border",
                viewMode === "split" && "bg-primary text-primary-foreground"
              )}
              onClick={() => setViewMode("split")}
            >
              Split
            </button>
            <button
              className={cn(
                "px-2 py-1 text-xs",
                viewMode === "preview" && "bg-primary text-primary-foreground"
              )}
              onClick={() => setViewMode("preview")}
            >
              <Eye className="w-3 h-3" />
            </button>
          </div>

          {/* Save Button */}
          <Button
            size="sm"
            variant={isDirty ? "default" : "outline"}
            onClick={handleSave}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? (
              <Save className="w-4 h-4 animate-pulse" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="ml-2 text-xs">⌘S</span>
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {saveError && (
        <div className="px-4 py-2 bg-destructive/20 text-destructive text-sm">
          Error saving: {saveError}
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 flex min-h-0">
        {/* Raw Editor */}
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className={cn(
              "flex-1 min-w-0",
              viewMode === "split" && "border-r border-border"
            )}
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={scheduleAutoSave}
              className="w-full h-full p-4 bg-transparent text-foreground resize-none focus:outline-none"
              style={{
                fontSize: `${fontSize}px`,
                fontFamily,
                lineHeight: 1.6,
              }}
              spellCheck={false}
            />
          </div>
        )}

        {/* Markdown Preview - Simple rendering for now */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div
            className={cn(
              "flex-1 min-w-0 overflow-auto p-4",
              viewMode === "split" && "bg-muted/10"
            )}
          >
            <pre
              className="whitespace-pre-wrap text-foreground text-sm leading-relaxed"
              style={{ fontFamily: "inherit" }}
            >
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
