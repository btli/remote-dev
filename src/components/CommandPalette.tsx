"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Terminal,
  Plus,
  FolderPlus,
  Settings,
  RefreshCw,
  X,
  Pause,
  Play,
  Columns,
  Rows,
  Maximize2,
  FileBox,
} from "lucide-react";

interface CommandAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  group: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  onNewSession: () => void;
  onQuickNewSession: () => void;
  onNewFolder: () => void;
  onOpenSettings: () => void;
  onCloseActiveSession?: () => void;
  onSuspendActiveSession?: () => void;
  onResumeActiveSession?: () => void;
  onRefreshSessions?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onExitSplitMode?: () => void;
  onSaveAsTemplate?: () => void;
  activeSessionId?: string | null;
  activeSessionStatus?: string;
  isSplitMode?: boolean;
}

export function CommandPalette({
  onNewSession,
  onQuickNewSession,
  onNewFolder,
  onOpenSettings,
  onCloseActiveSession,
  onSuspendActiveSession,
  onResumeActiveSession,
  onRefreshSessions,
  onSplitHorizontal,
  onSplitVertical,
  onExitSplitMode,
  onSaveAsTemplate,
  activeSessionId,
  activeSessionStatus,
  isSplitMode,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

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

  const runAction = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

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
    ...(activeSessionId && activeSessionStatus === "active" && onSuspendActiveSession
      ? [
          {
            id: "suspend-session",
            label: "Suspend Active Session",
            icon: <Pause className="w-4 h-4" />,
            group: "Active Session",
            onSelect: () => runAction(onSuspendActiveSession),
          },
        ]
      : []),
    ...(activeSessionId && activeSessionStatus === "suspended" && onResumeActiveSession
      ? [
          {
            id: "resume-session",
            label: "Resume Active Session",
            icon: <Play className="w-4 h-4" />,
            group: "Active Session",
            onSelect: () => runAction(onResumeActiveSession),
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
    // Settings
    {
      id: "settings",
      label: "Open Settings",
      icon: <Settings className="w-4 h-4" />,
      group: "Settings",
      onSelect: () => runAction(onOpenSettings),
    },
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

  return (
    <CommandDialog open={open} onOpenChange={setOpen} showCloseButton={false}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
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
