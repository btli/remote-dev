"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronUp,
  Loader2,
  Home,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface DirectoryBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
  description?: string;
}

export function DirectoryBrowser({
  open,
  onClose,
  onSelect,
  initialPath,
  title = "Browse Directory",
  description = "Navigate and select a directory",
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");

  const fetchDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);

    try {
      const url = new URL("/api/directories", window.location.origin);
      if (path) {
        url.searchParams.set("path", path);
      }

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load directory");
      }

      setCurrentPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries);
      setManualPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial directory when modal opens
  useEffect(() => {
    if (open) {
      fetchDirectory(initialPath || undefined);
    }
  }, [open, initialPath, fetchDirectory]);

  const handleNavigate = (path: string) => {
    fetchDirectory(path);
  };

  const handleGoUp = () => {
    if (parentPath) {
      fetchDirectory(parentPath);
    }
  };

  const handleGoHome = () => {
    fetchDirectory();
  };

  const handleManualPathSubmit = () => {
    if (manualPath.trim()) {
      fetchDirectory(manualPath.trim());
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onClose();
  };

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      handleNavigate(entry.path);
    }
  };

  const handleEntryDoubleClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      // Double-click selects and closes
      onSelect(entry.path);
      onClose();
    }
  };

  // Parse current path into breadcrumbs
  const getBreadcrumbs = () => {
    if (!currentPath) return [];
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs: { name: string; path: string }[] = [];
    let accumulated = "";

    for (const part of parts) {
      accumulated += "/" + part;
      crumbs.push({ name: part, path: accumulated });
    }

    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] bg-slate-900/95 backdrop-blur-xl border-white/10 flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-violet-400" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {description}
          </DialogDescription>
        </DialogHeader>

        {/* Path input and navigation */}
        <div className="flex gap-2 items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoHome}
            className="px-2 text-slate-400 hover:text-white"
            title="Go to home directory"
          >
            <Home className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoUp}
            disabled={!parentPath}
            className="px-2 text-slate-400 hover:text-white disabled:opacity-50"
            title="Go up one level"
          >
            <ChevronUp className="w-4 h-4" />
          </Button>
          <div className="flex-1 flex gap-2">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleManualPathSubmit();
                }
              }}
              placeholder="/path/to/directory"
              className="bg-slate-800/50 border-white/10 text-white text-sm font-mono"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualPathSubmit}
              className="px-3 text-slate-400 hover:text-white"
            >
              Go
            </Button>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => fetchDirectory("/")}
            className="text-slate-400 hover:text-white px-1"
          >
            /
          </button>
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center">
              <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
              <button
                onClick={() => handleNavigate(crumb.path)}
                className={cn(
                  "px-1 truncate max-w-[150px]",
                  index === breadcrumbs.length - 1
                    ? "text-violet-400 font-medium"
                    : "text-slate-400 hover:text-white"
                )}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Directory listing */}
        <div className="flex-1 min-h-[300px] max-h-[400px] overflow-y-auto border border-white/10 rounded-lg bg-slate-800/30">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-4">
              <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
              <p className="text-red-400 text-center">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoHome}
                className="mt-2 text-slate-400 hover:text-white"
              >
                Go to Home
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <p>Empty directory</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                    "hover:bg-slate-700/50",
                    entry.isDirectory && "cursor-pointer"
                  )}
                >
                  <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-white truncate flex-1">{entry.name}</span>
                  {entry.isDirectory && (
                    <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Current selection */}
        <div className="text-sm text-slate-400">
          Selected: <span className="text-white font-mono">{currentPath || "None"}</span>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!currentPath}
            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
          >
            Select Directory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
