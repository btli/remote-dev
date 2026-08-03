"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo, Activity } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { ImageAddon as ImageAddonType } from "@xterm/addon-image";
import type { SearchAddon as SearchAddonType } from "@xterm/addon-search";
import type { WebglAddon as WebglAddonType } from "@xterm/addon-webgl";
import type { ConnectionStatus, ServerMessage } from "@/types/terminal";
import { Search, X, ChevronUp, ChevronDown, Circle } from "lucide-react";
import { toast } from "sonner";
import { useNotifications } from "@/hooks/useNotifications";
import { useTerminalTheme } from "@/contexts/AppearanceContext";
import { sendImageToTerminal } from "@/lib/image-upload";
import { AuthErrorOverlay } from "./AuthErrorOverlay";
import { createTouchScrollHandlers } from "./touch-scroll";
import { createTouchInteractions, createTouchModeRef } from "./useTouchInteractions";
import {
  createHttpLinkOpener,
  createTerminalLinkController,
} from "./terminal-links";
import {
  MIN_COLS,
  MIN_ROWS,
  ResizeReconciler,
} from "./resize-reconciler";

import { apiFetch } from "@/lib/api-fetch";
import { useClipboardSyncPreference } from "@/hooks/useClipboardSyncPreference";
import {
  TerminalClipboardSync,
  readBrowserClipboard,
  writeBrowserClipboard,
} from "@/lib/terminal-clipboard-sync";

const REMOTE_CLIPBOARD_TOAST_ID = "remote-clipboard-fallback";
const CLIPBOARD_FALLBACK_ACTION_ATTRIBUTE =
  "data-rdv-clipboard-fallback-action";

function isClipboardFallbackActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.hasAttribute(CLIPBOARD_FALLBACK_ACTION_ATTRIBUTE) ||
    target.querySelector(`[${CLIPBOARD_FALLBACK_ACTION_ATTRIBUTE}]`) !== null
  );
}

export interface TerminalRef {
  focus: () => void;
  /** Request agent restart (only valid for terminalType='agent') */
  restartAgent: () => void;
  /** Get the WebSocket instance (for advanced use) */
  getWebSocket: () => WebSocket | null;
  /** Send text input to the terminal via WebSocket (for external input sources) */
  sendInput: (data: string) => void;
  /** Scroll the terminal to the bottom (latest output) */
  scrollToBottom: () => void;
  /**
   * Force a container re-measure + xterm.js re-fit and push the resulting
   * cols/rows to the terminal server. Used by the mobile native shell
   * (rdv-bridge `refit`, remote-dev-u5q5.2) on app resume / route pop-back,
   * where a platform WebView produces no page-level resize signal so the
   * in-page resize pipeline (ResizeObserver / visualViewport /
   * visibilitychange) never fires and the grid would otherwise stay stale
   * until the next pinch. No-op if the terminal hasn't initialized yet.
   */
  refit: () => void;
  /** Toggle xterm.js cursor blink at runtime (no remount). */
  setCursorBlink: (blink: boolean) => void;
  /**
   * Open the in-terminal search overlay (xterm.js SearchAddon).
   * Used by mobile chrome (PWA session metadata sheet, Flutter native
   * menu via rdv-bridge) to expose search since mobile has no Cmd+F.
   */
  openSearch: () => void;
  /** Close the in-terminal search overlay and clear decorations. */
  closeSearch: () => void;
  /** Toggle the search overlay (convenience for menu buttons). */
  toggleSearch: () => void;
  /** Enable/disable native-owned clipboard synchronization. */
  setClipboardSync: (enabled: boolean) => void;
  /** Push native clipboard text to the active remote session. */
  syncClipboard: (text: string) => void;
}

export interface TerminalProps {
  sessionId: string;
  tmuxSessionName: string;
  sessionName?: string;
  projectPath?: string | null;
  wsUrl?: string;
  fontSize?: number;
  fontFamily?: string;
  /** xterm.js client-side scrollback buffer size (default: 10000) */
  scrollback?: number;
  /** tmux server-side history-limit / scrollback buffer (default: 50000) */
  tmuxHistoryLimit?: number;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  isActive?: boolean;
  /** Whether the containing panel is currently presented to the user. */
  visible?: boolean;
  /** Environment variables to inject into new terminal sessions */
  environmentVars?: Record<string, string> | null;
  /** Terminal type for agent exit detection */
  terminalType?: "shell" | "agent" | "file" | string;
  /** When true, disables xterm.js internal textarea so external input can be used */
  mobileMode?: boolean;
  /**
   * Exact browser-mobile textarea that owns terminal input. Clipboard sync
   * listens to this element directly when mobileMode disables xterm stdin;
   * unrelated document inputs never become eligible.
   */
  mobileInputElement?: HTMLTextAreaElement | null;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  /** Called when an agent session exits (only for terminalType='agent') */
  onAgentExited?: (exitCode: number | null, exitedAt: string) => void;
  /** Called when an agent session restarts successfully. [hgwo] `resumed`
   *  distinguishes a resumed conversation from a fresh relaunch. */
  onAgentRestarted?: (resumed?: boolean) => void;
  /** Called when agent activity status changes (from Claude Code hooks).
   *  Includes sessionId so broadcast messages correctly target the right session. */
  onAgentActivityStatus?: (sessionId: string, status: string, statusAt?: number) => void;
  /** Called when beads issues are updated */
  onBeadsIssuesUpdated?: (sessionId: string) => void;
  /** Called when an agent session is auto-titled from its .jsonl file.
   *  [hgwo] `agentSessionId` is the generic per-provider native-id map. */
  onSessionRenamed?: (
    sessionId: string,
    name: string,
    claudeSessionId?: string,
    agentSessionId?: Record<string, string>,
  ) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
  /** Called when a session status indicator is set or cleared */
  onSessionStatus?: (sessionId: string, key: string, indicator: import("@/types/terminal-type").SessionStatusIndicator | null) => void;
  /** Called when session progress is updated or cleared */
  onSessionProgress?: (sessionId: string, progress: import("@/types/terminal-type").SessionProgress | null) => void;
  /** Called when a peer message is created (broadcast from terminal server) */
  onPeerMessageCreated?: (folderId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onChannelMessageCreated?: (folderId: string, channelId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onThreadReplyCreated?: (folderId: string, parentMessageId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onChannelCreated?: (folderId: string, channel: import("@/types/channels").Channel) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  /** Called when terminal scroll position changes between scrolled-up and at-bottom */
  onScrollStateChange?: (isScrolledUp: boolean) => void;
  /** Called when the server changes which connection controls tmux resize */
  onPrimaryChange?: (isPrimary: boolean) => void;
  /** Browser owns navigator.clipboard; native mode delegates to Flutter. */
  clipboardMode?: "browser" | "native";
  /** Called for remote clipboard updates in native mode. */
  onClipboardUpdate?: (text: string, revision: number) => void;
  /** Called when the xterm selection changes in native mode. */
  onSelectionChange?: (text: string) => void;
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal({
  sessionId,
  tmuxSessionName,
  sessionName = "Terminal",
  projectPath,
  wsUrl = "ws://localhost:3001",
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  scrollback = 10000,
  tmuxHistoryLimit = 50000,
  notificationsEnabled = true,
  isRecording = false,
  isActive = false,
  visible = true,
  environmentVars,
  terminalType = "shell",
  mobileMode = false,
  mobileInputElement = null,
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
  onAgentExited,
  onAgentRestarted,
  onAgentActivityStatus,
  onBeadsIssuesUpdated,
  onSessionRenamed,
  onNotification,
  onSessionStatus,
  onSessionProgress,
  onPeerMessageCreated,
  onChannelMessageCreated,
  onThreadReplyCreated,
  onChannelCreated,
  onOutput,
  onDimensionsChange,
  onScrollStateChange,
  onPrimaryChange,
  clipboardMode = "browser",
  onClipboardUpdate,
  onSelectionChange,
}, ref) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermType | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const imageAddonRef = useRef<ImageAddonType | null>(null);
  const searchAddonRef = useRef<SearchAddonType | null>(null);
  const webglAddonRef = useRef<WebglAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clipboardModeRef = useRef(clipboardMode);
  const onClipboardUpdateRef = useRef(onClipboardUpdate);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const nativeClipboardSyncEnabledRef = useRef(false);
  const readBrowserClipboardRef = useRef<() => void>(() => {});
  const runClipboardFallbackRef = useRef<() => void>(() => {});
  const reconcileClipboardFallbackFocusRef = useRef<
    (refocus: boolean) => void
  >(() => {});
  const clipboardFallbackActionRunningRef = useRef(false);
  const pendingClipboardFallbackRef = useRef<{
    retry: () => Promise<void>;
    token: number;
    revision: number;
  } | null>(null);
  const latestRemoteClipboardRef = useRef<{
    token: number;
    revision: number;
  } | null>(null);
  const clipboardSyncRef = useRef<TerminalClipboardSync | null>(null);
  if (clipboardSyncRef.current === null) {
    clipboardSyncRef.current = new TerminalClipboardSync({
      applyRemote: async (text, revision) => {
        if (clipboardModeRef.current === "native") {
          onClipboardUpdateRef.current?.(text, revision);
          return;
        }

        const sync = clipboardSyncRef.current;
        if (!sync) return;
        if (pendingClipboardFallbackRef.current) {
          pendingClipboardFallbackRef.current = null;
          toast.dismiss(REMOTE_CLIPBOARD_TOAST_ID);
          // A prior toast may currently own focus via the explicit fallback
          // exemption. Re-establish real xterm focus before granting the
          // replacement update a lease; otherwise revoke and drop it.
          reconcileClipboardFallbackFocusRef.current(true);
        }
        const token = sync.createEligibilityToken();
        if (token === null) return;
        latestRemoteClipboardRef.current = { token, revision };
        const clipboard =
          typeof navigator !== "undefined" ? navigator.clipboard : undefined;
        await writeBrowserClipboard(text, {
          clipboard,
          onBlocked: (_blockedText, retry) => {
            const latest = latestRemoteClipboardRef.current;
            if (
              !sync.isEligibilityTokenCurrent(token) ||
              latest?.token !== token ||
              latest.revision !== revision
            ) {
              return;
            }
            pendingClipboardFallbackRef.current = {
              retry,
              token,
              revision,
            };
            toast("Remote clipboard received", {
              id: REMOTE_CLIPBOARD_TOAST_ID,
              description:
                "Browser permission blocked automatic copying. Copy it with one click.",
              action: {
                label: (
                  <span data-rdv-clipboard-fallback-action="">Copy</span>
                ),
                onClick: () => {
                  runClipboardFallbackRef.current();
                },
              },
              onDismiss: () => {
                const pending = pendingClipboardFallbackRef.current;
                if (
                  pending?.token === token &&
                  pending.revision === revision
                ) {
                  pendingClipboardFallbackRef.current = null;
                  reconcileClipboardFallbackFocusRef.current(false);
                }
              },
              onAutoClose: () => {
                const pending = pendingClipboardFallbackRef.current;
                if (
                  pending?.token === token &&
                  pending.revision === revision
                ) {
                  pendingClipboardFallbackRef.current = null;
                  reconcileClipboardFallbackFocusRef.current(false);
                }
              },
            });
          },
        });
      },
      onEligibilityInvalidated: () => {
        latestRemoteClipboardRef.current = null;
        if (!pendingClipboardFallbackRef.current) return;
        pendingClipboardFallbackRef.current = null;
        toast.dismiss(REMOTE_CLIPBOARD_TOAST_ID);
        reconcileClipboardFallbackFocusRef.current(false);
      },
    });
  }
  const clipboardSync = clipboardSyncRef.current;
  const [deviceClipboardSyncEnabled] = useClipboardSyncPreference();
  const clientInstanceIdRef = useRef<string | null>(null);
  const previousSessionIdentityRef = useRef<{
    sessionId: string;
    tmuxSessionName: string;
  } | null>(null);
  const reconcilerRef = useRef<ResizeReconciler | null>(null);
  const visibleRef = useRef(visible);
  const isActiveRef = useRef(isActive);
  const textareaFocusedRef = useRef(false);
  const mobileInputElementRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileInputFocusedRef = useRef(false);
  const lastSentFocusStateRef = useRef<"focus" | "blur" | null>(null);
  const lastDesiredFocusStateRef = useRef<"focus" | "blur" | null>(null);
  const pendingGenuineFocusRef = useRef(false);
  const syncFocusToServerRef = useRef<
    ((force?: boolean, reassert?: boolean) => void) | null
  >(null);
  const forceFocusAssertRef = useRef<(() => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  // Primary is authoritative server state. Each socket starts false until a
  // primary_changed frame establishes ownership for that socket generation.
  const [isPrimary, setIsPrimary] = useState(false);
  const isScrolledUpRef = useRef(false);
  const isUnmountingRef = useRef(false);
  // IDisposables registered against the terminal that need explicit cleanup
  // (xterm's own dispose() does this for listeners it tracks, but not for ones
  // we attach via the public API on a third-party reference).
  const terminalDisposablesRef = useRef<{ dispose: () => void }[]>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalExitRef = useRef(false);
  // [remote-dev-d5ci] True once this terminal's socket has opened at least once,
  // so ws.onopen can tell a FIRST connect from a RE-open and only fire the
  // sidebar re-seed on reconnect (mirrors useTerminalWebSocket's hasConnectedBefore).
  const hasConnectedBeforeRef = useRef(false);
  const maxReconnectAttempts = 5;

  /**
   * Atomically marks session exit as intentional and cancels any pending reconnect.
   * This prevents race conditions where a reconnect timeout fires after exit.
   */
  const markIntentionalExit = useCallback(() => {
    intentionalExitRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
  }, []);

  // Notifications hook for command completion
  const { recordActivity } = useNotifications({
    enabled: notificationsEnabled,
    sessionName,
    inactivityDelay: 3000, // 3 seconds of inactivity = command finished
  });

  // Terminal theme from appearance context
  const terminalTheme = useTerminalTheme();

  // FIX: Use refs for callbacks to avoid re-creating terminal on callback changes
  const onStatusChangeRef = useRef(onStatusChange);
  const onWebSocketReadyRef = useRef(onWebSocketReady);
  const onSessionExitRef = useRef(onSessionExit);
  const onAgentExitedRef = useRef(onAgentExited);
  const onAgentRestartedRef = useRef(onAgentRestarted);
  const onAgentActivityStatusRef = useRef(onAgentActivityStatus);
  const onBeadsIssuesUpdatedRef = useRef(onBeadsIssuesUpdated);
  const onSessionRenamedRef = useRef(onSessionRenamed);
  const onNotificationRef = useRef(onNotification);
  const onSessionStatusRef = useRef(onSessionStatus);
  const onSessionProgressRef = useRef(onSessionProgress);
  const onPeerMessageCreatedRef = useRef(onPeerMessageCreated);
  const onChannelMessageCreatedRef = useRef(onChannelMessageCreated);
  const onThreadReplyCreatedRef = useRef(onThreadReplyCreated);
  const onChannelCreatedRef = useRef(onChannelCreated);
  const onOutputRef = useRef(onOutput);
  const onDimensionsChangeRef = useRef(onDimensionsChange);
  const onScrollStateChangeRef = useRef(onScrollStateChange);
  const onPrimaryChangeRef = useRef(onPrimaryChange);
  const recordActivityRef = useRef(recordActivity);

  // FIX: Use refs for font and scrollback to avoid recreating terminal on changes.
  // These refs are kept in sync with props so that:
  // 1. If terminal hasn't initialized yet, it will use the latest values
  // 2. If terminal already exists, the update effect applies changes directly
  // This prevents race conditions where preferences load after terminal mounts.
  const fontSizeRef = useRef(fontSize);
  const fontFamilyRef = useRef(fontFamily);
  const scrollbackRef = useRef(scrollback);
  const tmuxHistoryLimitRef = useRef(tmuxHistoryLimit);
  // mobileMode only matters at terminal construction (disableStdin can't change post-init)
  const mobileModeRef = useRef(mobileMode);

  // FIX: Use ref for terminal theme to avoid recreating terminal on theme changes.
  // Theme updates are applied dynamically via terminal.options.theme
  const terminalThemeRef = useRef(terminalTheme);

  // FIX: Use ref for environmentVars to prevent re-initialization on every render.
  // Environment variables are only used during initial WebSocket connection.
  // Without this, getEnvironmentForFolder() returning a new object on each render
  // would cause the terminal to constantly disconnect and reconnect.
  const environmentVarsRef = useRef(environmentVars);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onWebSocketReadyRef.current = onWebSocketReady;
    onSessionExitRef.current = onSessionExit;
    onAgentExitedRef.current = onAgentExited;
    onAgentRestartedRef.current = onAgentRestarted;
    onAgentActivityStatusRef.current = onAgentActivityStatus;
    onBeadsIssuesUpdatedRef.current = onBeadsIssuesUpdated;
    onSessionRenamedRef.current = onSessionRenamed;
    onNotificationRef.current = onNotification;
    onSessionStatusRef.current = onSessionStatus;
    onSessionProgressRef.current = onSessionProgress;
    onPeerMessageCreatedRef.current = onPeerMessageCreated;
    onChannelMessageCreatedRef.current = onChannelMessageCreated;
    onThreadReplyCreatedRef.current = onThreadReplyCreated;
    onChannelCreatedRef.current = onChannelCreated;
    onOutputRef.current = onOutput;
    onDimensionsChangeRef.current = onDimensionsChange;
    onScrollStateChangeRef.current = onScrollStateChange;
    onPrimaryChangeRef.current = onPrimaryChange;
    clipboardModeRef.current = clipboardMode;
    onClipboardUpdateRef.current = onClipboardUpdate;
    onSelectionChangeRef.current = onSelectionChange;
    recordActivityRef.current = recordActivity;
    // Keep font refs in sync for pending terminal initialization
    fontSizeRef.current = fontSize;
    fontFamilyRef.current = fontFamily;
    // Keep scrollback refs in sync for pending terminal initialization
    scrollbackRef.current = scrollback;
    tmuxHistoryLimitRef.current = tmuxHistoryLimit;
    mobileModeRef.current = mobileMode;
    // Keep environmentVars in sync (only used during initial connection)
    environmentVarsRef.current = environmentVars;
    // Keep theme ref in sync for pending terminal initialization
    terminalThemeRef.current = terminalTheme;
  }, [onStatusChange, onWebSocketReady, onSessionExit, onAgentExited, onAgentRestarted, onAgentActivityStatus, onBeadsIssuesUpdated, onSessionRenamed, onNotification, onSessionStatus, onSessionProgress, onPeerMessageCreated, onChannelMessageCreated, onThreadReplyCreated, onChannelCreated, onOutput, onDimensionsChange, onScrollStateChange, onPrimaryChange, clipboardMode, onClipboardUpdate, onSelectionChange, recordActivity, fontSize, fontFamily, scrollback, tmuxHistoryLimit, mobileMode, environmentVars, terminalTheme]);

  useEffect(() => {
    clipboardModeRef.current = clipboardMode;
    clipboardSync.setEnabled(
      clipboardMode === "browser"
        ? deviceClipboardSyncEnabled
        : nativeClipboardSyncEnabledRef.current,
    );
  }, [clipboardMode, clipboardSync, deviceClipboardSyncEnabled]);

  useEffect(() => {
    const reconcileFallbackFocus = (refocus: boolean) => {
      const terminal = xtermRef.current;
      const mobileInput = mobileInputElementRef.current;
      const clipboardInput = mobileModeRef.current
        ? mobileInput
        : terminal?.textarea;
      const canRefocus =
        refocus &&
        clipboardModeRef.current === "browser" &&
        isActiveRef.current &&
        visibleRef.current &&
        !document.hidden &&
        document.hasFocus() &&
        clipboardInput;
      if (canRefocus) {
        if (mobileModeRef.current) {
          mobileInput?.focus();
        } else {
          terminal?.focus();
        }
        const refocused = document.activeElement === clipboardInput;
        mobileInputFocusedRef.current = mobileModeRef.current && refocused;
        textareaFocusedRef.current = !mobileModeRef.current && refocused;
        clipboardSync.setPresented({ focused: refocused });
      } else {
        textareaFocusedRef.current = false;
        mobileInputFocusedRef.current = false;
        clipboardSync.setPresented({ focused: false });
      }
      syncFocusToServerRef.current?.();
    };
    reconcileClipboardFallbackFocusRef.current = reconcileFallbackFocus;

    const runFallback = () => {
      const pending = pendingClipboardFallbackRef.current;
      if (
        !pending ||
        !clipboardSync.isEligibilityTokenCurrent(pending.token)
      ) {
        pendingClipboardFallbackRef.current = null;
        toast.dismiss(REMOTE_CLIPBOARD_TOAST_ID);
        reconcileFallbackFocus(false);
        return;
      }

      clipboardFallbackActionRunningRef.current = true;
      void pending.retry().catch(() => {
        toast.error("Clipboard permission was denied");
      }).finally(() => {
        const latest = latestRemoteClipboardRef.current;
        const stillLatest =
          latest?.token === pending.token &&
          latest.revision === pending.revision;
        if (pendingClipboardFallbackRef.current === pending) {
          pendingClipboardFallbackRef.current = null;
        }
        if (!stillLatest) {
          clipboardFallbackActionRunningRef.current = false;
          return;
        }
        toast.dismiss(REMOTE_CLIPBOARD_TOAST_ID);

        if (!clipboardSync.isEligibilityTokenCurrent(pending.token)) {
          reconcileFallbackFocus(false);
          clipboardFallbackActionRunningRef.current = false;
          return;
        }

        // Moving focus to the toast action temporarily leaves xterm. Restore
        // terminal focus after the gesture; if that cannot be done, revoke
        // clipboard eligibility explicitly so it cannot remain stuck active.
        reconcileFallbackFocus(true);
        clipboardFallbackActionRunningRef.current = false;
      });
    };
    runClipboardFallbackRef.current = runFallback;
    return () => {
      if (runClipboardFallbackRef.current === runFallback) {
        runClipboardFallbackRef.current = () => {};
      }
      if (
        reconcileClipboardFallbackFocusRef.current === reconcileFallbackFocus
      ) {
        reconcileClipboardFallbackFocusRef.current = () => {};
      }
      clipboardFallbackActionRunningRef.current = false;
      latestRemoteClipboardRef.current = null;
      if (pendingClipboardFallbackRef.current) {
        pendingClipboardFallbackRef.current = null;
        toast.dismiss(REMOTE_CLIPBOARD_TOAST_ID);
      }
    };
  }, [clipboardSync]);

  // Expose focus method to parent components
  useImperativeHandle(ref, () => ({
    focus: () => {
      xtermRef.current?.focus();
    },
    restartAgent: () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "restart_agent" }));
      }
    },
    getWebSocket: () => wsRef.current,
    sendInput: (data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    },
    scrollToBottom: () => {
      xtermRef.current?.scrollToBottom();
    },
    refit: () => {
      forceFocusAssertRef.current?.();
      reconcilerRef.current?.request("refit");
      xtermRef.current?.scrollToBottom();
    },
    setCursorBlink: (blink: boolean) => {
      const term = xtermRef.current;
      if (term) {
        term.options.cursorBlink = blink;
      }
    },
    openSearch: () => {
      setIsSearchOpen(true);
      // The dedicated focus effect (isSearchOpen → focus + select) takes
      // it from here once React commits the state change.
    },
    closeSearch: () => {
      setIsSearchOpen(false);
      setSearchQuery("");
      searchAddonRef.current?.clearDecorations();
    },
    toggleSearch: () => {
      setIsSearchOpen((prev) => {
        const next = !prev;
        if (!next) {
          // Closing — clear query + decorations alongside the toggle.
          setSearchQuery("");
          searchAddonRef.current?.clearDecorations();
        }
        return next;
      });
    },
    setClipboardSync: (enabled: boolean) => {
      nativeClipboardSyncEnabledRef.current = enabled;
      if (clipboardModeRef.current === "native") {
        clipboardSync.setEnabled(enabled);
      }
    },
    syncClipboard: (text: string) => {
      if (clipboardModeRef.current === "native") {
        clipboardSync.writeLocalText(text);
      }
    },
  }), [clipboardSync]);

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      onStatusChangeRef.current?.(status);
    },
    []
  );

  /** Keyboard focus belongs to this terminal only while it is the active
   *  session in a presented panel, and never in mobile mode where the native
   *  shell owns the keyboard. */
  const focusIfPresented = useCallback(() => {
    if (!isActiveRef.current || !visibleRef.current) return;
    if (document.hidden || mobileModeRef.current) return;
    xtermRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let terminal: XTermType;
    let fitAddon: FitAddonType;
    let liveReconciler: ResizeReconciler | null = null;
    let mounted = true;
    isUnmountingRef.current = false;
    intentionalExitRef.current = false;
    if (clientInstanceIdRef.current === null) {
      clientInstanceIdRef.current = crypto.randomUUID();
    }
    const clientInstanceId = clientInstanceIdRef.current;
    const previousSessionIdentity = previousSessionIdentityRef.current;
    const isDifferentSession =
      !previousSessionIdentity ||
      previousSessionIdentity.sessionId !== sessionId ||
      previousSessionIdentity.tmuxSessionName !== tmuxSessionName;
    previousSessionIdentityRef.current = { sessionId, tmuxSessionName };
    // A same-session effect restart is another reopen of this mounted client,
    // while a different session must begin with a genuine focus assertion.
    if (isDifferentSession) {
      hasConnectedBeforeRef.current = false;
      lastDesiredFocusStateRef.current = null;
      pendingGenuineFocusRef.current = false;
      clipboardSync.resetSession();
    }

    const releaseReconciler = (instance: ResizeReconciler | null) => {
      if (!instance) return;
      instance.dispose();
      if (reconcilerRef.current === instance) {
        reconcilerRef.current = null;
        syncFocusToServerRef.current = null;
        forceFocusAssertRef.current = null;
      }
    };

    // Dynamically import xterm modules (browser-only)
    async function initTerminal() {
      const [
        { Terminal: XTerm },
        { FitAddon },
        { WebLinksAddon },
        { ImageAddon },
        { SearchAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-image"),
        import("@xterm/addon-search"),
      ]);

      // Also import CSS
      await import("@xterm/xterm/css/xterm.css");

      if (!mounted || !terminalRef.current) return;

      // Build xterm.js theme from terminal palette
      const theme = terminalThemeRef.current;

      // Convert hex background to RGBA with opacity for glass effect
      const hexToRgba = (hex: string, alpha: number): string => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      const bgOpacity = theme.opacity / 100;
      const background = bgOpacity < 1
        ? hexToRgba(theme.background, bgOpacity)
        : theme.background;

      const xtermTheme = {
        background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        cursorAccent: theme.cursorAccent,
        selectionBackground: theme.selectionBackground,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      };

      // OSC 8, inferred TUI links, and WebLinksAddon all cross the same
      // HTTP(S)-only opener boundary.
      const openTerminalHttpLink = createHttpLinkOpener();

      terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: theme.cursorStyle,
        fontSize: fontSizeRef.current,
        fontFamily: fontFamilyRef.current,
        theme: xtermTheme,
        allowProposedApi: true,
        allowTransparency: true, // Required for opacity/glass effect
        scrollback: scrollbackRef.current,
        // Mobile mode: disable internal textarea so external MobileInputBar handles input
        disableStdin: mobileModeRef.current,
        // Enable Option+click to force selection on macOS (bypasses tmux mouse mode)
        // Shift+click also works by default to bypass mouse mode
        macOptionClickForcesSelection: true,
        // Right-click selects word under cursor (macOS-style behavior)
        rightClickSelectsWord: true,
        linkHandler: {
          allowNonHttpProtocols: false,
          activate: (_event, text) => {
            openTerminalHttpLink(text);
          },
        },
      });

      fitAddon = new FitAddon();
      const terminalLinks = createTerminalLinkController(terminal, {
        open: openTerminalHttpLink,
      });
      const webLinksAddon = new WebLinksAddon(
        (_event, uri) => {
          terminalLinks.activateWebLink(uri);
        },
        {
          // WebLinksAddon passes its ILink's actual 1-based inclusive buffer
          // range here, despite the public option type being named
          // IViewportRange. The controller deliberately consumes those same
          // buffer coordinates when it rechecks the current rows.
          hover: (_event, text, range) => {
            terminalLinks.hoverWebLink(text, range);
          },
          leave: (_event, text) => {
            terminalLinks.leaveWebLink(text);
          },
        },
      );
      const imageAddon = new ImageAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      // xterm gives earlier providers priority and removes overlapping ranges
      // from later providers. Register before WebLinksAddon so its truncated
      // first-row match cannot win over a reconstructed multi-row candidate.
      terminalDisposablesRef.current.push(
        terminal.registerLinkProvider(terminalLinks.linkProvider),
      );
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(imageAddon);
      terminal.loadAddon(searchAddon);

      terminal.open(xtermContainerRef.current ?? terminalRef.current);

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      imageAddonRef.current = imageAddon;
      searchAddonRef.current = searchAddon;

      const reconciler = new ResizeReconciler({
        getContainer: () => terminalRef.current,
        fitVerified: () => {
          const proposal = fitAddon.proposeDimensions();
          if (
            !proposal ||
            proposal.cols < MIN_COLS ||
            proposal.rows < MIN_ROWS
          ) {
            return null;
          }
          fitAddon.fit();
          if (
            terminal.cols !== proposal.cols ||
            terminal.rows !== proposal.rows
          ) {
            return null;
          }
          return { cols: terminal.cols, rows: terminal.rows };
        },
        isPageVisible: () => !document.hidden,
        isPanelVisible: () => visibleRef.current,
        getWebSocket: () => wsRef.current,
        onDimensions: (cols, rows) =>
          onDimensionsChangeRef.current?.(cols, rows),
        raf: (cb) => requestAnimationFrame(cb),
        caf: (id) => cancelAnimationFrame(id),
      });
      liveReconciler = reconciler;
      reconcilerRef.current = reconciler;

      const getDesiredFocus = () =>
        visibleRef.current &&
        !document.hidden &&
        (document.hasFocus() || textareaFocusedRef.current);
      const syncFocusToServer = (force = false, reassert = false) => {
        const socket = wsRef.current;
        const next = getDesiredFocus() ? "focus" : "blur";
        const previousDesired = lastDesiredFocusStateRef.current;
        lastDesiredFocusStateRef.current = next;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          if (next === "blur") {
            pendingGenuineFocusRef.current = false;
          } else if (previousDesired === "blur") {
            pendingGenuineFocusRef.current = true;
          }
          return false;
        }
        if (!force && lastSentFocusStateRef.current === next) return false;
        try {
          const message = next === "focus"
            ? reassert
              ? { type: "client_focus", reassert: true }
              : { type: "client_focus" }
            : { type: "client_blur" };
          socket.send(JSON.stringify(message));
          lastSentFocusStateRef.current = next;
          if (next === "blur") pendingGenuineFocusRef.current = false;
          return true;
        } catch {
          // The desired state remains available for the next socket-open flush.
          return false;
        }
      };
      syncFocusToServerRef.current = syncFocusToServer;
      const forceFocusAssert = () => {
        if (!visibleRef.current || document.hidden) return;
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({ type: "client_focus" }));
          lastSentFocusStateRef.current = "focus";
        } catch {
          // A later derived-state trigger or socket-open flush retries focus.
        }
      };
      forceFocusAssertRef.current = forceFocusAssert;

      // Load WebGL renderer for better performance (falls back to DOM renderer)
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (!mounted || reconcilerRef.current !== reconciler) return;
        let contextLossRecoveryAttempted = false;

        // onRemoveTextureAtlasCanvas only fires inside TextureAtlas._mergePages
        // (when 4+ pages accumulate and get quad-merged). The merge rewrites
        // glyph indices, but WebglRenderer._updateModel's per-cell skip can
        // leave the vertex buffer pointing at stale page indices — visible as
        // wrong/duplicated glyphs during scrolling. Clear the atlas on the
        // next frame to rebind every cell. See xterm.js #5847, #4480, #4534, #4351.
        let atlasRecoveryRaf: number | null = null;
        const scheduleAtlasRecovery = () => {
          if (atlasRecoveryRaf !== null) return;
          atlasRecoveryRaf = requestAnimationFrame(() => {
            atlasRecoveryRaf = null;
            webglAddonRef.current?.clearTextureAtlas();
          });
        };

        const loadWebgl = () => {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            webglAddonRef.current = null;
            // Attempt one fresh addon load so we don't silently fall back to
            // the DOM renderer for the rest of the session.
            if (!contextLossRecoveryAttempted) {
              contextLossRecoveryAttempted = true;
              try {
                loadWebgl();
              } catch {
                // Recovery failed — DOM renderer remains.
              }
            }
          });
          const atlasMergeDisposable = webglAddon.onRemoveTextureAtlasCanvas(scheduleAtlasRecovery);
          terminalDisposablesRef.current.push(atlasMergeDisposable);
          terminal.loadAddon(webglAddon);
          webglAddonRef.current = webglAddon;
        };
        loadWebgl();
        // Push the rAF-cancel after loadWebgl so teardown drains in the right
        // order: listener removed first → no new rAF can be scheduled →
        // cancel any pending one. Without this ordering a context-loss
        // recovery would re-register the listener after the cancel disposable,
        // leaving a window where new rAFs could leak past unmount.
        terminalDisposablesRef.current.push({
          dispose: () => {
            if (atlasRecoveryRaf !== null) cancelAnimationFrame(atlasRecoveryRaf);
          },
        });

        // Stale glyphs from the WebGL texture atlas appear after the tab is
        // backgrounded or the window moves between displays with different DPR.
        // Force-clear the atlas on these events so a single resize isn't required.
        const handleVisibilityChange = () => {
          if (!document.hidden) webglAddonRef.current?.clearTextureAtlas();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        terminalDisposablesRef.current.push({
          dispose: () => document.removeEventListener("visibilitychange", handleVisibilityChange),
        });

        // matchMedia(`(resolution: ${current}dppx)`) only matches the DPR
        // baked into its query string, so once it fires it never matches
        // again. Re-arm against the new DPR after each fire so subsequent
        // display moves keep clearing the atlas.
        let dprMedia: MediaQueryList | null = null;
        let handleDprChange: () => void = () => {};
        const armDprListener = () => {
          dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
          handleDprChange = () => {
            webglAddonRef.current?.clearTextureAtlas();
            reconciler.request("dpr-change");
            dprMedia?.removeEventListener("change", handleDprChange);
            armDprListener();
          };
          dprMedia.addEventListener("change", handleDprChange);
        };
        armDprListener();
        terminalDisposablesRef.current.push({
          dispose: () => dprMedia?.removeEventListener("change", handleDprChange),
        });
      } catch {
        // WebGL not supported — DOM renderer is used automatically
      }
      if (!mounted || reconcilerRef.current !== reconciler) return;

      // Configure the xterm textarea to disable mobile predictive text/autocomplete
      // This helps prevent the duplication issue where mobile keyboards replace
      // the entire input field content when accepting autocomplete suggestions
      // See: https://github.com/xtermjs/xterm.js/issues/2403
      // See: https://github.com/xtermjs/xterm.js/issues/3600
      if (terminal.textarea) {
        const textarea = terminal.textarea;
        // Disable autocomplete, autocorrect, and predictive text for mobile/tablet
        // These attributes are critical for iOS and Android to prevent keyboard
        // from replacing terminal input with autocomplete suggestions
        textarea.setAttribute("autocomplete", "off");
        textarea.setAttribute("autocapitalize", "off");
        textarea.setAttribute("autocorrect", "off");
        textarea.setAttribute("spellcheck", "false");
        // Signal this is a terminal/command entry (helps mobile keyboards behave better)
        textarea.setAttribute("enterkeyhint", "send");
        // Disable Grammarly and other browser extensions that intercept input
        textarea.setAttribute("data-gramm", "false");
        textarea.setAttribute("data-gramm_editor", "false");
        textarea.setAttribute("data-enable-grammarly", "false");
        // Disable form autofill features
        textarea.setAttribute("data-form-type", "other");
        textarea.setAttribute("data-lpignore", "true"); // LastPass ignore
        // Additional mobile hints
        textarea.setAttribute("x-webkit-speech", "false");
      }

      // Track scroll position for mobile scroll-to-bottom indicator.
      // In xterm v6 .xterm-viewport is a vestigial empty div; the real scroll host is
      // .xterm-scrollable-element. Use the public buffer API instead — decoupled from DOM.
      // Alt-screen apps (vim/htop) have no scrollback; the buffer-change listener
      // clears any stale "scrolled up" state when the user enters/exits an alt-screen
      // app, since onScroll won't fire for the buffer switch itself.
      const updateScrollState = () => {
        const buf = terminal.buffer.active;
        const scrolledUp = buf.type === "normal" && buf.viewportY < buf.baseY;
        if (scrolledUp !== isScrolledUpRef.current) {
          isScrolledUpRef.current = scrolledUp;
          onScrollStateChangeRef.current?.(scrolledUp);
        }
      };
      const scrollDisposable = terminal.onScroll(updateScrollState);
      const bufferChangeDisposable = terminal.buffer.onBufferChange(updateScrollState);
      // Some alternate/test renderers implement only the core xterm surface;
      // selection notifications are additive and should not block startup.
      const selectionDisposable =
        typeof terminal.onSelectionChange === "function"
          ? terminal.onSelectionChange(() => {
              if (clipboardModeRef.current === "native") {
                onSelectionChangeRef.current?.(terminal.getSelection());
              }
            })
          : { dispose: () => {} };
      terminalDisposablesRef.current.push(
        scrollDisposable,
        bufferChangeDisposable,
        selectionDisposable,
      );

      // Custom keyboard handler for macOS shortcuts, clipboard, and special key sequences
      // xterm.js doesn't translate Cmd/Option key combinations by default
      // and leaves clipboard handling to embedders
      terminal.attachCustomKeyEventHandler((event) => {
        // Shift+Enter - Must handle BOTH keydown and keypress to prevent double input
        // On keydown: send ESC+CR. On keypress: block to prevent xterm sending \r
        // See: https://kane.mx/posts/2025/vscode-remote-ssh-claude-code-keybindings/
        if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Enter") {
          if (event.type === "keydown") {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input", data: "\x1b\r" })); // ESC + CR
            }
          }
          // Block both keydown and keypress to prevent xterm from also sending \r
          return false;
        }

        if (event.type !== "keydown") return true;

        // Cmd+Enter: Let this bubble up to app-level handler (creates new terminal)
        if (event.metaKey && event.key === "Enter") {
          return false;
        }

        // Cmd+C (Mac) / Ctrl+C (other): Copy selected text to clipboard
        // If text is selected, copy to clipboard and prevent SIGINT from being sent
        // If no selection, allow Ctrl+C through to send SIGINT to the process
        // See: https://github.com/xtermjs/xterm.js/issues/2478
        const isCopyShortcut = event.key === "c" && (event.metaKey || event.ctrlKey);
        if (isCopyShortcut && terminal.hasSelection()) {
          const selectedText = terminal.getSelection();
          clipboardSync.writeLocalText(selectedText);
          // Flutter owns the native clipboard in embedded mode. Never invoke
          // navigator.clipboard from inside its WebView.
          if (clipboardModeRef.current === "browser") {
            navigator.clipboard?.writeText(selectedText).then(() => {
              // Keep selection visible for a moment so user sees what was copied
              // Then clear it after a short delay
              setTimeout(() => {
                terminal.clearSelection();
              }, 150);
            }).catch((err) => {
              console.error("Failed to copy to clipboard:", err);
            });
          }
          return false; // Prevent Ctrl+C from sending SIGINT
        }

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return true;
        }

        // Cmd+key shortcuts (macOS)
        if (event.metaKey && !event.altKey) {
          switch (event.key) {
            case "Backspace": // Delete line (kill line)
              ws.send(JSON.stringify({ type: "input", data: "\x15" })); // Ctrl+U
              return false;
            case "Delete": // Kill to end of line (fn+backspace on Mac)
              ws.send(JSON.stringify({ type: "input", data: "\x0b" })); // Ctrl+K
              return false;
            case "ArrowLeft": // Jump to line start
              ws.send(JSON.stringify({ type: "input", data: "\x01" })); // Ctrl+A
              return false;
            case "ArrowRight": // Jump to line end
              ws.send(JSON.stringify({ type: "input", data: "\x05" })); // Ctrl+E
              return false;
          }
        }

        // Option+key shortcuts (macOS)
        if (event.altKey && !event.metaKey) {
          switch (event.key) {
            case "Backspace": // Delete word backward
              ws.send(JSON.stringify({ type: "input", data: "\x17" })); // Ctrl+W
              return false;
            case "ArrowLeft": // Move word backward
              ws.send(JSON.stringify({ type: "input", data: "\x1bb" })); // ESC+b
              return false;
            case "ArrowRight": // Move word forward
              ws.send(JSON.stringify({ type: "input", data: "\x1bf" })); // ESC+f
              return false;
          }
        }

        return true; // Let xterm handle other key combinations
      });

      // Prevent browser's context menu so tmux's context menu can be used
      const preventContextMenu = (e: Event) => e.preventDefault();
      terminalRef.current.addEventListener("contextmenu", preventContextMenu);

      // Post-init reconciliation: if PreferencesContext resolved during the
      // async init window (xterm/addon imports + WebGL load), the font-update
      // effect would have run with the latest fontSize/fontFamily but bailed
      // because xtermRef.current was still null. The refs are kept in sync
      // by the sync-ref effect, so re-apply them here to catch any drift.
      // This is a no-op when the values match what was passed to `new XTerm`.
      if (terminal.options.fontSize !== fontSizeRef.current) {
        terminal.options.fontSize = fontSizeRef.current;
      }
      if (terminal.options.fontFamily !== fontFamilyRef.current) {
        terminal.options.fontFamily = fontFamilyRef.current;
      }

      async function connect() {
        if (
          wsRef.current?.readyState === WebSocket.OPEN ||
          wsRef.current?.readyState === WebSocket.CONNECTING
        ) {
          return;
        }

        updateStatus("connecting");

        // Fetch auth token from Next.js server
        let token: string;
        try {
          const tokenResponse = await apiFetch(`/api/sessions/${sessionId}/token`);
          if (!tokenResponse.ok) {
            throw new Error("Failed to get auth token");
          }
          const tokenData = await tokenResponse.json();
          token = tokenData.token;
        } catch (error) {
          console.error("Failed to get WebSocket token:", error);
          terminal.writeln("\r\n\x1b[31mError: Failed to authenticate\x1b[0m");
          setAuthError("Your session may have expired. Please refresh the page to re-authenticate.");
          updateStatus("error");
          return;
        }
        if (!mounted || reconcilerRef.current !== reconciler) return;
        if (
          wsRef.current?.readyState === WebSocket.OPEN ||
          wsRef.current?.readyState === WebSocket.CONNECTING
        ) {
          return;
        }

        const cols = terminal.cols;
        const rows = terminal.rows;
        const params = new URLSearchParams({
          token,
          sessionId,
          tmuxSession: tmuxSessionName,
          cols: String(cols),
          rows: String(rows),
          // Include tmux history-limit for new session creation
          tmuxHistoryLimit: String(tmuxHistoryLimitRef.current),
          // Include terminal type for agent exit detection
          terminalType,
          clientInstanceId,
        });
        // Include working directory if specified
        if (projectPath) {
          params.set("cwd", projectPath);
        }
        // Include environment variables if specified (use ref for stable identity)
        const envVars = environmentVarsRef.current;
        if (envVars && Object.keys(envVars).length > 0) {
          params.set("environmentVars", encodeURIComponent(JSON.stringify(envVars)));
        }

        const oldWs = wsRef.current;
        const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
        wsRef.current = ws;
        if (oldWs && oldWs !== ws) {
          try {
            oldWs.close();
          } catch {
            // The replacement remains authoritative even if stale close fails.
          }
        }

        ws.onopen = () => {
          // Guard against race condition: if component unmounted during connection,
          // close the WebSocket immediately and don't call any callbacks with stale references
          if (wsRef.current !== ws) {
            try {
              ws.close();
            } catch {
              // The current socket remains authoritative.
            }
            return;
          }
          if (isUnmountingRef.current) {
            ws.close();
            return;
          }

          updateStatus("connected");
          reconnectAttemptsRef.current = 0;
          lastSentFocusStateRef.current = null;
          setIsPrimary(false);
          clipboardSync.openSocket(ws);
          onWebSocketReadyRef.current?.(ws);
          const pendingGenuineFocus = pendingGenuineFocusRef.current;
          const currentDesiredFocusState = getDesiredFocus() ? "focus" : "blur";
          const flushAsGenuineFocus =
            pendingGenuineFocus ||
            (lastDesiredFocusStateRef.current === "blur" &&
              currentDesiredFocusState === "focus");
          const focusFlushed = syncFocusToServer(
            true,
            hasConnectedBeforeRef.current && !flushAsGenuineFocus,
          );
          if (pendingGenuineFocus && focusFlushed) {
            pendingGenuineFocusRef.current = false;
          }
          reconciler.notifySocketOpen(ws);

          // [remote-dev-d5ci] On a RE-open (not the first connect), dispatch the
          // same sidebar-refresh event useTerminalWebSocket fires so SessionManager
          // re-seeds. A socket that silently dropped while the tab was hidden could
          // have missed running→idle status pushes; the refresh pulls authoritative
          // agentActivityStatus for every session from the DB.
          if (hasConnectedBeforeRef.current) {
            document.dispatchEvent(new CustomEvent("rdv:sidebar-changed"));
          } else {
            hasConnectedBeforeRef.current = true;
          }
        };

        ws.onmessage = (event) => {
          if (!mounted || wsRef.current !== ws) return;
          try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case "output": {
                terminal.write(msg.data);
                // Record activity for notification detection
                recordActivityRef.current?.();
                // Emit output for recording
                onOutputRef.current?.(msg.data);
                break;
              }
              case "ready":
                console.log("Terminal session ready:", msg.sessionId);
                break;
              case "session_created":
                console.log("New tmux session created:", msg.tmuxSessionName);
                break;
              case "session_attached":
                console.log("Attached to existing tmux session:", msg.tmuxSessionName);
                break;
              case "exit":
                terminal.writeln(
                  `\r\n\x1b[33mSession ended (exit code ${msg.code})\x1b[0m`
                );
                // Mark as intentional exit and cancel any pending reconnect
                markIntentionalExit();
                onSessionExitRef.current?.(msg.code);
                break;
              case "agent_exited":
                // Agent process has exited - show exit info in terminal
                terminal.writeln(
                  `\r\n\x1b[33mAgent exited (exit code ${msg.exitCode ?? "unknown"})\x1b[0m`
                );
                // Mark as intentional exit and cancel any pending reconnect
                markIntentionalExit();
                // Update activity status: error if non-zero exit, idle if clean exit
                onAgentActivityStatusRef.current?.(
                  msg.sessionId ?? sessionId,
                  msg.exitCode != null && msg.exitCode !== 0 ? "error" : "idle"
                );
                // Notify parent component to show agent exit screen
                onAgentExitedRef.current?.(msg.exitCode, msg.exitedAt);
                break;
              case "agent_restarted":
                // Agent has been restarted successfully
                terminal.clear();
                // [hgwo] Show resumed-vs-fresh so the user knows whether the
                // conversation was restored.
                terminal.writeln(
                  msg.resumed
                    ? "\x1b[32mAgent resumed (conversation restored)\x1b[0m\r\n"
                    : "\x1b[33mAgent restarted (fresh session)\x1b[0m\r\n"
                );
                // Clear intentional exit flag
                intentionalExitRef.current = false;
                // Reset activity status to running
                onAgentActivityStatusRef.current?.(sessionId, "running");
                // Notify parent component
                onAgentRestartedRef.current?.(Boolean(msg.resumed));
                break;
              case "agent_activity_status":
                // Agent activity status from Claude Code hooks (broadcast — may be for any session)
                // [remote-dev-1aa5d] Thread statusAt for client-side ordering.
                onAgentActivityStatusRef.current?.(msg.sessionId, msg.status, msg.statusAt);
                break;
              case "beads_issues_updated":
                // Beads issues updated — refresh sidebar
                onBeadsIssuesUpdatedRef.current?.(msg.sessionId);
                break;
              case "session_renamed":
                // Agent session auto-titled from .jsonl first user message
                onSessionRenamedRef.current?.(
                  msg.sessionId,
                  msg.name,
                  msg.claudeSessionId,
                  msg.agentSessionId as Record<string, string> | undefined,
                );
                break;
              case "notification":
                // In-app notification broadcast from terminal server
                if (msg.notification) {
                  onNotificationRef.current?.(msg.notification as Record<string, unknown>);
                }
                break;
              case "session_status_update":
                // Per-session custom status indicator from agent hooks
                onSessionStatusRef.current?.(msg.sessionId, msg.key, msg.indicator);
                break;
              case "session_status_cleared":
                // Clear a session status indicator
                onSessionStatusRef.current?.(msg.sessionId, msg.key, null);
                break;
              case "session_progress_update":
                // Per-session progress bar update from agent hooks
                onSessionProgressRef.current?.(msg.sessionId, { value: msg.value, label: msg.label, updatedAt: msg.updatedAt || new Date().toISOString() });
                break;
              case "session_progress_cleared":
                // Clear session progress bar
                onSessionProgressRef.current?.(msg.sessionId, null);
                break;
              case "peer_message_created":
                // Peer message broadcast — forward to chat room context
                if (msg.folderId && msg.message) {
                  onPeerMessageCreatedRef.current?.(msg.folderId as string, msg.message);
                }
                break;
              case "channel_message_created":
                if (msg.folderId && msg.message) {
                  onChannelMessageCreatedRef.current?.(
                    msg.folderId as string,
                    (msg.channelId as string) ?? "",
                    msg.message
                  );
                }
                break;
              case "thread_reply_created":
                if (msg.folderId && msg.message && msg.parentMessageId) {
                  onThreadReplyCreatedRef.current?.(
                    msg.folderId as string,
                    msg.parentMessageId as string,
                    msg.message
                  );
                }
                break;
              case "channel_created":
                if (msg.folderId && msg.channel) {
                  onChannelCreatedRef.current?.(
                    msg.folderId as string,
                    msg.channel as import("@/types/channels").Channel
                  );
                }
                break;
              case "primary_changed": {
                const next = Boolean(msg.isPrimary);
                clipboardSync.setPrimary(next, ws);
                setIsPrimary(next);
                onPrimaryChangeRef.current?.(next);
                if (next) readBrowserClipboardRef.current();
                break;
              }
              case "clipboard_update": {
                void clipboardSync.receive(
                  msg as Extract<ServerMessage, { type: "clipboard_update" }>,
                  ws,
                );
                break;
              }
              case "error":
                terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
                // Check if this is an authentication error
                const authErrorMessages = ["Authentication required", "Invalid or expired token", "Unauthorized"];
                if (authErrorMessages.some(m => msg.message?.includes(m))) {
                  setAuthError(msg.message);
                  updateStatus("error");
                }
                break;
            }
          } catch {
            terminal.write(event.data);
            // Record activity for notification detection (raw data)
            recordActivityRef.current?.();
            // Emit output for recording
            onOutputRef.current?.(event.data);
          }
        };

        ws.onclose = () => {
          clipboardSync.closeSocket(ws);
          if (wsRef.current !== ws) return;
          if (isUnmountingRef.current) {
            return;
          }

          updateStatus("disconnected");
          onWebSocketReadyRef.current?.(null);
          setIsPrimary(false);

          // Don't reconnect if this was an intentional exit (user typed "exit" or Ctrl+D)
          if (intentionalExitRef.current) {
            return;
          }

          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            updateStatus("reconnecting");
            reconnectAttemptsRef.current++;

            terminal.writeln(
              `\r\n\x1b[33mReconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...\x1b[0m`
            );

            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, 3000);
          } else {
            terminal.writeln(
              "\r\n\x1b[31mConnection lost. Refresh to reconnect.\x1b[0m"
            );
            updateStatus("error");
          }
        };

        ws.onerror = () => {
          console.error("WebSocket error");
        };
      }

      // Wait for fonts and container layout before connecting
      // This prevents incorrect initial sizing from various race conditions
      const initAndConnect = async () => {
        // Extract the primary font family name for loading
        const fontMatch = fontFamilyRef.current.match(/^['"]?([^'"]+)/);
        const primaryFont = fontMatch ? fontMatch[1] : fontFamilyRef.current;
        const fs = fontSizeRef.current;

        try {
          // Explicitly load the font we need (both weights)
          await Promise.all([
            document.fonts.load(`${fs}px "${primaryFont}"`),
            document.fonts.load(`bold ${fs}px "${primaryFont}"`),
          ]);
        } catch {
          // Font loading failed, continue with fallback
        }

        // Wait for all fonts to be ready
        await document.fonts.ready;
        if (!mounted || reconcilerRef.current !== reconciler) return;

        // A hidden initial panel connects with xterm's defaults. The explicit
        // reveal signal replays reconciliation once the panel is measurable.
        await reconciler.reconcileOnce("post-init");
        if (!mounted || reconcilerRef.current !== reconciler) return;
        focusIfPresented();
        void connect();
      };

      void initAndConnect();

      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Per-terminal focus signal: window/visibilitychange only fire for
      // coarse browser-level transitions, so they miss clicks between panels
      // or between terminal tabs in the same window. xterm's textarea is what
      // receives keyboard input — its focus state is the true per-terminal
      // signal the server needs to elect a primary client.
      const xtermTextarea = terminal.textarea;
      if (xtermTextarea) {
        const onXtermFocus = () => {
          textareaFocusedRef.current = true;
          if (
            clipboardModeRef.current === "browser" &&
            !mobileModeRef.current
          ) {
            clipboardSync.setPresented({
              focused: !document.hidden && document.hasFocus(),
            });
            readBrowserClipboardRef.current();
          }
          syncFocusToServer();
        };
        const onXtermBlur = (event: FocusEvent) => {
          if (
            clipboardModeRef.current === "browser" &&
            !mobileModeRef.current &&
            isClipboardFallbackActionTarget(event.relatedTarget)
          ) {
            // The fallback button is an explicit clipboard surface. Keep the
            // current eligibility lease alive only for its user gesture; the
            // action reconciles focus back to xterm (or revokes it) in finally.
            clipboardSync.setPresented({ focused: true });
            if (event.relatedTarget instanceof HTMLElement) {
              event.relatedTarget.addEventListener(
                "blur",
                () => {
                  if (!clipboardFallbackActionRunningRef.current) {
                    reconcileClipboardFallbackFocusRef.current(false);
                  }
                },
                { once: true },
              );
            }
            return;
          }
          textareaFocusedRef.current = false;
          if (
            clipboardModeRef.current === "browser" &&
            !mobileModeRef.current
          ) {
            clipboardSync.setPresented({ focused: false });
          }
          syncFocusToServer();
        };
        const onXtermCopy = () => {
          if (
            clipboardModeRef.current !== "browser" ||
            mobileModeRef.current
          ) {
            return;
          }
          queueMicrotask(() => readBrowserClipboardRef.current());
        };
        const onXtermPaste = (event: ClipboardEvent) => {
          if (
            clipboardModeRef.current !== "browser" ||
            mobileModeRef.current
          ) {
            return;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (typeof text === "string" && text.length > 0) {
            clipboardSync.writeLocalText(text);
          } else {
            readBrowserClipboardRef.current();
          }
        };
        xtermTextarea.addEventListener("focus", onXtermFocus);
        xtermTextarea.addEventListener("blur", onXtermBlur);
        xtermTextarea.addEventListener("copy", onXtermCopy);
        xtermTextarea.addEventListener("paste", onXtermPaste);
        terminalDisposablesRef.current.push({
          dispose: () => {
            xtermTextarea.removeEventListener("focus", onXtermFocus);
            xtermTextarea.removeEventListener("blur", onXtermBlur);
            xtermTextarea.removeEventListener("copy", onXtermCopy);
            xtermTextarea.removeEventListener("paste", onXtermPaste);
          },
        });
      }

      const handleVisibilityChange = () => {
        clipboardSync.setPresented({
          pageVisible: !document.hidden,
          focused:
            clipboardModeRef.current === "native"
              ? true
              : !document.hidden &&
                document.hasFocus() &&
                (mobileModeRef.current
                  ? mobileInputFocusedRef.current
                  : textareaFocusedRef.current),
        });
        syncFocusToServer();
        if (!document.hidden) {
          reconciler.request("page-visible");
          focusIfPresented();
          readBrowserClipboardRef.current();
        }
      };

      const handleWindowFocus = () => {
        if (clipboardModeRef.current === "browser") {
          clipboardSync.setPresented({
            focused: mobileModeRef.current
              ? mobileInputFocusedRef.current
              : textareaFocusedRef.current,
          });
          readBrowserClipboardRef.current();
        }
        syncFocusToServer();
        reconciler.request("window-focus");
      };

      const handleWindowBlur = () => {
        if (clipboardModeRef.current === "browser") {
          clipboardSync.setPresented({ focused: false });
        }
        syncFocusToServer();
      };

      const handleWindowResize = () => reconciler.request("window-resize");

      window.addEventListener("resize", handleWindowResize);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleWindowFocus);
      window.addEventListener("blur", handleWindowBlur);

      // Android Chrome on foldables doesn't always emit a `window.resize` when
      // the gesture bar appears post-unfold, but `visualViewport` does fire.
      // Listening here ensures the terminal re-fits whenever the visible area
      // changes, even if the wrapper's layout height is stable.
      const handleVisualViewportResize = () => {
        reconciler.request("visual-viewport");
      };
      const visualViewport =
        typeof window.visualViewport !== "undefined" ? window.visualViewport : null;
      if (visualViewport) {
        visualViewport.addEventListener("resize", handleVisualViewportResize);
      }

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          reconciler.observeRect(width, height);
        }
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      // Store cleanup in closure
      return () => {
        releaseReconciler(reconciler);
        window.removeEventListener("resize", handleWindowResize);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("focus", handleWindowFocus);
        window.removeEventListener("blur", handleWindowBlur);
        if (visualViewport) {
          visualViewport.removeEventListener("resize", handleVisualViewportResize);
        }
        terminalRef.current?.removeEventListener("contextmenu", preventContextMenu);
        resizeObserver.disconnect();
      };
    }

    let cleanup: (() => void) | undefined;

    void initTerminal().then((cleanupFn) => {
      if (!cleanupFn) return;
      if (!mounted) {
        cleanupFn();
        return;
      }
      cleanup = cleanupFn;
    });

    return () => {
      mounted = false;
      isUnmountingRef.current = true;
      cleanup?.();
      releaseReconciler(liveReconciler);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      clipboardSync.closeSocket(wsRef.current ?? undefined);
      wsRef.current?.close();
      for (const d of terminalDisposablesRef.current) d.dispose();
      terminalDisposablesRef.current = [];
      webglAddonRef.current?.dispose();
      imageAddonRef.current?.dispose();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      imageAddonRef.current = null;
      searchAddonRef.current = null;
      webglAddonRef.current = null;
      wsRef.current = null;
      textareaFocusedRef.current = false;
    };
  }, [sessionId, tmuxSessionName, projectPath, wsUrl, updateStatus, terminalType, markIntentionalExit, focusIfPresented, clipboardSync]);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    isActiveRef.current = isActive;
    clipboardSync.setPresented({
      active: isActive,
      visible,
      pageVisible: !document.hidden,
      focused:
        clipboardMode === "native"
          ? true
          : document.hasFocus() &&
            (mobileMode
              ? mobileInputFocusedRef.current
              : textareaFocusedRef.current),
    });
  }, [visible, isActive, clipboardMode, clipboardSync, mobileMode]);

  useEffect(() => {
    syncFocusToServerRef.current?.();
    reconcilerRef.current?.notifyPanelVisibility(visible);
  }, [visible]);

  // Browser clipboard surfaces are exact elements, never document-wide:
  // mobile uses the registered MobileInputBar below; desktop listeners live
  // on xterm's textarea (installed with the terminal above). Search, dialogs,
  // Settings, and unrelated inputs are therefore excluded.
  useEffect(() => {
    const element =
      mobileMode && clipboardMode === "browser" ? mobileInputElement : null;
    mobileInputElementRef.current = element;
    if (!element) {
      if (mobileInputFocusedRef.current) {
        mobileInputFocusedRef.current = false;
        clipboardSync.setPresented({ focused: false });
      }
      return;
    }

    const onFocus = () => {
      mobileInputFocusedRef.current = true;
      clipboardSync.setPresented({
        focused: !document.hidden && document.hasFocus(),
      });
      readBrowserClipboardRef.current();
      syncFocusToServerRef.current?.();
    };
    const onBlur = (event: FocusEvent) => {
      if (isClipboardFallbackActionTarget(event.relatedTarget)) {
        // The toast action is the only non-input surface allowed to retain
        // the current clipboard lease for its user gesture.
        clipboardSync.setPresented({ focused: true });
        if (event.relatedTarget instanceof HTMLElement) {
          event.relatedTarget.addEventListener(
            "blur",
            () => {
              if (!clipboardFallbackActionRunningRef.current) {
                reconcileClipboardFallbackFocusRef.current(false);
              }
            },
            { once: true },
          );
        }
        return;
      }
      mobileInputFocusedRef.current = false;
      clipboardSync.setPresented({ focused: false });
      syncFocusToServerRef.current?.();
    };
    const onCopy = () => {
      queueMicrotask(() => readBrowserClipboardRef.current());
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (typeof text === "string" && text.length > 0) {
        clipboardSync.writeLocalText(text);
      } else {
        readBrowserClipboardRef.current();
      }
    };

    element.addEventListener("focus", onFocus);
    element.addEventListener("blur", onBlur);
    element.addEventListener("copy", onCopy);
    element.addEventListener("paste", onPaste);
    if (document.activeElement === element) onFocus();

    return () => {
      element.removeEventListener("focus", onFocus);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("copy", onCopy);
      element.removeEventListener("paste", onPaste);
      if (mobileInputElementRef.current === element) {
        mobileInputElementRef.current = null;
      }
      if (mobileInputFocusedRef.current) {
        mobileInputFocusedRef.current = false;
        clipboardSync.setPresented({ focused: false });
      }
    };
  }, [clipboardMode, clipboardSync, mobileInputElement, mobileMode]);

  useEffect(() => {
    if (
      clipboardMode !== "browser" ||
      !deviceClipboardSyncEnabled ||
      !isActive ||
      !visible
    ) {
      readBrowserClipboardRef.current = () => {};
      return;
    }
    const browserClipboard = navigator.clipboard;

    const readAndSync = async () => {
      if (
        !clipboardSync.canReadLocalClipboard() ||
        document.hidden ||
        !document.hasFocus()
      ) {
        return;
      }
      await readBrowserClipboard(browserClipboard, (text) => {
        clipboardSync.writeLocalText(text);
      });
    };
    const handleClipboardChange = () => void readAndSync();

    const invokeRead = () => void readAndSync();
    readBrowserClipboardRef.current = invokeRead;
    browserClipboard?.addEventListener?.(
      "clipboardchange",
      handleClipboardChange,
    );
    // Seed the active session when it becomes eligible; this is also the path
    // used when returning from Settings without a window-level focus event.
    void readAndSync();

    return () => {
      if (readBrowserClipboardRef.current === invokeRead) {
        readBrowserClipboardRef.current = () => {};
      }
      browserClipboard?.removeEventListener?.(
        "clipboardchange",
        handleClipboardChange,
      );
    };
  }, [
    clipboardMode,
    clipboardSync,
    deviceClipboardSyncEnabled,
    isActive,
    visible,
  ]);

  // Update terminal options when font preferences change
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Track if this effect has been superseded by a newer one
    let cancelled = false;

    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;

    // Load the font before fitting to ensure accurate cell dimensions
    // The fontFamily value is like "'FiraCode Nerd Font Mono', monospace"
    // Extract the primary font family name for loading
    const fontMatch = fontFamily.match(/^['"]?([^'"]+)/);
    const primaryFont = fontMatch ? fontMatch[1] : fontFamily;

    // Use Font Loading API to ensure font is loaded before fitting
    // This triggers the browser to actually fetch and render the font
    const loadFontAndFit = async () => {
      try {
        // Load both regular and bold weights
        await Promise.all([
          document.fonts.load(`${fontSize}px "${primaryFont}"`),
          document.fonts.load(`bold ${fontSize}px "${primaryFont}"`),
        ]);
      } catch {
        // Font loading failed (e.g., font not found), continue with fallback
      }

      // Wait for all fonts to be ready (including the loaded one)
      await document.fonts.ready;

      // Bail out if this effect was superseded by a newer font change
      if (cancelled) return;
      reconcilerRef.current?.request("font-change");
    };

    loadFontAndFit();

    // Cleanup: cancel pending operations if effect re-runs
    return () => {
      cancelled = true;
    };
  }, [fontSize, fontFamily]);

  // Trigger resize when terminal becomes active (e.g., switching tabs or splits)
  useEffect(() => {
    if (!isActive) return;
    const reconciler = reconcilerRef.current;
    if (!reconciler) return;
    let cancelled = false;
    void reconciler.reconcileOnce("active").then(() => {
      if (!cancelled) focusIfPresented();
    });

    return () => {
      cancelled = true;
    };
  }, [isActive, visible, focusIfPresented]);

  // Update terminal theme when appearance changes
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Convert hex background to RGBA with opacity for glass effect
    const hexToRgba = (hex: string, alpha: number): string => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const bgOpacity = terminalTheme.opacity / 100;
    const background = bgOpacity < 1
      ? hexToRgba(terminalTheme.background, bgOpacity)
      : terminalTheme.background;

    // Build xterm.js theme from terminal palette
    const xtermTheme = {
      background,
      foreground: terminalTheme.foreground,
      cursor: terminalTheme.cursor,
      cursorAccent: terminalTheme.cursorAccent,
      selectionBackground: terminalTheme.selectionBackground,
      black: terminalTheme.black,
      red: terminalTheme.red,
      green: terminalTheme.green,
      yellow: terminalTheme.yellow,
      blue: terminalTheme.blue,
      magenta: terminalTheme.magenta,
      cyan: terminalTheme.cyan,
      white: terminalTheme.white,
      brightBlack: terminalTheme.brightBlack,
      brightRed: terminalTheme.brightRed,
      brightGreen: terminalTheme.brightGreen,
      brightYellow: terminalTheme.brightYellow,
      brightBlue: terminalTheme.brightBlue,
      brightMagenta: terminalTheme.brightMagenta,
      brightCyan: terminalTheme.brightCyan,
      brightWhite: terminalTheme.brightWhite,
    };

    // Apply theme and cursor style
    terminal.options.theme = xtermTheme;
    terminal.options.cursorStyle = terminalTheme.cursorStyle;
  }, [terminalTheme]);

  // Search functions
  const findNext = useCallback(() => {
    if (!searchAddonRef.current || !searchQuery) return;
    searchAddonRef.current.findNext(searchQuery, { caseSensitive: false });
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    if (!searchAddonRef.current || !searchQuery) return;
    searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false });
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    searchAddonRef.current?.clearDecorations();
    xtermRef.current?.focus();
  }, []);

  // Handle search input changes
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query && searchAddonRef.current) {
      searchAddonRef.current.findNext(query, { caseSensitive: false });
    } else {
      searchAddonRef.current?.clearDecorations();
    }
  }, []);

  // Handle search keyboard shortcuts
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }, [findNext, findPrevious, closeSearch]);

  // Global keyboard shortcut for opening search (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
        // Focus input after state update
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };

    const container = terminalRef.current;
    if (container) {
      container.addEventListener("keydown", handleKeyDown);
      return () => container.removeEventListener("keydown", handleKeyDown);
    }
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isSearchOpen]);

  const handleSendImage = useCallback(
    async (file: File) => {
      try {
        await sendImageToTerminal(file, wsRef.current);
      } catch (error) {
        console.error("Failed to upload image:", error);
      }
    },
    []
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // First try dataTransfer.files (works for Finder files, macOS screenshot thumbnails)
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));

      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          await handleSendImage(file);
        }
        return;
      }

      // Fallback: check dataTransfer.items for images dragged from browsers/other apps
      // These may not appear in files but can be retrieved as blobs via getAsFile()
      const items = Array.from(e.dataTransfer.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          await handleSendImage(file);
        }
      }
    },
    [handleSendImage]
  );

  // Handle paste events for images and text
  // Note: We use a native event listener in the capture phase because xterm.js
  // creates its own internal textarea that captures paste events. React's onPaste
  // on the container div never fires because the event goes to xterm's element.
  // This handles both Cmd+V and right-click paste for images and text.
  useEffect(() => {
    const container = terminalRef.current;
    const terminal = xtermRef.current;
    if (!container) return;

    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      // Handle image paste - upload image and send file path to terminal
      // This allows Claude Code and similar tools to receive image paths
      if (imageItems.length > 0) {
        e.preventDefault();
        e.stopPropagation();

        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) {
            await handleSendImage(file);
          }
        }
        return;
      }

      // Handle text paste - use terminal.paste() for reliable cross-platform support
      // xterm.js leaves clipboard handling to embedders, so we handle it explicitly
      // See: https://github.com/xtermjs/xterm.js/issues/2478
      const textItems = items.filter((item) => item.type === "text/plain");
      if (textItems.length > 0 && terminal) {
        const textItem = textItems[0];
        const text = await new Promise<string>((resolve) => {
          textItem.getAsString(resolve);
        });
        if (text) {
          e.preventDefault();
          e.stopPropagation();
          terminal.paste(text);
        }
      }
    };

    // Use capture phase to intercept before xterm.js processes the paste
    container.addEventListener("paste", handlePaste, { capture: true });

    return () => {
      container.removeEventListener("paste", handlePaste, { capture: true });
    };
  }, [handleSendImage]);

  // Mobile touch scrolling support — algorithm lives in ./touch-scroll.ts so the
  // unit test runs the same code path as production.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Shared mode object: lets the scroll handler bail when the interactions
    // handler is mid-selection, and lets the interactions handler keep its
    // mode visible to the scroll handler. One object, two readers.
    const modeRef = createTouchModeRef();

    const handlers = createTouchScrollHandlers({
      container,
      getXterm: () => xtermRef.current,
      sendInput: (data: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      },
      modeRef,
    });

    // Tap-to-click + long-press-to-select. Composed alongside the scroll
    // handler. The interactions handler's touchmove uses passive: false so
    // it can preventDefault during selection — a belt-and-suspenders pair
    // with the modeRef check on the scroll side.
    const interactions = createTouchInteractions({
      getTerminal: () => xtermRef.current,
      modeRef,
    });

    container.addEventListener("touchstart", handlers.handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handlers.handleTouchMove, { passive: false });
    container.addEventListener("touchend", handlers.handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handlers.handleTouchCancel, { passive: true });

    container.addEventListener("touchstart", interactions.handleTouchStart, { passive: true });
    container.addEventListener("touchmove", interactions.handleTouchMove, { passive: false });
    container.addEventListener("touchend", interactions.handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", interactions.handleTouchCancel, { passive: true });

    return () => {
      handlers.cancelMomentum();
      // Cancel any pending long-press timer so it can't fire on a disposed
      // xterm. Without this, a user who long-presses then closes the tab
      // within 500 ms hits `terminal.select()` on a torn-down instance.
      interactions.destroy();
      container.removeEventListener("touchstart", handlers.handleTouchStart);
      container.removeEventListener("touchmove", handlers.handleTouchMove);
      container.removeEventListener("touchend", handlers.handleTouchEnd);
      container.removeEventListener("touchcancel", handlers.handleTouchCancel);

      container.removeEventListener("touchstart", interactions.handleTouchStart);
      container.removeEventListener("touchmove", interactions.handleTouchMove);
      container.removeEventListener("touchend", interactions.handleTouchEnd);
      container.removeEventListener("touchcancel", interactions.handleTouchCancel);
    };
  }, []);

  // Focus terminal on left-click/touch to ensure it maintains focus
  // This fixes the issue where selecting text would quickly lose focus, preventing copy
  // Also ensures mobile keyboard appears when tapping the terminal
  // Note: Only trigger on left-click (button 0) to avoid interfering with
  // right-click context menus (e.g., tmux popup menu)
  const handleContainerInteraction = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // For mouse events, only focus on left-click (button 0)
    // Right-click (button 2) should not trigger focus to allow tmux menu to work
    if ("button" in e && e.button !== 0) {
      return;
    }
    // In mobile mode, don't steal focus from the external MobileInputBar
    if (mobileModeRef.current) return;
    xtermRef.current?.focus();
  }, []);

  // Compute glass effect styles from terminal theme
  // Note: We only apply backdropFilter here. Background opacity is applied
  // via the terminal theme's background color with alpha channel.
  const glassStyles = useMemo(() => {
    const blur = terminalTheme.blur;
    return {
      backdropFilter: blur > 0 ? `blur(${blur}px)` : undefined,
      WebkitBackdropFilter: blur > 0 ? `blur(${blur}px)` : undefined, // Safari
    } as React.CSSProperties;
  }, [terminalTheme.blur]);

  return (
    <div
      ref={terminalRef}
      className={`h-full w-full rounded-lg overflow-hidden relative ${
        isDragging ? "ring-2 ring-blue-500 ring-opacity-50" : ""
      }`}
      style={glassStyles}
      onMouseDown={handleContainerInteraction}
      onTouchStart={handleContainerInteraction}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* xterm.js mounts here — separate from overlay elements */}
      <div ref={xtermContainerRef} className="absolute inset-0" />

      {/* Recording indicator */}
      {isRecording && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 bg-red-500/90 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-lg animate-pulse">
          <Circle className="w-2 h-2 fill-white text-white" />
          <span className="text-xs font-medium text-white">REC</span>
        </div>
      )}


      {/* Search overlay - Activity preserves search state when hidden.
          Button sizing uses min-w-11/min-h-11 (44px iOS HIG tap target)
          on viewports without hover (mobile), and the original compact
          desktop sizing where hover is supported. */}
      <Activity mode={isSearchOpen ? "visible" : "hidden"}>
        <div
          data-testid="terminal-search-overlay"
          className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-popover/95 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5 shadow-lg"
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            aria-label="Search terminal output"
            className="w-40 sm:w-48 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={findPrevious}
              disabled={!searchQuery}
              aria-label="Previous match"
              data-testid="terminal-search-prev"
              className="inline-flex items-center justify-center rounded min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 sm:p-1 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous (Shift+Enter)"
            >
              <ChevronUp className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              onClick={findNext}
              disabled={!searchQuery}
              aria-label="Next match"
              data-testid="terminal-search-next"
              className="inline-flex items-center justify-center rounded min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 sm:p-1 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next (Enter)"
            >
              <ChevronDown className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              onClick={closeSearch}
              aria-label="Close search"
              data-testid="terminal-search-close"
              className="inline-flex items-center justify-center rounded min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 sm:p-1 hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Close (Esc)"
            >
              <X className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>
      </Activity>

      {isDragging && (
        <div className="absolute inset-0 bg-[var(--color-signal-attention-solid)]/10 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-background/90 px-4 py-2 rounded-lg border border-[var(--color-signal-attention-solid)]/40 text-sm">
            Drop image to paste
          </div>
        </div>
      )}

      {/* Non-primary indicator: another window/tab currently controls tmux sizing */}
      {!isPrimary && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-2 left-1/2 z-20 -translate-x-1/2"
        >
          <button
            type="button"
            onClick={() => {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "client_focus", force: true }));
              }
            }}
            aria-label="Claim primary control of this terminal session"
            title="Click to take over tmux sizing for this session"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-medium text-white/85 shadow-lg backdrop-blur-sm hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            Another window is in control · click to claim
          </button>
        </div>
      )}

      {/* Auth error overlay */}
      {authError && <AuthErrorOverlay message={authError} />}
    </div>
  );
});
