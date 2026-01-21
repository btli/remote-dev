"use client";

/**
 * TerminalTypeRenderer - Renders terminal content based on terminal type
 *
 * This component delegates to the appropriate UI based on the session's terminalType:
 * - shell: Standard Terminal component
 * - agent: Terminal with agent exit screen overlay
 * - file: MarkdownEditor for file viewing/editing
 */

import { useState, useRef, useCallback } from "react";
import type { TerminalSession } from "@/types/session";
import { Terminal, type TerminalRef } from "./Terminal";
import { AgentExitScreen } from "./AgentExitScreen";
import { MarkdownEditor } from "./MarkdownEditor";
import type { ConnectionStatus } from "@/types/terminal";
import type { FileViewerMetadata } from "@/types/terminal-type";

interface TerminalTypeRendererProps {
  session: TerminalSession;
  wsUrl: string;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  tmuxHistoryLimit?: number;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  isActive?: boolean;
  environmentVars?: Record<string, string> | null;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
  onSessionClose?: (sessionId: string) => void;
  onAgentStateChange?: (sessionId: string, state: "running" | "exited" | "restarting" | "closed") => void;
}

export function TerminalTypeRenderer({
  session,
  wsUrl,
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  scrollback = 10000,
  tmuxHistoryLimit = 50000,
  notificationsEnabled = true,
  isRecording = false,
  isActive = false,
  environmentVars,
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
  onOutput,
  onDimensionsChange,
  onSessionClose,
  onAgentStateChange,
}: TerminalTypeRendererProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const [agentExitInfo, setAgentExitInfo] = useState<{
    exitCode: number | null;
    exitedAt: string;
  } | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  // Handle agent exit
  const handleAgentExited = useCallback((exitCode: number | null, exitedAt: string) => {
    setAgentExitInfo({ exitCode, exitedAt });
    onAgentStateChange?.(session.id, "exited");
  }, [session.id, onAgentStateChange]);

  // Handle agent restart
  const handleAgentRestart = useCallback(async () => {
    setIsRestarting(true);
    onAgentStateChange?.(session.id, "restarting");

    try {
      // Send restart command via WebSocket
      terminalRef.current?.restartAgent();
    } catch (error) {
      console.error("Failed to restart agent:", error);
      setIsRestarting(false);
    }
  }, [session.id, onAgentStateChange]);

  // Handle agent restarted successfully
  const handleAgentRestarted = useCallback(() => {
    setAgentExitInfo(null);
    setIsRestarting(false);
    onAgentStateChange?.(session.id, "running");
  }, [session.id, onAgentStateChange]);

  // Handle session close
  const handleSessionClose = useCallback(() => {
    onAgentStateChange?.(session.id, "closed");
    onSessionClose?.(session.id);
  }, [session.id, onAgentStateChange, onSessionClose]);

  // Render based on terminal type
  switch (session.terminalType) {
    case "file": {
      // Extract file metadata
      const metadata = session.typeMetadata as FileViewerMetadata | null;
      const filePath = metadata?.filePath ?? "";
      const fileName = metadata?.fileName ?? "Untitled";
      const isAgentConfig = metadata?.isAgentConfig ?? false;

      return (
        <MarkdownEditor
          filePath={filePath}
          fileName={fileName}
          isAgentConfig={isAgentConfig}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />
      );
    }

    case "agent":
      return (
        <div className="relative w-full h-full">
          <Terminal
            ref={terminalRef}
            sessionId={session.id}
            tmuxSessionName={session.tmuxSessionName}
            sessionName={session.name}
            projectPath={session.projectPath}
            wsUrl={wsUrl}
            fontSize={fontSize}
            fontFamily={fontFamily}
            scrollback={scrollback}
            tmuxHistoryLimit={tmuxHistoryLimit}
            notificationsEnabled={notificationsEnabled}
            isRecording={isRecording}
            isActive={isActive}
            environmentVars={environmentVars}
            terminalType="agent"
            onStatusChange={onStatusChange}
            onWebSocketReady={onWebSocketReady}
            onSessionExit={onSessionExit}
            onAgentExited={handleAgentExited}
            onAgentRestarted={handleAgentRestarted}
            onOutput={onOutput}
            onDimensionsChange={onDimensionsChange}
          />

          {/* Agent Exit Screen Overlay */}
          {agentExitInfo && (
            <AgentExitScreen
              sessionId={session.id}
              sessionName={session.name}
              exitCode={agentExitInfo.exitCode}
              exitedAt={agentExitInfo.exitedAt}
              restartCount={session.agentRestartCount ?? 0}
              onRestart={handleAgentRestart}
              onClose={handleSessionClose}
              isRestarting={isRestarting}
            />
          )}
        </div>
      );

    case "shell":
    default:
      return (
        <Terminal
          ref={terminalRef}
          sessionId={session.id}
          tmuxSessionName={session.tmuxSessionName}
          sessionName={session.name}
          projectPath={session.projectPath}
          wsUrl={wsUrl}
          fontSize={fontSize}
          fontFamily={fontFamily}
          scrollback={scrollback}
          tmuxHistoryLimit={tmuxHistoryLimit}
          notificationsEnabled={notificationsEnabled}
          isRecording={isRecording}
          isActive={isActive}
          environmentVars={environmentVars}
          terminalType="shell"
          onStatusChange={onStatusChange}
          onWebSocketReady={onWebSocketReady}
          onSessionExit={onSessionExit}
          onOutput={onOutput}
          onDimensionsChange={onDimensionsChange}
        />
      );
  }
}
