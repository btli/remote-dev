"use client";

/**
 * MemoryPanel - Session-scoped memory display panel.
 *
 * Shows memories relevant to the active session/folder with:
 * - Tier-based organization (short-term, working, long-term)
 * - Quick actions (pin, dismiss, promote, delete)
 * - Real-time updates via polling
 * - Content type icons and badges
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Brain,
  Clock,
  Archive,
  Lightbulb,
  AlertTriangle,
  CheckSquare,
  HelpCircle,
  Eye,
  Bell,
  RefreshCw,
  MoreVertical,
  Pin,
  X,
  ArrowUpCircle,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import {
  useSessionMemory,
  type MemoryQueryResult,
  type MemoryTier,
} from "@/hooks/useSessionMemory";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  sessionId: string | null;
  folderId: string | null;
  className?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  width?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Type Icons & Colors
// ─────────────────────────────────────────────────────────────────────────────

const contentTypeConfig: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  "note:todo": { icon: CheckSquare, color: "text-blue-400", label: "Todo" },
  "note:reminder": { icon: Bell, color: "text-yellow-400", label: "Reminder" },
  "note:question": { icon: HelpCircle, color: "text-purple-400", label: "Question" },
  "note:observation": { icon: Eye, color: "text-green-400", label: "Observation" },
  "note:warning": { icon: AlertTriangle, color: "text-orange-400", label: "Warning" },
  "note:decision": { icon: CheckSquare, color: "text-emerald-400", label: "Decision" },
  "insight:convention": { icon: Lightbulb, color: "text-amber-400", label: "Convention" },
  "insight:pattern": { icon: Lightbulb, color: "text-cyan-400", label: "Pattern" },
  "insight:gotcha": { icon: AlertTriangle, color: "text-red-400", label: "Gotcha" },
  "insight:skill": { icon: Lightbulb, color: "text-indigo-400", label: "Skill" },
  "insight:tool": { icon: Lightbulb, color: "text-pink-400", label: "Tool" },
  context: { icon: Brain, color: "text-slate-400", label: "Context" },
  task_context: { icon: Brain, color: "text-blue-300", label: "Task Context" },
  error: { icon: AlertTriangle, color: "text-red-500", label: "Error" },
  discovery: { icon: Eye, color: "text-teal-400", label: "Discovery" },
  reference: { icon: Archive, color: "text-gray-400", label: "Reference" },
  project: { icon: Brain, color: "text-violet-400", label: "Project" },
};

const tierConfig: Record<
  MemoryTier,
  { icon: React.ElementType; color: string; label: string }
> = {
  short_term: { icon: Clock, color: "text-yellow-400", label: "Short-term" },
  working: { icon: Brain, color: "text-blue-400", label: "Working" },
  long_term: { icon: Archive, color: "text-green-400", label: "Long-term" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MemoryPanel({
  sessionId,
  folderId,
  className,
  collapsed = false,
  onCollapsedChange,
  width = 300,
}: MemoryPanelProps) {
  const {
    memories,
    loading,
    error,
    refresh,
    pinToWorking,
    dismiss,
    deleteMemory,
    promoteToLongTerm,
    counts,
  } = useSessionMemory({
    sessionId,
    folderId,
    pollInterval: 30000,
    autoFetch: !collapsed,
  });

  const [activeTab, setActiveTab] = useState<MemoryTier>("working");
  const [promoteDialog, setPromoteDialog] = useState<{
    memoryId: string;
    name: string;
  } | null>(null);
  const [expandedMemories, setExpandedMemories] = useState<Set<string>>(new Set());

  // Toggle memory expansion
  const toggleExpand = (memoryId: string) => {
    setExpandedMemories((prev) => {
      const next = new Set(prev);
      if (next.has(memoryId)) {
        next.delete(memoryId);
      } else {
        next.add(memoryId);
      }
      return next;
    });
  };

  // Handle promote to long-term
  const handlePromote = async () => {
    if (promoteDialog) {
      await promoteToLongTerm(promoteDialog.memoryId, promoteDialog.name);
      setPromoteDialog(null);
    }
  };

  // Current memories based on active tab
  const currentMemories = memories[activeTab];

  if (collapsed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center py-4 px-1 border-l border-border bg-card/50 backdrop-blur-sm",
          className
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapsedChange?.(false)}
          className="mb-4"
          title="Expand memory panel"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Brain className="h-5 w-5 text-muted-foreground" />
            {counts.total > 0 && (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-2 h-4 min-w-[16px] px-1 text-[10px]"
              >
                {counts.total}
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-card/50 backdrop-blur-sm",
        className
      )}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Memory</span>
          {counts.total > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {counts.total}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={loading}
            className="h-7 w-7"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange?.(true)}
            className="h-7 w-7"
            title="Collapse panel"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as MemoryTier)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="w-full justify-start rounded-none border-b px-1 h-auto py-1 bg-transparent">
          <TabsTrigger
            value="working"
            className="gap-1 text-xs px-2 py-1 data-[state=active]:bg-muted"
          >
            <Brain className="h-3 w-3" />
            <span className="hidden lg:inline">Working</span>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {counts.working}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="short_term"
            className="gap-1 text-xs px-2 py-1 data-[state=active]:bg-muted"
          >
            <Clock className="h-3 w-3" />
            <span className="hidden lg:inline">Short</span>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {counts.short_term}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="long_term"
            className="gap-1 text-xs px-2 py-1 data-[state=active]:bg-muted"
          >
            <Archive className="h-3 w-3" />
            <span className="hidden lg:inline">Long</span>
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {counts.long_term}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-2">
            {loading && currentMemories.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : currentMemories.length === 0 ? (
              <EmptyState tier={activeTab} />
            ) : (
              currentMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  expanded={expandedMemories.has(memory.id)}
                  onToggleExpand={() => toggleExpand(memory.id)}
                  onPin={() => pinToWorking(memory.id)}
                  onDismiss={() => dismiss(memory.id)}
                  onDelete={() => deleteMemory(memory.id)}
                  onPromote={(name) =>
                    setPromoteDialog({ memoryId: memory.id, name })
                  }
                />
              ))
            )}
          </div>
        </ScrollArea>
      </Tabs>

      {/* Promote Dialog */}
      <Dialog
        open={promoteDialog !== null}
        onOpenChange={(open) => !open && setPromoteDialog(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Promote to Long-term Memory</DialogTitle>
            <DialogDescription>
              Give this memory a name to save it permanently.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="memory-name">Name</Label>
              <Input
                id="memory-name"
                value={promoteDialog?.name ?? ""}
                onChange={(e) =>
                  setPromoteDialog((prev) =>
                    prev ? { ...prev, name: e.target.value } : null
                  )
                }
                placeholder="Enter a descriptive name..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={handlePromote}
              disabled={!promoteDialog?.name.trim()}
            >
              Promote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Card
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryCardProps {
  memory: MemoryQueryResult;
  expanded: boolean;
  onToggleExpand: () => void;
  onPin: () => void;
  onDismiss: () => void;
  onDelete: () => void;
  onPromote: (name: string) => void;
}

function MemoryCard({
  memory,
  expanded,
  onToggleExpand,
  onPin,
  onDismiss,
  onDelete,
  onPromote,
}: MemoryCardProps) {
  const config = contentTypeConfig[memory.contentType] || {
    icon: Brain,
    color: "text-muted-foreground",
    label: memory.contentType,
  };
  const Icon = config.icon;

  // Format relative time
  const timeAgo = useMemo(() => {
    const date = new Date(memory.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }, [memory.createdAt]);

  // Truncate content for preview
  const preview =
    memory.content.length > 120
      ? memory.content.slice(0, 120) + "..."
      : memory.content;

  return (
    <Card className="border-muted hover:border-muted-foreground/30 transition-colors">
      <CardHeader className="p-2 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", config.color)} />
            <Badge variant="outline" className="text-[10px] px-1 h-4">
              {config.label}
            </Badge>
            {memory.semantic && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1 h-4 bg-primary/20"
              >
                semantic
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {memory.tier !== "working" && (
                <DropdownMenuItem onClick={onPin}>
                  <Pin className="h-3.5 w-3.5 mr-2" />
                  Pin to Working
                </DropdownMenuItem>
              )}
              {memory.tier !== "long_term" && (
                <DropdownMenuItem
                  onClick={() => onPromote(memory.name || "Untitled")}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5 mr-2" />
                  Promote to Long-term
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onDismiss}>
                <X className="h-3.5 w-3.5 mr-2" />
                Dismiss
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {memory.name && (
          <CardTitle className="text-xs font-medium truncate">
            {memory.name}
          </CardTitle>
        )}
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <p
          className={cn(
            "text-xs text-muted-foreground whitespace-pre-wrap cursor-pointer",
            !expanded && "line-clamp-3"
          )}
          onClick={onToggleExpand}
        >
          {expanded ? memory.content : preview}
        </p>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/70">
          <span>{timeAgo}</span>
          {memory.score !== undefined && (
            <span>score: {(memory.score * 100).toFixed(0)}%</span>
          )}
          {memory.accessCount > 0 && <span>{memory.accessCount} views</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ tier }: { tier: MemoryTier }) {
  const config = tierConfig[tier];
  const Icon = config.icon;

  const messages: Record<MemoryTier, string> = {
    short_term: "No short-term memories. These are temporary context from recent activity.",
    working: "No working memories. Pin important items here for your current task.",
    long_term: "No long-term memories. Promote important insights to save them permanently.",
  };

  return (
    <div className="text-center py-8 px-4">
      <Icon className={cn("h-8 w-8 mx-auto mb-3", config.color, "opacity-50")} />
      <p className="text-xs text-muted-foreground">{messages[tier]}</p>
    </div>
  );
}

export default MemoryPanel;
