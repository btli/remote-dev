"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { ConnectionStatus } from "@/types/terminal";
import type { SessionStatusIndicator, SessionProgress } from "@/types/terminal-type";
import { useNotifications } from "@/hooks/useNotifications";

// ─── Options ───────────────────────────────────────────────────────────────────

export interface UseTerminalWebSocketOptions {
  sessionId: string;
  tmuxSessionName: string;
  projectPath?: string | null;
  wsUrl?: string;
  terminalType?: string;
  tmuxHistoryLimit?: number;
  environmentVars?: Record<string, string> | null;
  /** Initial terminal dimensions sent in the WebSocket URL */
  initialCols: number;
  initialRows: number;
  notificationsEnabled?: boolean;
  sessionName?: string;
  /** Required — caller owns rendering of output data */
  onOutput: (data: string) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  onAgentExited?: (exitCode: number | null, exitedAt: string) => void;
  onAgentRestarted?: () => void;
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  onBeadsIssuesUpdated?: (sessionId: string) => void;
  onSessionRenamed?: (sessionId: string, name: string, claudeSessionId?: string) => void;
  onNotification?: (notification: Record<string, unknown>) => void;
  onSessionStatus?: (sessionId: string, key: string, indicator: SessionStatusIndicator | null) => void;
  onSessionProgress?: (sessionId: string, progress: SessionProgress | null) => void;
  /** Called for non-output status messages (e.g. "Reconnecting 1/5...") */
  onStatusMessage?: (message: string) => void;
}

// ─── Return value ──────────────────────────────────────────────────────────────

export interface UseTerminalWebSocketReturn {
  wsRef: React.RefObject<WebSocket | null>;
  status: ConnectionStatus;
  authError: string | null;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  sendRestartAgent: () => void;
  markIntentionalExit: () => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;
const AUTH_ERROR_MESSAGES = ["Authentication required", "Invalid or expired token", "Unauthorized"];

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useTerminalWebSocket({
  sessionId,
  tmuxSessionName,
  projectPath,
  wsUrl = "ws://localhost:3001",
  terminalType = "shell",
  tmuxHistoryLimit = 50000,
  environmentVars,
  initialCols,
  initialRows,
  notificationsEnabled = true,
  sessionName = "Terminal",
  onOutput,
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
  onAgentExited,
  onAgentRestarted,
  onAgentActivityStatus,
  onBeadsIssuesUpdated,
  onSessionRenamed,
  onNotification,
  onSessionStatus,
  onSessionProgress,
  onStatusMessage,
}: UseTerminalWebSocketOptions): UseTerminalWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [authError, setAuthError] = useState<string | null>(null);

  // Reconnect state
  const isUnmountingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalExitRef = useRef(false);

  // Notifications hook for command completion
  const { recordActivity } = useNotifications({
    enabled: notificationsEnabled,
    sessionName,
    inactivityDelay: 3000,
  });

  // ── Ref-stabilize all callbacks to avoid re-running the connection effect ──
  const onOutputRef = useRef(onOutput);
  const onStatusChangeRef = useRef(onStatusChange);
  const onWebSocketReadyRef = useRef(onWebSocketReady);
  const onSessionExitRef = useRef(onSessionExit);
  const onAgentExitedRef = useRef(onAgentExited);
  const onAgentRestartedRef = useRef(onAgentRestarted);
  const onAgentActivityStatusRef = useRef(onAgentActivityStatus);
  const onBeadsIssuesUpdatedRef = useRef(onBeadsIssuesUpdated);
  const onSessionRenamedRef = useRef(onSessionRenamed);
  const onNotificationRef = useRef(onNotification);
  const onSessionStatusRef = useRef(onSessionStatus);
  const onSessionProgressRef = useRef(onSessionProgress);
  const onStatusMessageRef = useRef(onStatusMessage);
  const recordActivityRef = useRef(recordActivity);
  const tmuxHistoryLimitRef = useRef(tmuxHistoryLimit);
  const environmentVarsRef = useRef(environmentVars);

  useEffect(() => {
    onOutputRef.current = onOutput;
    onStatusChangeRef.current = onStatusChange;
    onWebSocketReadyRef.current = onWebSocketReady;
    onSessionExitRef.current = onSessionExit;
    onAgentExitedRef.current = onAgentExited;
    onAgentRestartedRef.current = onAgentRestarted;
    onAgentActivityStatusRef.current = onAgentActivityStatus;
    onBeadsIssuesUpdatedRef.current = onBeadsIssuesUpdated;
    onSessionRenamedRef.current = onSessionRenamed;
    onNotificationRef.current = onNotification;
    onSessionStatusRef.current = onSessionStatus;
    onSessionProgressRef.current = onSessionProgress;
    onStatusMessageRef.current = onStatusMessage;
    recordActivityRef.current = recordActivity;
    tmuxHistoryLimitRef.current = tmuxHistoryLimit;
    environmentVarsRef.current = environmentVars;
  }, [
    onOutput, onStatusChange, onWebSocketReady, onSessionExit,
    onAgentExited, onAgentRestarted, onAgentActivityStatus, onBeadsIssuesUpdated, onSessionRenamed,
    onNotification, onSessionStatus, onSessionProgress, onStatusMessage,
    recordActivity, tmuxHistoryLimit, environmentVars,
  ]);

  // ── Intentional exit helper ────────────────────────────────────────────────

  const markIntentionalExit = useCallback(() => {
    intentionalExitRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
  }, []);

  // ── Stable status updater ─────────────────────────────────────────────────

  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  // ── Public send helpers ────────────────────────────────────────────────────

  const sendJSON = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const sendInput = useCallback((data: string) => {
    sendJSON({ type: "input", data });
  }, [sendJSON]);

  const sendResize = useCallback((cols: number, rows: number) => {
    sendJSON({ type: "resize", cols, rows });
  }, [sendJSON]);

  const sendRestartAgent = useCallback(() => {
    sendJSON({ type: "restart_agent" });
  }, [sendJSON]);

  // ── Connection effect ──────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    isUnmountingRef.current = false;
    intentionalExitRef.current = false;

    async function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      updateStatus("connecting");

      // Fetch auth token
      let token: string;
      try {
        const tokenResponse = await fetch(`/api/sessions/${sessionId}/token`);
        if (!tokenResponse.ok) {
          throw new Error("Failed to get auth token");
        }
        const tokenData = await tokenResponse.json();
        token = tokenData.token;
      } catch {
        setAuthError("Your session may have expired. Please refresh the page to re-authenticate.");
        updateStatus("error");
        onStatusMessageRef.current?.("\x1b[31mError: Failed to authenticate\x1b[0m");
        return;
      }

      // Build WebSocket URL with params
      const params = new URLSearchParams({
        token,
        sessionId,
        tmuxSession: tmuxSessionName,
        cols: String(initialCols),
        rows: String(initialRows),
        tmuxHistoryLimit: String(tmuxHistoryLimitRef.current),
        terminalType,
      });
      if (projectPath) {
        params.set("cwd", projectPath);
      }
      const envVars = environmentVarsRef.current;
      if (envVars && Object.keys(envVars).length > 0) {
        params.set("environmentVars", encodeURIComponent(JSON.stringify(envVars)));
      }

      const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountingRef.current) {
          ws.close();
          return;
        }
        updateStatus("connected");
        reconnectAttemptsRef.current = 0;
        onWebSocketReadyRef.current?.(ws);
      };

      ws.onmessage = (event) => {
        // Skip binary frames (voice audio)
        if (typeof event.data !== "string") return;

        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "output":
              onOutputRef.current?.(msg.data);
              recordActivityRef.current?.();
              break;

            case "ready":
              break;

            case "session_created":
              break;

            case "session_attached":
              break;

            case "exit":
              markIntentionalExit();
              onStatusMessageRef.current?.(`\x1b[33mSession ended (exit code ${msg.code})\x1b[0m`);
              onSessionExitRef.current?.(msg.code);
              break;

            case "agent_exited":
              markIntentionalExit();
              onAgentActivityStatusRef.current?.(
                msg.sessionId ?? sessionId,
                msg.exitCode != null && msg.exitCode !== 0 ? "error" : "idle"
              );
              onStatusMessageRef.current?.(`\x1b[33mAgent exited (exit code ${msg.exitCode ?? "unknown"})\x1b[0m`);
              onAgentExitedRef.current?.(msg.exitCode, msg.exitedAt);
              break;

            case "agent_restarted":
              intentionalExitRef.current = false;
              onAgentActivityStatusRef.current?.(sessionId, "running");
              onStatusMessageRef.current?.("\x1b[32mAgent restarted\x1b[0m");
              onAgentRestartedRef.current?.();
              break;

            case "agent_activity_status":
              onAgentActivityStatusRef.current?.(msg.sessionId, msg.status);
              break;

            case "beads_issues_updated":
              onBeadsIssuesUpdatedRef.current?.(msg.sessionId);
              break;

            case "session_renamed":
              onSessionRenamedRef.current?.(msg.sessionId, msg.name, msg.claudeSessionId);
              break;

            case "notification":
              if (msg.notification) {
                onNotificationRef.current?.(msg.notification as Record<string, unknown>);
              }
              break;

            case "session_status_update":
              onSessionStatusRef.current?.(msg.sessionId, msg.key, msg.indicator);
              break;

            case "session_status_cleared":
              onSessionStatusRef.current?.(msg.sessionId, msg.key, null);
              break;

            case "session_progress_update":
              onSessionProgressRef.current?.(msg.sessionId, {
                value: msg.value,
                label: msg.label,
                updatedAt: msg.updatedAt || new Date().toISOString(),
              });
              break;

            case "session_progress_cleared":
              onSessionProgressRef.current?.(msg.sessionId, null);
              break;

            case "sidebar_changed":
              // Dispatch a global DOM event so SessionManager can debounce-refresh
              // without threading a callback through the entire component tree.
              document.dispatchEvent(new CustomEvent("rdv:sidebar-changed"));
              break;

            case "voice_ready":
              break;

            case "voice_error":
              console.error(`[Voice] Error: ${msg.message}`);
              break;

            case "error": {
              onStatusMessageRef.current?.(`\x1b[31mError: ${msg.message}\x1b[0m`);
              if (AUTH_ERROR_MESSAGES.some(m => msg.message?.includes(m))) {
                setAuthError(msg.message);
                updateStatus("error");
              }
              break;
            }
          }
        } catch {
          // Non-JSON data — treat as raw output
          onOutputRef.current?.(event.data);
          recordActivityRef.current?.();
        }
      };

      ws.onclose = () => {
        if (isUnmountingRef.current) return;

        updateStatus("disconnected");
        onWebSocketReadyRef.current?.(null);

        if (intentionalExitRef.current) return;

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          updateStatus("reconnecting");
          reconnectAttemptsRef.current++;
          onStatusMessageRef.current?.(
            `\x1b[33mReconnecting (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) connect();
          }, RECONNECT_DELAY_MS);
        } else {
          onStatusMessageRef.current?.("\x1b[31mConnection lost. Refresh to reconnect.\x1b[0m");
          updateStatus("error");
        }
      };

      ws.onerror = () => {
        console.error("WebSocket error");
      };
    }

    connect();

    return () => {
      mounted = false;
      isUnmountingRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, tmuxSessionName, projectPath, wsUrl, terminalType, initialCols, initialRows, updateStatus, markIntentionalExit]);

  return {
    wsRef,
    status,
    authError,
    sendInput,
    sendResize,
    sendRestartAgent,
    markIntentionalExit,
  };
}
