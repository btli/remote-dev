"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  FolderGit2,
  FolderPlus,
  File,
  ChevronRight,
  ChevronUp,
  Loader2,
  Home,
  Clock,
  AlertCircle,
  X,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface QuickRoot {
  id: string;
  label: string;
  path: string;
}

interface SidebarButtonProps {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  title: string;
  onClick: () => void;
}

/** A single quick-access / recent entry in the browser sidebar. */
function SidebarButton({
  icon: Icon,
  iconClassName,
  label,
  title,
  onClick,
}: SidebarButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm text-foreground hover:bg-accent transition-colors"
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0", iconClassName)} />
      <span className="truncate">{label}</span>
    </button>
  );
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

const RECENT_KEY_BASE = "rdv:dirpicker:recent";
const RECENT_MAX = 8;

/** localStorage key for a mode's recents, kept separate so a file path never
 *  appears in a directory picker (and vice-versa). */
function recentKeyFor(mode: "directory" | "file"): string {
  return `${RECENT_KEY_BASE}:${mode}`;
}

/** Read the recent-paths list from localStorage (best-effort, never throws). */
function readRecents(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Prepend a path to the recent list (dedupe, cap), persisting to localStorage. */
function pushRecent(key: string, path: string): string[] {
  if (typeof window === "undefined") return [];
  const next = [path, ...readRecents(key).filter((p) => p !== path)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore quota / disabled-storage failures.
  }
  return next;
}

/** Last path segment for display (handles trailing slashes). */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) || "/" : trimmed;
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
  // Index of the keyboard / single-click highlighted entry (-1 = none).
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [roots, setRoots] = useState<QuickRoot[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  // New-folder inline form state.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // After a successful create, highlight this folder once the list reloads.
  const pendingHighlightRef = useRef<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const isFileMode = mode === "file";
  const recentKey = recentKeyFor(mode);
  const defaultTitle = isFileMode ? "Browse Files" : "Browse Directory";
  const defaultDescription = isFileMode
    ? "Navigate and select a file"
    : "Navigate and select a directory";

  const fetchDirectory = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      setSelectedFile(null);
      setHighlightIndex(-1);

      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        // In file mode, show files too (dirsOnly=false)
        if (isFileMode) params.set("dirsOnly", "false");
        if (showHidden) params.set("showHidden", "true");
        const qs = params.toString();

        const response = await apiFetch(
          `/api/directories${qs ? `?${qs}` : ""}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load directory");
        }

        setCurrentPath(data.path);
        setParentPath(data.parent);
        setEntries(data.entries);
        setManualPath(data.path);

        // Re-highlight a freshly created folder if one is pending.
        const pending = pendingHighlightRef.current;
        if (pending) {
          pendingHighlightRef.current = null;
          const idx = (data.entries as DirectoryEntry[]).findIndex(
            (e) => e.path === pending
          );
          if (idx >= 0) setHighlightIndex(idx);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load directory");
      } finally {
        setLoading(false);
      }
    },
    [isFileMode, showHidden]
  );

  // Load initial directory + quick-access roots when modal opens.
  useEffect(() => {
    if (!open) return;
    setRecents(readRecents(recentKey));
    setCreatingFolder(false);
    setNewFolderName("");
    setCreateError(null);
    fetchDirectory(initialPath || undefined);

    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch("/api/directories/roots", {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.roots)) {
          setRoots(data.roots as QuickRoot[]);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Quick-access roots are non-critical; ignore failures.
      }
    })();

    return () => {
      controller.abort();
    };
  }, [open, initialPath, fetchDirectory, recentKey]);

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

  // Resolve the path the Select button will commit.
  const highlightedEntry =
    highlightIndex >= 0 && highlightIndex < entries.length
      ? entries[highlightIndex]
      : null;
  const highlightedDir =
    highlightedEntry && highlightedEntry.isDirectory ? highlightedEntry.path : null;
  const targetPath = isFileMode
    ? selectedFile
    : (highlightedDir ?? currentPath) || null;

  const commitSelect = useCallback(
    (path: string) => {
      onSelect(path);
      setRecents(pushRecent(recentKey, path));
      onClose();
    },
    [onSelect, onClose, recentKey]
  );

  const handleSelect = () => {
    if (targetPath) {
      commitSelect(targetPath);
    }
  };

  const handleEntryClick = (index: number, entry: DirectoryEntry) => {
    setHighlightIndex(index);
    if (isFileMode && !entry.isDirectory) {
      setSelectedFile(entry.path);
    } else if (!entry.isDirectory) {
      // Files in directory mode aren't selectable; clear any file selection.
      setSelectedFile(null);
    }
  };

  const handleEntryDoubleClick = (entry: DirectoryEntry) => {
    if (entry.isDirectory) {
      // Double-click on directory navigates into it
      handleNavigate(entry.path);
    } else if (isFileMode) {
      // Double-click on file selects and closes
      commitSelect(entry.path);
    }
  };

  const openNewFolder = () => {
    setCreateError(null);
    setNewFolderName("");
    setCreatingFolder(true);
    // Focus the input after it mounts.
    requestAnimationFrame(() => newFolderInputRef.current?.focus());
  };

  const cancelNewFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
    setCreateError(null);
  };

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreateError("Folder name is required");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/api/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create folder");
      }
      // Reload the listing and highlight the new folder once it appears.
      pendingHighlightRef.current = data.entry?.path ?? null;
      setCreatingFolder(false);
      setNewFolderName("");
      await fetchDirectory(currentPath);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreating(false);
    }
  };

  // Keyboard navigation on the listing. Skips while typing in inputs.
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (entries.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => {
        const next = prev < entries.length - 1 ? prev + 1 : prev;
        scrollEntryIntoView(next);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => {
        const next = prev > 0 ? prev - 1 : 0;
        scrollEntryIntoView(next);
        return next;
      });
    } else if (e.key === "Enter") {
      if (highlightedEntry) {
        e.preventDefault();
        if (highlightedEntry.isDirectory) {
          handleNavigate(highlightedEntry.path);
        } else if (isFileMode) {
          commitSelect(highlightedEntry.path);
        }
      }
    } else if (e.key === "Backspace") {
      e.preventDefault();
      handleGoUp();
    }
  };

  const scrollEntryIntoView = (index: number) => {
    requestAnimationFrame(() => {
      const container = listRef.current;
      if (!container) return;
      const node = container.querySelector<HTMLElement>(`[data-entry-index="${index}"]`);
      node?.scrollIntoView({ block: "nearest" });
    });
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

  const rootIcon = (id: string) => {
    if (id === "home") return Home;
    if (id === "projects") return FolderGit2;
    return Folder;
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[80vh] bg-popover/95 backdrop-blur-xl border-border flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            {title || defaultTitle}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description || defaultDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 min-h-0 flex-1">
          {/* Quick-access sidebar */}
          <aside className="hidden sm:flex w-[150px] flex-shrink-0 flex-col gap-3 overflow-y-auto scrollbar-thin pr-1">
            {roots.length > 0 && (
              <div className="space-y-1">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  Quick Access
                </p>
                {roots.map((root) => (
                  <SidebarButton
                    key={root.id}
                    icon={rootIcon(root.id)}
                    iconClassName="text-primary"
                    label={root.label}
                    title={root.path}
                    onClick={() => handleNavigate(root.path)}
                  />
                ))}
              </div>
            )}

            {recents.length > 0 && (
              <div className="space-y-1">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  Recent
                </p>
                {recents.map((path) => (
                  <SidebarButton
                    key={path}
                    icon={Clock}
                    iconClassName="text-muted-foreground"
                    label={basename(path)}
                    title={path}
                    onClick={() => handleNavigate(path)}
                  />
                ))}
              </div>
            )}
          </aside>

          {/* Main pane */}
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            {/* Path input and navigation */}
            <div className="flex gap-2 items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoHome}
                className="px-2 text-muted-foreground hover:text-foreground"
                title="Go to home directory"
                aria-label="Go to home directory"
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
                aria-label="Go up one level"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <div className="flex-1 flex gap-2 min-w-0">
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
              {!isFileMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openNewFolder}
                  className="px-2 text-muted-foreground hover:text-foreground"
                  title="New folder"
                  aria-label="New folder"
                >
                  <FolderPlus className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* New folder inline form */}
            {creatingFolder && (
              <div className="flex flex-col gap-1">
                <div className="flex gap-2 items-center">
                  <FolderPlus className="w-4 h-4 text-primary flex-shrink-0" />
                  <Input
                    ref={newFolderInputRef}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitNewFolder();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelNewFolder();
                      }
                    }}
                    placeholder="New folder name"
                    disabled={creating}
                    className="bg-card/50 border-border text-foreground text-sm flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void submitNewFolder()}
                    disabled={creating || !newFolderName.trim()}
                    className="px-2 text-primary hover:text-primary"
                    title="Create folder"
                    aria-label="Create folder"
                  >
                    {creating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelNewFolder}
                    disabled={creating}
                    className="px-2 text-muted-foreground hover:text-foreground"
                    title="Cancel"
                    aria-label="Cancel new folder"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                {createError && (
                  <p className="text-xs text-destructive pl-6">{createError}</p>
                )}
              </div>
            )}

            {/* Breadcrumbs */}
            <div className="flex items-center gap-1 text-sm overflow-x-auto pb-1 scrollbar-thin">
              <span className="text-muted-foreground/50 px-1 select-none">/</span>
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
            <div
              ref={listRef}
              className="flex-1 min-h-[260px] overflow-y-auto border border-border rounded-lg bg-card/30"
            >
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
                <div
                  role="listbox"
                  tabIndex={0}
                  onKeyDown={handleListKeyDown}
                  aria-label="Directory contents"
                  aria-activedescendant={
                    highlightIndex >= 0 ? `dir-entry-${highlightIndex}` : undefined
                  }
                  className="divide-y divide-border focus:outline-none focus:ring-1 focus:ring-primary/50 rounded-lg"
                >
                  {entries.map((entry, index) => {
                    const isHighlighted = index === highlightIndex;
                    return (
                      <button
                        key={entry.path}
                        id={`dir-entry-${index}`}
                        data-entry-index={index}
                        role="option"
                        aria-selected={isHighlighted}
                        onClick={() => handleEntryClick(index, entry)}
                        onDoubleClick={() => handleEntryDoubleClick(entry)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                          "hover:bg-accent cursor-pointer",
                          // No side-stripe per DESIGN.md "No Side-Stripe Rule".
                          // Selection is a background tint only.
                          isHighlighted && "bg-primary/10"
                        )}
                      >
                        {entry.isDirectory ? (
                          <Folder className="w-4 h-4 text-primary flex-shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span
                          className={cn(
                            "truncate flex-1",
                            isHighlighted ? "text-primary" : "text-foreground"
                          )}
                        >
                          {entry.name}
                        </span>
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
                  <span className="text-foreground font-mono">
                    {currentPath || "None"}
                  </span>
                  <br />
                  <span>Selected file: </span>
                  <span className="text-primary font-mono">
                    {selectedFile ? basename(selectedFile) : "None"}
                  </span>
                </>
              ) : (
                <>
                  Selected:{" "}
                  <span className="text-foreground font-mono">
                    {targetPath || "None"}
                  </span>
                </>
              )}
            </div>
          </div>
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
            disabled={!targetPath}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isFileMode ? "Select File" : "Select Directory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
