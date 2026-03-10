"use client";

/**
 * TerminalTypeRenderer - Renders terminal content based on terminal type
 *
 * This component delegates to the appropriate UI based on the session's terminalType:
 * - shell: Standard Terminal component
 * - agent: Terminal with agent exit screen overlay
 * - file: CodeMirrorEditor for file viewing/editing
 * - browser: BrowserPane with screenshot streaming
 */

import { useState, useRef, useCallback } from "react";
import type { TerminalSession } from "@/types/session";
import { Terminal, type TerminalRef } from "./Terminal";
import { AgentExitScreen } from "./AgentExitScreen";
import { VoiceMicButton } from "./VoiceMicButton";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { BrowserPane } from "./BrowserPane";
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
  /** Called when the user wants to navigate/switch to another session (e.g. child in orchestrator) */
  onNavigateToSession?: (sessionId: string) => void;
  onAgentStateChange?: (sessionId: string, state: "running" | "exited" | "restarting" | "closed") => void;
  /** Called when agent activity status changes (from Claude Code hooks) */
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  /** Called when agent TodoWrite tasks are synced */
  onAgentTodosUpdated?: (sessionId: string) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
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
  onNavigateToSession,
  onAgentStateChange,
  onAgentActivityStatus,
  onAgentTodosUpdated,
  onNotification,
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

  const renderAgentTerminal = (terminalType: "agent") => (
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
        terminalType={terminalType}
        onStatusChange={onStatusChange}
        onWebSocketReady={onWebSocketReady}
        onSessionExit={onSessionExit}
        onAgentExited={handleAgentExited}
        onAgentRestarted={handleAgentRestarted}
        onAgentActivityStatus={onAgentActivityStatus}
        onAgentTodosUpdated={onAgentTodosUpdated}
        onNotification={onNotification}
        onOutput={onOutput}
        onDimensionsChange={onDimensionsChange}
      />

      {/* Voice mic button - rendered outside Terminal to avoid xterm canvas stacking */}
      <div className="absolute top-2 left-2 z-50" style={isRecording ? { left: "5.5rem" } : undefined}>
        <VoiceMicButton getWebSocket={() => terminalRef.current?.getWebSocket() ?? null} />
      </div>

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

  // Render based on terminal type
  switch (session.terminalType) {
    case "file": {
      // Extract file metadata
      const metadata = session.typeMetadata as FileViewerMetadata | null;
      const filePath = metadata?.filePath ?? "";
      const fileName = metadata?.fileName ?? "Untitled";

      return (
        <CodeMirrorEditor
          filePath={filePath}
          fileName={fileName}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />
      );
    }

    case "agent":
      return renderAgentTerminal("agent");

    case "browser":
      return <BrowserPane session={session} />;

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
