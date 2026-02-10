import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

export type ConnectionState = "connecting" | "connected" | "disconnecting" | "disconnected" | "reconnecting";

export interface WebSocketMessage {
  type: "input" | "output" | "resize" | "exit" | "error";
  data?: string | { cols: number; rows: number } | { code: number } | { message: string };
}

interface WebSocketConnection {
  ws: WebSocket;
  sessionId: string;
  token: string;
  state: ConnectionState;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
}

interface WebSocketManagerConfig {
  serverUrl: string;
  maxReconnectAttempts: number;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
}

type MessageHandler = (sessionId: string, message: WebSocketMessage) => void;
type StateHandler = (sessionId: string, state: ConnectionState) => void;

/**
 * WebSocket manager with auto-reconnect and network awareness.
 * Manages multiple terminal WebSocket connections.
 */
export class WebSocketManager {
  private config: WebSocketManagerConfig;
  private connections: Map<string, WebSocketConnection> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private stateHandlers: Set<StateHandler> = new Set();
  private networkUnsubscribe: (() => void) | null = null;
  private isNetworkAvailable = true;

  constructor(config: Partial<WebSocketManagerConfig> = {}) {
    this.config = {
      serverUrl: config.serverUrl || "ws://localhost:3001",
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      baseReconnectDelay: config.baseReconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 30000,
    };
  }

  /**
   * Start monitoring network state.
   */
  startNetworkMonitoring(): void {
    this.networkUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const wasAvailable = this.isNetworkAvailable;
      this.isNetworkAvailable = state.isConnected === true && state.isInternetReachable !== false;

      if (!wasAvailable && this.isNetworkAvailable) {
        // Network restored - reconnect all disconnected sessions
        console.log("[WebSocketManager] Network restored, reconnecting sessions");
        this.reconnectAllSessions();
      } else if (wasAvailable && !this.isNetworkAvailable) {
        // Network lost - pause reconnect timers
        console.log("[WebSocketManager] Network lost, pausing reconnects");
        this.pauseAllReconnectTimers();
      }
    });
  }

  /**
   * Stop monitoring network state.
   */
  stopNetworkMonitoring(): void {
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = null;
    }
  }

  /**
   * Connect to a terminal session.
   */
  async connect(sessionId: string, token: string): Promise<void> {
    // Check if already connected or connecting (prevents race condition)
    const existing = this.connections.get(sessionId);
    if (existing) {
      if (existing.state === "connected") {
        return;
      }
      if (existing.state === "connecting") {
        // Already connecting - don't start another connection
        if (__DEV__) {
          console.log(`[WebSocketManager] Already connecting: ${sessionId}`);
        }
        return;
      }
      // Cancel any pending reconnect timer
      if (existing.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      // Close existing socket if not already closed
      if (existing.ws.readyState === WebSocket.OPEN ||
          existing.ws.readyState === WebSocket.CONNECTING) {
        existing.ws.close(1000, "Reconnecting");
      }
    }

    return new Promise((resolve, reject) => {
      const url = `${this.config.serverUrl}?sessionId=${sessionId}&token=${token}`;

      this.updateState(sessionId, "connecting");

      const ws = new WebSocket(url);

      const connection: WebSocketConnection = {
        ws,
        sessionId,
        token,
        state: "connecting",
        reconnectAttempts: 0,
        reconnectTimer: null,
      };

      ws.onopen = () => {
        console.log(`[WebSocketManager] Connected: ${sessionId}`);
        connection.state = "connected";
        connection.reconnectAttempts = 0;
        this.connections.set(sessionId, connection);
        this.updateState(sessionId, "connected");
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          this.notifyMessageHandlers(sessionId, message);
        } catch (error) {
          console.error(`[WebSocketManager] Failed to parse message:`, error);
        }
      };

      ws.onerror = (error) => {
        console.error(`[WebSocketManager] Error: ${sessionId}`, error);
        if (connection.state === "connecting") {
          reject(new Error("WebSocket connection failed"));
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocketManager] Closed: ${sessionId} (code: ${event.code})`);
        connection.state = "disconnected";
        this.updateState(sessionId, "disconnected");

        // Schedule reconnect if not intentionally closed
        if (event.code !== 1000 && event.code !== 4001) {
          this.scheduleReconnect(sessionId);
        }
      };

      this.connections.set(sessionId, connection);
    });
  }

  /**
   * Disconnect from a terminal session.
   */
  disconnect(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    // Cancel pending reconnect
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }

    if (connection.ws.readyState === WebSocket.OPEN) {
      this.updateState(sessionId, "disconnecting");
      connection.ws.close(1000, "Client disconnect");
    }

    this.connections.delete(sessionId);
    this.updateState(sessionId, "disconnected");
  }

  /**
   * Disconnect all sessions.
   */
  disconnectAll(): void {
    for (const sessionId of this.connections.keys()) {
      this.disconnect(sessionId);
    }
  }

  /**
   * Send a message to a terminal session.
   */
  send(sessionId: string, message: WebSocketMessage): void {
    const connection = this.connections.get(sessionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WebSocketManager] Cannot send, not connected: ${sessionId}`);
      return;
    }

    connection.ws.send(JSON.stringify(message));
  }

  /**
   * Send terminal input.
   */
  sendInput(sessionId: string, data: string): void {
    this.send(sessionId, { type: "input", data });
  }

  /**
   * Send terminal resize.
   */
  sendResize(sessionId: string, cols: number, rows: number): void {
    this.send(sessionId, { type: "resize", data: { cols, rows } });
  }

  /**
   * Get connection state for a session.
   */
  getState(sessionId: string): ConnectionState {
    return this.connections.get(sessionId)?.state ?? "disconnected";
  }

  /**
   * Check if a session is connected.
   */
  isConnected(sessionId: string): boolean {
    return this.getState(sessionId) === "connected";
  }

  /**
   * Register a message handler.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register a state change handler.
   */
  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private scheduleReconnect(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;

    // Check if we've exceeded max attempts
    if (connection.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log(`[WebSocketManager] Max reconnect attempts reached: ${sessionId}`);
      return;
    }

    // Don't reconnect if network is unavailable
    if (!this.isNetworkAvailable) {
      console.log(`[WebSocketManager] Network unavailable, skipping reconnect: ${sessionId}`);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.baseReconnectDelay * Math.pow(2, connection.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    console.log(`[WebSocketManager] Scheduling reconnect in ${delay}ms: ${sessionId}`);
    this.updateState(sessionId, "reconnecting");

    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectAttempts++;
      this.connect(sessionId, connection.token).catch((error) => {
        console.error(`[WebSocketManager] Reconnect failed: ${sessionId}`, error);
      });
    }, delay);
  }

  private reconnectAllSessions(): void {
    for (const [sessionId, connection] of this.connections) {
      if (connection.state === "disconnected" || connection.state === "reconnecting") {
        connection.reconnectAttempts = 0; // Reset attempts on network restore
        this.scheduleReconnect(sessionId);
      }
    }
  }

  private pauseAllReconnectTimers(): void {
    for (const connection of this.connections.values()) {
      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer);
        connection.reconnectTimer = null;
      }
    }
  }

  private updateState(sessionId: string, state: ConnectionState): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.state = state;
    }
    this.notifyStateHandlers(sessionId, state);
  }

  private notifyMessageHandlers(sessionId: string, message: WebSocketMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(sessionId, message);
      } catch (error) {
        console.error("[WebSocketManager] Message handler error:", error);
      }
    }
  }

  private notifyStateHandlers(sessionId: string, state: ConnectionState): void {
    for (const handler of this.stateHandlers) {
      try {
        handler(sessionId, state);
      } catch (error) {
        console.error("[WebSocketManager] State handler error:", error);
      }
    }
  }
}

// Singleton instance
let wsManager: WebSocketManager | null = null;

export function getWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager({
      serverUrl: process.env.EXPO_PUBLIC_WS_URL || "ws://localhost:3001",
    });
    wsManager.startNetworkMonitoring();
  }
  return wsManager;
}

/**
 * Clean up the WebSocket manager singleton.
 * Call this on app shutdown or for testing.
 */
export function destroyWebSocketManager(): void {
  if (wsManager) {
    wsManager.stopNetworkMonitoring();
    wsManager.disconnectAll();
    wsManager = null;
  }
}
