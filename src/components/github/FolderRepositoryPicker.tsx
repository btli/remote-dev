"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Github,
  Search,
  Loader2,
  Lock,
  Globe,
  Check,
  Download,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CachedGitHubRepository } from "@/types/github";

interface FolderRepositoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (repo: CachedGitHubRepository) => void;
  selectedRepoId: string | null;
}

export function FolderRepositoryPicker({
  open,
  onClose,
  onSelect,
  selectedRepoId,
}: FolderRepositoryPickerProps) {
  const [repositories, setRepositories] = useState<CachedGitHubRepository[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<CachedGitHubRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRepositories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/repositories?includeCloneStatus=true");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch repositories");
      }
      const data = await response.json();
      setRepositories(data.repositories);
      setFilteredRepos(data.repositories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch repositories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchRepositories();
    }
  }, [open, fetchRepositories]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredRepos(repositories);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = repositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
    );
    setFilteredRepos(filtered);
  }, [searchQuery, repositories]);

  const handleSelect = (repo: CachedGitHubRepository) => {
    onSelect(repo);
    onClose();
  };

  const handleClear = () => {
    onSelect(null as unknown as CachedGitHubRepository);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Github className="w-5 h-5 text-violet-400" />
            Select Repository
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories..."
              className="pl-10 bg-slate-800/50 border-white/10 focus:border-violet-500"
            />
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin mb-2" />
              <p className="text-sm text-slate-400">Loading repositories...</p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm mb-2">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRepositories}
                className="text-violet-400"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Repository List */}
          {!loading && !error && (
            <ScrollArea className="h-[300px]">
              <div className="space-y-1 pr-4">
                {/* Clear selection option */}
                {selectedRepoId && (
                  <button
                    onClick={handleClear}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg text-left",
                      "border border-dashed border-white/10 transition-all duration-200",
                      "bg-slate-800/30 hover:bg-slate-800/50 hover:border-red-500/30"
                    )}
                  >
                    <X className="w-4 h-4 text-red-400" />
                    <span className="text-sm text-slate-400">Clear repository link</span>
                  </button>
                )}

                {filteredRepos.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    {searchQuery ? "No repositories match your search" : "No repositories found"}
                  </div>
                ) : (
                  filteredRepos.map((repo) => {
                    const isSelected = selectedRepoId === repo.id;
                    const isCloned = !!repo.localPath;

                    return (
                      <button
                        key={repo.id}
                        onClick={() => handleSelect(repo)}
                        className={cn(
                          "group w-full flex items-center gap-3 p-3 rounded-lg text-left",
                          "border transition-all duration-200",
                          isSelected
                            ? "border-violet-500/50 bg-violet-500/10"
                            : "border-white/10 bg-slate-800/50 hover:bg-slate-800/80 hover:border-violet-500/30"
                        )}
                      >
                        {/* Visibility Icon */}
                        <div className="shrink-0">
                          {repo.isPrivate ? (
                            <Lock className="w-4 h-4 text-amber-400" />
                          ) : (
                            <Globe className="w-4 h-4 text-slate-400" />
                          )}
                        </div>

                        {/* Repo Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white truncate">
                              {repo.fullName}
                            </span>
                          </div>
                        </div>

                        {/* Clone Status */}
                        <div className="shrink-0 flex items-center gap-2">
                          {isCloned ? (
                            <span className="flex items-center gap-1 text-xs text-green-400">
                              <Check className="w-3 h-3" />
                              Cloned
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <Download className="w-3 h-3" />
                              Not cloned
                            </span>
                          )}
                        </div>

                        {/* Selected indicator */}
                        {isSelected && (
                          <Check className="w-4 h-4 text-violet-400 shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          )}

          {/* Footer hint */}
          <p className="text-xs text-slate-500 text-center">
            Non-cloned repositories will be cloned automatically when saving
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
