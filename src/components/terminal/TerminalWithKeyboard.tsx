"use client";

import { useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal, type TerminalRef } from "./Terminal";
import { MobileInputBar } from "./MobileInputBar";
import { MobileKeyboard } from "./MobileKeyboard";
import { VoiceMicButton } from "./VoiceMicButton";
import { SessionEndedOverlay } from "./SessionEndedOverlay";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useMobile } from "@/hooks/useMobile";
import { sendImageToTerminal } from "@/lib/image-upload";
import type { ConnectionStatus } from "@/types/terminal";
import type { TerminalSession } from "@/types/session";
import type { SessionStatusIndicator, SessionProgress } from "@/types/terminal-type";

export interface TerminalWithKeyboardRef {
  focus: () => void;
}

interface TerminalWithKeyboardProps {
  sessionId: string;
  tmuxSessionName: string;
  sessionName?: string;
  projectPath?: string | null;
  session?: TerminalSession;
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
  onStatusChange?: (status: ConnectionStatus) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  onSessionRestart?: () => Promise<void>;
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void>;
  /** Called when agent activity status changes (from Claude Code hooks) */
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  /** Called when agent TodoWrite tasks are synced */
  onAgentTodosUpdated?: (sessionId: string) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
  /** Called when a session status indicator is set or cleared */
  onSessionStatus?: (sessionId: string, key: string, indicator: SessionStatusIndicator | null) => void;
  /** Called when session progress is updated or cleared */
  onSessionProgress?: (sessionId: string, progress: SessionProgress | null) => void;
}

export const TerminalWithKeyboard = forwardRef<TerminalWithKeyboardRef, TerminalWithKeyboardProps>(function TerminalWithKeyboard({
  sessionId,
  tmuxSessionName,
  sessionName,
  projectPath,
  session,
  wsUrl = "ws://localhost:3001",
  fontSize,
  fontFamily,
  scrollback,
  tmuxHistoryLimit,
  notificationsEnabled,
  isRecording,
  isActive,
  environmentVars,
  onStatusChange,
  onSessionExit,
  onOutput,
  onDimensionsChange,
  onSessionRestart,
  onSessionDelete,
  onAgentActivityStatus,
  onAgentTodosUpdated,
  onNotification,
  onSessionStatus,
  onSessionProgress,
}, ref) {
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalRef>(null);
  const mobileInputRef = useRef<HTMLTextAreaElement>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [exitCode, setExitCode] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const isMobile = useMobile();

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (isMobile) {
        mobileInputRef.current?.focus();
      } else {
        terminalRef.current?.focus();
      }
    },
  }), [isMobile]);

  const handleWebSocketReady = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  const handleStatusChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
    onStatusChange?.(status);
  }, [onStatusChange]);

  const handleSessionExit = useCallback((code: number) => {
    setExitCode(code);
    setSessionEnded(true);
  }, []);

  const handleRestart = useCallback(async () => {
    await onSessionRestart?.();
  }, [onSessionRestart]);

  const handleDelete = useCallback(async (deleteWorktree?: boolean) => {
    if (onSessionDelete) {
      await onSessionDelete(deleteWorktree);
    } else {
      onSessionExit?.(exitCode);
    }
  }, [onSessionDelete, onSessionExit, exitCode]);

  // ── Mobile input handlers ─────────────────────────────────────────────
  const handleMobileTextSubmit = useCallback((text: string) => {
    terminalRef.current?.sendInput(text);
  }, []);

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
      terminalRef.current?.sendInput(data);
    },
    []
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      await sendImageToTerminal(file, wsRef.current);
    },
    []
  );

  // ── Shared terminal component ─────────────────────────────────────────
  const terminalElement = (
    <ErrorBoundary title="Terminal Error">
      <Terminal
        ref={terminalRef}
        sessionId={sessionId}
        tmuxSessionName={tmuxSessionName}
        sessionName={sessionName}
        projectPath={projectPath}
        wsUrl={wsUrl}
        fontSize={fontSize}
        fontFamily={fontFamily}
        scrollback={scrollback}
        tmuxHistoryLimit={tmuxHistoryLimit}
        notificationsEnabled={notificationsEnabled}
        isRecording={isRecording}
        isActive={isActive}
        environmentVars={environmentVars}
        mobileMode={isMobile}
        onStatusChange={handleStatusChange}
        onWebSocketReady={handleWebSocketReady}
        onSessionExit={handleSessionExit}
        onOutput={onOutput}
        onDimensionsChange={onDimensionsChange}
        onAgentActivityStatus={onAgentActivityStatus}
        onAgentTodosUpdated={onAgentTodosUpdated}
        onNotification={onNotification}
        onSessionStatus={onSessionStatus}
        onSessionProgress={onSessionProgress}
      />
    </ErrorBoundary>
  );

  const sessionEndedOverlay = sessionEnded && session && (
    <SessionEndedOverlay
      session={session}
      exitCode={exitCode}
      onRestart={handleRestart}
      onDelete={handleDelete}
    />
  );

  // ── Mobile: xterm.js rendering + native input bar + special keys ──────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full relative">
        <div className="flex-1 min-h-0 relative">
          {terminalElement}
          {session?.terminalType === "agent" && (
            <div className="absolute top-2 left-2 z-50">
              <VoiceMicButton getWebSocket={() => wsRef.current} />
            </div>
          )}
        </div>

        <MobileInputBar
          ref={mobileInputRef}
          onSubmit={handleMobileTextSubmit}
          disabled={connectionStatus !== "connected"}
          placeholder={session?.terminalType === "agent" ? "Ask the agent..." : "Type a command..."}
        />

        <MobileKeyboard
          onKeyPress={handleMobileKeyPress}
          onImageUpload={handleImageUpload}
        />

        {sessionEndedOverlay}
      </div>
    );
  }

  // ── Desktop: xterm.js with built-in textarea ──────────────────────────
  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 min-h-0 relative">
        {terminalElement}
        {session?.terminalType === "agent" && (
          <div className="absolute top-2 left-2 z-50" style={isRecording ? { left: "5.5rem" } : undefined}>
            <VoiceMicButton getWebSocket={() => wsRef.current} />
          </div>
        )}
      </div>

      {sessionEndedOverlay}
    </div>
  );
});
