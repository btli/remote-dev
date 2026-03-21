"use client";

import { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import AnsiToHtml from "ansi-to-html";
import { MobileInputBar } from "./MobileInputBar";
import { MobileKeyboard } from "./MobileKeyboard";
import { VoiceMicButton } from "./VoiceMicButton";
import { AgentExitScreen } from "./AgentExitScreen";
import { AuthErrorOverlay } from "./AuthErrorOverlay";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { useTerminalTheme } from "@/contexts/AppearanceContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { sendImageToTerminal } from "@/lib/image-upload";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { ConnectionStatus } from "@/types/terminal";
import type { SessionStatusIndicator, SessionProgress } from "@/types/terminal-type";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MobileTerminalViewRef {
  focus: () => void;
}

interface MobileTerminalViewProps {
  sessionId: string;
  tmuxSessionName: string;
  sessionName?: string;
  projectPath?: string | null;
  session?: TerminalSession;
  wsUrl?: string;
  tmuxHistoryLimit?: number;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  environmentVars?: Record<string, string> | null;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void>;
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  onAgentTodosUpdated?: (sessionId: string) => void;
  onNotification?: (notification: Record<string, unknown>) => void;
  onSessionStatus?: (sessionId: string, key: string, indicator: SessionStatusIndicator | null) => void;
  onSessionProgress?: (sessionId: string, progress: SessionProgress | null) => void;
}

// ─── Types & Constants ──────────────────────────────────────────────────────────

interface OutputEntry {
  id: number;
  html: string;
}

const MAX_OUTPUT_ENTRIES = 2000;
const MOBILE_COLS = 120;
const MOBILE_ROWS = 24;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Build the 16-color ANSI palette from theme values. */
function getAnsiColors(theme: ReturnType<typeof useTerminalTheme>): string[] {
  return [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
}

/** Create an AnsiToHtml converter in stream mode with the given theme. */
function createAnsiConverter(theme: ReturnType<typeof useTerminalTheme>): AnsiToHtml {
  return new AnsiToHtml({
    fg: theme.foreground,
    bg: "transparent",
    colors: getAnsiColors(theme),
    escapeXML: true,
    stream: true,
  });
}

/** Map connection status to a badge CSS class. */
function getStatusColor(status: ConnectionStatus): string {
  switch (status) {
    case "connected": return "bg-green-500";
    case "connecting":
    case "reconnecting": return "bg-yellow-500 animate-pulse";
    case "error": return "bg-red-500";
    default: return "bg-muted-foreground/50";
  }
}

/** Map connection status to a human-readable label. */
function getStatusLabel(status: ConnectionStatus, sessionName?: string): string {
  switch (status) {
    case "connected": return sessionName || "Terminal";
    case "connecting": return "Connecting...";
    case "reconnecting": return "Reconnecting...";
    case "error": return "Connection error";
    default: return "Disconnected";
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const MobileTerminalView = forwardRef<MobileTerminalViewRef, MobileTerminalViewProps>(
  function MobileTerminalView(
    {
      sessionId,
      tmuxSessionName,
      sessionName,
      projectPath,
      session,
      wsUrl = "ws://localhost:3001",
      tmuxHistoryLimit = 50000,
      notificationsEnabled = true,
      isRecording = false,
      environmentVars,
      onStatusChange,
      onWebSocketReady,
      onSessionExit,
      onOutput,
      onSessionDelete,
      onAgentActivityStatus,
      onAgentTodosUpdated,
      onNotification,
      onSessionStatus,
      onSessionProgress,
    },
    ref
  ) {
    // ── Refs ──────────────────────────────────────────────────────────────────
    const scrollRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const inputBarRef = useRef<HTMLTextAreaElement>(null);
    const converterRef = useRef<AnsiToHtml | null>(null);
    const lineIdRef = useRef(0);
    const userScrolledUpRef = useRef(false);

    // ── State ─────────────────────────────────────────────────────────────────
    const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
    const [agentExitInfo, setAgentExitInfo] = useState<{
      exitCode: number | null;
      exitedAt: string;
    } | null>(null);
    const [isRestarting, setIsRestarting] = useState(false);

    // ── Theme ─────────────────────────────────────────────────────────────────
    const terminalTheme = useTerminalTheme();
    const { getAgentActivityStatus } = useSessionContext();
    const activityStatus = session ? getAgentActivityStatus(session.id) : "idle";
    const needsAttention = activityStatus === "waiting" || activityStatus === "error";

    // ── ANSI converter (stream mode for cross-chunk state continuity) ─────────
    // Initialize on first render and rebuild when theme changes
    if (converterRef.current == null) {
      converterRef.current = createAnsiConverter(terminalTheme);
    }

    useEffect(() => {
      converterRef.current = createAnsiConverter(terminalTheme);
    }, [terminalTheme]);

    // ── Shared output append helper ───────────────────────────────────────────
    const appendAnsiOutput = useCallback((ansi: string) => {
      const converter = converterRef.current;
      if (!converter) return;
      const html = converter.toHtml(ansi);
      if (!html) return;
      setOutputEntries(prev => {
        const newEntry: OutputEntry = { id: lineIdRef.current++, html };
        const updated = [...prev, newEntry];
        return updated.length > MAX_OUTPUT_ENTRIES
          ? updated.slice(-MAX_OUTPUT_ENTRIES)
          : updated;
      });
    }, []);

    const handleOutput = useCallback((data: string) => {
      appendAnsiOutput(data);
      onOutput?.(data);
    }, [appendAnsiOutput, onOutput]);

    const handleStatusMessage = useCallback((message: string) => {
      appendAnsiOutput("\r\n" + message + "\r\n");
    }, [appendAnsiOutput]);

    // ── Agent lifecycle callbacks ─────────────────────────────────────────────
    // onAgentActivityStatus is already called by useTerminalWebSocket for agent_exited
    const handleAgentExited = useCallback((exitCode: number | null, exitedAt: string) => {
      setAgentExitInfo({ exitCode, exitedAt });
    }, []);

    const handleAgentRestarted = useCallback(() => {
      setAgentExitInfo(null);
      setIsRestarting(false);
      setOutputEntries([]);
      lineIdRef.current = 0;
      converterRef.current = createAnsiConverter(terminalTheme);
    }, [terminalTheme]);

    // ── WebSocket connection ─────────────────────────────────────────────────
    const {
      wsRef,
      status,
      authError,
      sendInput,
      sendRestartAgent,
    } = useTerminalWebSocket({
      sessionId,
      tmuxSessionName,
      projectPath,
      wsUrl,
      terminalType: session?.terminalType ?? "shell",
      tmuxHistoryLimit,
      environmentVars,
      initialCols: MOBILE_COLS,
      initialRows: MOBILE_ROWS,
      notificationsEnabled,
      sessionName,
      onOutput: handleOutput,
      onStatusChange,
      onWebSocketReady,
      onSessionExit,
      onAgentExited: handleAgentExited,
      onAgentRestarted: handleAgentRestarted,
      onAgentActivityStatus,
      onAgentTodosUpdated,
      onNotification,
      onSessionStatus,
      onSessionProgress,
      onStatusMessage: handleStatusMessage,
    });

    // ── Expose ref ────────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      focus: () => {
        inputBarRef.current?.focus();
      },
    }), []);

    // ── Auto-scroll ──────────────────────────────────────────────────────────
    useEffect(() => {
      if (userScrolledUpRef.current) return;
      anchorRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    }, [outputEntries]);

    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      // User scrolled up if they're more than 50px from the bottom
      const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
      userScrolledUpRef.current = !isAtBottom;
    }, []);

    // ── Input handlers ───────────────────────────────────────────────────────
    const handleMobileKeyPress = useCallback(
      (key: string, modifiers?: { ctrl?: boolean; alt?: boolean }) => {
        let data = key;
        if (modifiers?.ctrl && key.length === 1) {
          const charCode = key.toUpperCase().charCodeAt(0);
          if (charCode >= 65 && charCode <= 90) {
            data = String.fromCharCode(charCode - 64);
          }
        }
        if (modifiers?.alt) {
          data = "\x1b" + data;
        }
        sendInput(data);
      },
      [sendInput]
    );

    const handleImageUpload = useCallback(
      async (file: File) => {
        await sendImageToTerminal(file, wsRef.current);
      },
      [wsRef]
    );

    // ── Agent restart / close ────────────────────────────────────────────────
    const handleAgentRestart = useCallback(() => {
      setIsRestarting(true);
      sendRestartAgent();
    }, [sendRestartAgent]);

    const handleAgentClose = useCallback(async () => {
      if (onSessionDelete) {
        await onSessionDelete();
      } else {
        onSessionExit?.(agentExitInfo?.exitCode ?? 0);
      }
    }, [onSessionDelete, onSessionExit, agentExitInfo]);

    // ── Background styling to match terminal theme ──────────────────────────
    const bgOpacity = terminalTheme.opacity / 100;
    const outputBg = bgOpacity < 1
      ? hexToRgba(terminalTheme.background, bgOpacity)
      : terminalTheme.background;

    return (
      <div className={cn("flex flex-col h-full relative", needsAttention && "notification-ring")}>
        {/* Connection status indicator */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-popover/80 border-b border-border text-xs text-muted-foreground">
          <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", getStatusColor(status))} />
          <span className="truncate">{getStatusLabel(status, sessionName)}</span>
          {isRecording && (
            <span className="ml-auto flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              REC
            </span>
          )}
        </div>

        {/* Output panel */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
          style={{
            backgroundColor: outputBg,
            backdropFilter: terminalTheme.blur > 0 ? `blur(${terminalTheme.blur}px)` : undefined,
            color: terminalTheme.foreground,
          }}
        >
          <pre
            className="p-2 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words min-h-full"
            style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace" }}
          >
            {outputEntries.map(entry => (
              <span
                key={entry.id}
                dangerouslySetInnerHTML={{ __html: entry.html }}
              />
            ))}
            <span ref={anchorRef} />
          </pre>
        </div>

        {/* Voice mic button for agent sessions */}
        {session?.terminalType === "agent" && (
          <div className="absolute top-8 left-2 z-50">
            <VoiceMicButton getWebSocket={() => wsRef.current} />
          </div>
        )}

        {/* Text input bar (camera button lives in MobileKeyboard to avoid duplication) */}
        <MobileInputBar
          ref={inputBarRef}
          onSubmit={sendInput}
          disabled={status !== "connected"}
          placeholder={session?.terminalType === "agent" ? "Ask the agent..." : "Type a command..."}
        />

        {/* Special keys toolbar */}
        <MobileKeyboard
          onKeyPress={handleMobileKeyPress}
          onImageUpload={handleImageUpload}
        />

        {/* Agent exit screen overlay */}
        {agentExitInfo && session && (
          <AgentExitScreen
            sessionId={session.id}
            sessionName={session.name}
            exitCode={agentExitInfo.exitCode}
            exitedAt={agentExitInfo.exitedAt}
            restartCount={session.agentRestartCount ?? 0}
            onRestart={handleAgentRestart}
            onClose={handleAgentClose}
            isRestarting={isRestarting}
          />
        )}

        {/* Auth error overlay */}
        {authError && <AuthErrorOverlay message={authError} />}
      </div>
    );
  }
);
