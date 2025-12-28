"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  Search,
  Loader2,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GitHubRepository, GitHubBranch } from "@/types/github";

interface BranchPickerProps {
  repository: GitHubRepository;
  onSelect: (branch: GitHubBranch | null, createWorktree: boolean, newBranchName?: string) => void;
  onBack: () => void;
}

type Mode = "select" | "create";

export function BranchPicker({ repository, onSelect, onBack }: BranchPickerProps) {
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<Mode>("select");
  const [newBranchName, setNewBranchName] = useState("");
  const [selectedBaseBranch, setSelectedBaseBranch] = useState<GitHubBranch | null>(null);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/github/repositories/${repository.id}/branches`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch branches");
      }
      const data = await response.json();
      setBranches(data.branches);

      // Set default branch as base
      const defaultBranch = data.branches.find((b: GitHubBranch) => b.name === repository.defaultBranch);
      if (defaultBranch) {
        setSelectedBaseBranch(defaultBranch);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch branches");
    } finally {
      setLoading(false);
    }
  }, [repository.id, repository.defaultBranch]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectExisting = (branch: GitHubBranch) => {
    // Generate a unique branch name for the worktree based on the selected branch
    // This avoids the "branch already checked out" error
    const timestamp = Date.now().toString(36);
    const worktreeBranchName = `${branch.name}-wt-${timestamp}`;
    onSelect(branch, true, worktreeBranchName);
  };

  const handleCreateNew = () => {
    if (!newBranchName.trim()) return;
    onSelect(selectedBaseBranch, true, newBranchName.trim());
  };

  const handleSkipWorktree = () => {
    onSelect(null, false, undefined);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Loading branches...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <GitBranch className="w-12 h-12 text-destructive mb-4" />
        <p className="text-destructive mb-4">{error}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack} className="text-muted-foreground">
            Back
          </Button>
          <Button onClick={fetchBranches} className="bg-primary hover:bg-primary/90">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("select")}
          className={cn(
            "flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all",
            mode === "select"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-card/50 text-muted-foreground border border-transparent hover:border-border"
          )}
        >
          <GitBranch className="w-4 h-4 inline mr-2" />
          From Branch
        </button>
        <button
          onClick={() => setMode("create")}
          className={cn(
            "flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all",
            mode === "create"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-card/50 text-muted-foreground border border-transparent hover:border-border"
          )}
        >
          <Plus className="w-4 h-4 inline mr-2" />
          New Branch
        </button>
      </div>

      {mode === "select" ? (
        <>
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branches..."
              className="pl-10 bg-card/50 border-border focus:border-primary"
            />
          </div>

          {/* Branch List */}
          <ScrollArea className="h-[240px]">
            <div className="space-y-1 pr-4">
              {filteredBranches.map((branch) => (
                <button
                  key={branch.name}
                  onClick={() => handleSelectExisting(branch)}
                  className={cn(
                    "group w-full flex items-center gap-3 p-2.5 rounded-lg text-left",
                    "border border-transparent transition-all duration-200",
                    "hover:bg-card/80 hover:border-primary/50",
                    branch.name === repository.defaultBranch && "bg-card/30"
                  )}
                >
                  <GitBranch className="w-4 h-4 text-muted-foreground" />
                  <span className="flex-1 text-sm text-foreground truncate">
                    {branch.name}
                  </span>
                  {branch.name === repository.defaultBranch && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                      default
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-primary" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </>
      ) : (
        <div className="space-y-4">
          {/* New Branch Name */}
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">New Branch Name</label>
            <Input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="feature/my-feature"
              className="bg-card/50 border-border focus:border-primary"
            />
          </div>

          {/* Base Branch */}
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Base Branch</label>
            <div className="relative">
              <select
                value={selectedBaseBranch?.name || ""}
                onChange={(e) => {
                  const branch = branches.find((b) => b.name === e.target.value);
                  setSelectedBaseBranch(branch || null);
                }}
                className="w-full p-2.5 rounded-lg bg-card/50 border border-border text-foreground text-sm appearance-none focus:border-primary focus:outline-none"
              >
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
              <GitBranch className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Create Button */}
          <Button
            onClick={handleCreateNew}
            disabled={!newBranchName.trim()}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Worktree with New Branch
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between pt-2 border-t border-border">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground">
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={handleSkipWorktree}
          className="text-muted-foreground"
        >
          Skip (use default branch)
        </Button>
      </div>
    </div>
  );
}
