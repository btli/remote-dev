/**
 * MCP Socket Push Manager
 *
 * Terminal-server-side module that pushes events to per-session MCP server
 * Unix sockets. Each MCP server process listens on /tmp/rdv-mcp-{sessionId}.sock
 * and relays events to Claude Code via sendLoggingMessage().
 *
 * Fire-and-forget: push failures are silently ignored (PreToolUse hook is the
 * reliable fallback). Connections are lazily established and cached.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("McpPush");

/** Event types pushed from terminal server to MCP server via Unix socket. */
export type McpPushEventType = "peer_message" | "channel_message" | "mention";

export interface McpPushEvent {
  type: McpPushEventType;
  messageId: string;
  fromSessionId: string | null;
  fromSessionName: string;
  toSessionId: string | null;
  body: string;
  channelId: string | null;
  channelName: string | null;
  parentMessageId: string | null;
  createdAt: string;
}

interface SocketEntry {
  socket: net.Socket | null;
  state: "disconnected" | "connecting" | "connected";
  lastErrorAt: number;
  /** Events queued while the socket is connecting. Flushed on connect. */
  pending: string[];
}

const MAX_PENDING = 20;

const sockets = new Map<string, SocketEntry>();
const RETRY_COOLDOWN_MS = 5000;

export function getMcpSocketPath(sessionId: string): string {
  return `/tmp/rdv-mcp-${sessionId}.sock`;
}

/**
 * Push an event to a session's MCP server via Unix socket.
 * Fire-and-forget — failures are silently ignored.
 */
export function pushToMcpServer(sessionId: string, event: McpPushEvent): void {
  const entry = sockets.get(sessionId);

  // Fast path: already connected — write directly, no filesystem check
  if (entry?.state === "connected" && entry.socket) {
    const data = JSON.stringify(event) + "\n";
    entry.socket.write(data, (err) => {
      if (err) {
        log.debug("MCP socket write failed", { sessionId, error: String(err) });
        entry.state = "disconnected";
        entry.lastErrorAt = Date.now();
        entry.socket?.destroy();
        entry.socket = null;
      }
    });
    return;
  }

  // Retry cooldown after error
  if (entry?.state === "disconnected" && Date.now() - entry.lastErrorAt < RETRY_COOLDOWN_MS) {
    return;
  }

  // Already connecting — queue the event (flushed on connect)
  if (entry?.state === "connecting") {
    if (entry.pending.length < MAX_PENDING) {
      entry.pending.push(JSON.stringify(event) + "\n");
    }
    return;
  }

  // Check if socket file exists before attempting connection
  const sockPath = getMcpSocketPath(sessionId);
  try {
    fs.accessSync(sockPath);
  } catch {
    // Cache negative result so the cooldown rate-limits future accessSync calls
    sockets.set(sessionId, { socket: null, state: "disconnected", lastErrorAt: Date.now(), pending: [] });
    return;
  }

  // Not connected — connect and write.
  // Store socket immediately so closeMcpSocket() can destroy it during connecting.
  const data = JSON.stringify(event) + "\n";
  const socket = net.createConnection(sockPath);
  const newEntry: SocketEntry = { socket, state: "connecting", lastErrorAt: 0, pending: [] };
  sockets.set(sessionId, newEntry);

  socket.on("connect", () => {
    newEntry.state = "connected";
    log.debug("MCP socket connected", { sessionId });
    socket.write(data);
    // Flush any events queued while connecting
    for (const queued of newEntry.pending) {
      socket.write(queued);
    }
    newEntry.pending.length = 0;
  });

  socket.on("error", (err) => {
    log.debug("MCP socket error", { sessionId, error: String(err) });
    newEntry.state = "disconnected";
    newEntry.lastErrorAt = Date.now();
    newEntry.socket = null;
    newEntry.pending.length = 0;
  });

  socket.on("close", () => {
    newEntry.state = "disconnected";
    newEntry.lastErrorAt = Date.now();
    newEntry.socket = null;
  });
}

/**
 * Close and remove the cached socket for a session.
 * Called when a session's last WebSocket connection closes.
 */
export function closeMcpSocket(sessionId: string): void {
  const entry = sockets.get(sessionId);
  if (entry?.socket) {
    entry.socket.destroy();
  }
  sockets.delete(sessionId);
}
