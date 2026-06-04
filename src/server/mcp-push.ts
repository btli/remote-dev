/**
 * MCP Socket Push Manager
 *
 * Terminal-server-side module that pushes events to per-session MCP server
 * Unix sockets. Each MCP server process listens on /tmp/rdv-mcp-{sessionId}.sock
 * and relays events to Claude Code via sendLoggingMessage().
 *
 * [x386.2/.3] The protocol is now BIDIRECTIONAL over the same Unix socket:
 *   - terminal server → MCP server:  {type:"event", messageId, ...}  (a push)
 *   - MCP server → terminal server:  {type:"ack", messageId}         (surfaced)
 *   - MCP server → terminal server:  {type:"replay_request", sessionId} (reconnect)
 *
 * On a successful socket write the registered "delivered hook" marks the
 * delivery `delivered`; when the MCP server acks, the per-session ack handler
 * marks it `acked`. A dropped ack leaves the row `delivered` (the poll fallback
 * recovers it) — there is no silent loss. On (re)connect the MCP server sends a
 * replay_request; the registered "replay hook" re-pushes everything still
 * undelivered for that session.
 *
 * This module deliberately holds NO import of the delivery service — the
 * terminal server installs hooks at boot (`setDeliveredHook`/`setReplayHook`)
 * so Clean-Architecture layering is preserved (mcp-push stays infrastructure).
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
  /** Inbound line buffer for ack / replay_request frames. */
  inBuf: string;
}

const MAX_PENDING = 20;

const sockets = new Map<string, SocketEntry>();
const RETRY_COOLDOWN_MS = 5000;

// ── Hooks installed by the terminal server at boot (layering boundary) ───────

/** Called when a (session, message) write is accepted by the socket. */
type DeliveredHook = (sessionId: string, messageId: string) => void;
/** Called when the MCP server requests replay of its undelivered backlog. */
type ReplayHook = (sessionId: string) => void | Promise<void>;
/** Per-session handler invoked when the MCP server acks a messageId. */
type AckHandler = (messageId: string) => void;
/**
 * [x386.15] Returns the session ids that currently have undelivered backlog.
 * The reconcile tick uses it to decide which sockets to proactively (re)connect
 * so replay fires on idle reconnect rather than on the next coincident push.
 */
type PendingSessionsProvider = () => Promise<string[]>;

let deliveredHook: DeliveredHook | null = null;
let replayHook: ReplayHook | null = null;
let pendingSessionsProvider: PendingSessionsProvider | null = null;
const ackHandlers = new Map<string, AckHandler>();

/** Install the hook that marks a delivery `delivered` on socket-write success. */
export function setDeliveredHook(fn: DeliveredHook | null): void {
  deliveredHook = fn;
}

/** Install the hook that replays a session's undelivered backlog on reconnect. */
export function setReplayHook(fn: ReplayHook | null): void {
  replayHook = fn;
}

/**
 * [x386.15] Install the provider that lists sessions with undelivered backlog.
 * Without it the reconcile tick is a no-op (e.g. in unit tests that don't wire
 * the delivery service).
 */
export function setPendingSessionsProvider(fn: PendingSessionsProvider | null): void {
  pendingSessionsProvider = fn;
}

/** Register a per-session ack handler (advances delivery → acked). */
export function onMcpAck(sessionId: string, handler: AckHandler): void {
  ackHandlers.set(sessionId, handler);
}

// ── Socket path (overridable in tests) ───────────────────────────────────────

let socketPathFn: (sessionId: string) => string = (sessionId) =>
  `/tmp/rdv-mcp-${sessionId}.sock`;

export function getMcpSocketPath(sessionId: string): string {
  return socketPathFn(sessionId);
}

/** Test seam: override the socket-path resolver (pass null to reset). */
export function __setMcpSocketPathForTest(
  fn: ((sessionId: string) => string) | null,
): void {
  socketPathFn = fn ?? ((sessionId) => `/tmp/rdv-mcp-${sessionId}.sock`);
}

// ── Inbound frame handling (acks + replay requests) ──────────────────────────

/** Parse newline-delimited inbound frames from the MCP server for a session. */
function handleInbound(sessionId: string, entry: SocketEntry, chunk: Buffer): void {
  entry.inBuf += chunk.toString();
  let nl: number;
  while ((nl = entry.inBuf.indexOf("\n")) !== -1) {
    const line = entry.inBuf.slice(0, nl);
    entry.inBuf = entry.inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // malformed frame, skip
    }
    if (msg.type === "ack" && typeof msg.messageId === "string") {
      ackHandlers.get(sessionId)?.(msg.messageId);
    } else if (msg.type === "replay_request") {
      const sid = (typeof msg.sessionId === "string" && msg.sessionId) || sessionId;
      Promise.resolve(replayHook?.(sid)).catch((err) =>
        log.debug("Replay hook failed", { sessionId: sid, error: String(err) }),
      );
    }
  }
}

/** Attach the inbound data/close listeners to a freshly created socket. */
function wireSocket(sessionId: string, entry: SocketEntry, socket: net.Socket): void {
  socket.on("data", (chunk: Buffer) => handleInbound(sessionId, entry, chunk));
}

// ── Push ─────────────────────────────────────────────────────────────────────

/** Serialize an event into the bidirectional envelope. */
function frame(event: McpPushEvent): string {
  // The event's own `type` (peer_message | channel_message | mention) lives at
  // the top level for back-compat with the original push format. The bidi
  // protocol adds `frame: "event"` so the MCP server can discriminate a push
  // from an inbound ack/replay frame without colliding with the event's `type`.
  return JSON.stringify({ frame: "event", ...event }) + "\n";
}

/**
 * Push an event to a session's MCP server via Unix socket. On write success the
 * delivered hook fires (marks the delivery `delivered`). The actual ack arrives
 * asynchronously over the same socket and is handled by {@link handleInbound}.
 *
 * Returns true if the write was attempted on a live/connecting socket (i.e. the
 * delivery is at least in-flight), false if the socket was unavailable (the
 * delivery stays `pending` and the poll fallback will recover it).
 */
export function pushToMcpServer(sessionId: string, event: McpPushEvent): boolean {
  const entry = sockets.get(sessionId);

  // Fast path: already connected — write directly, no filesystem check.
  if (entry?.state === "connected" && entry.socket) {
    const data = frame(event);
    entry.socket.write(data, (err) => {
      if (err) {
        log.debug("MCP socket write failed", { sessionId, error: String(err) });
        entry.state = "disconnected";
        entry.lastErrorAt = Date.now();
        entry.socket?.destroy();
        entry.socket = null;
      } else if (event.messageId) {
        deliveredHook?.(sessionId, event.messageId);
      }
    });
    return true;
  }

  // Retry cooldown after error.
  if (entry?.state === "disconnected" && Date.now() - entry.lastErrorAt < RETRY_COOLDOWN_MS) {
    return false;
  }

  // Already connecting — queue the event (flushed on connect).
  if (entry?.state === "connecting") {
    if (entry.pending.length < MAX_PENDING) {
      entry.pending.push(frame(event));
    }
    return true;
  }

  // Check if socket file exists before attempting connection.
  const sockPath = getMcpSocketPath(sessionId);
  try {
    fs.accessSync(sockPath);
  } catch {
    // Cache negative result so the cooldown rate-limits future accessSync calls.
    sockets.set(sessionId, {
      socket: null,
      state: "disconnected",
      lastErrorAt: Date.now(),
      pending: [],
      inBuf: "",
    });
    return false;
  }

  // Not connected — connect, write this event first, then fire the queued ones.
  connect(sessionId, sockPath, (socket) => {
    socket.write(frame(event), (err) => {
      if (!err && event.messageId) deliveredHook?.(sessionId, event.messageId);
    });
  });
  return true;
}

/**
 * Open a fresh connection to a session's MCP socket and run `onConnect` once the
 * socket is up. Shared by {@link pushToMcpServer} (writes the triggering event)
 * and {@link ensureConnected} (fires a proactive replay). The entry is stored
 * immediately as `connecting` so {@link closeMcpSocket} can tear it down mid-dial
 * and so a concurrent push queues onto `pending` instead of opening a 2nd socket.
 */
function connect(
  sessionId: string,
  sockPath: string,
  onConnect: (socket: net.Socket) => void,
): void {
  const socket = net.createConnection(sockPath);
  const newEntry: SocketEntry = {
    socket,
    state: "connecting",
    lastErrorAt: 0,
    pending: [],
    inBuf: "",
  };
  sockets.set(sessionId, newEntry);
  wireSocket(sessionId, newEntry, socket);

  socket.on("connect", () => {
    newEntry.state = "connected";
    log.debug("MCP socket connected", { sessionId });
    onConnect(socket);
    // Flush any events queued while connecting.
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
 * [x386.15] Proactively (re)connect a session's MCP socket if it has reappeared,
 * and on connect fire the replay hook so the session's undelivered backlog is
 * pushed without waiting for a coincident outbound message. No-op when already
 * connected/connecting, when inside the post-error retry cooldown, or when the
 * socket file does not (yet) exist. Returns true only when a fresh dial was
 * started (used by the reconcile tick to throttle log noise / for tests).
 *
 * Idempotency: the replay re-pushes via {@link pushToMcpServer}, whose delivery
 * rows gate on ack state (`getUndelivered` skips `acked`, `markDelivered` never
 * regresses an ack), so a message is never delivered twice. Because this is a
 * no-op while a socket is live, it never competes with the normal push path.
 */
export function ensureConnected(sessionId: string): boolean {
  const entry = sockets.get(sessionId);

  // Already up or dialing — nothing to do (the live socket also receives any
  // replay_request the MCP server sends, so reconnect-replay is already covered).
  if (entry?.state === "connected" || entry?.state === "connecting") return false;

  // Respect the post-error cooldown so a flapping socket can't trigger a
  // reconnect storm from the periodic tick.
  if (entry?.state === "disconnected" && Date.now() - entry.lastErrorAt < RETRY_COOLDOWN_MS) {
    return false;
  }

  const sockPath = getMcpSocketPath(sessionId);
  try {
    fs.accessSync(sockPath);
  } catch {
    // Socket not present — cache the negative result so we don't accessSync it
    // every tick (the cooldown rate-limits the next probe).
    sockets.set(sessionId, {
      socket: null,
      state: "disconnected",
      lastErrorAt: Date.now(),
      pending: [],
      inBuf: "",
    });
    return false;
  }

  log.debug("MCP socket reappeared — proactively reconnecting for replay", { sessionId });
  connect(sessionId, sockPath, () => {
    Promise.resolve(replayHook?.(sessionId)).catch((err) =>
      log.debug("Proactive replay failed", { sessionId, error: String(err) }),
    );
  });
  return true;
}

// ── Proactive reconcile tick (idle-reconnect replay) ─────────────────────────

const RECONCILE_INTERVAL_MS = 3000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight = false;

/**
 * [x386.15] One reconcile pass: ask the delivery service which sessions still
 * have undelivered backlog and {@link ensureConnected} each. When nothing is
 * pending (the common case) this performs a single cheap indexed query and does
 * no socket work. Never throws into the caller — failures are logged and swallowed
 * so the interval keeps running.
 */
export async function reconcileMcpConnections(): Promise<void> {
  if (!pendingSessionsProvider) return;
  // Skip if a prior pass is still resolving (slow DB) — avoids overlap.
  if (reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    const sessionIds = await pendingSessionsProvider();
    for (const sessionId of sessionIds) ensureConnected(sessionId);
  } catch (err) {
    log.debug("MCP reconcile pass failed", { error: String(err) });
  } finally {
    reconcileInFlight = false;
  }
}

/** Start the periodic reconcile tick (idempotent). Unref'd so it never holds the
 * event loop open at shutdown. */
export function startMcpReconcile(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcileMcpConnections();
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();
}

/** Stop the periodic reconcile tick (idempotent). */
export function stopMcpReconcile(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
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
  ackHandlers.delete(sessionId);
}
