"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  ChevronRight,
  Home,
  Loader2,
  AlertCircle,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

export function FolderBrowserModal({
  open,
  onClose,
  onSelect,
  initialPath,
  title = "Select Folder",
}: FolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Fetch directory contents
  const fetchDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);

    try {
      const queryPath = path ? `?path=${encodeURIComponent(path)}&dirsOnly=true` : "?dirsOnly=true";
      const response = await fetch(`/api/directories${queryPath}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to load directory");
      }

      const data = await response.json();
      setCurrentPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial directory when modal opens
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedPath(initialPath || null);
      fetchDirectory(initialPath);
    }
  }, [open, initialPath, fetchDirectory]);

  // Navigate to a directory
  const navigateTo = useCallback(
    (path: string) => {
      setFilter("");
      fetchDirectory(path);
    },
    [fetchDirectory]
  );

  // Navigate up to parent
  const navigateUp = useCallback(() => {
    if (parentPath) {
      navigateTo(parentPath);
    }
  }, [parentPath, navigateTo]);

  // Navigate to home
  const navigateHome = useCallback(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  // Handle folder click (select)
  const handleFolderClick = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  // Handle folder double-click (navigate into)
  const handleFolderDoubleClick = useCallback(
    (path: string) => {
      navigateTo(path);
    },
    [navigateTo]
  );

  // Handle select button
  const handleSelect = useCallback(() => {
    if (selectedPath) {
      onSelect(selectedPath);
    } else if (currentPath) {
      onSelect(currentPath);
    }
  }, [selectedPath, currentPath, onSelect]);

  // Parse path into breadcrumb segments
  const pathSegments = currentPath.split("/").filter(Boolean);

  // Filter entries
  const filterLower = filter.toLowerCase();
  const filteredEntries = filter
    ? entries.filter((e) => e.name.toLowerCase().includes(filterLower))
    : entries;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[70vh] bg-slate-900 border-white/10 flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-white text-sm">
            <Folder className="w-4 h-4 text-violet-400" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-xs overflow-x-auto pb-2 border-b border-white/5">
          <button
            type="button"
            onClick={navigateHome}
            className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white shrink-0"
            title="Home"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          {pathSegments.map((segment, index) => {
            const segmentPath = "/" + pathSegments.slice(0, index + 1).join("/");
            const isLast = index === pathSegments.length - 1;
            return (
              <div key={segmentPath} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                <button
                  type="button"
                  onClick={() => !isLast && navigateTo(segmentPath)}
                  className={cn(
                    "px-1 py-0.5 rounded truncate max-w-[100px]",
                    isLast
                      ? "text-white font-medium"
                      : "text-slate-400 hover:text-white hover:bg-white/10"
                  )}
                  disabled={isLast}
                  title={segment}
                >
                  {segment}
                </button>
              </div>
            );
          })}
        </div>

        {/* Search filter */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter folders..."
            className="h-7 pl-8 text-xs bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
          />
        </div>

        {/* Folder list */}
        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-red-400">
              <AlertCircle className="w-5 h-5 mb-2" />
              <span className="text-xs">{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fetchDirectory(currentPath)}
                className="mt-2 text-xs"
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="py-2 space-y-0.5">
              {/* Parent directory option */}
              {parentPath && !filter && (
                <button
                  type="button"
                  onClick={navigateUp}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-sm hover:bg-white/5 text-slate-400"
                >
                  <Folder className="w-4 h-4" />
                  <span className="text-xs">..</span>
                </button>
              )}

              {/* Directory entries */}
              {filteredEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => handleFolderClick(entry.path)}
                  onDoubleClick={() => handleFolderDoubleClick(entry.path)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-sm transition-colors",
                    "hover:bg-white/5",
                    selectedPath === entry.path && "bg-violet-500/20"
                  )}
                >
                  <Folder
                    className={cn(
                      "w-4 h-4 shrink-0",
                      selectedPath === entry.path
                        ? "text-violet-400 fill-violet-400/30"
                        : "text-slate-400"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs truncate",
                      selectedPath === entry.path
                        ? "text-white font-medium"
                        : "text-slate-300"
                    )}
                  >
                    {entry.name}
                  </span>
                </button>
              ))}

              {/* Empty state */}
              {filteredEntries.length === 0 && !loading && (
                <div className="text-center py-4 text-xs text-slate-500">
                  {filter ? "No folders match filter" : "No folders"}
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Selected path display */}
        <div className="pt-2 border-t border-white/5">
          <div className="text-[10px] text-slate-500 mb-1">Selected:</div>
          <div className="text-xs text-slate-300 truncate bg-slate-800/50 px-2 py-1.5 rounded">
            {selectedPath || currentPath || "None"}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSelect}
            disabled={!selectedPath && !currentPath}
            className="bg-violet-600 hover:bg-violet-700 text-white text-xs"
          >
            Select Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
