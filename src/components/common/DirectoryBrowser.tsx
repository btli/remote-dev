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
  File,
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
  /** Mode: 'directory' for folder selection, 'file' for file selection */
  mode?: "directory" | "file";
  /** Show hidden files/folders */
  showHidden?: boolean;
}

export function DirectoryBrowser({
  open,
  onClose,
  onSelect,
  initialPath,
  title,
  description,
  mode = "directory",
  showHidden = false,
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const isFileMode = mode === "file";
  const defaultTitle = isFileMode ? "Browse Files" : "Browse Directory";
  const defaultDescription = isFileMode
    ? "Navigate and select a file"
    : "Navigate and select a directory";

  const fetchDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);

    try {
      const url = new URL("/api/directories", window.location.origin);
      if (path) {
        url.searchParams.set("path", path);
      }
      // In file mode, show files too (dirsOnly=false)
      if (isFileMode) {
        url.searchParams.set("dirsOnly", "false");
      }
      if (showHidden) {
        url.searchParams.set("showHidden", "true");
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
  }, [isFileMode, showHidden]);

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
    // In file mode, use selected file; in directory mode, use current directory
    const pathToSelect = isFileMode ? selectedFile : currentPath;
    if (pathToSelect) {
      onSelect(pathToSelect);
      onClose();
    }
  };

  const handleEntryClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      handleNavigate(entry.path);
    } else if (isFileMode) {
      // In file mode, clicking a file selects it
      setSelectedFile(entry.path);
    }
  };

  const handleEntryDoubleClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      // Double-click on directory navigates into it
      handleNavigate(entry.path);
    } else if (isFileMode) {
      // Double-click on file selects and closes
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
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            {title || defaultTitle}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description || defaultDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Path input and navigation */}
        <div className="flex gap-2 items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoHome}
            className="px-2 text-muted-foreground hover:text-foreground"
            title="Go to home directory"
          >
            <Home className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoUp}
            disabled={!parentPath}
            className="px-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
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
              className="bg-card/50 border-border text-foreground text-sm font-mono"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualPathSubmit}
              className="px-3 text-muted-foreground hover:text-foreground"
            >
              Go
            </Button>
          </div>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => fetchDirectory("/")}
            className="text-muted-foreground hover:text-foreground px-1"
          >
            /
          </button>
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center">
              <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
              <button
                onClick={() => handleNavigate(crumb.path)}
                className={cn(
                  "px-1 truncate max-w-[150px]",
                  index === breadcrumbs.length - 1
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Directory listing */}
        <div className="flex-1 min-h-[300px] max-h-[400px] overflow-y-auto border border-border rounded-lg bg-card/30">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
              <AlertCircle className="w-8 h-8 text-destructive mb-2" />
              <p className="text-destructive text-center">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoHome}
                className="mt-2 text-muted-foreground hover:text-foreground"
              >
                Go to Home
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground/70">
              <p>Empty directory</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((entry) => {
                const isSelected = isFileMode && !entry.isDirectory && selectedFile === entry.path;
                return (
                  <button
                    key={entry.path}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                      "hover:bg-accent cursor-pointer",
                      isSelected && "bg-primary/20 border-l-2 border-primary"
                    )}
                  >
                    {entry.isDirectory ? (
                      <Folder className="w-4 h-4 text-warning flex-shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className={cn(
                      "truncate flex-1",
                      isSelected ? "text-primary" : "text-foreground"
                    )}>{entry.name}</span>
                    {entry.isDirectory && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Current selection */}
        <div className="text-sm text-muted-foreground">
          {isFileMode ? (
            <>
              <span>Directory: </span>
              <span className="text-foreground font-mono">{currentPath || "None"}</span>
              <br />
              <span>Selected file: </span>
              <span className="text-primary font-mono">{selectedFile ? selectedFile.split("/").pop() : "None"}</span>
            </>
          ) : (
            <>
              Selected: <span className="text-foreground font-mono">{currentPath || "None"}</span>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={isFileMode ? !selectedFile : !currentPath}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isFileMode ? "Select File" : "Select Directory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
