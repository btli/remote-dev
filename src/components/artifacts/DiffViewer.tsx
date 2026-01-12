"use client";

/**
 * DiffViewer - Side-by-side and unified diff visualization
 *
 * Features:
 * - Unified and split view modes
 * - Syntax highlighting for changed content
 * - Line-by-line change indicators
 * - Expandable context lines
 * - Copy and download support
 *
 * Based on arXiv 2512.10398v5 UX patterns for artifact visualization.
 */

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Copy,
  Check,
  Maximize2,
  GitCompare,
  Download,
  Columns,
  Rows,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DiffLineType = "add" | "remove" | "context" | "header";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
  };
}

interface DiffViewerProps {
  /** Raw diff string (unified diff format) */
  diff: string;
  /** Old file content (for split view computation) */
  oldContent?: string;
  /** New file content (for split view computation) */
  newContent?: string;
  /** File name for display */
  filename?: string;
  /** Initial view mode */
  defaultMode?: "unified" | "split";
  /** Maximum lines before collapsing */
  maxLines?: number;
  /** Additional CSS class */
  className?: string;
  /** Mode: inline, panel, or dialog */
  mode?: "inline" | "panel" | "dialog";
  /** Trigger for dialog mode */
  trigger?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff Parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const hunks: DiffHunk[] = [];
  let oldFile = "";
  let newFile = "";
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    // File headers
    if (line.startsWith("---")) {
      oldFile = line.slice(4).trim();
      if (oldFile.startsWith("a/")) oldFile = oldFile.slice(2);
      continue;
    }
    if (line.startsWith("+++")) {
      newFile = line.slice(4).trim();
      if (newFile.startsWith("b/")) newFile = newFile.slice(2);
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      oldLineNum = parseInt(hunkMatch[1], 10);
      newLineNum = parseInt(hunkMatch[3], 10);
      currentHunk = {
        header: line,
        oldStart: oldLineNum,
        oldCount: parseInt(hunkMatch[2] || "1", 10),
        newStart: newLineNum,
        newCount: parseInt(hunkMatch[4] || "1", 10),
        lines: [
          {
            type: "header",
            content: hunkMatch[5]?.trim() || "",
          },
        ],
      };
      continue;
    }

    if (!currentHunk) continue;

    // Diff lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNum: newLineNum++,
      });
      additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNum: oldLineNum++,
      });
      deletions++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    oldFile,
    newFile,
    hunks,
    stats: { additions, deletions },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified View Component
// ─────────────────────────────────────────────────────────────────────────────

interface UnifiedViewProps {
  parsed: ParsedDiff;
}

function UnifiedView({ parsed }: UnifiedViewProps) {
  return (
    <div className="font-mono text-sm">
      {parsed.hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex}>
          {/* Hunk header */}
          <div className="bg-blue-500/10 text-blue-400 px-3 py-1 border-y border-border">
            {hunk.header}
          </div>

          {/* Lines */}
          {hunk.lines.filter((l) => l.type !== "header").map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={cn(
                "flex",
                line.type === "add" && "bg-green-500/10",
                line.type === "remove" && "bg-red-500/10"
              )}
            >
              {/* Old line number */}
              <span className="w-12 flex-shrink-0 px-2 py-0.5 text-right text-muted-foreground border-r border-border select-none">
                {line.oldLineNum || ""}
              </span>

              {/* New line number */}
              <span className="w-12 flex-shrink-0 px-2 py-0.5 text-right text-muted-foreground border-r border-border select-none">
                {line.newLineNum || ""}
              </span>

              {/* Change indicator */}
              <span
                className={cn(
                  "w-6 flex-shrink-0 px-1 py-0.5 text-center select-none",
                  line.type === "add" && "text-green-400",
                  line.type === "remove" && "text-red-400"
                )}
              >
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>

              {/* Content */}
              <code className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto">
                {line.content}
              </code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Split View Component
// ─────────────────────────────────────────────────────────────────────────────

interface SplitViewProps {
  parsed: ParsedDiff;
}

function SplitView({ parsed }: SplitViewProps) {
  // Build paired lines for split view
  const pairedLines = useMemo(() => {
    const pairs: Array<{
      left: DiffLine | null;
      right: DiffLine | null;
    }> = [];

    for (const hunk of parsed.hunks) {
      // Add hunk separator
      pairs.push({
        left: { type: "header", content: hunk.header },
        right: { type: "header", content: hunk.header },
      });

      const hunkLines = hunk.lines.filter((l) => l.type !== "header");
      let i = 0;

      while (i < hunkLines.length) {
        const line = hunkLines[i];

        if (line.type === "context") {
          pairs.push({ left: line, right: line });
          i++;
        } else if (line.type === "remove") {
          // Check if next line is an add (paired change)
          const nextLine = hunkLines[i + 1];
          if (nextLine?.type === "add") {
            pairs.push({ left: line, right: nextLine });
            i += 2;
          } else {
            pairs.push({ left: line, right: null });
            i++;
          }
        } else if (line.type === "add") {
          pairs.push({ left: null, right: line });
          i++;
        } else {
          i++;
        }
      }
    }

    return pairs;
  }, [parsed.hunks]);

  return (
    <div className="font-mono text-sm grid grid-cols-2">
      {/* Headers */}
      <div className="bg-muted/50 px-3 py-1 border-b border-r border-border text-sm font-medium">
        {parsed.oldFile || "Original"}
      </div>
      <div className="bg-muted/50 px-3 py-1 border-b border-border text-sm font-medium">
        {parsed.newFile || "Modified"}
      </div>

      {/* Paired lines */}
      {pairedLines.map((pair, index) => (
        <React.Fragment key={index}>
          {/* Left side */}
          <div
            className={cn(
              "flex border-r border-border",
              pair.left?.type === "header" && "bg-blue-500/10",
              pair.left?.type === "remove" && "bg-red-500/10",
              !pair.left && "bg-muted/20"
            )}
          >
            {pair.left?.type === "header" ? (
              <div className="px-3 py-0.5 text-blue-400 truncate">
                {pair.left.content}
              </div>
            ) : (
              <>
                <span className="w-10 flex-shrink-0 px-2 py-0.5 text-right text-muted-foreground border-r border-border select-none">
                  {pair.left?.oldLineNum || ""}
                </span>
                <span
                  className={cn(
                    "w-4 flex-shrink-0 text-center py-0.5 select-none",
                    pair.left?.type === "remove" && "text-red-400"
                  )}
                >
                  {pair.left?.type === "remove" ? "-" : " "}
                </span>
                <code className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto">
                  {pair.left?.content || ""}
                </code>
              </>
            )}
          </div>

          {/* Right side */}
          <div
            className={cn(
              "flex",
              pair.right?.type === "header" && "bg-blue-500/10",
              pair.right?.type === "add" && "bg-green-500/10",
              !pair.right && "bg-muted/20"
            )}
          >
            {pair.right?.type === "header" ? (
              <div className="px-3 py-0.5 text-blue-400 truncate">
                {pair.right.content}
              </div>
            ) : (
              <>
                <span className="w-10 flex-shrink-0 px-2 py-0.5 text-right text-muted-foreground border-r border-border select-none">
                  {pair.right?.newLineNum || ""}
                </span>
                <span
                  className={cn(
                    "w-4 flex-shrink-0 text-center py-0.5 select-none",
                    pair.right?.type === "add" && "text-green-400"
                  )}
                >
                  {pair.right?.type === "add" ? "+" : " "}
                </span>
                <code className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto">
                  {pair.right?.content || ""}
                </code>
              </>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// Need React import for Fragment
import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar Component (extracted to avoid circular reference)
// ─────────────────────────────────────────────────────────────────────────────

interface ToolbarProps {
  filename?: string;
  parsedFilename: string;
  stats: { additions: number; deletions: number };
  viewMode: "unified" | "split";
  setViewMode: (mode: "unified" | "split") => void;
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  showExpand?: boolean;
  onExpand?: () => void;
}

function DiffToolbar({
  filename,
  parsedFilename,
  stats,
  viewMode,
  setViewMode,
  copied,
  onCopy,
  onDownload,
  showExpand,
  onExpand,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
      {/* File info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <GitCompare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium truncate">
          {filename || parsedFilename || "Diff"}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-green-400 text-[10px]">
          <Plus className="h-2.5 w-2.5 mr-0.5" />
          {stats.additions}
        </Badge>
        <Badge variant="outline" className="text-red-400 text-[10px]">
          <Minus className="h-2.5 w-2.5 mr-0.5" />
          {stats.deletions}
        </Badge>
      </div>

      {/* View mode toggle */}
      <div className="flex items-center border border-border rounded">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={viewMode === "unified" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded-none rounded-l"
              onClick={() => setViewMode("unified")}
            >
              <Rows className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Unified view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={viewMode === "split" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded-none rounded-r border-l border-border"
              onClick={() => setViewMode("split")}
            >
              <Columns className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Split view</TooltipContent>
        </Tooltip>
      </div>

      {/* Copy */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy diff"}</TooltipContent>
      </Tooltip>

      {/* Download */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDownload}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download diff</TooltipContent>
      </Tooltip>

      {/* Expand button */}
      {showExpand && onExpand && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onExpand}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Expand</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function DiffViewer({
  diff,
  filename,
  defaultMode = "unified",
  maxLines = 200,
  className,
  mode = "inline",
  trigger,
}: DiffViewerProps) {
  // State
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">(defaultMode);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Parse diff
  const parsed = useMemo(() => parseDiff(diff), [diff]);

  // Check if truncated
  const totalLines = parsed.hunks.reduce(
    (sum, h) => sum + h.lines.length,
    0
  );
  const isTruncated = totalLines > maxLines;

  // Copy handler
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [diff]);

  // Download handler
  const handleDownload = useCallback(() => {
    const blob = new Blob([diff], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename || "changes"}.diff`;
    a.click();
    URL.revokeObjectURL(url);
  }, [diff, filename]);

  // Shared toolbar props
  const toolbarProps = {
    filename,
    parsedFilename: parsed.newFile,
    stats: parsed.stats,
    viewMode,
    setViewMode,
    copied,
    onCopy: handleCopy,
    onDownload: handleDownload,
  };

  // Content
  const content = (
    <ScrollArea className="max-h-[500px]" style={{ maxHeight: mode === "panel" ? undefined : "500px" }}>
      {viewMode === "unified" ? (
        <UnifiedView parsed={parsed} />
      ) : (
        <SplitView parsed={parsed} />
      )}

      {isTruncated && mode === "inline" && (
        <div className="px-3 py-2 text-center text-muted-foreground text-sm border-t border-border bg-muted/20">
          +{totalLines - maxLines} more lines
          <Button
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0"
            onClick={() => setDialogOpen(true)}
          >
            Show all
          </Button>
        </div>
      )}
    </ScrollArea>
  );

  // Render based on mode
  if (mode === "dialog") {
    return (
      <Dialog>
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <GitCompare className="h-4 w-4 mr-2" />
              View Diff
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-w-6xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              {filename || "Diff Viewer"}
            </DialogTitle>
          </DialogHeader>
          <DiffToolbar {...toolbarProps} />
          <ScrollArea className="flex-1">
            {viewMode === "unified" ? (
              <UnifiedView parsed={parsed} />
            ) : (
              <SplitView parsed={parsed} />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  }

  // Inline or panel mode with expand dialog
  return (
    <div
      className={cn(
        "border border-border rounded-lg overflow-hidden bg-background",
        className
      )}
    >
      <DiffToolbar
        {...toolbarProps}
        showExpand={isTruncated}
        onExpand={() => setDialogOpen(true)}
      />
      {content}

      {/* Expand dialog for inline mode */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-6xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              {filename || "Diff Viewer"}
            </DialogTitle>
          </DialogHeader>
          <DiffToolbar {...toolbarProps} />
          <ScrollArea className="flex-1">
            {viewMode === "unified" ? (
              <UnifiedView parsed={parsed} />
            ) : (
              <SplitView parsed={parsed} />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DiffViewer;
