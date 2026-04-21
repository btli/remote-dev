"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore, Activity, useEffectEvent } from "react";
import { Sidebar } from "./Sidebar";
import { NewSessionWizard } from "./NewSessionWizard";
import { SaveTemplateModal } from "./SaveTemplateModal";
import { GroupPreferencesModal } from "@/components/preferences/GroupPreferencesModal";
import { ProjectPreferencesModal } from "@/components/preferences/ProjectPreferencesModal";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsPanel } from "@/components/KeyboardShortcutsPanel";
import { RecordingsModal } from "@/components/session/RecordingsModal";
import { SaveRecordingModal } from "@/components/session/SaveRecordingModal";
import { TrashModal } from "@/components/trash/TrashModal";
import { ResumeSessionModal } from "./ResumeSessionModal";
import { SettingsView, type SettingsSection } from "@/components/settings/SettingsView";
import { PortManagerModal } from "@/components/ports/PortManagerModal";
import { BeadsSidebar } from "@/components/beads/BeadsSidebar";
import { IssuesModal } from "@/components/github/IssuesModal";
import { PRsModal } from "@/components/github/PRsModal";
import type { GitHubIssueDTO } from "@/contexts/GitHubIssuesContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { useRecordingContext } from "@/contexts/RecordingContext";
import { useRecording } from "@/hooks/useRecording";
import { useMobile } from "@/hooks/useMobile";
import { usePWA } from "@/hooks/usePWA";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useTrashContext } from "@/contexts/TrashContext";
import { useGitHubStats } from "@/contexts/GitHubStatsContext";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { useBeadsContext } from "@/contexts/BeadsContext";
import {
  getEnvironmentWithSecretsSync,
  prefetchSecretsForFolder,
} from "@/hooks/useEnvironmentWithSecrets";
import type { FolderRepoStats } from "./Sidebar";
import type { PinnedFile } from "@/types/pinned-files";
import { WORKTREE_TYPES, type WorktreeType, type TerminalSession } from "@/types/session";
import { sanitizeBranchName } from "@/lib/git-utils";
import { Terminal as TerminalIcon, Plus, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import type { TerminalWithKeyboardRef } from "@/components/terminal/TerminalWithKeyboard";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";
import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import { useNotificationContext, hydrateNotification } from "@/contexts/NotificationContext";
import { dismissToastsForSession } from "@/lib/notification-toast";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { FolderTabBar } from "@/components/peers/FolderTabBar";
import type { ActiveView, PeerChatMessage } from "@/types/peer-chat";
import { ChannelSidebar } from "@/components/channels/ChannelSidebar";
import { ChannelView } from "@/components/channels/ChannelView";
import { CreateChannelModal } from "@/components/channels/CreateChannelModal";
import { useChannelContext } from "@/contexts/ChannelContext";

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

// Dynamically import TerminalTypeRenderer for browser session types
const TerminalTypeRenderer = dynamic(
  () =>
    import("@/components/terminal/TerminalTypeRenderer").then(
      (mod) => mod.TerminalTypeRenderer
    ),
  { ssr: false }
);

// Dynamically import CodeMirrorEditor for file-type sessions
const CodeMirrorEditor = dynamic(
  () =>
    import("@/components/terminal/CodeMirrorEditor").then(
      (mod) => mod.CodeMirrorEditor
    ),
  { ssr: false }
);

// Dynamically import LoopChatPane for loop-type sessions
const LoopChatPane = dynamic(
  () =>
    import("@/components/loop/LoopChatPane").then(
      (mod) => mod.LoopChatPane
    ),
  { ssr: false }
);

// Stable subscription functions for useSyncExternalStore (must be outside component)
// These listen for both cross-tab storage events and same-tab custom events
function subscribeToSidebarCollapsed(callback: () => void) {
  const handler = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== "sidebar-collapsed") return;
    callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("sidebar-collapsed-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("sidebar-collapsed-change", handler);
  };
}

function subscribeToSidebarWidth(callback: () => void) {
  const handler = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== "sidebar-width") return;
    callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("sidebar-width-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("sidebar-width-change", handler);
  };
}

function getSidebarCollapsed() {
  return localStorage.getItem("sidebar-collapsed") === "true";
}

function getSidebarWidth() {
  const saved = localStorage.getItem("sidebar-width");
  if (saved) {
    const width = parseInt(saved, 10);
    if (!isNaN(width) && width >= 180 && width <= 400) return width;
  }
  return 220;
}

// SSR snapshots (return defaults for hydration)
function getServerSidebarCollapsed() {
  return false;
}

function getServerSidebarWidth() {
  return 220;
}

interface SessionManagerProps {
  isGitHubConnected?: boolean;
}

export function SessionManager({ isGitHubConnected = false }: SessionManagerProps) {
  const {
    sessions,
    activeSessionId,
    loading,
    createSession,
    closeSession,
    suspendSession,
    resumeSession,
    updateSession,
    setActiveSession,
    reorderSessions,
    refreshSessions,
    debouncedRefreshSessions,
    setAgentActivityStatus,
    agentActivityStatuses,
    setSessionStatusIndicator,
    setSessionProgress,
    patchSessionLocal,
  } = useSessionContext();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardFolderId, setWizardFolderId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("terminal");
  const peerChat = usePeerChatContext();
  const channelCtx = useChannelContext();
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const isMobile = useMobile();
  const isPWA = usePWA();
  // Use useSyncExternalStore for localStorage values to avoid hydration mismatches
  // and prevent cascading renders from setState in effects.
  // Functions are defined outside the component for stable identity.
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsed,
    getServerSidebarCollapsed
  );

  const sidebarWidth = useSyncExternalStore(
    subscribeToSidebarWidth,
    getSidebarWidth,
    getServerSidebarWidth
  );

  // Helper to update localStorage and trigger re-render
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
    window.dispatchEvent(new CustomEvent("sidebar-collapsed-change"));
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    localStorage.setItem("sidebar-width", String(width));
    window.dispatchEvent(new CustomEvent("sidebar-width-change"));
  }, []);


  const [folderSettingsModal, setFolderSettingsModal] = useState<{
    folderId: string;
    folderName: string;
    initialTab?: "general" | "appearance" | "repository" | "environment";
  } | null>(null);
  // Phase 4: Group/Project preferences modal triggered from ProjectTreeSidebar gear.
  const [nodeSettingsModal, setNodeSettingsModal] = useState<{
    id: string;
    type: "group" | "project";
    name: string;
  } | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [isRecordingsModalOpen, setIsRecordingsModalOpen] = useState(false);
  const [isSaveRecordingModalOpen, setIsSaveRecordingModalOpen] = useState(false);
  const [mobileEditingName, setMobileEditingName] = useState<string | null>(null);

  // Recording state
  const { createRecording } = useRecordingContext();
  const {
    isRecording,
    duration: recordingDuration,
    startRecording,
    stopRecording,
    recordOutput,
    updateDimensions,
  } = useRecording({
    sessionId: activeSessionId || undefined,
    onSave: async (data) => {
      await createRecording(data);
    },
  });

  // Terminal refs for focus management
  const terminalRefsMap = useRef<Map<string, TerminalWithKeyboardRef>>(new Map());
  // Stable ref for sessions list — used in callbacks to avoid dep churn
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Compute WebSocket URL based on current location (supports cloudflared tunnels)
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return "ws://localhost:3001";
    const { protocol, hostname, port } = window.location;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalhost) {
      // Local development: use terminal server port directly
      return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
    }
    // Remote access via tunnel: use /ws path (cloudflared routes to terminal server)
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
  }, []);

  // Note: No longer need refs for keyboard handler - useEffectEvent handles this

  // setSidebarCollapsed and setSidebarWidth already persist to localStorage
  // and trigger re-renders via useSyncExternalStore

  // Project tree state (persisted in database). Flatten groups+projects into a
  // unified list for legacy "folder" lookups (name-by-id, tree refresh, etc.).
  const projectTree = useProjectTree();
  const folders = useMemo(
    () => [
      ...projectTree.groups.map((g) => ({ id: g.id, name: g.name })),
      ...projectTree.projects.map((p) => ({ id: p.id, name: p.name })),
    ],
    [projectTree.groups, projectTree.projects]
  );
  const debouncedRefreshFolders = useCallback(() => {
    void projectTree.refresh();
  }, [projectTree]);

  // Move a session to a project via the sessions API. Sessions are always
  // associated with a leaf project (never a group) on the backend.
  const moveSessionToFolder = useCallback(
    async (sessionId: string, folderId: string | null) => {
      const response = await fetch(`/api/sessions/${sessionId}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: folderId }),
      });
      if (!response.ok) {
        throw new Error(`Failed to move session: ${response.status}`);
      }
    },
    []
  );

  // Trash state from context
  const { count: trashCount, trashSession } = useTrashContext();
  const [isTrashOpen, setIsTrashOpen] = useState(false);

  // Resume Claude Session modal state
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [resumeModalFolderId, setResumeModalFolderId] = useState<string | null>(null);
  const [resumeModalProjectPath, setResumeModalProjectPath] = useState("");
  const [resumeModalProfileId, setResumeModalProfileId] = useState<string | undefined>(undefined);

  // Schedule target session — passed to TaskSidebar to open schedule creation
  const [scheduleTargetSessionId, setScheduleTargetSessionId] = useState<string | null>(null);

  // Settings view state
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>(undefined);
  const [settingsOpenCount, setSettingsOpenCount] = useState(0);

  // Port manager modal state
  const [isPortsModalOpen, setIsPortsModalOpen] = useState(false);

  // Worktree name prompt state
  const [worktreePrompt, setWorktreePrompt] = useState<{ folderId: string } | null>(null);
  const [worktreeNameInput, setWorktreeNameInput] = useState("");
  const [worktreeTypeInput, setWorktreeTypeInput] = useState<WorktreeType>("feature");

  // Issues modal state
  const [issuesModal, setIssuesModal] = useState<{
    open: boolean;
    folderId: string;
    repositoryId: string;
    repositoryName: string;
    repositoryUrl?: string;
    initialIssueNumber?: number;
  } | null>(null);

  // PRs modal state
  const [prsModal, setPrsModal] = useState<{
    open: boolean;
    folderId: string;
    repositoryId: string;
    repositoryName: string;
    repositoryUrl?: string;
    initialPRNumber?: number;
  } | null>(null);

  // Preferences state from context
  const {
    userSettings,
    activeProject,
    folderHasRepo,
    currentPreferences,
    setActiveFolder,
    resolvePreferencesForFolder,
    getEnvironmentForFolder,
    getFolderPreferences,
  } = usePreferencesContext();

  // Secrets state from context
  const { fetchSecretsForFolder, configuredFolderIds } = useSecretsContext();

  // GitHub stats for repo badges on folders
  const { getRepositoryById } = useGitHubStats();

  const { debouncedRefresh } = useBeadsContext();
  const { addNotification, registerJumpHandler, notifications, markRead, latestUnreadSessionId } = useNotificationContext();

  // Notification panel state
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);

  // Agent status notifications (hook manages its own permission state)
  const notificationsEnabled = userSettings?.notificationsEnabled ?? true;
  useAgentNotifications({
    enabled: userSettings?.notificationsEnabled,
    agentActivityStatuses,
    sessions,
    setActiveSession,
  });

  // Handle agent activity status updates from WebSocket
  const handleAgentActivityStatus = useCallback(
    (sid: string, status: string) => {
      setAgentActivityStatus(sid, status as AgentActivityStatus);
    },
    [setAgentActivityStatus]
  );

  // Listen for sidebar_changed WebSocket broadcasts (dispatched as CustomEvent
  // from useTerminalWebSocket) and debounce-refresh both sessions and folders.
  useEffect(() => {
    function handleSidebarChanged() {
      debouncedRefreshSessions();
      debouncedRefreshFolders();
    }

    document.addEventListener("rdv:sidebar-changed", handleSidebarChanged);
    return () => {
      document.removeEventListener("rdv:sidebar-changed", handleSidebarChanged);
    };
  }, [debouncedRefreshSessions, debouncedRefreshFolders]);

  const handlePeerMessageCreated = useCallback(
    (folderId: string, message: PeerChatMessage) => {
      // Only add messages for the active folder (ignore cross-folder broadcasts)
      if (folderId === activeProject.folderId) {
        peerChat.addMessage(message);
      }
    },
    [peerChat, activeProject.folderId]
  );

  /** Convert a PeerChatMessage to a ChannelMessage, filling in channelId. */
  const toChannelMessage = useCallback(
    (msg: PeerChatMessage, fallbackChannelId: string): import("@/types/channels").ChannelMessage => ({
      id: msg.id,
      channelId: msg.channelId ?? fallbackChannelId,
      fromSessionId: msg.fromSessionId,
      fromSessionName: msg.fromSessionName,
      toSessionId: msg.toSessionId,
      body: msg.body,
      isUserMessage: msg.isUserMessage,
      parentMessageId: msg.parentMessageId,
      replyCount: msg.replyCount,
      createdAt: msg.createdAt,
    }),
    []
  );

  const handleChannelMessageCreated = useCallback(
    (folderId: string, channelId: string, message: PeerChatMessage) => {
      if (folderId === activeProject.folderId) {
        channelCtx.addMessage(toChannelMessage(message, channelId));
      }
    },
    [activeProject.folderId, channelCtx, toChannelMessage]
  );

  const handleThreadReplyCreated = useCallback(
    (folderId: string, parentMessageId: string, message: PeerChatMessage) => {
      if (folderId === activeProject.folderId && parentMessageId) {
        channelCtx.addThreadReply(parentMessageId, toChannelMessage(message, ""));
      }
    },
    [activeProject.folderId, channelCtx, toChannelMessage]
  );

  const handleChannelCreated = useCallback(
    (folderId: string, channel: import("@/types/channels").Channel) => {
      if (folderId === activeProject.folderId) {
        channelCtx.addChannel(channel);
      }
    },
    [activeProject.folderId, channelCtx]
  );

  // Handle server-pushed session rename (from `rdv session title`)
  const handleSessionRenamed = useCallback(
    (sid: string, name: string, claudeSessionId?: string) => {
      // Local-only update — the DB write already happened server-side.
      // Do NOT call updateSession() here: that sends a PATCH which sets
      // titleLocked=true, permanently preventing future title updates.
      const updates: Partial<TerminalSession> = { name };
      if (claudeSessionId) {
        const existing = sessionsRef.current.find((s) => s.id === sid);
        updates.typeMetadata = { ...existing?.typeMetadata, claudeSessionId };
      }
      patchSessionLocal(sid, updates);
    },
    [patchSessionLocal]
  );

  // Focus terminal when active session changes
  useEffect(() => {
    if (activeSessionId) {
      // Small delay to ensure terminal is mounted and visible
      const timeoutId = setTimeout(() => {
        terminalRefsMap.current.get(activeSessionId)?.focus();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [activeSessionId]);

  const activeSessions = sessions.filter((s) => s.status !== "closed");

  // Pre-fetch secrets for active session folders that have secrets configured
  useEffect(() => {
    const foldersWithSecrets = new Set<string>();

    // Find unique projectIds from active sessions that have secrets configured
    for (const session of activeSessions) {
      if (session.projectId && configuredFolderIds.includes(session.projectId)) {
        foldersWithSecrets.add(session.projectId);
      }
    }

    // Pre-fetch secrets for each folder
    for (const folderId of foldersWithSecrets) {
      prefetchSecretsForFolder(folderId, fetchSecretsForFolder);
    }
  }, [activeSessions, configuredFolderIds, fetchSecretsForFolder]);

  /**
   * Get environment variables for a folder, merged with secrets.
   * Uses cached secrets from the pre-fetch effect.
   */
  const getEnvironmentWithSecrets = useCallback(
    (folderId: string | null): Record<string, string> | null => {
      const folderEnv = getEnvironmentForFolder(folderId);
      return getEnvironmentWithSecretsSync(folderId, folderEnv);
    },
    [getEnvironmentForFolder]
  );
  const autoFollowEnabled = userSettings?.autoFollowActiveSession ?? true;

  // Helper to get folder name by ID
  const getFolderName = useCallback(
    (folderId: string | null | undefined): string | null => {
      if (!folderId) return null;
      const folder = folders.find((f) => f.id === folderId);
      return folder?.name ?? null;
    },
    [folders]
  );

  // Calculate next available session number for a given prefix
  // Looks at existing session names like "Terminal 3" and returns max + 1
  const getNextSessionNumber = useCallback(
    (prefix: string): number => {
      const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)$`);
      let maxNum = 0;
      for (const session of sessions) {
        const match = session.name.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
      return maxNum + 1;
    },
    [sessions]
  );

  // Generate session name based on folder context with smart numbering
  const generateSessionName = useCallback(
    (folderId: string | null | undefined): string => {
      const folderName = getFolderName(folderId);
      const prefix = folderName || "Terminal";
      const nextNum = getNextSessionNumber(prefix);
      return `${prefix} ${nextNum}`;
    },
    [getFolderName, getNextSessionNumber]
  );

  const attachedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSessionId) {
      ids.add(activeSessionId);
    }
    return ids;
  }, [activeSessionId]);

  const logSessionError = useCallback((action: string, error: unknown) => {
    console.error(`Failed to ${action}:`, error);
  }, []);

  const syncSessionStatus = useCallback(
    async (sessionId: string, targetStatus: "active" | "suspended") => {
      try {
        if (targetStatus === "active") {
          await resumeSession(sessionId);
        } else {
          await suspendSession(sessionId);
        }
      } catch (error) {
        logSessionError(`${targetStatus} session`, error);
      }
    },
    [resumeSession, suspendSession, logSessionError]
  );

  useEffect(() => {
    if (sessions.length === 0) return;

    for (const session of sessions) {
      // Skip terminal states (closed/trashed) - they can't be suspended or resumed
      if (session.status === "closed" || session.status === "trashed") continue;
      const shouldBeActive = attachedSessionIds.has(session.id);
      const targetStatus = shouldBeActive ? "active" : "suspended";
      if (session.status === targetStatus) continue;

      void syncSessionStatus(session.id, targetStatus);
    }
  }, [sessions, attachedSessionIds, syncSessionStatus]);

  const maybeAutoFollowFolder = useCallback(
    (folderId: string | null) => {
      if (!autoFollowEnabled || activeProject.isPinned) return;
      if (folderId !== activeProject.folderId) {
        setActiveFolder(folderId);
      }
    },
    [autoFollowEnabled, activeProject.isPinned, activeProject.folderId, setActiveFolder]
  );

  const handleCreateSession = useCallback(
    async (data: {
      name: string;
      projectPath?: string;
      githubRepoId?: string;
      worktreeBranch?: string;
      folderId?: string;
      projectId?: string;
      startupCommand?: string;
      featureDescription?: string;
      createWorktree?: boolean;
      baseBranch?: string;
    }) => {
      // Determine target folder with priority:
      // 1. Explicit folderId from wizard
      // 2. wizardFolderId from context
      // 3. For GitHub repos: folder containing other sessions from same repo
      // 4. Fall back to active folder
      let effectiveFolderId: string | null = data.folderId ?? wizardFolderId ?? null;

      // For GitHub repos without explicit folder, find existing repo folder
      if (!effectiveFolderId && data.githubRepoId) {
        const existingRepoSession = sessions.find(
          (s) => s.githubRepoId === data.githubRepoId
        );
        if (existingRepoSession) {
          effectiveFolderId = existingRepoSession.projectId || null;
        }
      }

      // Fall back to active folder
      if (!effectiveFolderId) {
        effectiveFolderId = activeProject.folderId;
      }

      const sessionData = {
        ...data,
        projectId: effectiveFolderId ?? undefined,
      };
      // Strip any legacy folderId field to avoid excess-property errors.
      delete (sessionData as Record<string, unknown>).folderId;
      const newSession = await createSession(sessionData);
      if (newSession) {
        maybeAutoFollowFolder(sessionData.projectId ?? null);
      }
      // Clear wizard folder after creation
      setWizardFolderId(null);
    },
    [
      createSession,
      wizardFolderId,
      sessions,
      activeProject.folderId,
      maybeAutoFollowFolder,
    ]
  );

  const handleQuickNewSession = useCallback(async () => {
    const folderId = activeProject.folderId || undefined;
    const name = generateSessionName(folderId);
    // Pass empty startupCommand to get a plain shell (no agent/startup command)
    try {
      await createSession({
        name,
        projectPath: currentPreferences.defaultWorkingDirectory || undefined,
        projectId: folderId,
        startupCommand: "", // Explicitly skip startup command for plain terminal
      });
      maybeAutoFollowFolder(folderId ?? null);
    } catch (error) {
      logSessionError("create session", error);
    }
  }, [
    createSession,
    generateSessionName,
    currentPreferences.defaultWorkingDirectory,
    activeProject.folderId,
    logSessionError,
    maybeAutoFollowFolder,
  ]);

  const handleCloseSession = useCallback(
    async (sessionId: string, options?: { deleteWorktree?: boolean }) => {
      void options; // Both options go to trash for recovery
      try {
        // Check if this session has a worktree - if so, trash it instead of closing
        // Both "keep worktree" and "delete worktree" options go to trash for recovery
        const session = sessions.find((s) => s.id === sessionId);
        if (session?.worktreeBranch && session?.projectPath) {
          // Trash worktree session for recovery
          const success = await trashSession(sessionId);
          if (success) {
            // Refresh sessions to remove trashed session from sidebar
            await refreshSessions();
          } else {
            // Fallback to regular close if trash fails
            await closeSession(sessionId);
          }
        } else {
          // Regular close for non-worktree sessions
          await closeSession(sessionId);
        }
      } catch (error) {
        logSessionError("close session", error);
      }
    },
    [sessions, trashSession, closeSession, refreshSessions, logSessionError]
  );

  const handleRenameSession = useCallback(
    async (sessionId: string, newName: string) => {
      try {
        await updateSession(sessionId, { name: newName });
      } catch (error) {
        logSessionError("rename session", error);
      }
    },
    [updateSession, logSessionError]
  );

  const handleTogglePinSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      try {
        await updateSession(sessionId, { pinned: !session.pinned });
      } catch (error) {
        logSessionError("toggle pin session", error);
      }
    },
    [sessions, updateSession, logSessionError]
  );

  // Open schedule modal for a session (via context menu)
  // setScheduleTargetSessionId is a stable state setter, no useCallback needed
  const handleScheduleSession = setScheduleTargetSessionId;

  // Folder handlers now use the context methods directly
  // When moving a session with a githubRepoId, move ALL sessions for that repo together
  // This enforces one folder per repository
  const handleMoveSession = useCallback(
    async (sessionId: string, folderId: string | null) => {
      const session = sessions.find((s) => s.id === sessionId);

      if (session?.githubRepoId) {
        // Find all sessions for this repo and move them together
        const repoSessions = sessions.filter(
          (s) => s.githubRepoId === session.githubRepoId
        );
        // Use allSettled to handle partial failures gracefully
        const results = await Promise.allSettled(
          repoSessions.map(async (s) => {
            await moveSessionToFolder(s.id, folderId);
            // Also update session in SessionContext for immediate UI update
            await updateSession(s.id, { projectId: folderId });
          })
        );
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.error("Some sessions failed to move:", failures);
        }
      } else {
        // No repo association, just move this session
        await moveSessionToFolder(sessionId, folderId);
        // Also update session in SessionContext for immediate UI update
        await updateSession(sessionId, { projectId: folderId });
      }
    },
    [sessions, moveSessionToFolder, updateSession]
  );

  const handleReorderSessions = useCallback(
    async (sessionIds: string[]) => {
      try {
        await reorderSessions(sessionIds);
      } catch (error) {
        logSessionError("reorder sessions", error);
      }
    },
    [reorderSessions, logSessionError]
  );

  const handleCreateFolder = useCallback(
    async (name: string, parentId: string | null = null) => {
      // Legacy "create folder" action creates a top-level group; groups are
      // the containers in the new project-tree model.
      await projectTree.createGroup({ name, parentGroupId: parentId });
    },
    [projectTree]
  );

  const handleFolderSettings = useCallback(
    (folderId: string, folderName: string, initialTab?: "general" | "appearance" | "repository" | "environment") => {
      setFolderSettingsModal({ folderId, folderName, initialTab });
    },
    []
  );

  const handleNodeSettings = useCallback(
    (node: { id: string; type: "group" | "project"; name: string }) => {
      setNodeSettingsModal(node);
    },
    []
  );

  // Get repo stats for a folder (for sidebar badges)
  // Uses resolvePreferencesForFolder to include inherited repo from parent folders
  const getFolderRepoStats = useCallback(
    (folderId: string): FolderRepoStats | null => {
      const prefs = resolvePreferencesForFolder(folderId);
      if (!prefs?.githubRepoId) return null;

      const repo = getRepositoryById(prefs.githubRepoId);
      if (!repo) return null;

      return {
        prCount: repo.stats.openPRCount,
        issueCount: repo.stats.openIssueCount,
        hasChanges: repo.hasChanges ?? false,
      };
    },
    [resolvePreferencesForFolder, getRepositoryById]
  );

  // Resolve linked repository info for a folder
  const getRepoInfoForFolder = useCallback(
    (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      if (!prefs?.githubRepoId) return null;

      const repo = getRepositoryById(prefs.githubRepoId);
      if (!repo) return null;

      return { folderId, repositoryId: repo.id, repositoryName: repo.fullName, repositoryUrl: repo.url };
    },
    [resolvePreferencesForFolder, getRepositoryById]
  );

  // Handle viewing issues for a folder's linked repository
  const handleViewIssues = useCallback(
    (folderId: string) => {
      const info = getRepoInfoForFolder(folderId);
      if (!info) return;

      setIssuesModal({ open: true, ...info });
    },
    [getRepoInfoForFolder]
  );

  // Handle viewing PRs for a folder's linked repository
  const handleViewPRs = useCallback(
    (folderId: string) => {
      const info = getRepoInfoForFolder(folderId);
      if (!info) return;

      setPrsModal({ open: true, ...info });
    },
    [getRepoInfoForFolder]
  );

  // Get pinned files for a folder
  const handleGetFolderPinnedFiles = useCallback(
    (folderId: string): PinnedFile[] => {
      const prefs = getFolderPreferences(folderId);
      return prefs?.pinnedFiles ?? [];
    },
    [getFolderPreferences]
  );

  // Open a pinned file as a file editor session, reusing an existing session if one matches
  const handleOpenPinnedFile = useCallback(
    async (folderId: string, file: PinnedFile) => {
      // Find an existing active file session for this path
      const existing = activeSessions.find(
        (s) => s.terminalType === "file" && s.status === "active" && s.typeMetadata?.filePath === file.path
      );
      if (existing) {
        setActiveSession(existing.id);
        return;
      }
      // Close any stale (suspended) file sessions for this path before creating a new one
      const stale = activeSessions.filter(
        (s) => s.terminalType === "file" && s.status !== "active" && s.typeMetadata?.filePath === file.path
      );
      await Promise.all(stale.map((s) => closeSession(s.id)));
      await createSession({
        name: file.name,
        projectId: folderId,
        terminalType: "file",
        filePath: file.path,
      });
    },
    [activeSessions, setActiveSession, createSession, closeSession]
  );

  // Handle creating a worktree from an issue with agent session
  const handleCreateWorktreeFromIssue = useCallback(
    async (issue: GitHubIssueDTO, repositoryId: string) => {
      if (!issuesModal) return;

      try {
        // Build issue context prompt for the agent (truncate body to prevent shell overflow)
        const bodyContext = issue.body
          ? issue.body.substring(0, 2000)
          : "No description provided.";
        const labelsStr = issue.labels.map((l) => l.name).join(", ");
        const issuePrompt = [
          `Research and resolve GitHub issue #${issue.number}: ${issue.title}`,
          "",
          bodyContext,
          "",
          labelsStr ? `Labels: ${labelsStr}` : "",
        ].filter(Boolean).join("\n");

        // Shell-escape for single-quote wrapping: replace ' with '\''
        const escapedPrompt = issuePrompt.replace(/'/g, "'\\''");

        // Resolve folder's default agent provider (fallback to claude)
        const folderPrefs = resolvePreferencesForFolder(issuesModal.folderId);
        const agentProvider = folderPrefs.defaultAgentProvider || "claude";

        const newSession = await createSession({
          name: `#${issue.number} ${issue.title}`.slice(0, 50),
          projectId: issuesModal.folderId,
          githubRepoId: repositoryId,
          worktreeBranch: issue.suggestedBranchName,
          worktreeType: issue.suggestedWorktreeType,
          createWorktree: true,
          terminalType: "agent",
          agentProvider,
          autoLaunchAgent: true,
          agentFlags: [`'${escapedPrompt}'`],
        });
        if (newSession) {
          setActiveSession(newSession.id);
        }
        setIssuesModal(null);
      } catch (error) {
        console.error("Failed to create worktree from issue:", error);
      }
    },
    [issuesModal, createSession, setActiveSession, resolvePreferencesForFolder]
  );

  const handleFolderNewSession = useCallback(
    async (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      const name = generateSessionName(folderId);
      // Pass empty startupCommand to get a plain shell (no agent/startup command)
      try {
        await createSession({
          name,
          projectPath: prefs.defaultWorkingDirectory || undefined,
          projectId: folderId,
          startupCommand: "", // Explicitly skip startup command for plain terminal
        });
        setActiveFolder(folderId);
      } catch (error) {
        logSessionError("create session", error);
      }
    },
    [
      createSession,
      generateSessionName,
      resolvePreferencesForFolder,
      setActiveFolder,
      logSessionError,
    ]
  );

  const handleFolderAdvancedSession = useCallback(
    (folderId: string) => {
      // Set the folder context for the wizard and open it
      setWizardFolderId(folderId);
      setActiveFolder(folderId);
      setIsWizardOpen(true);
    },
    [setActiveFolder]
  );

  const handleFolderNewWorktree = useCallback(
    (folderId: string) => {
      setWorktreeNameInput("");
      setWorktreeTypeInput("feature");
      setWorktreePrompt({ folderId });
    },
    []
  );

  const handleWorktreePromptConfirm = useCallback(
    async () => {
      if (!worktreePrompt) return;
      const { folderId } = worktreePrompt;
      const branchName = worktreeNameInput.trim() || undefined;
      const prefs = resolvePreferencesForFolder(folderId);
      const name = branchName || generateSessionName(folderId);
      setWorktreePrompt(null);
      try {
        const newSession = await createSession({
          name,
          projectPath: prefs.defaultWorkingDirectory || undefined,
          projectId: folderId,
          createWorktree: true,
          terminalType: "agent",
          featureDescription: branchName,
          worktreeType: worktreeTypeInput,
        });
        if (newSession) {
          setActiveFolder(folderId);
        }
      } catch (error) {
        console.error("Failed to create worktree session:", error);
      }
    },
    [worktreePrompt, worktreeNameInput, worktreeTypeInput, createSession, resolvePreferencesForFolder, generateSessionName, setActiveFolder]
  );

  // Handler for opening the wizard from Plus button or command palette
  // Sets wizardFolderId to current active folder so new sessions inherit the folder context
  const handleOpenWizard = useCallback(() => {
    setWizardFolderId(activeProject.folderId);
    setIsWizardOpen(true);
  }, [activeProject.folderId]);

  // Handler for creating a new agent session using folder's startupCommand
  const handleNewAgent = useCallback(async () => {
    const folderId = activeProject.folderId || undefined;
    const name = generateSessionName(folderId);
    try {
      await createSession({
        name,
        projectPath: currentPreferences.defaultWorkingDirectory || undefined,
        projectId: folderId,
        terminalType: "agent",
      });
      maybeAutoFollowFolder(folderId ?? null);
    } catch (error) {
      logSessionError("create agent session", error);
    }
  }, [
    createSession,
    generateSessionName,
    currentPreferences.defaultWorkingDirectory,
    activeProject.folderId,
    logSessionError,
    maybeAutoFollowFolder,
  ]);

  const handleFolderNewAgent = useCallback(
    async (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      const name = generateSessionName(folderId);
      try {
        const newSession = await createSession({
          name,
          projectPath: prefs.defaultWorkingDirectory || undefined,
          projectId: folderId,
          terminalType: "agent",
        });
        if (newSession) {
          setActiveFolder(folderId);
        }
      } catch (error) {
        logSessionError("create agent session", error);
      }
    },
    [
      createSession,
      generateSessionName,
      resolvePreferencesForFolder,
      setActiveFolder,
      logSessionError,
    ]
  );

  // Handler to open the Resume Claude Session modal for a folder
  const handleFolderResumeClaudeSession = useCallback(
    (folderId: string) => {
      const prefs = resolvePreferencesForFolder(folderId);
      const profileId = sessions.find(
        (s) => s.projectId === folderId && s.profileId
      )?.profileId ?? undefined;

      setResumeModalFolderId(folderId);
      setResumeModalProjectPath(prefs.defaultWorkingDirectory || "");
      setResumeModalProfileId(profileId);
      setIsResumeModalOpen(true);
    },
    [resolvePreferencesForFolder, sessions]
  );

  const handleResumeModalClose = useCallback(() => {
    setIsResumeModalOpen(false);
    setResumeModalFolderId(null);
  }, []);

  // Handler to resume a specific Claude Code session
  const handleResumeClaudeSession = useCallback(
    async (claudeSessionId: string) => {
      const folderId = resumeModalFolderId ?? undefined;

      // Build startup command using folder's base command (or default "claude") with --resume flag
      const prefs = folderId ? resolvePreferencesForFolder(folderId) : undefined;
      const baseCommand = prefs?.startupCommand || "claude";
      const sanitizedId = claudeSessionId.replace(/[^a-zA-Z0-9\-_]/g, "");
      const startupCommand = `${baseCommand} --resume ${sanitizedId}`;

      try {
        const newSession = await createSession({
          name: `Resume ${claudeSessionId.slice(0, 8)}`,
          projectPath: resumeModalProjectPath || undefined,
          projectId: folderId,
          terminalType: "agent",
          agentProvider: "claude",
          autoLaunchAgent: false,
          startupCommand,
          profileId: resumeModalProfileId || undefined,
        });
        if (newSession && folderId) {
          setActiveFolder(folderId);
        }
      } catch (error) {
        logSessionError("resume claude session", error);
        throw error;
      }
    },
    [
      resumeModalFolderId,
      resumeModalProjectPath,
      resumeModalProfileId,
      resolvePreferencesForFolder,
      createSession,
      setActiveFolder,
      logSessionError,
    ]
  );

  // Handle restarting a session with the same configuration
  const handleSessionRestart = useCallback(
    async (session: typeof activeSessions[0]) => {
      try {
        // Close the old session first
        await closeSession(session.id);

        // Create a new session with the same configuration
        // Include folderId so the session is created with folder preferences
        // (resolves defaultWorkingDirectory from folder settings)
        const newSession = await createSession({
          name: session.name,
          projectId: session.projectId ?? undefined,
          projectPath: session.projectPath ?? undefined,
          githubRepoId: session.githubRepoId ?? undefined,
          worktreeBranch: session.worktreeBranch ?? undefined,
          terminalType: session.terminalType,
          agentProvider: session.agentProvider ?? undefined,
          profileId: session.profileId ?? undefined,
        });
        // Preserve pinned state from the old session
        if (session.pinned) {
          await updateSession(newSession.id, { pinned: true });
        }
      } catch (error) {
        logSessionError("restart session", error);
      }
    },
    [closeSession, createSession, updateSession, logSessionError]
  );

  // Handle deleting a session (with optional worktree deletion)
  // Both options ("keep worktree" and "delete worktree") go to trash for recovery
  const handleSessionDelete = useCallback(
    async (session: typeof activeSessions[0], deleteWorktree?: boolean) => {
      void deleteWorktree; // Both options go to trash for recovery
      // For worktree sessions, always use trash for recovery
      // The trash system moves the worktree to .trash directory
      if (session.worktreeBranch && session.projectPath) {
        try {
          const success = await trashSession(session.id);
          if (success) {
            // Refresh sessions to remove trashed session from sidebar
            await refreshSessions();
            return;
          }
          // Fallback to regular close if trash fails
        } catch (error) {
          logSessionError("trash session", error);
        }
      }

      // Regular close for non-worktree sessions or if trash failed
      try {
        await closeSession(session.id);
      } catch (error) {
        logSessionError("close session", error);
      }
    },
    [closeSession, trashSession, refreshSessions, logSessionError]
  );

  // Select a session — on mobile the sidebar stays open so users can browse freely
  const handleSessionClick = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
      // Update active folder based on the session's folder
      // Use session.folderId directly for immediate availability (not sessionFolders which loads async)
      const session = sessions.find(s => s.id === sessionId);
      const folderId = session?.projectId || null;
      maybeAutoFollowFolder(folderId);
    },
    [setActiveSession, sessions, maybeAutoFollowFolder]
  );

  // Keyboard shortcut handler - useEffectEvent always reads latest values
  // Note: Cmd+T and Cmd+W are intercepted by browsers, so we use alternatives
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    // Cmd+Enter or Ctrl+Enter for new session (not intercepted by browsers)
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      // useEffectEvent reads latest values automatically - no refs needed
      const name = generateSessionName(activeProject.folderId);
      // Pass folderId so environment variables from folder preferences are applied
      createSession({ name, projectId: activeProject.folderId ?? undefined }).catch((error) => {
        logSessionError("create session", error);
      });
    }
    // Cmd+Shift+W or Ctrl+Shift+W to close current session
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "w") {
      if (activeSessionId) {
        e.preventDefault();
        closeSession(activeSessionId).catch((error) => {
          logSessionError("close session", error);
        });
      }
    }
    // Cmd+[ or Cmd+] to switch tabs
    if (e.metaKey && e.key === "[") {
      e.preventDefault();
      const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
      if (currentIndex > 0) {
        const targetSession = activeSessions[currentIndex - 1];
        setActiveSession(targetSession.id);
        maybeAutoFollowFolder(targetSession.projectId || null);
      }
    }
    if (e.metaKey && e.key === "]") {
      e.preventDefault();
      const currentIndex = activeSessions.findIndex((s) => s.id === activeSessionId);
      if (currentIndex < activeSessions.length - 1) {
        const targetSession = activeSessions[currentIndex + 1];
        setActiveSession(targetSession.id);
        maybeAutoFollowFolder(targetSession.projectId || null);
      }
    }
    // Cmd+Shift+J or Ctrl+Shift+J to jump to latest unread notification session
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "j" || e.key === "J")) {
      if (latestUnreadSessionId) {
        e.preventDefault();
        setActiveSession(latestUnreadSessionId);
      }
    }
  });

  // Keyboard shortcuts effect - empty deps since onKeyDown is an effect event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for open-folder-preferences event from Port Manager
  // Use ref for folders to keep a single stable listener instead of re-adding on every folders change
  const foldersRef = useRef(folders);
  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    const handleOpenFolderPrefs = (e: CustomEvent<{ folderId: string }>) => {
      const { folderId } = e.detail;
      const folder = foldersRef.current.find((f) => f.id === folderId);
      if (folder) {
        setFolderSettingsModal({
          folderId,
          folderName: folder.name,
          initialTab: "environment",
        });
        setIsPortsModalOpen(false); // Close port manager
      }
    };

    window.addEventListener("open-folder-preferences", handleOpenFolderPrefs as EventListener);
    return () => window.removeEventListener("open-folder-preferences", handleOpenFolderPrefs as EventListener);
  }, []);

  // Listen for notification-panel-toggle event from Header bell button
  useEffect(() => {
    const handleToggle = () => setNotificationPanelOpen((prev) => !prev);
    window.addEventListener("notification-panel-toggle", handleToggle);
    return () => window.removeEventListener("notification-panel-toggle", handleToggle);
  }, []);

  // Listen for open-settings event from Header gear button and Sidebar
  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: string }>).detail;
      setSettingsInitialSection(detail?.section);
      setSettingsOpenCount((c) => c + 1);
      setActiveView("settings");
    };
    window.addEventListener("open-settings", handleOpenSettings);
    return () => window.removeEventListener("open-settings", handleOpenSettings);
  }, []);

  // Register session jump handler for toast "View session" actions
  useEffect(() => {
    registerJumpHandler(setActiveSession);
    return () => registerJumpHandler(null);
  }, [registerJumpHandler, setActiveSession]);

  // Dismiss toasts and mark notifications read when a session is selected
  const markSessionNotificationsRead = useEffectEvent((sessionId: string) => {
    dismissToastsForSession(sessionId);
    const unreadIds = notifications
      .filter((n) => !n.readAt && n.sessionId === sessionId)
      .map((n) => n.id);
    if (unreadIds.length > 0) {
      markRead(unreadIds);
    }
  });

  useEffect(() => {
    if (!activeSessionId) return;
    markSessionNotificationsRead(activeSessionId);
  }, [activeSessionId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Recording Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(() => {
    startRecording();
  }, [startRecording]);

  const handleStopRecording = useCallback(() => {
    // Show modal to save the recording
    setIsSaveRecordingModalOpen(true);
  }, []);

  const handleSaveRecording = useCallback(
    async (name: string) => {
      const data = await stopRecording(name);
      if (data) {
        // Recording was saved via the onSave callback in useRecording
        setIsSaveRecordingModalOpen(false);
      }
    },
    [stopRecording]
  );

  const handleCancelSaveRecording = useCallback(() => {
    // Cancel recording - discard the data
    stopRecording();
    setIsSaveRecordingModalOpen(false);
  }, [stopRecording]);

  // Handle view change from FolderTabBar (terminal/chat toggle)
  const handleViewChange = useCallback(
    (view: ActiveView) => {
      setActiveView(view);
      if (view === "chat") {
        peerChat.markAllRead();
      } else {
        peerChat.markChatInactive();
      }
    },
    [peerChat]
  );

  // Handle agent tab click from FolderTabBar
  const handleAgentTabClick = useCallback(
    (sessionId: string) => {
      setActiveView("terminal");
      setActiveSession(sessionId);
    },
    [setActiveSession]
  );

  /** Agent sessions in the active folder — drives FolderTabBar */
  const folderAgentSessions = useMemo(() => {
    if (!activeProject.folderId) return [];
    return activeSessions.filter(
      (s) =>
        s.projectId === activeProject.folderId &&
        (s.terminalType === "agent" || s.terminalType === "loop")
    );
  }, [activeSessions, activeProject.folderId]);

  // When all agent sessions close, force back to terminal from chat view
  // (tab bar disappears so chat is unreachable). Computed, not effect-based.
  const effectiveActiveView: ActiveView =
    folderAgentSessions.length === 0 && activeView === "chat"
      ? "terminal"
      : activeView;

  // On mobile, sidebar is collapsed when drawer is not open
  const effectiveCollapsed = isMobile ? !isMobileSidebarOpen : sidebarCollapsed;

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Sidebar - inline layout: pushes content over when expanded on mobile; hidden in settings */}
      <div
        className={cn(
          isPWA && isMobile ? "pt-safe-top" : undefined,
          effectiveActiveView === "settings" && "hidden"
        )}
        onClick={() => {
          // On mobile, clicking the collapsed sidebar expands it
          if (isMobile && !isMobileSidebarOpen) {
            setIsMobileSidebarOpen(true);
          }
        }}
      >
        <Sidebar
            sessions={activeSessions}
            activeSessionId={activeSessionId}
            activeFolderId={activeProject.folderId}
            collapsed={effectiveCollapsed}
            onCollapsedChange={(collapsed) => {
              if (isMobile) {
                // On mobile, toggling collapsed state controls the drawer
                setIsMobileSidebarOpen(!collapsed);
              } else {
                setSidebarCollapsed(collapsed);
              }
            }}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            folderHasRepo={folderHasRepo}
            getFolderRepoStats={getFolderRepoStats}
            onSessionClick={handleSessionClick}
            onSessionClose={handleCloseSession}
            onSessionRename={handleRenameSession}
            onSessionTogglePin={handleTogglePinSession}
            onSessionMove={handleMoveSession}
            onSessionReorder={handleReorderSessions}
            onNewSession={handleOpenWizard}
            onQuickNewSession={handleQuickNewSession}
            onNewAgent={handleNewAgent}
            onProjectSettings={handleFolderSettings}
            onProjectNewSession={handleFolderNewSession}
            onProjectNewAgent={handleFolderNewAgent}
            onProjectResumeClaudeSession={handleFolderResumeClaudeSession}
            onProjectAdvancedSession={handleFolderAdvancedSession}
            onProjectNewWorktree={handleFolderNewWorktree}
            trashCount={trashCount}
            onTrashOpen={() => setIsTrashOpen(true)}
            onSessionSchedule={handleScheduleSession}
            onProfilesOpen={() =>
              window.dispatchEvent(
                new CustomEvent("open-settings", { detail: { section: "profiles" } })
              )
            }
            onPortsOpen={() => setIsPortsModalOpen(true)}
            onViewIssues={handleViewIssues}
            onViewPRs={handleViewPRs}
            getFolderPinnedFiles={handleGetFolderPinnedFiles}
            onOpenPinnedFile={handleOpenPinnedFile}
            onOpenNodePreferences={handleNodeSettings}
          />
      </div>

      {/* Main content area */}
      <div className={cn(
        "flex-1 flex flex-col overflow-hidden",
        isPWA && isMobile && "pt-safe-top"
      )}>
        {/* Mobile header bar */}
        {isMobile && activeSessions.length > 0 && effectiveActiveView !== "settings" && (
          <div className="flex items-center gap-2 px-12 py-2 border-b border-border bg-card/50">
            {mobileEditingName !== null ? (
              <input
                type="text"
                autoFocus
                value={mobileEditingName}
                onChange={(e) => setMobileEditingName(e.target.value)}
                onBlur={() => {
                  if (activeSessionId && mobileEditingName.trim()) {
                    handleRenameSession(activeSessionId, mobileEditingName.trim());
                  }
                  setMobileEditingName(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (activeSessionId && mobileEditingName.trim()) {
                      handleRenameSession(activeSessionId, mobileEditingName.trim());
                    }
                    setMobileEditingName(null);
                  } else if (e.key === "Escape") {
                    setMobileEditingName(null);
                  }
                }}
                className="flex-1 bg-input border border-primary/50 rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span
                className="text-xs text-muted-foreground truncate flex-1 cursor-pointer hover:text-foreground transition-colors"
                onClick={() => {
                  const session = activeSessions.find((s) => s.id === activeSessionId);
                  if (session) {
                    setMobileEditingName(session.name);
                  }
                }}
              >
                {activeSessions.find((s) => s.id === activeSessionId)?.name || "No session"}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Folder tab bar — Terminal / Chat Room / Agent tabs (hidden in settings) */}
        {activeSessions.length > 0 && folderAgentSessions.length > 0 && effectiveActiveView !== "settings" && (
          <FolderTabBar
            activeView={activeView}
            onViewChange={handleViewChange}
            agentSessions={folderAgentSessions}
            activeSessionId={activeSessionId}
            onAgentTabClick={handleAgentTabClick}
            chatUnreadCount={channelCtx.totalUnreadCount}
          />
        )}

        {/* Empty state when no sessions (unless settings view is active) */}
        {!loading && activeSessions.length === 0 && effectiveActiveView !== "settings" ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="relative p-8 rounded-2xl bg-card/50 backdrop-blur-xl border border-border shadow-2xl">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
                <div className="relative mx-auto w-16 h-16 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6">
                  <TerminalIcon className="w-8 h-8 text-primary" />
                </div>
                <h2 className="relative text-2xl font-semibold text-foreground mb-3">
                  No Active Sessions
                </h2>
                <p className="relative text-muted-foreground mb-6">
                  Press <kbd className="px-2 py-1 bg-muted rounded text-xs">⌘↵</kbd> to
                  create a new terminal session, or use the wizard for more options.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button
                    onClick={handleQuickNewSession}
                    className="relative bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Quick Terminal
                  </Button>
                  <Button
                    onClick={handleOpenWizard}
                    variant="outline"
                    className="border-border text-muted-foreground hover:bg-accent/50"
                  >
                    Advanced...
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
          {/* Terminal Container — hidden when chat view is active */}
          <div className={cn("flex-1 p-3 overflow-hidden", isMobile && "pb-safe-bottom", effectiveActiveView !== "terminal" && "hidden")}>
            <div className="h-full relative rounded-xl overflow-hidden">
              {/* Gradient border effect */}
              <div className="absolute inset-0 rounded-xl p-[1px] bg-gradient-to-br from-primary/30 via-transparent to-accent/30">
                <div className="absolute inset-[1px] rounded-xl bg-background" />
              </div>

              {/* Terminal panels */}
              <div className="relative h-full">
                {(() => {
                    const session = activeSessions.find((s) => s.id === activeSessionId);
                    if (!session) return null;
                    const folderId = session.projectId || null;
                    const prefs = resolvePreferencesForFolder(folderId);

                    if (session.terminalType === "file") {
                      const metadata = session.typeMetadata;
                      return (
                        <div className="absolute inset-0 z-10">
                          <CodeMirrorEditor
                            key={session.id}
                            filePath={String(metadata?.filePath ?? "")}
                            fileName={String(metadata?.fileName ?? session.name)}
                            fontSize={prefs.fontSize}
                            fontFamily={prefs.fontFamily}
                          />
                        </div>
                      );
                    }

                    // Loop type uses LoopChatPane for chat-first UI
                    if (session.terminalType === "loop") {
                      return (
                        <div className="absolute inset-0 z-10">
                          <LoopChatPane
                            key={session.id}
                            session={session}
                            wsUrl={wsUrl}
                            fontSize={prefs.fontSize}
                            fontFamily={prefs.fontFamily}
                            scrollback={userSettings?.xtermScrollback ?? 10000}
                            tmuxHistoryLimit={userSettings?.tmuxHistoryLimit ?? 50000}
                            isActive={session.id === activeSessionId}
                            environmentVars={getEnvironmentWithSecrets(folderId)}
                            onAgentActivityStatus={handleAgentActivityStatus}
                            onBeadsIssuesUpdated={() => debouncedRefresh()}
                            onSessionRenamed={handleSessionRenamed}
                            onNotification={(notification) => {
                              addNotification(hydrateNotification(notification));
                            }}
                            onSessionStatus={setSessionStatusIndicator}
                            onSessionProgress={setSessionProgress}
                            onSessionClose={(id) => handleSessionDelete(activeSessions.find(s => s.id === id) ?? session)}
                            onPeerMessageCreated={handlePeerMessageCreated}
                            onChannelMessageCreated={handleChannelMessageCreated}
                            onThreadReplyCreated={handleThreadReplyCreated}
                            onChannelCreated={handleChannelCreated}
                          />
                        </div>
                      );
                    }

                    // Browser type uses TerminalTypeRenderer for BrowserPane
                    if (session.terminalType === "browser") {
                      return (
                        <div className="absolute inset-0 z-10">
                          <TerminalTypeRenderer
                            key={session.id}
                            session={session}
                            wsUrl={wsUrl}
                            fontSize={prefs.fontSize}
                            fontFamily={prefs.fontFamily}
                            scrollback={userSettings?.xtermScrollback ?? 10000}
                            tmuxHistoryLimit={userSettings?.tmuxHistoryLimit ?? 50000}
                            notificationsEnabled={notificationsEnabled}
                            isRecording={isRecording}
                            isActive={session.id === activeSessionId}
                            environmentVars={getEnvironmentWithSecrets(folderId)}
                            onOutput={isRecording ? recordOutput : undefined}
                            onDimensionsChange={isRecording ? updateDimensions : undefined}
                            onSessionClose={(id) => handleSessionDelete(activeSessions.find(s => s.id === id) ?? session)}
                            onNavigateToSession={(id) => setActiveSession(id)}
                            onAgentActivityStatus={handleAgentActivityStatus}
                            onBeadsIssuesUpdated={() => debouncedRefresh()}
                            onSessionRenamed={handleSessionRenamed}
                            onNotification={(notification) => {
                              addNotification(hydrateNotification(notification));
                            }}
                            onSessionStatus={setSessionStatusIndicator}
                            onSessionProgress={setSessionProgress}
                            onPeerMessageCreated={handlePeerMessageCreated}
                            onChannelMessageCreated={handleChannelMessageCreated}
                            onThreadReplyCreated={handleThreadReplyCreated}
                            onChannelCreated={handleChannelCreated}
                          />
                        </div>
                      );
                    }

                    return (
                      <div className="absolute inset-0 z-10">
                        <TerminalWithKeyboard
                          key={session.id}
                          ref={(ref) => {
                            if (ref) {
                              terminalRefsMap.current.set(session.id, ref);
                            } else {
                              terminalRefsMap.current.delete(session.id);
                            }
                          }}
                          sessionId={session.id}
                          tmuxSessionName={session.tmuxSessionName}
                          sessionName={session.name}
                          projectPath={session.projectPath}
                          session={session}
                          wsUrl={wsUrl}
                          fontSize={prefs.fontSize}
                          fontFamily={prefs.fontFamily}
                          scrollback={userSettings?.xtermScrollback ?? 10000}
                          tmuxHistoryLimit={userSettings?.tmuxHistoryLimit ?? 50000}
                          notificationsEnabled={notificationsEnabled}
                          isRecording={isRecording}
                          isActive={session.id === activeSessionId}
                          environmentVars={getEnvironmentWithSecrets(folderId)}
                          onOutput={isRecording ? recordOutput : undefined}
                          onDimensionsChange={isRecording ? updateDimensions : undefined}
                          onSessionRestart={() => handleSessionRestart(session)}
                          onSessionDelete={(deleteWorktree) => handleSessionDelete(session, deleteWorktree)}
                          onAgentActivityStatus={handleAgentActivityStatus}
                          onBeadsIssuesUpdated={() => debouncedRefresh()}
                          onSessionRenamed={handleSessionRenamed}
                          onNotification={(notification) => {
                            addNotification(hydrateNotification(notification));
                          }}
                          onSessionStatus={setSessionStatusIndicator}
                          onSessionProgress={setSessionProgress}
                          onPeerMessageCreated={handlePeerMessageCreated}
                          onChannelMessageCreated={handleChannelMessageCreated}
                          onThreadReplyCreated={handleThreadReplyCreated}
                          onChannelCreated={handleChannelCreated}
                        />
                      </div>
                    );
                  })()}
              </div>
            </div>
          </div>

          {/* Channel View — visible when chat view is active */}
          <div className={cn("flex-1 overflow-hidden", effectiveActiveView !== "chat" && "hidden")}>
            <ChannelView
              folderId={activeProject.folderId}
              folderName={getFolderName(activeProject.folderId)}
            />
          </div>

          {/* Settings View — conditionally rendered (no state to preserve, key handles remount) */}
          {effectiveActiveView === "settings" && (
            <div className="flex-1 overflow-hidden">
              <SettingsView
                key={`settings-${settingsOpenCount}`}
                onClose={() => setActiveView("terminal")}
                initialSection={settingsInitialSection as SettingsSection | undefined}
              />
            </div>
          )}
          </>
        )}
      </div>

      {/* Right sidebar — Channel list (chat) or Beads+Schedules (terminal), hidden in settings */}
      <div className={cn((effectiveActiveView === "chat" || effectiveActiveView === "settings") && "hidden")}>
        <BeadsSidebar
          scheduleTargetSessionId={scheduleTargetSessionId}
          onScheduleTargetConsumed={() => setScheduleTargetSessionId(null)}
        />
      </div>
      {effectiveActiveView === "chat" && activeProject.folderId && (
        <ChannelSidebar onCreateChannel={() => setIsCreateChannelOpen(true)} />
      )}

      <CreateChannelModal
        open={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
      />

      {/* New Session Wizard */}
      <NewSessionWizard
        open={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false);
          setWizardFolderId(null);
        }}
        onCreate={handleCreateSession}
        isGitHubConnected={isGitHubConnected}
      />

      {/* Legacy folder preferences modal → now routes to ProjectPreferencesModal
          since Phase 6 consolidated folder prefs onto project nodes. */}
      {folderSettingsModal && (
        <ProjectPreferencesModal
          open
          onClose={() => setFolderSettingsModal(null)}
          projectId={folderSettingsModal.folderId}
          projectName={folderSettingsModal.folderName}
        />
      )}

      {/* Phase 4: Group/Project preferences modal (triggered from ProjectTree gear). */}
      {nodeSettingsModal?.type === "group" && (
        <GroupPreferencesModal
          open
          onClose={() => setNodeSettingsModal(null)}
          groupId={nodeSettingsModal.id}
          groupName={nodeSettingsModal.name}
        />
      )}
      {nodeSettingsModal?.type === "project" && (
        <ProjectPreferencesModal
          open
          onClose={() => setNodeSettingsModal(null)}
          projectId={nodeSettingsModal.id}
          projectName={nodeSettingsModal.name}
        />
      )}

      {/* Command Palette */}
      <CommandPalette
        onNewSession={handleOpenWizard}
        onQuickNewSession={handleQuickNewSession}
        onNewFolder={() => handleCreateFolder("New Folder")}
        onOpenSettings={() => setActiveView("settings")}
        onCloseActiveSession={
          activeSessionId
            ? () => handleCloseSession(activeSessionId)
            : undefined
        }
        onSaveAsTemplate={() => setIsTemplateModalOpen(true)}
        onShowKeyboardShortcuts={() => setIsKeyboardShortcutsOpen(true)}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        onViewRecordings={() => setIsRecordingsModalOpen(true)}
        activeSessionId={activeSessionId}
        isRecording={isRecording}
      />

      {/* Save Template Modal */}
      <SaveTemplateModal
        open={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        session={activeSessions.find((s) => s.id === activeSessionId) || null}
      />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsPanel
        open={isKeyboardShortcutsOpen}
        onOpenChange={setIsKeyboardShortcutsOpen}
      />

      {/* Recordings Modal */}
      <RecordingsModal
        open={isRecordingsModalOpen}
        onOpenChange={setIsRecordingsModalOpen}
      />

      {/* Save Recording Modal */}
      <SaveRecordingModal
        open={isSaveRecordingModalOpen}
        onClose={handleCancelSaveRecording}
        onSave={handleSaveRecording}
        duration={recordingDuration}
        sessionName={activeSessions.find((s) => s.id === activeSessionId)?.name}
      />

      {/* Trash Modal */}
      <TrashModal open={isTrashOpen} onClose={() => setIsTrashOpen(false)} />

      {/* Resume Claude Session Modal */}
      <ResumeSessionModal
        open={isResumeModalOpen}
        onClose={handleResumeModalClose}
        projectPath={resumeModalProjectPath}
        profileId={resumeModalProfileId}
        onResume={handleResumeClaudeSession}
      />

      {/* Profiles: now in SettingsView */}

      {/* Port Manager Modal */}
      <PortManagerModal
        open={isPortsModalOpen}
        onClose={() => setIsPortsModalOpen(false)}
      />

      {/* Issues Modal */}
      {issuesModal && (
        <IssuesModal
          open={issuesModal.open}
          onClose={() => setIssuesModal(null)}
          repositoryId={issuesModal.repositoryId}
          repositoryName={issuesModal.repositoryName}
          repositoryUrl={issuesModal.repositoryUrl}
          initialIssueNumber={issuesModal.initialIssueNumber}
          onCreateWorktree={handleCreateWorktreeFromIssue}
        />
      )}

      {/* PRs Modal */}
      {prsModal && (
        <PRsModal
          open={prsModal.open}
          onClose={() => setPrsModal(null)}
          repositoryId={prsModal.repositoryId}
          repositoryName={prsModal.repositoryName}
          repositoryUrl={prsModal.repositoryUrl}
          initialPRNumber={prsModal.initialPRNumber}
        />
      )}

      {/* Worktree Name Prompt */}
      <Dialog open={!!worktreePrompt} onOpenChange={(open) => { if (!open) { setWorktreePrompt(null); setWorktreeNameInput(""); setWorktreeTypeInput("feature"); } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              New Worktree
            </DialogTitle>
            <DialogDescription>
              Enter a name for the worktree branch. Leave blank for an auto-generated name.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Select value={worktreeTypeInput} onValueChange={(v) => setWorktreeTypeInput(v as WorktreeType)}>
              <SelectTrigger className="w-[100px] font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKTREE_TYPES.map((wt) => (
                  <SelectItem key={wt.id} value={wt.id} className="font-mono text-xs">
                    {wt.label}/
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="flex-1"
              placeholder="e.g. fix-auth-bug"
              value={worktreeNameInput}
              onChange={(e) => setWorktreeNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleWorktreePromptConfirm();
                if (e.key === "Escape") setWorktreePrompt(null);
              }}
              autoFocus
            />
          </div>
          {worktreeNameInput.trim() && (
            <p className="text-xs text-muted-foreground">
              Branch: <span className="font-mono text-primary">{worktreeTypeInput}/{sanitizeBranchName(worktreeNameInput.trim())}</span>
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setWorktreePrompt(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleWorktreePromptConfirm}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification Panel */}
      <NotificationPanel
        open={notificationPanelOpen}
        onOpenChange={setNotificationPanelOpen}
        onJumpToSession={(sessionId) => {
          setActiveSession(sessionId);
          setNotificationPanelOpen(false);
        }}
      />
    </div>
  );
}
