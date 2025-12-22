"use client";

import { useRef, useCallback } from "react";
import { Terminal } from "./Terminal";
import { MobileKeyboard } from "./MobileKeyboard";
import type { ConnectionStatus } from "@/types/terminal";
import type { ShellFramework } from "@/types/preferences";

interface TerminalWithKeyboardProps {
  sessionId: string;
  tmuxSessionName: string;
  wsUrl?: string;
  theme?: string;
  shellFramework?: ShellFramework;
  shellTheme?: string;
  fontSize?: number;
  fontFamily?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onSessionExit?: (exitCode: number) => void;
}

export function TerminalWithKeyboard({
  sessionId,
  tmuxSessionName,
  wsUrl = "ws://localhost:3001",
  theme,
  shellFramework,
  shellTheme,
  fontSize,
  fontFamily,
  onStatusChange,
  onSessionExit,
}: TerminalWithKeyboardProps) {
  const wsRef = useRef<WebSocket | null>(null);

  const handleWebSocketReady = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

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
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Terminal
          sessionId={sessionId}
          tmuxSessionName={tmuxSessionName}
          wsUrl={wsUrl}
          theme={theme}
          shellFramework={shellFramework}
          shellTheme={shellTheme}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onStatusChange={onStatusChange}
          onWebSocketReady={handleWebSocketReady}
          onSessionExit={onSessionExit}
        />
      </div>
      <MobileKeyboard onKeyPress={handleMobileKeyPress} />
    </div>
  );
}
