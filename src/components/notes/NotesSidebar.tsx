"use client";

/**
 * NotesSidebar - Collapsible sidebar for session notes.
 *
 * Features:
 * - Quick capture form with type selection
 * - Search and tag filtering
 * - Pinned notes section
 * - Note cards with actions (edit, pin, archive, delete)
 * - Markdown preview support
 */

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StickyNote,
  Plus,
  Search,
  Pin,
  Archive,
  Trash2,
  ChevronDown,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Pencil,
  Eye,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Lightbulb,
  ListTodo,
  Link2,
  Loader2,
  X,
  PanelRightClose,
  RefreshCw,
} from "lucide-react";
import {
  useNotes,
  type Note,
  type NoteType,
  type CreateNoteInput,
  NOTE_TYPES,
} from "@/hooks/useNotes";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface NotesSidebarProps {
  sessionId?: string | null;
  folderId?: string | null;
  className?: string;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Width in pixels when expanded */
  width?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Config
// ─────────────────────────────────────────────────────────────────────────────

const typeConfig: Record<
  NoteType,
  { icon: React.ElementType; color: string; bgColor: string; label: string }
> = {
  observation: {
    icon: Eye,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    label: "Observation",
  },
  decision: {
    icon: CheckCircle2,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    label: "Decision",
  },
  gotcha: {
    icon: AlertTriangle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Gotcha",
  },
  pattern: {
    icon: Lightbulb,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    label: "Pattern",
  },
  question: {
    icon: CircleHelp,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    label: "Question",
  },
  todo: {
    icon: ListTodo,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    label: "Todo",
  },
  reference: {
    icon: Link2,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    label: "Reference",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Note Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onTogglePin: (noteId: string) => void;
  onToggleArchive: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

function NoteCard({ note, onEdit, onTogglePin, onToggleArchive, onDelete }: NoteCardProps) {
  const config = typeConfig[note.type];
  const TypeIcon = config.icon;

  const preview = useMemo(() => {
    const lines = note.content.split("\n");
    const firstLine = lines[0] ?? "";
    if (firstLine.length > 100) {
      return firstLine.slice(0, 97) + "...";
    }
    if (lines.length > 1) {
      return firstLine + "...";
    }
    return firstLine;
  }, [note.content]);

  // Format date without calling Date.now() during render
  const timeAgo = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "numeric",
      month: "short",
      day: "numeric",
    });
    return formatter.format(note.createdAt);
  }, [note.createdAt]);

  return (
    <div
      className={cn(
        "group rounded-md border border-border/50 p-2.5 transition-colors",
        "hover:border-border hover:bg-muted/30",
        note.pinned && "border-amber-500/30 bg-amber-500/5"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={cn("p-1 rounded", config.bgColor)}>
          <TypeIcon className={cn("h-3 w-3", config.color)} />
        </div>
        {note.title && (
          <span className="text-xs font-medium text-foreground truncate flex-1">
            {note.title}
          </span>
        )}
        {!note.title && (
          <span className="text-xs text-muted-foreground truncate flex-1">
            {config.label}
          </span>
        )}
        {note.pinned && (
          <Pin className="h-3 w-3 text-amber-400 fill-amber-400" />
        )}
        <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => onEdit(note)}>
              <Pencil className="h-3 w-3 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTogglePin(note.id)}>
              <Pin className="h-3 w-3 mr-2" />
              {note.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onToggleArchive(note.id)}>
              <Archive className="h-3 w-3 mr-2" />
              {note.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(note.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Content preview */}
      <p className="text-xs text-muted-foreground line-clamp-2">{preview}</p>

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {note.tags.slice(0, 3).map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="h-4 px-1.5 text-[10px]"
            >
              #{tag}
            </Badge>
          ))}
          {note.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{note.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Capture Form
// ─────────────────────────────────────────────────────────────────────────────

interface QuickCaptureProps {
  sessionId?: string | null;
  folderId?: string | null;
  onSubmit: (input: CreateNoteInput) => Promise<Note | null>;
  disabled?: boolean;
}

function QuickCapture({ sessionId, folderId, onSubmit, disabled }: QuickCaptureProps) {
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<NoteType>("observation");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) return;

    setSubmitting(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await onSubmit({
        type,
        content: content.trim(),
        tags: tagList,
        sessionId: sessionId ?? undefined,
        folderId: folderId ?? undefined,
      });

      // Reset form
      setContent("");
      setTags("");
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  }, [content, tags, type, sessionId, folderId, onSubmit]);

  const config = typeConfig[type];
  const TypeIcon = config.icon;

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => setExpanded(true)}
        disabled={disabled}
      >
        <Plus className="h-3.5 w-3.5" />
        Quick capture...
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-border p-2.5 space-y-2">
      {/* Type selector */}
      <div className="flex gap-2">
        <Select value={type} onValueChange={(v) => setType(v as NoteType)}>
          <SelectTrigger className="h-7 w-[130px]">
            <SelectValue>
              <div className="flex items-center gap-1.5">
                <TypeIcon className={cn("h-3 w-3", config.color)} />
                <span className="text-xs">{config.label}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {NOTE_TYPES.map((t) => {
              const c = typeConfig[t];
              const Icon = c.icon;
              return (
                <SelectItem key={t} value={t}>
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-3 w-3", c.color)} />
                    <span>{c.label}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 ml-auto"
          onClick={() => setExpanded(false)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <Textarea
        placeholder="What did you notice or decide?"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[60px] text-xs resize-none"
        disabled={submitting}
      />

      {/* Tags */}
      <Input
        placeholder="Tags (comma separated)"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="h-7 text-xs"
        disabled={submitting}
      />

      {/* Submit */}
      <Button
        size="sm"
        className="w-full h-7"
        onClick={handleSubmit}
        disabled={!content.trim() || submitting}
      >
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Note
          </>
        )}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function NotesSidebar({
  sessionId,
  folderId,
  className,
  collapsed = false,
  onCollapsedChange,
  width = 320,
}: NotesSidebarProps) {
  const {
    notes,
    pinned,
    loading,
    error,
    refresh,
    createNote,
    togglePin,
    toggleArchive,
    deleteNote,
    counts,
    filterTypes,
    setFilterTypes,
    searchQuery,
    setSearchQuery,
  } = useNotes({
    sessionId,
    folderId,
    pollInterval: 30000,
    autoFetch: true,
  });

  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [, setEditingNote] = useState<Note | null>(null);

  // Filtered notes (excluding pinned from main list)
  const mainNotes = useMemo(() => {
    return notes.filter((n) => !n.pinned);
  }, [notes]);

  const handleEdit = useCallback((note: Note) => {
    setEditingNote(note);
    // TODO: Implement edit modal
  }, [setEditingNote]);

  // Collapsed view
  if (collapsed) {
    return (
      <div
        className={cn(
          "flex flex-col h-full border-l border-border bg-background/95 backdrop-blur-sm",
          className
        )}
        style={{ width: 40 }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className="w-full h-10 rounded-none flex items-center justify-center"
              onClick={() => onCollapsedChange?.(false)}
            >
              <div className="relative">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                {counts.total > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center">
                    {counts.total > 99 ? "99" : counts.total}
                  </span>
                )}
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="text-xs">
              <div className="font-medium">Notes</div>
              {counts.total > 0 && (
                <div className="text-muted-foreground">{counts.total} total</div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full border-l border-border bg-background/95 backdrop-blur-sm",
        className
      )}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Notes</span>
          {counts.total > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {counts.total}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          {onCollapsedChange && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => onCollapsedChange(true)}
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Search and Filter */}
      <div className="px-3 py-2 space-y-2 border-b border-border">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                <Filter className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {NOTE_TYPES.map((t) => {
                const config = typeConfig[t];
                const Icon = config.icon;
                return (
                  <DropdownMenuCheckboxItem
                    key={t}
                    checked={filterTypes.includes(t)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFilterTypes((prev) => [...prev, t]);
                      } else {
                        setFilterTypes((prev) => prev.filter((x) => x !== t));
                      }
                    }}
                  >
                    <Icon className={cn("h-3 w-3 mr-2", config.color)} />
                    {config.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Quick Capture */}
      <div className="px-3 py-2 border-b border-border">
        <QuickCapture
          sessionId={sessionId}
          folderId={folderId}
          onSubmit={createNote}
          disabled={loading}
        />
      </div>

      {/* Notes List */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-2 space-y-3">
          {/* Error */}
          {error && (
            <div className="p-2 rounded-md bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}

          {/* Pinned Section */}
          {pinned.length > 0 && (
            <Collapsible open={pinnedExpanded} onOpenChange={setPinnedExpanded}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                {pinnedExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <Pin className="h-3 w-3 text-amber-400" />
                <span>Pinned ({pinned.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {pinned.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onEdit={handleEdit}
                    onTogglePin={togglePin}
                    onToggleArchive={toggleArchive}
                    onDelete={deleteNote}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Main Notes */}
          {mainNotes.length > 0 && (
            <div className="space-y-2">
              {pinned.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Recent ({mainNotes.length})
                </div>
              )}
              {mainNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onEdit={handleEdit}
                  onTogglePin={togglePin}
                  onToggleArchive={toggleArchive}
                  onDelete={deleteNote}
                />
              ))}
            </div>
          )}

          {/* Empty State */}
          {!loading && notes.length === 0 && (
            <div className="text-center py-8">
              <StickyNote className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">
                No notes yet. Capture observations, decisions, and gotchas as you work.
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && notes.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer with counts */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex flex-wrap gap-1.5">
          {NOTE_TYPES.map((t) => {
            const count = counts[t];
            if (count === 0) return null;
            const config = typeConfig[t];
            const Icon = config.icon;
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className={cn("h-5 px-1.5 text-[10px] gap-1", config.bgColor)}
                  >
                    <Icon className={cn("h-2.5 w-2.5", config.color)} />
                    {count}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{config.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
