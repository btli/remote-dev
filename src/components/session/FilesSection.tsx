"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Files,
  ChevronDown,
  ChevronRight,
  FileText,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSessionContext } from "@/contexts/SessionContext";
import type { PinnedFile } from "@/types/pinned-files";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DEFAULT_FILE_NAMES = [".env", ".env.local", "CLAUDE.md", "README.md"];

interface FilesSectionProps {
  activeFolderId: string | null;
  collapsed?: boolean;
  getFolderPinnedFiles: (folderId: string) => PinnedFile[];
  onOpenFile: (folderId: string, file: PinnedFile) => void;
  activeSessionId: string | null;
}

async function checkFilesExist(
  paths: string[]
): Promise<Record<string, boolean>> {
  try {
    const res = await fetch("/api/files/exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.exists ?? {};
  } catch {
    return {};
  }
}

export function FilesSection({
  activeFolderId,
  collapsed = false,
  getFolderPinnedFiles,
  onOpenFile,
  activeSessionId,
}: FilesSectionProps) {
  const { resolvePreferencesForFolder } = usePreferencesContext();
  const { sessions } = useSessionContext();
  const [expanded, setExpanded] = useState(true);
  const [defaultFiles, setDefaultFiles] = useState<PinnedFile[]>([]);

  // Resolve working directory for the active folder
  const resolvedPrefs = activeFolderId
    ? resolvePreferencesForFolder(activeFolderId)
    : null;
  const baseDir =
    resolvedPrefs?.localRepoPath ||
    resolvedPrefs?.defaultWorkingDirectory ||
    null;

  const pinnedFiles = useMemo(
    () => (activeFolderId ? getFolderPinnedFiles(activeFolderId) : []),
    [activeFolderId, getFolderPinnedFiles]
  );

  const pinnedPaths = useMemo(
    () => new Set(pinnedFiles.map((f) => f.path)),
    [pinnedFiles]
  );

  // Probe default file existence when base directory changes
  useEffect(() => {
    if (!baseDir) return;

    let cancelled = false;
    const normalizedBase = baseDir.replace(/\/$/, "");
    const candidates = DEFAULT_FILE_NAMES.map((name) => ({
      name,
      path: `${normalizedBase}/${name}`,
    }));

    checkFilesExist(candidates.map((c) => c.path)).then((results) => {
      if (cancelled) return;
      const found: PinnedFile[] = [];
      for (const candidate of candidates) {
        if (results[candidate.path]) {
          found.push({
            id: `default-${candidate.name}`,
            path: candidate.path,
            name: candidate.name,
            sortOrder: found.length,
            createdAt: new Date(0).toISOString(),
          });
        }
      }
      setDefaultFiles(found);
    });

    return () => {
      cancelled = true;
    };
  }, [baseDir]);

  // Merge: pinned files first, then default files not already pinned.
  // When baseDir is null, skip defaultFiles since they belong to a previous directory.
  const allFiles = useMemo(
    () => [
      ...pinnedFiles,
      ...(baseDir ? defaultFiles.filter((f) => !pinnedPaths.has(f.path)) : []),
    ],
    [pinnedFiles, defaultFiles, pinnedPaths, baseDir]
  );

  // Don't render when no folder is selected
  if (!activeFolderId) {
    return null;
  }

  // Collapsed sidebar: icon + count badge
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "relative w-full flex items-center justify-center p-2 rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "transition-colors"
            )}
          >
            <Files className="w-4 h-4" />
            {allFiles.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                {allFiles.length}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Files ({allFiles.length})
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2",
          "text-xs text-muted-foreground hover:text-foreground",
          "hover:bg-accent/30 transition-colors"
        )}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <Files className="w-3.5 h-3.5" />
        <span className="font-medium">Files</span>
        {allFiles.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {allFiles.length}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-2 pb-2 space-y-0.5">
          {/* Empty state: no working directory configured */}
          {!baseDir && allFiles.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Set a working directory in folder settings
            </p>
          )}

          {/* File rows */}
          {allFiles.map((file) => {
            const isPinned = pinnedPaths.has(file.path);
            const fileSession = sessions.find(
              (s) =>
                s.terminalType === "file" &&
                s.status !== "closed" &&
                s.typeMetadata?.filePath === file.path
            );
            const isFileActive = fileSession?.id === activeSessionId;

            return (
              <button
                key={file.id}
                onClick={() => onOpenFile(activeFolderId!, file)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md",
                  "text-xs transition-colors text-left",
                  isFileActive
                    ? "text-foreground bg-primary/20 border border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
                title={file.path}
              >
                <FileText
                  className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    isFileActive ? "text-primary" : "text-blue-400"
                  )}
                />
                <span className="truncate">{file.name}</span>
                {isPinned && (
                  <Pin className="w-2.5 h-2.5 shrink-0 ml-auto text-muted-foreground/50" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
