"use client";

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo, Activity } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { ImageAddon as ImageAddonType } from "@xterm/addon-image";
import type { SearchAddon as SearchAddonType } from "@xterm/addon-search";
import type { WebglAddon as WebglAddonType } from "@xterm/addon-webgl";
import type { ConnectionStatus } from "@/types/terminal";
import { Search, X, ChevronUp, ChevronDown, Circle } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { useTerminalTheme } from "@/contexts/AppearanceContext";
import { sendImageToTerminal } from "@/lib/image-upload";
import { AuthErrorOverlay } from "./AuthErrorOverlay";

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
}

interface TerminalProps {
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
  /** Environment variables to inject into new terminal sessions */
  environmentVars?: Record<string, string> | null;
  /** Terminal type for agent exit detection */
  terminalType?: "shell" | "agent" | "file" | string;
  /** When true, disables xterm.js internal textarea so external input can be used */
  mobileMode?: boolean;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  /** Called when an agent session exits (only for terminalType='agent') */
  onAgentExited?: (exitCode: number | null, exitedAt: string) => void;
  /** Called when an agent session restarts successfully */
  onAgentRestarted?: () => void;
  /** Called when agent activity status changes (from Claude Code hooks).
   *  Includes sessionId so broadcast messages correctly target the right session. */
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  /** Called when agent TodoWrite tasks are synced (from PostToolUse hooks) */
  onAgentTodosUpdated?: (sessionId: string) => void;
  /** Called when an agent session is auto-titled from its .jsonl file */
  onSessionRenamed?: (sessionId: string, name: string, claudeSessionId?: string) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
  /** Called when a session status indicator is set or cleared */
  onSessionStatus?: (sessionId: string, key: string, indicator: import("@/types/terminal-type").SessionStatusIndicator | null) => void;
  /** Called when session progress is updated or cleared */
  onSessionProgress?: (sessionId: string, progress: import("@/types/terminal-type").SessionProgress | null) => void;
  /** Called when a peer message is created (broadcast from terminal server) */
  onPeerMessageCreated?: (folderId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  /** Called when terminal scroll position changes between scrolled-up and at-bottom */
  onScrollStateChange?: (isScrolledUp: boolean) => void;
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
  environmentVars,
  terminalType = "shell",
  mobileMode = false,
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
  onAgentExited,
  onAgentRestarted,
  onAgentActivityStatus,
  onAgentTodosUpdated,
  onSessionRenamed,
  onNotification,
  onSessionStatus,
  onSessionProgress,
  onPeerMessageCreated,
  onOutput,
  onDimensionsChange,
  onScrollStateChange,
}, ref) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermType | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const imageAddonRef = useRef<ImageAddonType | null>(null);
  const searchAddonRef = useRef<SearchAddonType | null>(null);
  const webglAddonRef = useRef<WebglAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const isScrolledUpRef = useRef(false);
  const isUnmountingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalExitRef = useRef(false);
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
  const onAgentTodosUpdatedRef = useRef(onAgentTodosUpdated);
  const onSessionRenamedRef = useRef(onSessionRenamed);
  const onNotificationRef = useRef(onNotification);
  const onSessionStatusRef = useRef(onSessionStatus);
  const onSessionProgressRef = useRef(onSessionProgress);
  const onPeerMessageCreatedRef = useRef(onPeerMessageCreated);
  const onOutputRef = useRef(onOutput);
  const onDimensionsChangeRef = useRef(onDimensionsChange);
  const onScrollStateChangeRef = useRef(onScrollStateChange);
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
    onAgentTodosUpdatedRef.current = onAgentTodosUpdated;
    onSessionRenamedRef.current = onSessionRenamed;
    onNotificationRef.current = onNotification;
    onSessionStatusRef.current = onSessionStatus;
    onSessionProgressRef.current = onSessionProgress;
    onPeerMessageCreatedRef.current = onPeerMessageCreated;
    onOutputRef.current = onOutput;
    onDimensionsChangeRef.current = onDimensionsChange;
    onScrollStateChangeRef.current = onScrollStateChange;
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
  }, [onStatusChange, onWebSocketReady, onSessionExit, onAgentExited, onAgentRestarted, onAgentActivityStatus, onAgentTodosUpdated, onSessionRenamed, onNotification, onSessionStatus, onSessionProgress, onPeerMessageCreated, onOutput, onDimensionsChange, onScrollStateChange, recordActivity, fontSize, fontFamily, scrollback, tmuxHistoryLimit, mobileMode, environmentVars, terminalTheme]);

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
  }), []);

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      onStatusChangeRef.current?.(status);
    },
    []
  );

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let terminal: XTermType;
    let fitAddon: FitAddonType;
    let mounted = true;
    isUnmountingRef.current = false;
    intentionalExitRef.current = false;

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
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const imageAddon = new ImageAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(imageAddon);
      terminal.loadAddon(searchAddon);

      terminal.open(xtermContainerRef.current ?? terminalRef.current);

      // Load WebGL renderer for better performance (falls back to DOM renderer)
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          webglAddonRef.current = null;
        });
        terminal.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch {
        // WebGL not supported — DOM renderer is used automatically
      }

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

      // Track scroll position for mobile scroll-to-bottom indicator
      terminal.onScroll(() => {
        const viewport = xtermContainerRef.current?.querySelector('.xterm-viewport') as HTMLElement | null;
        if (!viewport) return;
        const isAtBottom = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 10;
        const scrolledUp = !isAtBottom;
        if (scrolledUp !== isScrolledUpRef.current) {
          isScrolledUpRef.current = scrolledUp;
          onScrollStateChangeRef.current?.(scrolledUp);
        }
      });

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
          navigator.clipboard.writeText(selectedText).then(() => {
            // Keep selection visible for a moment so user sees what was copied
            // Then clear it after a short delay
            setTimeout(() => {
              terminal.clearSelection();
            }, 150);
          }).catch((err) => {
            console.error("Failed to copy to clipboard:", err);
          });
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

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      imageAddonRef.current = imageAddon;
      searchAddonRef.current = searchAddon;

      async function connect() {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        updateStatus("connecting");

        // Fetch auth token from Next.js server
        let token: string;
        try {
          const tokenResponse = await fetch(`/api/sessions/${sessionId}/token`);
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

        const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
        wsRef.current = ws;

        ws.onopen = () => {
          // Guard against race condition: if component unmounted during connection,
          // close the WebSocket immediately and don't call any callbacks with stale references
          if (isUnmountingRef.current) {
            ws.close();
            return;
          }

          updateStatus("connected");
          reconnectAttemptsRef.current = 0;
          onWebSocketReadyRef.current?.(ws);

          // Send resize immediately after connection to sync dimensions
          // The URL params may be stale if container resized during connection
          requestAnimationFrame(() => {
            fitAddon.fit();
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              })
            );
          });
        };

        ws.onmessage = (event) => {
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
                terminal.writeln("\x1b[32mAgent restarted\x1b[0m\r\n");
                // Clear intentional exit flag
                intentionalExitRef.current = false;
                // Reset activity status to running
                onAgentActivityStatusRef.current?.(sessionId, "running");
                // Notify parent component
                onAgentRestartedRef.current?.();
                break;
              case "agent_activity_status":
                // Agent activity status from Claude Code hooks (broadcast — may be for any session)
                onAgentActivityStatusRef.current?.(msg.sessionId, msg.status);
                break;
              case "agent_todos_updated":
                // Agent TodoWrite tasks synced — refresh task list
                onAgentTodosUpdatedRef.current?.(msg.sessionId);
                break;
              case "session_renamed":
                // Agent session auto-titled from .jsonl first user message
                onSessionRenamedRef.current?.(msg.sessionId, msg.name, msg.claudeSessionId);
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
              case "voice_ready":
                console.log(`[Voice] Ready for session ${msg.sessionId}`);
                break;
              case "voice_error":
                console.error(`[Voice] Error: ${msg.message}`);
                break;
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
          if (isUnmountingRef.current) {
            return;
          }

          updateStatus("disconnected");
          onWebSocketReadyRef.current?.(null);

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

        // Wait for container dimensions to stabilize
        // On hard refresh, the layout may take multiple frames to settle
        const MIN_CONTAINER_WIDTH = 100;
        const MIN_CONTAINER_HEIGHT = 80;
        const MAX_WAIT_ATTEMPTS = 30; // ~500ms max wait
        const STABLE_FRAMES_REQUIRED = 3; // Dimensions must be stable for 3 frames

        let lastWidth = 0;
        let lastHeight = 0;
        let stableFrames = 0;

        for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

          const container = terminalRef.current;
          if (!container) continue;

          const rect = container.getBoundingClientRect();

          // Check if dimensions are valid and stable
          if (rect.width >= MIN_CONTAINER_WIDTH && rect.height >= MIN_CONTAINER_HEIGHT) {
            if (rect.width === lastWidth && rect.height === lastHeight) {
              stableFrames++;
              if (stableFrames >= STABLE_FRAMES_REQUIRED) {
                break; // Container dimensions are stable
              }
            } else {
              // Dimensions changed, reset stability counter
              stableFrames = 0;
              lastWidth = rect.width;
              lastHeight = rect.height;
            }
          }
        }

        // Now fit with accurate measurements
        fitAddon.fit();

        // Connect with correct dimensions
        connect();
      };

      initAndConnect();

      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Minimum dimensions to prevent resizing to unusable sizes
      const MIN_WIDTH = 100;
      const MIN_HEIGHT = 80;

      const handleResize = () => {
        const container = terminalRef.current;
        if (!container) return;

        // Skip resize if page is hidden (browser tab backgrounded)
        if (document.hidden) return;

        // Skip if container is not visible (display: none from "hidden" class)
        // offsetParent is null when element or ancestor has display: none
        if (container.offsetParent === null) return;

        // Skip if container is too small
        const rect = container.getBoundingClientRect();
        if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;

        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          fitAddon.fit();

          // Don't send resize events for invalid dimensions
          // This prevents resizing tmux when terminal is hidden or minimized
          const MIN_COLS = 10;
          const MIN_ROWS = 3;
          if (terminal.cols < MIN_COLS || terminal.rows < MIN_ROWS) {
            return;
          }

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              })
            );
          }
          // Emit dimensions for recording
          onDimensionsChangeRef.current?.(terminal.cols, terminal.rows);
        });
      };

      // Re-fit when page becomes visible again (returning from background)
      let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          // Clear any pending timeout to avoid duplicate calls
          if (visibilityTimeout) {
            clearTimeout(visibilityTimeout);
          }
          // Small delay to let the browser settle after becoming visible
          visibilityTimeout = setTimeout(() => {
            visibilityTimeout = null;
            handleResize();
            // Focus terminal when page becomes visible
            terminal.focus();
          }, 100);
        }
      };

      window.addEventListener("resize", handleResize);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      // Use ResizeObserver to detect when terminal container becomes visible
      // This handles the case when switching tabs (hidden -> visible)
      let lastWidth = 0;
      let lastHeight = 0;
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          // Only trigger resize when dimensions are above minimum threshold
          // and actually change to new values
          if (
            width >= MIN_WIDTH &&
            height >= MIN_HEIGHT &&
            (width !== lastWidth || height !== lastHeight)
          ) {
            lastWidth = width;
            lastHeight = height;

            // Debounce rapid resize events (e.g., during window drag)
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 16); // ~60fps
          }
        }
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      // Store cleanup in closure
      return () => {
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
        }
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        terminalRef.current?.removeEventListener("contextmenu", preventContextMenu);
        resizeObserver.disconnect();
        if (resizeTimeout) clearTimeout(resizeTimeout);
      };
    }

    let cleanup: (() => void) | undefined;

    initTerminal().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    return () => {
      mounted = false;
      isUnmountingRef.current = true;
      cleanup?.();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      webglAddonRef.current?.dispose();
      imageAddonRef.current?.dispose();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      imageAddonRef.current = null;
      searchAddonRef.current = null;
      webglAddonRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, tmuxSessionName, projectPath, wsUrl, updateStatus, terminalType, markIntentionalExit]);

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

      // Apply the same safety checks as handleResize() to prevent
      // resizing to invalid dimensions when terminal is hidden/backgrounded
      const container = terminalRef.current;
      if (!container) return;

      // Skip if page is hidden (browser tab backgrounded)
      if (document.hidden) return;

      // Skip if container is not visible (display: none)
      if (container.offsetParent === null) return;

      // Skip if container is too small
      const MIN_WIDTH = 100;
      const MIN_HEIGHT = 80;
      const rect = container.getBoundingClientRect();
      if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (cancelled) return;

        fitAddonRef.current?.fit();

        // Don't send resize for invalid dimensions
        const MIN_COLS = 10;
        const MIN_ROWS = 3;
        if (terminal.cols < MIN_COLS || terminal.rows < MIN_ROWS) return;

        // Send resize to server if connected
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
      });
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

    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    const ws = wsRef.current;

    if (!terminal || !fitAddon) return;

    // Small delay to ensure container has finished layout
    const timeoutId = setTimeout(() => {
      fitAddon.fit();

      // Send resize to sync tmux dimensions
      if (ws?.readyState === WebSocket.OPEN && terminal.cols > 0 && terminal.rows > 0) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          })
        );
      }

      // Focus the terminal
      terminal.focus();
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [isActive]);

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

  // Mobile touch scrolling support
  // xterm.js v6 uses a VS Code ScrollableElement internally to manage viewport scroll.
  // Direct .xterm-viewport.scrollTop manipulation is NOT detected by this widget and
  // gets overwritten on the next sync cycle. We must use terminal.scrollLines() which
  // properly updates the buffer position and triggers the viewport sync.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const SCROLL_ACTIVATION_PX = 5;
    const MOMENTUM_START_THRESHOLD = 1.5;
    const MOMENTUM_STOP_THRESHOLD = 0.3;
    const MOMENTUM_DECAY = 0.95; // Feels closer to iOS native momentum
    const MAX_VELOCITY_SAMPLES = 5;

    let touchStartY = 0;
    let lastTouchY = 0;
    let lastTouchTime = 0;
    let velocityY = 0;
    let isScrolling = false;
    let momentumAnimationId: number | null = null;
    let accumulatedDelta = 0;

    const velocitySamples: number[] = [];

    const computeCellHeight = (): number => {
      const terminal = xtermRef.current;
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null;
      if (terminal && terminal.rows > 0 && viewport && viewport.clientHeight > 0) {
        return viewport.clientHeight / terminal.rows;
      }
      return fontSizeRef.current * 1.2;
    };

    /** Consume accumulatedDelta and scroll the terminal by whole lines. */
    const flushScrollLines = (): void => {
      const h = computeCellHeight();
      if (h <= 0) return;
      const linesToScroll = Math.trunc(accumulatedDelta / h);
      if (linesToScroll !== 0) {
        xtermRef.current?.scrollLines(linesToScroll);
        accumulatedDelta -= linesToScroll * h;
      }
    };

    const cancelMomentum = (): void => {
      if (momentumAnimationId) {
        cancelAnimationFrame(momentumAnimationId);
        momentumAnimationId = null;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      cancelMomentum();

      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        lastTouchY = touchStartY;
        lastTouchTime = performance.now();
        velocityY = 0;
        velocitySamples.length = 0;
        accumulatedDelta = 0;
        isScrolling = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        isScrolling = false;
        return;
      }

      const currentY = e.touches[0].clientY;
      const deltaY = lastTouchY - currentY; // positive = finger moved up
      const now = performance.now();
      const timeDelta = now - lastTouchTime;

      // Track velocity with rolling average
      if (timeDelta > 0) {
        const instantVelocity = (deltaY / timeDelta) * 16; // Normalize to ~60fps frame
        velocitySamples.push(instantVelocity);
        if (velocitySamples.length > MAX_VELOCITY_SAMPLES) {
          velocitySamples.shift();
        }
        velocityY = velocitySamples.reduce((a, b) => a + b, 0) / velocitySamples.length;
      }

      if (!isScrolling && Math.abs(currentY - touchStartY) > SCROLL_ACTIVATION_PX) {
        isScrolling = true;
      }

      // Always update position/time so velocity samples are per-frame, not cumulative
      lastTouchY = currentY;
      lastTouchTime = now;

      if (isScrolling) {
        e.preventDefault();
        accumulatedDelta += deltaY;
        flushScrollLines();
      }
    };

    const handleTouchEnd = () => {
      if (!isScrolling) return;
      isScrolling = false;

      if (!xtermRef.current) return;

      const applyMomentum = () => {
        if (Math.abs(velocityY) < MOMENTUM_STOP_THRESHOLD) {
          momentumAnimationId = null;
          return;
        }

        accumulatedDelta += velocityY;
        flushScrollLines();

        velocityY *= MOMENTUM_DECAY;
        momentumAnimationId = requestAnimationFrame(applyMomentum);
      };

      if (Math.abs(velocityY) > MOMENTUM_START_THRESHOLD) {
        momentumAnimationId = requestAnimationFrame(applyMomentum);
      }
    };

    // Reset all scroll state (used by touchcancel when iOS interrupts a gesture)
    const handleTouchCancel = () => {
      cancelMomentum();
      isScrolling = false;
      velocityY = 0;
      accumulatedDelta = 0;
    };

    // Register on container — fires before xterm's document-level handlers
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      cancelMomentum();
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
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


      {/* Search overlay - Activity preserves search state when hidden */}
      <Activity mode={isSearchOpen ? "visible" : "hidden"}>
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-popover/95 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5 shadow-lg">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            className="w-48 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={findPrevious}
              disabled={!searchQuery}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous (Shift+Enter)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={findNext}
              disabled={!searchQuery}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next (Enter)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closeSearch}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Activity>

      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-background/90 px-4 py-2 rounded-lg border border-blue-500/50 text-sm">
            Drop image to paste
          </div>
        </div>
      )}

      {/* Auth error overlay */}
      {authError && <AuthErrorOverlay message={authError} />}
    </div>
  );
});
