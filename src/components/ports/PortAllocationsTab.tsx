"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Network,
  Search,
  ExternalLink,
  Circle,
  FolderOpen,
} from "lucide-react";
import { usePortContext } from "@/contexts/PortContext";
import type { PortAllocationWithFolder } from "@/types/port";

interface PortAllocationsTabProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

type SortField = "port" | "folder" | "variable";
type SortDirection = "asc" | "desc";

export function PortAllocationsTab({
  selectedFolderId,
  onSelectFolder,
}: PortAllocationsTabProps) {
  const { allocations, isPortActive } = usePortContext();
  // folders context not needed since we get folder names from allocations

  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("port");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  // Build folder options for dropdown
  const folderOptions = useMemo(() => {
    const uniqueFolders = new Map<string, string>();
    for (const alloc of allocations) {
      uniqueFolders.set(alloc.folderId, alloc.folderName);
    }
    return Array.from(uniqueFolders.entries()).map(([id, name]) => ({
      id,
      name,
    }));
  }, [allocations]);

  // Filter and sort allocations
  const filteredAllocations = useMemo(() => {
    let result = [...allocations];

    // Filter by folder
    if (selectedFolderId) {
      result = result.filter((a) => a.folderId === selectedFolderId);
    }

    // Filter by active status
    if (filterActive !== null) {
      result = result.filter((a) => isPortActive(a.port) === filterActive);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.port.toString().includes(query) ||
          a.variableName.toLowerCase().includes(query) ||
          a.folderName.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "port":
          comparison = a.port - b.port;
          break;
        case "folder":
          comparison = a.folderName.localeCompare(b.folderName);
          break;
        case "variable":
          comparison = a.variableName.localeCompare(b.variableName);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [
    allocations,
    selectedFolderId,
    filterActive,
    searchQuery,
    sortField,
    sortDirection,
    isPortActive,
  ]);

  // Handle sort toggle
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField]
  );

  // Navigate to folder preferences
  const handleOpenFolderPrefs = useCallback((folderId: string) => {
    // For now, emit a custom event that SessionManager can listen to
    window.dispatchEvent(
      new CustomEvent("open-folder-preferences", { detail: { folderId } })
    );
  }, []);

  if (allocations.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Network className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p className="text-xs">No port allocations</p>
        <p className="text-xs mt-1">
          Add environment variables like PORT=3000 to folder preferences
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ports, variables, folders..."
            className="pl-8 bg-slate-800 border-white/10 text-white placeholder:text-slate-500 text-xs h-8"
          />
        </div>

        <Select
          value={selectedFolderId || "all"}
          onValueChange={(v) => onSelectFolder(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-[140px] bg-slate-800 border-white/10 text-white text-xs h-8">
            <SelectValue placeholder="All folders" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-white/10">
            <SelectItem value="all" className="text-white text-xs">
              All folders
            </SelectItem>
            {folderOptions.map((folder) => (
              <SelectItem
                key={folder.id}
                value={folder.id}
                className="text-white text-xs"
              >
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterActive === null ? "all" : filterActive ? "active" : "inactive"}
          onValueChange={(v) =>
            setFilterActive(v === "all" ? null : v === "active")
          }
        >
          <SelectTrigger className="w-[100px] bg-slate-800 border-white/10 text-white text-xs h-8">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-white/10">
            <SelectItem value="all" className="text-white text-xs">
              All
            </SelectItem>
            <SelectItem value="active" className="text-white text-xs">
              Active
            </SelectItem>
            <SelectItem value="inactive" className="text-white text-xs">
              Inactive
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 rounded-lg text-xs text-slate-400">
        <button
          onClick={() => handleSort("port")}
          className="w-20 text-left hover:text-white flex items-center gap-1"
        >
          Port
          {sortField === "port" && (
            <span className="text-violet-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
          )}
        </button>
        <button
          onClick={() => handleSort("variable")}
          className="w-32 text-left hover:text-white flex items-center gap-1"
        >
          Variable
          {sortField === "variable" && (
            <span className="text-violet-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
          )}
        </button>
        <button
          onClick={() => handleSort("folder")}
          className="flex-1 text-left hover:text-white flex items-center gap-1"
        >
          Folder
          {sortField === "folder" && (
            <span className="text-violet-400">{sortDirection === "asc" ? "↑" : "↓"}</span>
          )}
        </button>
        <div className="w-16 text-center">Status</div>
        <div className="w-8" />
      </div>

      {/* Allocations List */}
      <div className="space-y-1">
        {filteredAllocations.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            No matching allocations
          </div>
        ) : (
          filteredAllocations.map((alloc) => (
            <PortAllocationRow
              key={alloc.id}
              allocation={alloc}
              isActive={isPortActive(alloc.port)}
              onOpenFolderPrefs={handleOpenFolderPrefs}
            />
          ))
        )}
      </div>

      {/* Summary */}
      <div className="text-xs text-slate-500 pt-2 border-t border-white/5">
        Showing {filteredAllocations.length} of {allocations.length} allocations
      </div>
    </div>
  );
}

// ============================================================================
// Port Allocation Row
// ============================================================================

interface PortAllocationRowProps {
  allocation: PortAllocationWithFolder;
  isActive: boolean;
  onOpenFolderPrefs: (folderId: string) => void;
}

function PortAllocationRow({
  allocation,
  isActive,
  onOpenFolderPrefs,
}: PortAllocationRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/30 border border-white/5 hover:border-violet-500/30 transition-colors">
      {/* Port */}
      <div className="w-20">
        <span className="font-mono text-white text-xs">{allocation.port}</span>
      </div>

      {/* Variable Name */}
      <div className="w-32">
        <Badge
          variant="outline"
          className="font-mono text-[10px] bg-slate-800/50 text-slate-300 border-slate-700"
        >
          {allocation.variableName}
        </Badge>
      </div>

      {/* Folder */}
      <div className="flex-1 flex items-center gap-1.5">
        <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs text-slate-300 truncate">
          {allocation.folderName}
        </span>
      </div>

      {/* Status */}
      <div className="w-16 flex justify-center">
        <span className="flex items-center gap-1">
          <Circle
            className={`w-2 h-2 ${
              isActive ? "fill-emerald-400 text-emerald-400" : "fill-slate-500 text-slate-500"
            }`}
          />
          <span
            className={`text-[10px] ${
              isActive ? "text-emerald-400" : "text-slate-500"
            }`}
          >
            {isActive ? "Active" : "Idle"}
          </span>
        </span>
      </div>

      {/* Actions */}
      <div className="w-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenFolderPrefs(allocation.folderId)}
          className="h-6 w-6 text-slate-400 hover:text-violet-400"
          title="Edit in folder preferences"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
