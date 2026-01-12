"use client";

/**
 * MemoryBrowser - Component for viewing and managing hierarchical memory entries.
 *
 * Provides:
 * - View entries by tier (short-term, working, long-term)
 * - Search functionality with semantic search
 * - Manual promotion/demotion between tiers
 * - Delete functionality
 * - Tier-based filtering
 */

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  RefreshCw,
  Loader2,
  Clock,
  Brain,
  Database,
  MoreVertical,
  ChevronUp,
  ChevronDown,
  Trash2,
  Pin,
  Eye,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSessionMemory,
  type MemoryQueryResult,
  type MemoryTier,
  type MemoryContentType,
} from "@/hooks/useSessionMemory";
import { useSessionContext } from "@/contexts/SessionContext";
import { formatDistanceToNow } from "date-fns";

interface MemoryBrowserProps {
  open: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<
  MemoryTier,
  { label: string; icon: React.ReactNode; color: string; description: string }
> = {
  short_term: {
    label: "Short-term",
    icon: <Clock className="w-4 h-4" />,
    color: "text-yellow-500",
    description: "Recent commands, observations (auto-expires)",
  },
  working: {
    label: "Working",
    icon: <Brain className="w-4 h-4" />,
    color: "text-blue-500",
    description: "Active task context, hypotheses",
  },
  long_term: {
    label: "Long-term",
    icon: <Database className="w-4 h-4" />,
    color: "text-green-500",
    description: "Project knowledge, conventions, patterns",
  },
};

const CONTENT_TYPE_LABELS: Record<MemoryContentType, string> = {
  "note:todo": "Todo",
  "note:reminder": "Reminder",
  "note:question": "Question",
  "note:observation": "Observation",
  "note:warning": "Warning",
  "note:decision": "Decision",
  "insight:convention": "Convention",
  "insight:pattern": "Pattern",
  "insight:gotcha": "Gotcha",
  "insight:skill": "Skill",
  "insight:tool": "Tool",
  context: "Context",
  task_context: "Task Context",
  error: "Error",
  discovery: "Discovery",
  reference: "Reference",
  project: "Project",
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory Entry Card
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryEntryCardProps {
  entry: MemoryQueryResult;
  onPromote: (id: string, tier: MemoryTier) => void;
  onDemote: (id: string, tier: MemoryTier) => void;
  onPin: (id: string) => void;
  onDismiss: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (entry: MemoryQueryResult) => void;
}

function MemoryEntryCard({
  entry,
  onPromote,
  onDemote,
  onPin,
  onDismiss,
  onDelete,
  onView,
}: MemoryEntryCardProps) {
  const tierConfig = TIER_CONFIG[entry.tier];
  const contentTypeLabel =
    CONTENT_TYPE_LABELS[entry.contentType] || entry.contentType;

  const canPromote = entry.tier !== "long_term";
  const canDemote = entry.tier !== "short_term";

  const getNextTier = (current: MemoryTier): MemoryTier => {
    if (current === "short_term") return "working";
    if (current === "working") return "long_term";
    return "long_term";
  };

  const getPrevTier = (current: MemoryTier): MemoryTier => {
    if (current === "long_term") return "working";
    if (current === "working") return "short_term";
    return "short_term";
  };

  return (
    <div className="group border border-border rounded-lg p-3 hover:border-primary/50 transition-colors bg-card/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("flex-shrink-0", tierConfig.color)}>
              {tierConfig.icon}
            </span>
            <Badge variant="secondary" className="text-xs">
              {contentTypeLabel}
            </Badge>
            {entry.name && (
              <span className="font-medium text-sm truncate">{entry.name}</span>
            )}
            {entry.score !== undefined && (
              <Badge variant="outline" className="text-xs ml-auto">
                {(entry.score * 100).toFixed(0)}%
              </Badge>
            )}
          </div>

          {/* Description or Content Preview */}
          <p className="text-sm text-muted-foreground line-clamp-2">
            {entry.description || entry.content}
          </p>

          {/* Meta info */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>
              {formatDistanceToNow(new Date(entry.createdAt), {
                addSuffix: true,
              })}
            </span>
            {entry.accessCount > 0 && (
              <span>{entry.accessCount} access{entry.accessCount !== 1 ? "es" : ""}</span>
            )}
            {entry.expiresAt && (
              <span className="text-yellow-500">
                Expires{" "}
                {formatDistanceToNow(new Date(entry.expiresAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onView(entry)}>
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {entry.tier === "short_term" && (
              <DropdownMenuItem onClick={() => onPin(entry.id)}>
                <Pin className="w-4 h-4 mr-2" />
                Pin to Working
              </DropdownMenuItem>
            )}
            {canPromote && (
              <DropdownMenuItem
                onClick={() => onPromote(entry.id, getNextTier(entry.tier))}
              >
                <ChevronUp className="w-4 h-4 mr-2" />
                Promote to {TIER_CONFIG[getNextTier(entry.tier)].label}
              </DropdownMenuItem>
            )}
            {canDemote && (
              <DropdownMenuItem
                onClick={() => onDemote(entry.id, getPrevTier(entry.tier))}
              >
                <ChevronDown className="w-4 h-4 mr-2" />
                Demote to {TIER_CONFIG[getPrevTier(entry.tier)].label}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDismiss(entry.id)}>
              <XCircle className="w-4 h-4 mr-2" />
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(entry.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Detail View
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryDetailViewProps {
  entry: MemoryQueryResult | null;
  onClose: () => void;
}

function MemoryDetailView({ entry, onClose }: MemoryDetailViewProps) {
  if (!entry) return null;

  const tierConfig = TIER_CONFIG[entry.tier];

  return (
    <Dialog open={!!entry} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={tierConfig.color}>{tierConfig.icon}</span>
            {entry.name || CONTENT_TYPE_LABELS[entry.contentType]}
          </DialogTitle>
          <DialogDescription>{tierConfig.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {entry.description && (
            <div>
              <h4 className="text-sm font-medium mb-1">Description</h4>
              <p className="text-sm text-muted-foreground">
                {entry.description}
              </p>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium mb-1">Content</h4>
            <pre className="text-sm bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
              {entry.content}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <Badge variant="secondary">{entry.contentType}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Tier:</span>{" "}
              <Badge variant="outline">{tierConfig.label}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Priority:</span>{" "}
              {entry.priority}
            </div>
            <div>
              <span className="text-muted-foreground">Confidence:</span>{" "}
              {(entry.confidence * 100).toFixed(0)}%
            </div>
            <div>
              <span className="text-muted-foreground">Relevance:</span>{" "}
              {(entry.relevance * 100).toFixed(0)}%
            </div>
            <div>
              <span className="text-muted-foreground">Access Count:</span>{" "}
              {entry.accessCount}
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>{" "}
              {formatDistanceToNow(new Date(entry.createdAt), {
                addSuffix: true,
              })}
            </div>
            {entry.expiresAt && (
              <div>
                <span className="text-muted-foreground">Expires:</span>{" "}
                {formatDistanceToNow(new Date(entry.expiresAt), {
                  addSuffix: true,
                })}
              </div>
            )}
          </div>

          {entry.taskId && (
            <div>
              <span className="text-sm text-muted-foreground">Task ID:</span>{" "}
              <code className="text-sm">{entry.taskId}</code>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory List
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryListProps {
  entries: MemoryQueryResult[];
  loading: boolean;
  tier: MemoryTier;
  onPromote: (id: string, tier: MemoryTier) => void;
  onDemote: (id: string, tier: MemoryTier) => void;
  onPin: (id: string) => void;
  onDismiss: (id: string) => void;
  onDelete: (id: string) => void;
  onView: (entry: MemoryQueryResult) => void;
}

function MemoryList({
  entries,
  loading,
  tier,
  onPromote,
  onDemote,
  onPin,
  onDismiss,
  onDelete,
  onView,
}: MemoryListProps) {
  const tierConfig = TIER_CONFIG[tier];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <span className={cn("mb-2", tierConfig.color)}>{tierConfig.icon}</span>
        <p className="text-sm text-muted-foreground">
          No {tierConfig.label.toLowerCase()} memories
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {tierConfig.description}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <MemoryEntryCard
          key={entry.id}
          entry={entry}
          onPromote={onPromote}
          onDemote={onDemote}
          onPin={onPin}
          onDismiss={onDismiss}
          onDelete={onDelete}
          onView={onView}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MemoryBrowser({ open, onClose }: MemoryBrowserProps) {
  const { sessions, activeSessionId } = useSessionContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<MemoryTier | "all">("all");
  const [selectedEntry, setSelectedEntry] = useState<MemoryQueryResult | null>(
    null
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Get the active session and its folder directly from session data
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeFolderId = activeSession?.folderId ?? null;

  const {
    memories,
    allMemories,
    loading,
    error,
    refresh,
    pinToWorking,
    dismiss,
    deleteMemory,
    promoteToLongTerm,
    counts,
  } = useSessionMemory({
    sessionId: activeSessionId,
    folderId: activeFolderId,
    query: searchQuery || undefined,
    autoFetch: open,
    pollInterval: open ? 30000 : 0,
  });

  // Filter memories based on active tab
  const displayedMemories = useMemo(() => {
    if (activeTab === "all") return allMemories;
    return memories[activeTab];
  }, [activeTab, memories, allMemories]);

  // Handlers
  const handlePromote = async (id: string, targetTier: MemoryTier) => {
    if (targetTier === "long_term") {
      const entry = allMemories.find((e) => e.id === id);
      const name = entry?.name || entry?.description?.slice(0, 50) || "Memory";
      await promoteToLongTerm(id, name);
    } else {
      await pinToWorking(id);
    }
  };

  const handleDemote = async (id: string, targetTier: MemoryTier) => {
    // For demotion, we update the tier directly via API
    try {
      const response = await fetch(`/api/sdk/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: targetTier,
          ttlSeconds: targetTier === "short_term" ? 3600 : 86400,
        }),
      });
      if (!response.ok) throw new Error("Failed to demote");
      await refresh();
    } catch (err) {
      console.error("Demote error:", err);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteMemory(deleteConfirm);
    setDeleteConfirm(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              Memory Browser
            </DialogTitle>
            <DialogDescription>
              View and manage hierarchical memory entries for this session
            </DialogDescription>
          </DialogHeader>

          {/* Search and refresh */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw
                className={cn("w-4 h-4", loading && "animate-spin")}
              />
            </Button>
          </div>

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as MemoryTier | "all")}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="all" className="gap-1">
                All
                <Badge variant="secondary" className="ml-1 text-xs">
                  {counts.total}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="short_term" className="gap-1">
                <Clock className="w-3 h-3" />
                Short
                <Badge variant="secondary" className="ml-1 text-xs">
                  {counts.short_term}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="working" className="gap-1">
                <Brain className="w-3 h-3" />
                Working
                <Badge variant="secondary" className="ml-1 text-xs">
                  {counts.working}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="long_term" className="gap-1">
                <Database className="w-3 h-3" />
                Long
                <Badge variant="secondary" className="ml-1 text-xs">
                  {counts.long_term}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto mt-4">
              <TabsContent value="all" className="m-0">
                <MemoryList
                  entries={displayedMemories}
                  loading={loading}
                  tier="working"
                  onPromote={handlePromote}
                  onDemote={handleDemote}
                  onPin={pinToWorking}
                  onDismiss={dismiss}
                  onDelete={setDeleteConfirm}
                  onView={setSelectedEntry}
                />
              </TabsContent>
              <TabsContent value="short_term" className="m-0">
                <MemoryList
                  entries={memories.short_term}
                  loading={loading}
                  tier="short_term"
                  onPromote={handlePromote}
                  onDemote={handleDemote}
                  onPin={pinToWorking}
                  onDismiss={dismiss}
                  onDelete={setDeleteConfirm}
                  onView={setSelectedEntry}
                />
              </TabsContent>
              <TabsContent value="working" className="m-0">
                <MemoryList
                  entries={memories.working}
                  loading={loading}
                  tier="working"
                  onPromote={handlePromote}
                  onDemote={handleDemote}
                  onPin={pinToWorking}
                  onDismiss={dismiss}
                  onDelete={setDeleteConfirm}
                  onView={setSelectedEntry}
                />
              </TabsContent>
              <TabsContent value="long_term" className="m-0">
                <MemoryList
                  entries={memories.long_term}
                  loading={loading}
                  tier="long_term"
                  onPromote={handlePromote}
                  onDemote={handleDemote}
                  onPin={pinToWorking}
                  onDismiss={dismiss}
                  onDelete={setDeleteConfirm}
                  onView={setSelectedEntry}
                />
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Detail view */}
      <MemoryDetailView
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Memory Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this memory entry. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
