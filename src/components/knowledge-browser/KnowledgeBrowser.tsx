"use client";

/**
 * KnowledgeBrowser - Unified browser for notes, insights, and project knowledge.
 *
 * Features:
 * - Tabbed interface for Notes, Insights, and Project Knowledge
 * - Search and filter across all knowledge types
 * - Edit and delete capabilities
 * - Session/folder context awareness
 */

import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Filter,
  RefreshCw,
  StickyNote,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle2,
  Eye,
  AlertTriangle,
  CircleHelp,
  ListTodo,
  Link2,
  Code2,
  Loader2,
  Pin,
  Archive,
  Shield,
  Power,
  Zap,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useNotes, type Note, type NoteType, NOTE_TYPES } from "@/hooks/useNotes";
import {
  useSdkInsights,
  type SdkInsight,
  type SdkInsightType,
  SDK_INSIGHT_TYPES,
} from "@/hooks/useSdkInsights";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface KnowledgeBrowserProps {
  sessionId?: string | null;
  folderId?: string | null;
  className?: string;
  /** Initial active tab */
  defaultTab?: "notes" | "insights";
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Config
// ─────────────────────────────────────────────────────────────────────────────

const noteTypeConfig: Record<
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

const insightTypeConfig: Record<
  SdkInsightType,
  { icon: React.ElementType; color: string; bgColor: string; label: string }
> = {
  convention: {
    icon: Code2,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    label: "Convention",
  },
  pattern: {
    icon: Lightbulb,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    label: "Pattern",
  },
  anti_pattern: {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    label: "Anti-Pattern",
  },
  skill: {
    icon: Zap,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    label: "Skill",
  },
  gotcha: {
    icon: AlertTriangle,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    label: "Gotcha",
  },
  best_practice: {
    icon: CheckCircle2,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    label: "Best Practice",
  },
  dependency: {
    icon: Link2,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    label: "Dependency",
  },
  performance: {
    icon: TrendingUp,
    color: "text-pink-400",
    bgColor: "bg-pink-500/10",
    label: "Performance",
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
  const config = noteTypeConfig[note.type];
  const TypeIcon = config.icon;

  const preview = useMemo(() => {
    const lines = note.content.split("\n");
    const firstLine = lines[0] ?? "";
    if (firstLine.length > 120) {
      return firstLine.slice(0, 117) + "...";
    }
    if (lines.length > 1) {
      return firstLine + "...";
    }
    return firstLine;
  }, [note.content]);

  const formattedDate = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    return formatter.format(note.createdAt);
  }, [note.createdAt]);

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/50 p-3 transition-colors",
        "hover:border-border hover:bg-muted/30",
        note.pinned && "border-amber-500/30 bg-amber-500/5"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-1.5 rounded-md flex-shrink-0", config.bgColor)}>
          <TypeIcon className={cn("h-4 w-4", config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {note.title && (
              <span className="text-sm font-medium text-foreground truncate">
                {note.title}
              </span>
            )}
            {!note.title && (
              <span className="text-sm text-muted-foreground">{config.label}</span>
            )}
            {note.pinned && (
              <Pin className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {preview}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{formattedDate}</span>
              {note.tags.length > 0 && (
                <div className="flex gap-1">
                  {note.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline" className="h-4 px-1 text-[9px]">
                      {tag}
                    </Badge>
                  ))}
                  {note.tags.length > 2 && (
                    <span className="text-[9px] text-muted-foreground">
                      +{note.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onEdit(note)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTogglePin(note.id)}>
                  <Pin className="h-3.5 w-3.5 mr-2" />
                  {note.pinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onToggleArchive(note.id)}>
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  {note.archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(note.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface InsightCardProps {
  insight: SdkInsight;
  onEdit: (insight: SdkInsight) => void;
  onToggleVerified: (insightId: string) => void;
  onToggleActive: (insightId: string) => void;
  onDelete: (insightId: string) => void;
}

function InsightCard({ insight, onEdit, onToggleVerified, onToggleActive, onDelete }: InsightCardProps) {
  const config = insightTypeConfig[insight.type];
  const TypeIcon = config.icon;

  const formattedDate = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    return formatter.format(insight.createdAt);
  }, [insight.createdAt]);

  const confidenceColor = insight.confidence >= 0.8 ? "text-green-400" :
                          insight.confidence >= 0.5 ? "text-amber-400" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/50 p-3 transition-colors",
        "hover:border-border hover:bg-muted/30",
        insight.verified && "border-green-500/30 bg-green-500/5",
        !insight.active && "opacity-50"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-1.5 rounded-md flex-shrink-0", config.bgColor)}>
          <TypeIcon className={cn("h-4 w-4", config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground truncate">
              {insight.title}
            </span>
            {insight.verified && (
              <Shield className="h-3 w-3 text-green-400 flex-shrink-0" />
            )}
            {!insight.active && (
              <Power className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {insight.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{formattedDate}</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {insight.applicability}
              </Badge>
              <span className={cn("text-[10px]", confidenceColor)}>
                {Math.round(insight.confidence * 100)}%
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onEdit(insight)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleVerified(insight.id)}>
                  <Shield className="h-3.5 w-3.5 mr-2" />
                  {insight.verified ? "Unverify" : "Verify"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onToggleActive(insight.id)}>
                  <Power className="h-3.5 w-3.5 mr-2" />
                  {insight.active ? "Deactivate" : "Activate"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(insight.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Confirmation Dialog
// ─────────────────────────────────────────────────────────────────────────────

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
}

function DeleteDialog({ open, onOpenChange, title, description, onConfirm, loading }: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function KnowledgeBrowser({
  sessionId,
  folderId,
  className,
  defaultTab = "notes",
}: KnowledgeBrowserProps) {
  const [activeTab, setActiveTab] = useState<"notes" | "insights">(defaultTab);
  const [noteSearch, setNoteSearch] = useState("");
  const [insightSearch, setInsightSearch] = useState("");
  const [noteTypeFilter, setNoteTypeFilter] = useState<NoteType[]>(NOTE_TYPES);
  const [insightTypeFilter, setInsightTypeFilter] = useState<SdkInsightType[]>(SDK_INSIGHT_TYPES);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "note" | "insight"; id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit note state
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [editNoteType, setEditNoteType] = useState<NoteType>("observation");
  const [savingNote, setSavingNote] = useState(false);

  // Edit insight state
  const [editingInsight, setEditingInsight] = useState<SdkInsight | null>(null);
  const [editInsightTitle, setEditInsightTitle] = useState("");
  const [editInsightDescription, setEditInsightDescription] = useState("");
  const [savingInsight, setSavingInsight] = useState(false);

  // Notes data
  const {
    notes,
    loading: notesLoading,
    error: notesError,
    refresh: refreshNotes,
    updateNote,
    togglePin,
    toggleArchive,
    deleteNote,
    counts: noteCounts,
  } = useNotes({
    sessionId,
    folderId,
    searchQuery: noteSearch,
    types: noteTypeFilter.length < NOTE_TYPES.length ? noteTypeFilter : undefined,
    pollInterval: 30000,
    autoFetch: true,
  });

  // Insights data
  const {
    insights,
    loading: insightsLoading,
    error: insightsError,
    refresh: refreshInsights,
    updateInsight,
    toggleVerified,
    toggleActive,
    deleteInsight,
    counts: insightCounts,
  } = useSdkInsights({
    folderId,
    searchQuery: insightSearch,
    types: insightTypeFilter.length < SDK_INSIGHT_TYPES.length ? insightTypeFilter : undefined,
    pollInterval: 60000,
    autoFetch: true,
  });

  const handleEditNote = useCallback((note: Note) => {
    setEditingNote(note);
    setEditNoteContent(note.content);
    setEditNoteTitle(note.title || "");
    setEditNoteType(note.type);
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!editingNote) return;
    setSavingNote(true);
    try {
      await updateNote(editingNote.id, {
        content: editNoteContent,
        title: editNoteTitle || undefined,
        type: editNoteType,
      });
      setEditingNote(null);
    } finally {
      setSavingNote(false);
    }
  }, [editingNote, editNoteContent, editNoteTitle, editNoteType, updateNote]);

  const handleCloseNoteEdit = useCallback(() => {
    setEditingNote(null);
    setEditNoteContent("");
    setEditNoteTitle("");
    setEditNoteType("observation");
  }, []);

  const handleEditInsight = useCallback((insight: SdkInsight) => {
    setEditingInsight(insight);
    setEditInsightTitle(insight.title);
    setEditInsightDescription(insight.description);
  }, []);

  const handleSaveInsight = useCallback(async () => {
    if (!editingInsight) return;
    setSavingInsight(true);
    try {
      await updateInsight(editingInsight.id, {
        title: editInsightTitle,
        description: editInsightDescription,
      });
      setEditingInsight(null);
    } finally {
      setSavingInsight(false);
    }
  }, [editingInsight, editInsightTitle, editInsightDescription, updateInsight]);

  const handleCloseInsightEdit = useCallback(() => {
    setEditingInsight(null);
    setEditInsightTitle("");
    setEditInsightDescription("");
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      if (deleteTarget.type === "note") {
        await deleteNote(deleteTarget.id);
      } else {
        await deleteInsight(deleteTarget.id);
      }
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleteNote, deleteInsight]);

  const filteredNotes = useMemo(() => {
    return notes.filter((n) =>
      noteTypeFilter.length === NOTE_TYPES.length || noteTypeFilter.includes(n.type)
    );
  }, [notes, noteTypeFilter]);

  const filteredInsights = useMemo(() => {
    return insights.filter((i) =>
      insightTypeFilter.length === SDK_INSIGHT_TYPES.length || insightTypeFilter.includes(i.type)
    );
  }, [insights, insightTypeFilter]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "notes" | "insights")} className="flex flex-col h-full">
        {/* Tab List */}
        <div className="flex-shrink-0 px-4 pt-4 pb-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="notes" className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" />
              Notes
              {noteCounts.total > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {noteCounts.total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="insights" className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Insights
              {insightCounts.total > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {insightCounts.total}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 m-0">
          {/* Search and Filter */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-border">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search notes..."
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                    <Filter className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {NOTE_TYPES.map((t) => {
                    const config = noteTypeConfig[t];
                    const Icon = config.icon;
                    return (
                      <DropdownMenuCheckboxItem
                        key={t}
                        checked={noteTypeFilter.includes(t)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setNoteTypeFilter((prev) => [...prev, t]);
                          } else {
                            setNoteTypeFilter((prev) => prev.filter((x) => x !== t));
                          }
                        }}
                      >
                        <Icon className={cn("h-3.5 w-3.5 mr-2", config.color)} />
                        {config.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={refreshNotes}
                    disabled={notesLoading}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", notesLoading && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Notes List */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {notesError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {notesError}
                </div>
              )}

              {notesLoading && filteredNotes.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {!notesLoading && filteredNotes.length === 0 && (
                <div className="text-center py-12">
                  <StickyNote className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No notes found. Capture observations, decisions, and insights as you work.
                  </p>
                </div>
              )}

              {filteredNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onEdit={handleEditNote}
                  onTogglePin={togglePin}
                  onToggleArchive={toggleArchive}
                  onDelete={(id) => setDeleteTarget({ type: "note", id, title: note.title || "this note" })}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="flex-1 flex flex-col min-h-0 m-0">
          {/* Search and Filter */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-border">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search insights..."
                  value={insightSearch}
                  onChange={(e) => setInsightSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                    <Filter className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {SDK_INSIGHT_TYPES.map((t) => {
                    const config = insightTypeConfig[t];
                    const Icon = config.icon;
                    return (
                      <DropdownMenuCheckboxItem
                        key={t}
                        checked={insightTypeFilter.includes(t)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setInsightTypeFilter((prev) => [...prev, t]);
                          } else {
                            setInsightTypeFilter((prev) => prev.filter((x) => x !== t));
                          }
                        }}
                      >
                        <Icon className={cn("h-3.5 w-3.5 mr-2", config.color)} />
                        {config.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={refreshInsights}
                    disabled={insightsLoading}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", insightsLoading && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Insights List */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {insightsError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {insightsError}
                </div>
              )}

              {insightsLoading && filteredInsights.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {!insightsLoading && filteredInsights.length === 0 && (
                <div className="text-center py-12">
                  <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No insights found. Insights are extracted from notes and session analysis.
                  </p>
                </div>
              )}

              {filteredInsights.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onEdit={handleEditInsight}
                  onToggleVerified={toggleVerified}
                  onToggleActive={toggleActive}
                  onDelete={(id) => setDeleteTarget({ type: "insight", id, title: insight.title })}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.type === "note" ? "Note" : "Insight"}?`}
        description={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        loading={deleting}
      />

      {/* Edit Note Modal */}
      <Dialog open={!!editingNote} onOpenChange={(open) => !open && handleCloseNoteEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={editNoteType} onValueChange={(v) => setEditNoteType(v as NoteType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_TYPES.map((t) => {
                    const config = noteTypeConfig[t];
                    const Icon = config.icon;
                    return (
                      <SelectItem key={t} value={t}>
                        <div className="flex items-center gap-2">
                          <Icon className={cn("h-3.5 w-3.5", config.color)} />
                          <span>{config.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Title (optional)</label>
              <Input
                placeholder="Note title..."
                value={editNoteTitle}
                onChange={(e) => setEditNoteTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Content</label>
              <Textarea
                placeholder="Note content..."
                value={editNoteContent}
                onChange={(e) => setEditNoteContent(e.target.value)}
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseNoteEdit} disabled={savingNote}>
              Cancel
            </Button>
            <Button onClick={handleSaveNote} disabled={savingNote || !editNoteContent.trim()}>
              {savingNote ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Insight Modal */}
      <Dialog open={!!editingInsight} onOpenChange={(open) => !open && handleCloseInsightEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Insight</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                placeholder="Insight title..."
                value={editInsightTitle}
                onChange={(e) => setEditInsightTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Insight description..."
                value={editInsightDescription}
                onChange={(e) => setEditInsightDescription(e.target.value)}
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseInsightEdit} disabled={savingInsight}>
              Cancel
            </Button>
            <Button onClick={handleSaveInsight} disabled={savingInsight || !editInsightTitle.trim()}>
              {savingInsight ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
