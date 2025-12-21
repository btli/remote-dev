"use client";

import { useRef, useCallback, useState } from "react";
import { Terminal } from "./Terminal";
import { MobileKeyboard } from "./MobileKeyboard";
import { Button } from "@/components/ui/button";
import { RotateCcw, Terminal as TerminalIcon } from "lucide-react";
import type { ConnectionStatus } from "@/types/terminal";

interface TerminalWithKeyboardProps {
  sessionId: string;
  tmuxSessionName: string;
  sessionName?: string;
  projectPath?: string | null;
  wsUrl?: string;
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  onStatusChange?: (status: ConnectionStatus) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
}

export function TerminalWithKeyboard({
  sessionId,
  tmuxSessionName,
  sessionName,
  projectPath,
  wsUrl = "ws://localhost:3001",
  theme,
  fontSize,
  fontFamily,
  notificationsEnabled,
  isRecording,
  onStatusChange,
  onSessionExit,
  onOutput,
  onDimensionsChange,
}: TerminalWithKeyboardProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const [hasExited, setHasExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  const handleWebSocketReady = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  const handleSessionExit = useCallback((code: number) => {
    setHasExited(true);
    setExitCode(code);
    onSessionExit?.(code);
  }, [onSessionExit]);

  const handleRestart = useCallback(() => {
    setHasExited(false);
    setExitCode(null);
    // Increment key to force Terminal component to remount and reconnect
    setRestartKey((k) => k + 1);
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
      <div className="flex-1 min-h-0 relative">
        <Terminal
          key={restartKey}
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
          onStatusChange={onStatusChange}
          onWebSocketReady={handleWebSocketReady}
          onSessionExit={handleSessionExit}
          onOutput={onOutput}
          onDimensionsChange={onDimensionsChange}
        />

        {/* Restart overlay when session has exited */}
        {hasExited && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm z-20">
            <div className="text-center p-6 rounded-xl bg-slate-900/90 border border-white/10 shadow-2xl max-w-sm">
              <div className="mx-auto w-12 h-12 rounded-lg bg-amber-500/20 flex items-center justify-center mb-4">
                <TerminalIcon className="w-6 h-6 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Session Ended
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                {exitCode === 0
                  ? "The terminal exited normally."
                  : `The terminal exited with code ${exitCode}.`}
              </p>
              <Button
                onClick={handleRestart}
                className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Restart Session
              </Button>
            </div>
          </div>
        )}
      </div>
      <MobileKeyboard onKeyPress={handleMobileKeyPress} />
    </div>
  );
}
