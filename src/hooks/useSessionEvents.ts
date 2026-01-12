/**
 * useSessionEvents - React hook for real-time session updates via SSE
 *
 * Subscribes to the session events SSE endpoint and dispatches events
 * to registered callbacks. Handles connection lifecycle including
 * automatic reconnection on disconnects.
 */

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Session event types matching the Rust backend
 */
export type SessionEventType =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "reordered";

/**
 * Session data included in events
 */
export interface SessionEventData {
  id: string;
  name: string;
  tmux_session_name: string;
  status: string;
  project_path: string | null;
  folder_id: string | null;
  worktree_branch: string | null;
  agent_provider: string | null;
  is_orchestrator_session: boolean;
  created_at: number;
  updated_at: number;
}

/**
 * Session event from SSE
 */
export interface SessionEvent {
  type: SessionEventType;
  user_id: string;
  session_id: string | null;
  session: SessionEventData | null;
  timestamp: number;
}

/**
 * Event handlers for session events
 */
export interface SessionEventHandlers {
  onSessionCreated?: (session: SessionEventData) => void;
  onSessionUpdated?: (session: SessionEventData) => void;
  onSessionDeleted?: (sessionId: string) => void;
  onSessionStatusChanged?: (session: SessionEventData) => void;
  onSessionsReordered?: () => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/**
 * Connection state
 */
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/**
 * Hook options
 */
export interface UseSessionEventsOptions {
  /** Whether to enable the SSE connection (default: true) */
  enabled?: boolean;
  /** Automatic reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
}

/**
 * Hook to subscribe to real-time session events via SSE
 *
 * @param handlers - Callbacks for different event types
 * @param options - Connection options
 * @returns Connection state and control functions
 *
 * @example
 * ```tsx
 * const { connectionState, reconnect } = useSessionEvents({
 *   onSessionCreated: (session) => {
 *     console.log("New session:", session.name);
 *   },
 *   onSessionDeleted: (sessionId) => {
 *     console.log("Session deleted:", sessionId);
 *   },
 * });
 * ```
 */
export function useSessionEvents(
  handlers: SessionEventHandlers,
  options: UseSessionEventsOptions = {}
) {
  const {
    enabled = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Store handlers in ref to avoid reconnecting when handlers change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /**
   * Process an incoming SSE event
   */
  const processEvent = useCallback((event: SessionEvent) => {
    const handlers = handlersRef.current;

    switch (event.type) {
      case "created":
        if (event.session && handlers.onSessionCreated) {
          handlers.onSessionCreated(event.session);
        }
        break;
      case "updated":
        if (event.session && handlers.onSessionUpdated) {
          handlers.onSessionUpdated(event.session);
        }
        break;
      case "deleted":
        if (event.session_id && handlers.onSessionDeleted) {
          handlers.onSessionDeleted(event.session_id);
        }
        break;
      case "status_changed":
        if (event.session && handlers.onSessionStatusChanged) {
          handlers.onSessionStatusChanged(event.session);
        }
        break;
      case "reordered":
        if (handlers.onSessionsReordered) {
          handlers.onSessionsReordered();
        }
        break;
    }
  }, []);

  /**
   * Connect to the SSE endpoint
   */
  const connect = useCallback(() => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState("connecting");

    try {
      const eventSource = new EventSource("/api/events/sessions");
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnectionState("connected");
        reconnectAttemptsRef.current = 0;
        handlersRef.current.onConnected?.();
      };

      eventSource.addEventListener("session", (event) => {
        try {
          const data = JSON.parse(event.data) as SessionEvent;
          processEvent(data);
        } catch (error) {
          console.error("[useSessionEvents] Failed to parse event:", error);
        }
      });

      eventSource.addEventListener("error", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          console.error("[useSessionEvents] Server error:", data);
          handlersRef.current.onError?.(new Error(data.error || "Server error"));
        } catch {
          // Not a JSON error, just a connection error
          console.error("[useSessionEvents] Connection error");
        }
      });

      eventSource.onerror = () => {
        setConnectionState("error");
        handlersRef.current.onDisconnected?.();

        // Close the failed connection
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(
            `[useSessionEvents] Reconnecting in ${reconnectDelay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        } else {
          console.error("[useSessionEvents] Max reconnect attempts reached");
          setConnectionState("disconnected");
        }
      };
    } catch (error) {
      console.error("[useSessionEvents] Failed to create EventSource:", error);
      setConnectionState("error");
      handlersRef.current.onError?.(
        error instanceof Error ? error : new Error("Failed to connect")
      );
    }
  }, [processEvent, reconnectDelay, maxReconnectAttempts]);

  /**
   * Disconnect from the SSE endpoint
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionState("disconnected");
    reconnectAttemptsRef.current = 0;
  }, []);

  /**
   * Manual reconnect (resets attempt counter)
   */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Connect on mount / when enabled changes
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    connectionState,
    reconnect,
    disconnect,
    isConnected: connectionState === "connected",
  };
}

export default useSessionEvents;
