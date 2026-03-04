"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Save, AlertCircle, Check, Loader2, Eye, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ViewMode = "rendered" | "editor";

interface CodeMirrorEditorProps {
  filePath: string;
  fileName: string;
  fontSize?: number;
  fontFamily?: string;
  autoSaveDelay?: number;
}

function getLanguageExtension(filePath: string): Extension[] {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return [StreamLanguage.define(dockerFile)];
  }

  switch (ext) {
    case "js":
    case "jsx":
      return [javascript({ jsx: true })];
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "md":
    case "mdx":
      return [markdown()];
    case "yml":
    case "yaml":
      return [yaml()];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "sh":
    case "bash":
    case "zsh":
      return [StreamLanguage.define(shell)];
    case "env":
    case "properties":
    case "ini":
    case "cfg":
      return [StreamLanguage.define(properties)];
    default:
      // Files starting with . and no other extension (like .env, .gitignore)
      if (name.startsWith(".env")) {
        return [StreamLanguage.define(properties)];
      }
      return [];
  }
}

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const ALLOWED_PROTOCOLS = /^(https?:|mailto:|#)/i;

function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  const trimmed = href.trimStart();
  // Allow relative links (no protocol) and explicitly safe protocols
  return !trimmed.includes(":") || ALLOWED_PROTOCOLS.test(trimmed);
}

const MARKDOWN_COMPONENTS = {
  a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => {
    if (isSafeHref(href)) {
      return (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    return <span {...props}>{children}</span>;
  },
} as const;

const appTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "hsl(var(--primary))",
      padding: "16px 0",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid hsl(var(--border))",
      color: "hsl(var(--muted-foreground))",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "hsl(var(--accent) / 0.3)",
    },
    ".cm-activeLine": {
      backgroundColor: "hsl(var(--accent) / 0.15)",
    },
    ".cm-selectionBackground": {
      backgroundColor: "hsl(var(--primary) / 0.2) !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "hsl(var(--primary) / 0.3) !important",
    },
    ".cm-cursor": {
      borderLeftColor: "hsl(var(--primary))",
    },
    ".cm-matchingBracket": {
      backgroundColor: "hsl(var(--primary) / 0.2)",
      outline: "1px solid hsl(var(--primary) / 0.5)",
    },
  },
  { dark: true }
);

export function CodeMirrorEditor({
  filePath,
  fileName,
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  autoSaveDelay = 2000,
}: CodeMirrorEditorProps): ReactNode {
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  const contentRef = useRef(content);
  const originalContentRef = useRef(originalContent);
  const filePathRef = useRef(filePath);
  contentRef.current = content;
  originalContentRef.current = originalContent;
  filePathRef.current = filePath;

  const langExtension = getLanguageExtension(filePath);
  const isMarkdown = /\.(md|mdx)$/i.test(filePath);
  const isDirty = content !== null && content !== originalContent;
  const [viewMode, setViewMode] = useState<ViewMode>(
    isMarkdown ? "rendered" : "editor"
  );

  useEffect(() => {
    setViewMode(isMarkdown ? "rendered" : "editor");
  }, [isMarkdown]);

  useEffect(() => {
    let cancelled = false;

    async function loadContent() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/files/read?path=${encodeURIComponent(filePath)}`
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Failed to load file (${response.status})`);
        }
        const data = await response.json();
        if (!cancelled) {
          setContent(data.content);
          setOriginalContent(data.content);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadContent();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const saveNow = useCallback(async () => {
    const currentContent = contentRef.current;
    const currentOriginal = originalContentRef.current;
    if (currentContent === null || currentContent === currentOriginal) return;
    if (isSavingRef.current) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePathRef.current, content: currentContent }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save file");
      }

      setOriginalContent(currentContent);
      setLastSavedAt(new Date());
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    if (autoSaveDelay > 0) {
      autoSaveTimeoutRef.current = setTimeout(saveNow, autoSaveDelay);
    }
  }, [autoSaveDelay, saveNow]);

  // Cmd+S / Ctrl+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveNow]);

  // Flush any unsaved content on unmount via sendBeacon
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      const currentContent = contentRef.current;
      const currentOriginal = originalContentRef.current;
      if (currentContent !== null && currentContent !== currentOriginal) {
        navigator.sendBeacon(
          "/api/files/write",
          new Blob(
            [JSON.stringify({ path: filePathRef.current, content: currentContent })],
            { type: "application/json" }
          )
        );
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading {fileName}...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background gap-2">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <p className="text-xs text-muted-foreground">{filePath}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{fileName}</span>
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
          {saveError && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {saveError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isMarkdown && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setViewMode((m) => {
                  if (m === "editor") saveNow();
                  return m === "rendered" ? "editor" : "rendered";
                });
              }}
              title={viewMode === "rendered" ? "Edit source" : "Preview rendered"}
            >
              {viewMode === "rendered" ? (
                <Pencil className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </Button>
          )}

          <Button
            size="sm"
            variant={isDirty ? "default" : "outline"}
            onClick={saveNow}
            disabled={isSaving || !isDirty}
          >
            <Save className={cn("w-4 h-4", isSaving && "animate-pulse")} />
            <span className="ml-2 text-xs">⌘S</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === "rendered" ? (
          <div className="h-full overflow-auto">
            <div className="max-w-3xl mx-auto px-8 py-6 markdown-prose">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={MARKDOWN_COMPONENTS}
              >
                {content ?? ""}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <CodeMirror
            value={content ?? ""}
            onChange={setContent}
            onBlur={scheduleAutoSave}
            extensions={[...langExtension, appTheme]}
            theme="dark"
            style={{
              height: "100%",
              fontSize: `${fontSize}px`,
              fontFamily,
            }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              bracketMatching: true,
              foldGutter: true,
              indentOnInput: true,
              autocompletion: false,
            }}
            className="h-full [&_.cm-editor]:h-full"
          />
        )}
      </div>
    </div>
  );
}
