"use client";

import { useState, useCallback } from "react";
import { ChevronRight, Folder, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderTreeNodeProps {
  path: string;
  name: string;
  depth: number;
  isSelected: boolean;
  onSelect: (path: string) => void;
  filter: string;
  defaultExpanded?: boolean;
}

export function FolderTreeNode({
  path,
  name,
  depth,
  isSelected,
  onSelect,
  filter,
  defaultExpanded = false,
}: FolderTreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchChildren = useCallback(async () => {
    if (loaded) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/directories?path=${encodeURIComponent(path)}&dirsOnly=true`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to load");
      }

      const data = await response.json();
      setChildren(data.entries || []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path, loaded]);

  const handleToggle = useCallback(async () => {
    if (!expanded && !loaded) {
      await fetchChildren();
    }
    setExpanded(!expanded);
  }, [expanded, loaded, fetchChildren]);

  const handleClick = useCallback(() => {
    onSelect(path);
  }, [path, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onSelect(path);
  }, [path, onSelect]);

  // Filter children
  const filterLower = filter.toLowerCase();
  const filteredChildren = filter
    ? children.filter((c) => c.name.toLowerCase().includes(filterLower))
    : children;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 cursor-pointer rounded-sm transition-colors",
          "hover:bg-white/5",
          isSelected && "bg-violet-500/20 text-white"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expand/collapse chevron */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          className="p-0.5 hover:bg-white/10 rounded-sm"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
          ) : error ? (
            <AlertCircle className="w-3 h-3 text-red-400" />
          ) : (
            <ChevronRight
              className={cn(
                "w-3 h-3 text-slate-400 transition-transform",
                expanded && "rotate-90"
              )}
            />
          )}
        </button>

        {/* Folder icon */}
        <Folder
          className={cn(
            "w-4 h-4 shrink-0",
            isSelected ? "text-violet-400 fill-violet-400/30" : "text-slate-400"
          )}
        />

        {/* Folder name */}
        <span
          className={cn(
            "text-xs truncate",
            isSelected ? "text-white font-medium" : "text-slate-300"
          )}
        >
          {name}
        </span>
      </div>

      {/* Children */}
      {expanded && !error && (
        <div>
          {filteredChildren.map((child) => (
            <FolderTreeNode
              key={child.path}
              path={child.path}
              name={child.name}
              depth={depth + 1}
              isSelected={isSelected && false} // Only one can be selected, passed from parent
              onSelect={onSelect}
              filter={filter}
            />
          ))}
          {loaded && filteredChildren.length === 0 && (
            <div
              className="text-[10px] text-slate-500 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              {filter ? "No matches" : "Empty folder"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
