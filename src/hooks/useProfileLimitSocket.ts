"use client";

/**
 * [remote-dev-0yix] Claude profile usage-limit control socket.
 *
 * Opens ONE lightweight control-mode WebSocket per browser tab (no PTY) to the
 * terminal server and listens for `profile_limit_changed` broadcasts, feeding
 * each into ProfileContext's `limitStates` map so the Claude Accounts dashboard
 * and the wizard's limit badges update live without a refresh.
 *
 * Behavior mirrors {@link useStatusControlSocket} (same control-token auth,
 * same RDV_BASE_PATH-aware WS URL helper, same capped-backoff reconnect). They
 * are intentionally separate sockets so each concern stays isolated; the
 * terminal server broadcasts both event types to every connected client.
 */

import { useEffect, useRef } from "react";

import { apiFetch } from "@/lib/api-fetch";
import { resolveTerminalWsUrl } from "@/hooks/useTerminalWsUrl";
import type { ProfileLimitChangedEvent } from "@/types/claude-limits";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

interface UseProfileLimitSocketArgs {
  /** Fold a live `profile_limit_changed` broadcast into the limit-state cache. */
  onLimitChanged: (event: ProfileLimitChangedEvent) => void;
  /** Gate the socket (e.g. only when authenticated). Defaults to true. */
  enabled?: boolean;
}

export function useProfileLimitSocket({
  onLimitChanged,
  enabled = true,
}: UseProfileLimitSocketArgs): void {
  // Stable ref so the connect loop never re-subscribes on callback churn.
  const onLimitChangedRef = useRef(onLimitChanged);
  useEffect(() => {
    onLimitChangedRef.current = onLimitChanged;
  }, [onLimitChanged]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let mounted = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    async function connect() {
      if (!mounted) return;

      let token: string;
      try {
        const res = await apiFetch("/api/control-token");
        if (!res.ok) throw new Error(`control-token ${res.status}`);
        const data = await res.json();
        token = data.token;
      } catch {
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
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "profile_limit_changed" && msg.profileId) {
            onLimitChangedRef.current(msg as ProfileLimitChangedEvent);
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
