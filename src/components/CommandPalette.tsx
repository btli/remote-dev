"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Terminal,
  Plus,
  FolderPlus,
  Settings,
  RefreshCw,
  X,
  Columns,
  Rows,
  Maximize2,
  FileBox,
  Keyboard,
  Video,
  Circle,
  Square,
  Brain,
  Bot,
  Clock,
  Database,
  Eye,
  Trash2,
  Lightbulb,
  AlertTriangle,
  CheckSquare,
  HelpCircle,
  Bell,
} from "lucide-react";
import { useSessionMemory, type MemoryQueryResult, type MemoryTier } from "@/hooks/useSessionMemory";

interface CommandAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  group: string;
  onSelect: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Content Type Icons
// ─────────────────────────────────────────────────────────────────────────────

const CONTENT_TYPE_ICONS: Record<string, React.ElementType> = {
  "note:todo": CheckSquare,
  "note:reminder": Bell,
  "note:question": HelpCircle,
  "note:observation": Eye,
  "note:warning": AlertTriangle,
  "note:decision": CheckSquare,
  "insight:convention": Lightbulb,
  "insight:pattern": Lightbulb,
  "insight:gotcha": AlertTriangle,
  "insight:skill": Lightbulb,
  "insight:tool": Lightbulb,
  context: Brain,
  task_context: Brain,
  error: AlertTriangle,
  discovery: Eye,
  reference: Database,
  project: Database,
};

const TIER_ICONS: Record<MemoryTier, React.ElementType> = {
  short_term: Clock,
  working: Brain,
  long_term: Database,
};

const TIER_COLORS: Record<MemoryTier, string> = {
  short_term: "text-yellow-500",
  working: "text-blue-500",
  long_term: "text-green-500",
};

interface CommandPaletteProps {
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onNewAgentSession?: () => void;
  onNewFolder: () => void;
  onOpenSettings: () => void;
  onCloseActiveSession?: () => void;
  onRefreshSessions?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onExitSplitMode?: () => void;
  onSaveAsTemplate?: () => void;
  onShowKeyboardShortcuts?: () => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onViewRecordings?: () => void;
  onReinitOrchestrator?: () => void;
  onOpenMemoryBrowser?: () => void;
  onViewMemory?: (memory: MemoryQueryResult) => void;
  activeSessionId?: string | null;
  activeFolderId?: string | null;
  isSplitMode?: boolean;
  isRecording?: boolean;
}

export function CommandPalette({
  onNewSession,
  onQuickNewSession,
  onNewAgentSession,
  onNewFolder,
  onOpenSettings,
  onCloseActiveSession,
  onRefreshSessions,
  onSplitHorizontal,
  onSplitVertical,
  onExitSplitMode,
  onSaveAsTemplate,
  onShowKeyboardShortcuts,
  onStartRecording,
  onStopRecording,
  onViewRecordings,
  onReinitOrchestrator,
  onOpenMemoryBrowser,
  onViewMemory,
  activeSessionId,
  activeFolderId,
  isSplitMode,
  isRecording,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Memory search integration
  const {
    allMemories,
    loading: memoriesLoading,
    pinToWorking,
    promoteToLongTerm,
    deleteMemory,
  } = useSessionMemory({
    sessionId: activeSessionId ?? null,
    folderId: activeFolderId ?? null,
    query: searchQuery.length >= 2 ? searchQuery : undefined,
    autoFetch: open,
    pollInterval: 0, // Don't poll, just search on demand
    limit: 10,
  });

  // Filter memories based on search query (minimum 2 chars)
  const filteredMemories = useMemo(() => {
    if (searchQuery.length < 2) return [];
    return allMemories.slice(0, 5); // Show max 5 memories in palette
  }, [allMemories, searchQuery]);

  // Listen for keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+P or Cmd+K
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || (e.shiftKey && e.key === "p"))) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle open state change and reset search when closing
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchQuery("");
    }
  }, []);

  const runAction = useCallback((action: () => void) => {
    handleOpenChange(false);
    action();
  }, [handleOpenChange]);

  // Memory quick actions
  const handleViewMemory = useCallback((memory: MemoryQueryResult) => {
    handleOpenChange(false);
    onViewMemory?.(memory);
  }, [handleOpenChange, onViewMemory]);

  const handlePinMemory = useCallback(async (memory: MemoryQueryResult) => {
    await pinToWorking(memory.id);
    handleOpenChange(false);
  }, [handleOpenChange, pinToWorking]);

  const handlePromoteMemory = useCallback(async (memory: MemoryQueryResult) => {
    const name = memory.name || memory.description?.slice(0, 50) || "Memory";
    await promoteToLongTerm(memory.id, name);
    handleOpenChange(false);
  }, [handleOpenChange, promoteToLongTerm]);

  const handleDeleteMemory = useCallback(async (memory: MemoryQueryResult) => {
    await deleteMemory(memory.id);
    handleOpenChange(false);
  }, [handleOpenChange, deleteMemory]);

  const actions: CommandAction[] = [
    // Sessions
    {
      id: "new-session-quick",
      label: "New Terminal",
      icon: <Terminal className="w-4 h-4" />,
      shortcut: "⌘↵",
      group: "Sessions",
      onSelect: () => runAction(onQuickNewSession),
    },
    ...(onNewAgentSession
      ? [
          {
            id: "new-agent-session",
            label: "New Agent",
            icon: <Bot className="w-4 h-4" />,
            group: "Sessions",
            onSelect: () => runAction(onNewAgentSession),
          },
        ]
      : []),
    {
      id: "new-session-advanced",
      label: "New Session (Advanced)",
      icon: <Plus className="w-4 h-4" />,
      group: "Sessions",
      onSelect: () => runAction(onNewSession),
    },
    {
      id: "new-folder",
      label: "New Folder",
      icon: <FolderPlus className="w-4 h-4" />,
      group: "Sessions",
      onSelect: () => runAction(onNewFolder),
    },
    // Save as template
    ...(activeSessionId && onSaveAsTemplate
      ? [
          {
            id: "save-as-template",
            label: "Save Session as Template",
            icon: <FileBox className="w-4 h-4" />,
            group: "Templates",
            onSelect: () => runAction(onSaveAsTemplate),
          },
        ]
      : []),
    // Active session actions
    ...(activeSessionId && onCloseActiveSession
      ? [
          {
            id: "close-session",
            label: "Close Active Session",
            icon: <X className="w-4 h-4" />,
            shortcut: "⌘⇧W",
            group: "Active Session",
            onSelect: () => runAction(onCloseActiveSession),
          },
        ]
      : []),
    // Split pane actions
    ...(activeSessionId && onSplitHorizontal
      ? [
          {
            id: "split-horizontal",
            label: "Split Pane Horizontally",
            icon: <Columns className="w-4 h-4" />,
            shortcut: "⌘D",
            group: "Layout",
            onSelect: () => runAction(onSplitHorizontal),
          },
        ]
      : []),
    ...(activeSessionId && onSplitVertical
      ? [
          {
            id: "split-vertical",
            label: "Split Pane Vertically",
            icon: <Rows className="w-4 h-4" />,
            shortcut: "⌘⇧D",
            group: "Layout",
            onSelect: () => runAction(onSplitVertical),
          },
        ]
      : []),
    ...(isSplitMode && onExitSplitMode
      ? [
          {
            id: "exit-split-mode",
            label: "Exit Split Mode",
            icon: <Maximize2 className="w-4 h-4" />,
            group: "Layout",
            onSelect: () => runAction(onExitSplitMode),
          },
        ]
      : []),
    // Recording actions
    ...(activeSessionId && onStartRecording && !isRecording
      ? [
          {
            id: "start-recording",
            label: "Start Recording",
            icon: <Circle className="w-4 h-4 text-red-500" />,
            group: "Recording",
            onSelect: () => runAction(onStartRecording),
          },
        ]
      : []),
    ...(isRecording && onStopRecording
      ? [
          {
            id: "stop-recording",
            label: "Stop Recording",
            icon: <Square className="w-4 h-4 text-red-500" />,
            group: "Recording",
            onSelect: () => runAction(onStopRecording),
          },
        ]
      : []),
    ...(onViewRecordings
      ? [
          {
            id: "view-recordings",
            label: "View Recordings",
            icon: <Video className="w-4 h-4" />,
            group: "Recording",
            onSelect: () => runAction(onViewRecordings),
          },
        ]
      : []),
    // Settings
    {
      id: "settings",
      label: "Open Settings",
      icon: <Settings className="w-4 h-4" />,
      group: "Settings",
      onSelect: () => runAction(onOpenSettings),
    },
    // Orchestrator actions
    ...(activeFolderId && onReinitOrchestrator
      ? [
          {
            id: "reinit-orchestrator",
            label: "Reinitialize Orchestrator",
            icon: <Brain className="w-4 h-4" />,
            group: "Orchestrator",
            onSelect: () => runAction(onReinitOrchestrator),
          },
        ]
      : []),
    // Keyboard shortcuts
    ...(onShowKeyboardShortcuts
      ? [
          {
            id: "keyboard-shortcuts",
            label: "Keyboard Shortcuts",
            icon: <Keyboard className="w-4 h-4" />,
            shortcut: "⌘?",
            group: "Help",
            onSelect: () => runAction(onShowKeyboardShortcuts),
          },
        ]
      : []),
    // Memory
    ...(onOpenMemoryBrowser
      ? [
          {
            id: "open-memory-browser",
            label: "Browse Memory",
            icon: <Brain className="w-4 h-4" />,
            group: "Memory",
            onSelect: () => runAction(onOpenMemoryBrowser),
          },
        ]
      : []),
    // Refresh
    ...(onRefreshSessions
      ? [
          {
            id: "refresh",
            label: "Refresh Sessions",
            icon: <RefreshCw className="w-4 h-4" />,
            group: "Sessions",
            onSelect: () => runAction(onRefreshSessions),
          },
        ]
      : []),
  ];

  // Group actions
  const groups = actions.reduce(
    (acc, action) => {
      if (!acc[action.group]) {
        acc[action.group] = [];
      }
      acc[action.group].push(action);
      return acc;
    },
    {} as Record<string, CommandAction[]>
  );

  // Helper to get memory icon
  const getMemoryIcon = (memory: MemoryQueryResult) => {
    const ContentIcon = CONTENT_TYPE_ICONS[memory.contentType] || Brain;
    const TierIcon = TIER_ICONS[memory.tier];
    const tierColor = TIER_COLORS[memory.tier];
    return (
      <div className="flex items-center gap-1">
        <TierIcon className={`w-3 h-3 ${tierColor}`} />
        <ContentIcon className="w-4 h-4" />
      </div>
    );
  };

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} showCloseButton={false}>
      <CommandInput
        placeholder="Type a command or search memories..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>
          {memoriesLoading ? "Searching..." : "No results found."}
        </CommandEmpty>

        {/* Memory search results - show when searching */}
        {filteredMemories.length > 0 && (
          <>
            <CommandGroup heading="Memories">
              {filteredMemories.map((memory) => (
                <CommandItem
                  key={memory.id}
                  value={`memory-${memory.id}-${memory.name || memory.content.slice(0, 20)}`}
                  onSelect={() => handleViewMemory(memory)}
                  className="flex-col items-start"
                >
                  <div className="flex items-center gap-2 w-full">
                    {getMemoryIcon(memory)}
                    <span className="flex-1 truncate">
                      {memory.name || memory.description || memory.content.slice(0, 50)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {memory.tier.replace("_", "-")}
                    </span>
                  </div>
                  {memory.description && memory.name && (
                    <span className="text-xs text-muted-foreground ml-6 truncate w-full">
                      {memory.description.slice(0, 60)}
                    </span>
                  )}
                </CommandItem>
              ))}
              {/* Quick actions for memory */}
              {filteredMemories.length > 0 && onOpenMemoryBrowser && (
                <CommandItem
                  value="view-all-memories"
                  onSelect={() => runAction(onOpenMemoryBrowser)}
                  className="justify-center text-muted-foreground"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View all memories...
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Regular command groups */}
        {Object.entries(groups).map(([group, groupActions]) => (
          <CommandGroup key={group} heading={group}>
            {groupActions.map((action) => (
              <CommandItem key={action.id} onSelect={action.onSelect}>
                {action.icon}
                <span>{action.label}</span>
                {action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
