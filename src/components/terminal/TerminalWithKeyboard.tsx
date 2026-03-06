"use client";

import { useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal, type TerminalRef } from "./Terminal";
import { VoiceMicButton } from "./VoiceMicButton";
import { MobileKeyboard } from "./MobileKeyboard";
import { SessionEndedOverlay } from "./SessionEndedOverlay";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useMobile } from "@/hooks/useMobile";
import { sendImageToTerminal } from "@/lib/image-upload";
import type { ConnectionStatus } from "@/types/terminal";
import type { TerminalSession } from "@/types/session";

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
}, ref) {
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalRef>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [exitCode, setExitCode] = useState(0);
  const isMobile = useMobile();

  // Expose focus method to parent components
  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus();
    },
  }), []);

  const handleWebSocketReady = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  const handleSessionExit = useCallback((code: number) => {
    setExitCode(code);
    setSessionEnded(true);
    // Don't call onSessionExit immediately - wait for user action
  }, []);

  const handleRestart = useCallback(async () => {
    if (onSessionRestart) {
      await onSessionRestart();
    }
  }, [onSessionRestart]);

  const handleDelete = useCallback(async (deleteWorktree?: boolean) => {
    if (onSessionDelete) {
      await onSessionDelete(deleteWorktree);
    } else {
      // Fallback to just calling onSessionExit if no delete handler
      onSessionExit?.(exitCode);
    }
  }, [onSessionDelete, onSessionExit, exitCode]);

  const handleMobileKeyPress = useCallback(
    (key: string, modifiers?: { ctrl?: boolean; alt?: boolean }) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      let data = key;

      // Handle Ctrl modifier - convert to control character
      if (modifiers?.ctrl && key.length === 1) {
        const charCode = key.toUpperCase().charCodeAt(0);
        if (charCode >= 65 && charCode <= 90) {
          // A-Z -> Ctrl codes (1-26)
          data = String.fromCharCode(charCode - 64);
        }
      }

      // Handle Alt modifier - send escape prefix
      if (modifiers?.alt) {
        data = "\x1b" + data;
      }

      wsRef.current.send(JSON.stringify({ type: "input", data }));
    },
    []
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      await sendImageToTerminal(file, wsRef.current);
    },
    []
  );

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 min-h-0 relative">
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
            onStatusChange={onStatusChange}
            onWebSocketReady={handleWebSocketReady}
            onSessionExit={handleSessionExit}
            onOutput={onOutput}
            onDimensionsChange={onDimensionsChange}
            onAgentActivityStatus={onAgentActivityStatus}
            onAgentTodosUpdated={onAgentTodosUpdated}
          />
        </ErrorBoundary>
        {session?.terminalType === "agent" && (
          <div className="absolute top-2 left-2 z-50" style={isRecording ? { left: "5.5rem" } : undefined}>
            <VoiceMicButton getWebSocket={() => wsRef.current} />
          </div>
        )}
      </div>
      {isMobile && (
        <MobileKeyboard
          onKeyPress={handleMobileKeyPress}
          onImageUpload={handleImageUpload}
        />
      )}

      {sessionEnded && session && (
        <SessionEndedOverlay
          session={session}
          exitCode={exitCode}
          onRestart={handleRestart}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
});
