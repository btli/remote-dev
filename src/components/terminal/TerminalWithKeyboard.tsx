"use client";

import { useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { Terminal, type TerminalRef } from "./Terminal";
import { MobileKeyboard } from "./MobileKeyboard";
import { SessionEndedOverlay } from "./SessionEndedOverlay";
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
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  isActive?: boolean;
  onStatusChange?: (status: ConnectionStatus) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  onSessionRestart?: () => Promise<void>;
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void>;
}

export const TerminalWithKeyboard = forwardRef<TerminalWithKeyboardRef, TerminalWithKeyboardProps>(function TerminalWithKeyboard({
  sessionId,
  tmuxSessionName,
  sessionName,
  projectPath,
  session,
  wsUrl = "ws://localhost:3001",
  theme,
  fontSize,
  fontFamily,
  notificationsEnabled,
  isRecording,
  isActive,
  onStatusChange,
  onSessionExit,
  onOutput,
  onDimensionsChange,
  onSessionRestart,
  onSessionDelete,
}, ref) {
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalRef>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [exitCode, setExitCode] = useState(0);

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

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 min-h-0">
        <Terminal
          ref={terminalRef}
          sessionId={sessionId}
          tmuxSessionName={tmuxSessionName}
          sessionName={sessionName}
          projectPath={projectPath}
          wsUrl={wsUrl}
          theme={theme}
          fontSize={fontSize}
          fontFamily={fontFamily}
          notificationsEnabled={notificationsEnabled}
          isRecording={isRecording}
          isActive={isActive}
          onStatusChange={onStatusChange}
          onWebSocketReady={handleWebSocketReady}
          onSessionExit={handleSessionExit}
          onOutput={onOutput}
          onDimensionsChange={onDimensionsChange}
        />
      </div>
      <MobileKeyboard onKeyPress={handleMobileKeyPress} />

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
