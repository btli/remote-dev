"use client";

/**
 * [remote-dev-d5ci] Control-mode status socket.
 *
 * Opens ONE lightweight WebSocket per browser tab (no PTY, no terminal attach)
 * to the terminal server with `?control=1`, so the sidebar's live agent-activity
 * indicators update even when no terminal is mounted/attached. Without this, the
 * only WS clients were mounted Terminal components, so a session whose terminal
 * wasn't open never saw running→idle pushes until a manual refresh.
 *
 * Behavior mirrors useTerminalWebSocket's reconnect idiom:
 *   - fetch a short-lived control token (same auth as terminal tokens),
 *   - connect with the same RDV_BASE_PATH-aware WS URL helper,
 *   - handle agent_activity_status (threading statusAt for ordering) and
 *     session_metadata (re-dispatched as the existing rdv:session-metadata DOM
 *     event so SessionManager/useSessionMetadata consume it unchanged),
 *   - reconnect with a capped backoff (this is the sidebar's lifeline, so it
 *     keeps retrying rather than giving up after N attempts),
 *   - on every RE-connect, refreshSessions() to re-seed any pushes missed while
 *     the socket was down.
 */

import { useEffect, useRef } from "react";

import { apiFetch } from "@/lib/api-fetch";
import { resolveTerminalWsUrl } from "@/hooks/useTerminalWsUrl";
import type { AgentActivityStatus } from "@/types/terminal-type";
import type { SessionMetadata } from "@/types/session-metadata";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

interface UseStatusControlSocketArgs {
  /** Feed live activity-status pushes into the SessionContext cache. */
  setAgentActivityStatus: (sessionId: string, status: AgentActivityStatus, at?: number) => void;
  /** Re-seed from DB truth on (re)connect to recover missed pushes. */
  refreshSessions: () => void;
  /** Gate the socket (e.g. only when authenticated). Defaults to true. */
  enabled?: boolean;
}

export function useStatusControlSocket({
  setAgentActivityStatus,
  refreshSessions,
  enabled = true,
}: UseStatusControlSocketArgs): void {
  // Stable refs so the connect loop never re-subscribes on callback identity churn.
  const setStatusRef = useRef(setAgentActivityStatus);
  const refreshRef = useRef(refreshSessions);
  useEffect(() => {
    setStatusRef.current = setAgentActivityStatus;
    refreshRef.current = refreshSessions;
  }, [setAgentActivityStatus, refreshSessions]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let mounted = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let hasConnectedBefore = false;

    async function connect() {
      if (!mounted) return;

      let token: string;
      try {
        const res = await apiFetch("/api/control-token");
        if (!res.ok) throw new Error(`control-token ${res.status}`);
        const data = await res.json();
        token = data.token;
      } catch {
        // Auth/network hiccup — back off and retry.
        scheduleReconnect();
        return;
      }
      if (!mounted) return;

      const base = resolveTerminalWsUrl();
      const url = `${base}?control=1&token=${encodeURIComponent(token)}`;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        reconnectAttempts = 0;
        // On a RE-connect, re-seed from DB to recover any pushes missed while the
        // socket was down. Skip the first open (SessionContext already loads).
        if (hasConnectedBefore) {
          refreshRef.current();
        } else {
          hasConnectedBefore = true;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "agent_activity_status":
              setStatusRef.current(
                msg.sessionId,
                msg.status as AgentActivityStatus,
                msg.statusAt,
              );
              break;
            case "session_metadata":
              if (msg.metadata) {
                document.dispatchEvent(
                  new CustomEvent<SessionMetadata>("rdv:session-metadata", {
                    detail: msg.metadata,
                  }),
                );
              }
              break;
            // Other broadcast types are handled by mounted terminal sockets;
            // the control socket only needs the sidebar-relevant ones.
          }
        } catch {
          // Ignore non-JSON / unparseable frames.
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose handles the reconnect; avoid double-scheduling here.
      };
    }

    function scheduleReconnect() {
      if (!mounted || reconnectTimer) return;
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
        RECONNECT_MAX_DELAY_MS,
      );
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (mounted) connect();
      }, delay);
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    };
  }, [enabled]);
}
