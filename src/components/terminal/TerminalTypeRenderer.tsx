"use client";

/**
 * TerminalTypeRenderer — Shell/agent terminal renderer with exit-screen overlay.
 *
 * Historically this component owned a switch on `session.terminalType` and
 * dispatched between shell, agent, file, browser, and loop views. After A2,
 * `SessionManager.tsx` dispatches directly via
 * {@link TerminalTypeClientRegistry}, so this file narrows its job to what
 * it does best: render a `Terminal` with an overlayed voice mic + agent
 * exit screen. It is no longer the canonical entry point for file/browser/
 * loop sessions — those are each dispatched to their own plugin component.
 *
 * Kept as the fallback content for the (unused-from-registry) legacy
 * combined plugin shim so the deprecated `TerminalTypePlugin` shape still
 * works until it is deleted.
 */

import { useState, useRef, useCallback } from "react";
import type { TerminalSession } from "@/types/session";
import { Terminal, type TerminalRef } from "./Terminal";
import { AgentExitScreen } from "./AgentExitScreen";
import { VoiceMicButton } from "./VoiceMicButton";
import type { ConnectionStatus } from "@/types/terminal";
import type { SessionStatusIndicator, SessionProgress } from "@/types/terminal-type";
import { useSessionContext } from "@/contexts/SessionContext";

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
  /** Called when the user wants to navigate/switch to another session */
  onNavigateToSession?: (sessionId: string) => void;
  onAgentStateChange?: (sessionId: string, state: "running" | "exited" | "restarting" | "closed") => void;
  /** Called when agent activity status changes (from Claude Code hooks) */
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  /** Called when beads issues are updated */
  onBeadsIssuesUpdated?: (sessionId: string) => void;
  /** Called when an agent session is auto-titled from its .jsonl file */
  onSessionRenamed?: (sessionId: string, name: string, claudeSessionId?: string) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
  /** Called when a session status indicator is set or cleared */
  onSessionStatus?: (sessionId: string, key: string, indicator: SessionStatusIndicator | null) => void;
  /** Called when session progress is updated or cleared */
  onSessionProgress?: (sessionId: string, progress: SessionProgress | null) => void;
  /** Called when a peer message is created (broadcast from terminal server) */
  onPeerMessageCreated?: (folderId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onChannelMessageCreated?: (folderId: string, channelId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onThreadReplyCreated?: (folderId: string, parentMessageId: string, message: import("@/types/peer-chat").PeerChatMessage) => void;
  onChannelCreated?: (folderId: string, channel: import("@/types/channels").Channel) => void;
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
}: TerminalTypeRendererProps) {
  const { getAgentActivityStatus } = useSessionContext();
  const activityStatus = getAgentActivityStatus(session.id);
  const needsAttention = activityStatus === "waiting" || activityStatus === "error";
  const terminalRef = useRef<TerminalRef>(null);
  const [agentExitInfo, setAgentExitInfo] = useState<{
    exitCode: number | null;
    exitedAt: string;
  } | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  const isAgent = session.terminalType === "agent";

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

  return (
    <div className={`relative w-full h-full${needsAttention ? " notification-ring" : ""}`}>
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
        terminalType={session.terminalType as "shell" | "agent"}
        onStatusChange={onStatusChange}
        onWebSocketReady={onWebSocketReady}
        onSessionExit={onSessionExit}
        onAgentExited={isAgent ? handleAgentExited : undefined}
        onAgentRestarted={isAgent ? handleAgentRestarted : undefined}
        onAgentActivityStatus={onAgentActivityStatus}
        onBeadsIssuesUpdated={onBeadsIssuesUpdated}
        onSessionRenamed={onSessionRenamed}
        onNotification={onNotification}
        onSessionStatus={onSessionStatus}
        onSessionProgress={onSessionProgress}
        onPeerMessageCreated={onPeerMessageCreated}
        onChannelMessageCreated={onChannelMessageCreated}
        onThreadReplyCreated={onThreadReplyCreated}
        onChannelCreated={onChannelCreated}
        onOutput={onOutput}
        onDimensionsChange={onDimensionsChange}
      />

      {isAgent && (
        <>
          {/* Voice mic button — rendered outside Terminal to avoid xterm canvas stacking */}
          <div
            className="absolute top-2 left-2 z-50"
            style={isRecording ? { left: "5.5rem" } : undefined}
          >
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
        </>
      )}
    </div>
  );
}
