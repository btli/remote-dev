"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Github,
  Search,
  Loader2,
  Lock,
  Globe,
  Star,
  GitFork,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GitHubRepository } from "@/types/github";

interface RepositoryPickerProps {
  onSelect: (repo: GitHubRepository) => void;
  onBack: () => void;
}

export function RepositoryPicker({ onSelect, onBack }: RepositoryPickerProps) {
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<GitHubRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRepositories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/repositories");
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
    fetchRepositories();
  }, [fetchRepositories]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredRepos(repositories);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = repositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    );
    setFilteredRepos(filtered);
  }, [searchQuery, repositories]);

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin mb-4" />
        <p className="text-slate-400">Loading repositories...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Github className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-red-400 mb-4">{error}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack} className="text-slate-400">
            Back
          </Button>
          <Button onClick={fetchRepositories} className="bg-violet-600 hover:bg-violet-700">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {/* Repository List */}
      <ScrollArea className="h-[300px]">
        <div className="space-y-2 pr-4">
          {filteredRepos.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              {searchQuery
                ? "No repositories match your search"
                : "No repositories found"}
            </div>
          ) : (
            filteredRepos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => onSelect(repo)}
                className={cn(
                  "group w-full flex items-start gap-3 p-3 rounded-lg text-left",
                  "border border-white/10 transition-all duration-200",
                  "bg-slate-800/50 hover:bg-slate-800/80 hover:border-violet-500/50",
                  "hover:shadow-lg hover:shadow-violet-500/10"
                )}
              >
                {/* Visibility Icon */}
                <div className="mt-0.5">
                  {repo.isPrivate ? (
                    <Lock className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Globe className="w-4 h-4 text-slate-400" />
                  )}
                </div>

                {/* Repo Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white truncate">
                      {repo.fullName}
                    </h3>
                  </div>

                  {repo.description && (
                    <p className="text-sm text-slate-400 mt-0.5 line-clamp-2">
                      {repo.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: getLanguageColor(repo.language),
                          }}
                        />
                        {repo.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {repo.stargazersCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <GitFork className="w-3 h-3" />
                      {repo.forksCount}
                    </span>
                    <span>Updated {formatDate(repo.updatedAt)}</span>
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-violet-400 transition-colors mt-1" />
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex justify-between pt-2 border-t border-white/10">
        <Button variant="ghost" onClick={onBack} className="text-slate-400">
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={fetchRepositories}
          className="text-slate-400"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>
  );
}

// Language color mapping (common languages)
function getLanguageColor(language: string): string {
  const colors: Record<string, string> = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Go: "#00ADD8",
    Rust: "#dea584",
    Java: "#b07219",
    Ruby: "#701516",
    PHP: "#4F5D95",
    "C++": "#f34b7d",
    C: "#555555",
    "C#": "#178600",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    Dart: "#00B4AB",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Shell: "#89e051",
    Dockerfile: "#384d54",
  };
  return colors[language] || "#8b949e";
}
