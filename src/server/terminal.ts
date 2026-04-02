import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { resolve as pathResolve } from "node:path";
import { promisify } from "node:util";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { validateWsToken, getAuthSecret } from "../lib/ws-token.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("Terminal");
const agentLog = createLogger("AgentExit");
const agentStatusLog = createLogger("AgentStatus");
const notifyLog = createLogger("Notify");
const voiceLog = createLogger("Voice");
const internalLog = createLogger("InternalAPI");
const ptyLog = createLogger("PtyControl");
const peerLog = createLogger("PeerAPI");

// Re-export for backwards compatibility with API routes
export { generateWsToken } from "../lib/ws-token.js";

/**
 * Filter out internal/private environment variables from frameworks.
 * These should not leak into child terminal sessions.
 */
function getCleanEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Filter out Next.js internal variables
    if (key.startsWith("__NEXT_PRIVATE_")) continue;
    if (key.startsWith("__NEXT_ACTION_")) continue;
    // Filter out other framework internals
    if (key.startsWith("__VITE_")) continue;
    if (key.startsWith("__TURBOPACK_")) continue;
    env[key] = value;
  }
  // Ensure locale vars are always present for proper UTF-8 handling in PTY.
  // Without these, node-pty uses the C locale and multi-byte characters
  // (Nerd Font glyphs, Unicode) render as '_'.
  if (!env.LANG) env.LANG = "en_US.UTF-8";
  if (!env.LC_CTYPE) env.LC_CTYPE = "en_US.UTF-8";
  if (!env.TERM) env.TERM = "xterm-256color";
  return env;
}

/**
 * Validate a tmux session name to prevent command injection.
 * Must match the rdv-{uuid} format used by the domain layer (TmuxSessionName).
 */
function validateSessionName(name: string): boolean {
  return /^rdv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

/**
 * Validate a path to prevent path traversal attacks.
 * Must be absolute and within allowed directories.
 */
function validatePath(path: string | undefined): string | undefined {
  if (!path) return undefined;

  // Must be absolute path
  if (!path.startsWith("/")) return undefined;

  // Resolve to canonical path (removes .., ., etc.)
  const resolved = pathResolve(path);

  // Must be within home directory or /tmp
  const home = process.env.HOME || "/tmp";
  if (!resolved.startsWith(home) && !resolved.startsWith("/tmp")) {
    return undefined;
  }

  return resolved;
}


interface TerminalConnection {
  connectionId: string;
  pty: IPty;
  ws: WebSocket;
  sessionId: string;
  tmuxSessionName: string;
  isAttached: boolean;
  lastCols: number;
  lastRows: number;
  pendingResize: { cols: number; rows: number } | null;
  resizeTimeout: ReturnType<typeof setTimeout> | null;
  // Terminal type for agent exit detection
  terminalType: "shell" | "agent" | "file" | string;
  // User ID for session service calls
  userId: string;
  // Voice mode state
  voiceFifoPath: string | null;
  voiceFifoFd: number | null;
  voiceAudioBuffer: Buffer[];
  voiceFifoReady: boolean;
  voiceSpaceInterval: ReturnType<typeof setInterval> | null;
}

// All active connections, keyed by connectionId (UUID)
const connections = new Map<string, TerminalConnection>();

// Session -> connection IDs for multi-client support
const sessionConnections = new Map<string, Set<string>>();

// Which connection controls tmux resize per session (newest wins)
const sessionPrimaryConnection = new Map<string, string>();

/** Get all active connections for a session */
function getConnectionsForSession(sessionId: string): TerminalConnection[] {
  const connIds = sessionConnections.get(sessionId);
  if (!connIds) return [];
  const result: TerminalConnection[] = [];
  for (const id of connIds) {
    const conn = connections.get(id);
    if (conn) result.push(conn);
  }
  return result;
}

/** Get any single active connection for a session (for internal API lookups) */
function getAnyConnectionForSession(sessionId: string): TerminalConnection | undefined {
  const connIds = sessionConnections.get(sessionId);
  if (!connIds) return undefined;
  const firstId = connIds.values().next().value;
  if (!firstId) return undefined;
  return connections.get(firstId);
}

// Per-session status indicators (key -> StatusIndicator)
type StatusIndicator = { value: string; icon?: string; color?: string; updatedAt: string };
const sessionStatusIndicators = new Map<string, Map<string, StatusIndicator>>();

// Per-session progress bars
type SessionProgress = { value: number; label?: string; updatedAt: string };
const sessionProgressBars = new Map<string, SessionProgress>();

// Claude Code session ID -> rdv session ID mapping
const claudeSessionMap = new Map<string, string>();

// Promisified execFile for async tmux commands
const execFileAsync = promisify(execFile);

/** Map of human-readable key names to tmux key names */
const TMUX_KEY_MAP: Record<string, string> = {
  "Enter": "Enter",
  "Return": "Enter",
  "C-c": "C-c",
  "Ctrl-C": "C-c",
  "C-d": "C-d",
  "Ctrl-D": "C-d",
  "C-z": "C-z",
  "Ctrl-Z": "C-z",
  "C-l": "C-l",
  "Ctrl-L": "C-l",
  "Tab": "Tab",
  "Escape": "Escape",
  "Esc": "Escape",
  "Up": "Up",
  "Down": "Down",
  "Left": "Left",
  "Right": "Right",
  "PageUp": "PPage",
  "PageDown": "NPage",
  "Home": "Home",
  "End": "End",
  "Backspace": "BSpace",
  "Space": "Space",
};

/** Build an agent_exited event payload */
function agentExitedEvent(sessionId: string, exitCode: number | null): Record<string, unknown> {
  return { type: "agent_exited", sessionId, exitCode, exitedAt: new Date().toISOString() };
}

/** Broadcast a JSON message to all connected WebSocket clients */
function broadcastToClients(data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const [, conn] of connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

/** Broadcast a JSON message only to WebSocket clients belonging to a specific user */
function broadcastToUser(userId: string, data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const [, conn] of connections) {
    if (conn.userId === userId && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

// Cached module references for MCP push (avoids repeated dynamic import overhead)
let _mcpPush: typeof import("@/server/mcp-push") | null = null;
let _peerService: typeof import("@/services/peer-service") | null = null;

async function getMcpPush() {
  return (_mcpPush ??= await import("@/server/mcp-push"));
}
async function getPeerService() {
  return (_peerService ??= await import("@/services/peer-service"));
}

/** Push an MCP event to a single peer session (fire-and-forget). */
function pushMcpEventToPeer(sessionId: string, event: import("@/server/mcp-push").McpPushEvent): void {
  getMcpPush().then(({ pushToMcpServer }) => pushToMcpServer(sessionId, event)).catch(() => {});
}

/** Push an MCP event to all folder peers except the sender (fire-and-forget). */
async function pushMcpEventToFolderPeers(
  folderId: string,
  fromSessionId: string,
  buildEvent: (peerId: string) => import("@/server/mcp-push").McpPushEvent,
): Promise<void> {
  const { pushToMcpServer } = await getMcpPush();
  const PeerService = await getPeerService();
  const peers = await PeerService.getFolderPeers(folderId);
  for (const peer of peers) {
    if (peer.sessionId === fromSessionId) continue;
    pushToMcpServer(peer.sessionId, buildEvent(peer.sessionId));
  }
}

/** Whether a terminal type has agent-like behavior (exit handling, restart, voice). */
function isAgentTerminalType(type: string): boolean {
  return type === "agent" || type === "loop";
}

/** Get the current active and agent session counts for drain status reporting. */
function getSessionCounts(): { activeSessions: number; activeAgentSessions: number } {
  // Count unique sessions, not individual connections
  let activeAgentSessions = 0;
  for (const [sessionId] of sessionConnections) {
    const conn = getAnyConnectionForSession(sessionId);
    if (conn && isAgentTerminalType(conn.terminalType)) {
      activeAgentSessions++;
    }
  }
  return { activeSessions: sessionConnections.size, activeAgentSessions };
}

/** Broadcast a JSON message to clients connected to a specific session */
function broadcastToSession(sessionId: string, data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const conn of getConnectionsForSession(sessionId)) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(message);
    }
  }
}

/**
 * Destroy a PTY and release its file descriptors.
 * Uses the runtime's destroy() method which closes the socket/FDs,
 * falling back to kill() (SIGHUP only) if destroy() is unavailable.
 */
function destroyPty(ptyProcess: IPty): void {
  const withDestroy = ptyProcess as IPty & { destroy?: () => void };
  if (typeof withDestroy.destroy === "function") {
    withDestroy.destroy();
  } else {
    ptyProcess.kill();
  }
}

/**
 * Destroy a PTY, ignoring errors if it's already dead.
 */
function safeDestroyPty(ptyProcess: IPty): void {
  try { destroyPty(ptyProcess); } catch { /* PTY may already be dead */ }
}

/**
 * Safely cleanup a single connection. Guards against double-cleanup from
 * concurrent events (PTY exit, WebSocket close, WebSocket error).
 */
function cleanupConnection(connectionId: string): void {
  const conn = connections.get(connectionId);
  if (!conn) return;

  // Remove from connections map first to prevent concurrent cleanup
  connections.delete(connectionId);

  // Remove from session connections and update session-level state
  const connSet = sessionConnections.get(conn.sessionId);
  if (connSet) {
    connSet.delete(connectionId);
  }

  const isLastConnection = !connSet || connSet.size === 0;
  if (isLastConnection) {
    // Last connection closed — clean up all session-level state
    sessionConnections.delete(conn.sessionId);
    sessionPrimaryConnection.delete(conn.sessionId);
    sessionStatusIndicators.delete(conn.sessionId);
    sessionProgressBars.delete(conn.sessionId);
    for (const [claudeId, rdvId] of claudeSessionMap) {
      if (rdvId === conn.sessionId) {
        claudeSessionMap.delete(claudeId);
      }
    }
    // Clean up MCP socket cache entry if the MCP server has exited.
    // Don't destroy live sockets — the MCP server outlives browser connections.
    getMcpPush().then(({ closeMcpSocket, getMcpSocketPath }) => {
      const fs = require("node:fs");
      try { fs.accessSync(getMcpSocketPath(conn.sessionId)); } catch {
        closeMcpSocket(conn.sessionId);
      }
    }).catch(() => {});
  } else if (sessionPrimaryConnection.get(conn.sessionId) === connectionId) {
    // Promote another connection to primary for resize control
    const nextPrimary = connSet.values().next().value;
    if (nextPrimary) {
      sessionPrimaryConnection.set(conn.sessionId, nextPrimary);
    }
  }

  // Per-connection cleanup
  if (conn.resizeTimeout) clearTimeout(conn.resizeTimeout);
  if (conn.voiceSpaceInterval) {
    clearInterval(conn.voiceSpaceInterval);
    conn.voiceSpaceInterval = null;
  }
  cleanupVoiceFifo(conn);
  safeDestroyPty(conn.pty);
}

// Re-import would create circular deps with types/terminal.ts in server context,
// so keep a local constant matching the shared VOICE_AUDIO_PREFIX from @/types/terminal
const VOICE_AUDIO_PREFIX = 0x01;
/** Max buffered voice chunks before FIFO reader connects (~25 seconds at 256ms/chunk) */
const MAX_VOICE_BUFFER_CHUNKS = 100;

/**
 * Create a named FIFO pipe for streaming voice audio to the sox shim.
 * Opens the FIFO for writing asynchronously (blocks until a reader opens it),
 * buffering any audio chunks received before the reader connects.
 */
function createVoiceFifo(conn: TerminalConnection): string {
  // Use sessionId (not connectionId) — the sox shim inside tmux looks up
  // the FIFO by $RDV_SESSION_ID: /tmp/rdv-voice-${RDV_SESSION_ID}.fifo
  const fifoPath = `${tmpdir()}/rdv-voice-${conn.sessionId}.fifo`;
  try { fs.unlinkSync(fifoPath); } catch { /* may not exist */ }
  execFileSync("mkfifo", ["-m", "0600", fifoPath]);
  conn.voiceFifoPath = fifoPath;
  conn.voiceAudioBuffer = [];
  conn.voiceFifoReady = false;

  // Open FIFO for writing asynchronously — blocks until reader opens
  fs.open(fifoPath, fs.constants.O_WRONLY, (err, fd) => {
    if (err) {
      voiceLog.error("Failed to open FIFO for writing", { error: err.message });
      return;
    }
    conn.voiceFifoFd = fd;
    // Flush buffered audio before marking ready
    for (const chunk of conn.voiceAudioBuffer) {
      try {
        fs.writeSync(fd, chunk);
      } catch (flushErr) {
        voiceLog.warn("Failed to flush buffered chunk", { error: String(flushErr) });
        break;
      }
    }
    conn.voiceAudioBuffer = [];
    conn.voiceFifoReady = true;
    voiceLog.debug("FIFO writer connected", { connectionId: conn.connectionId, sessionId: conn.sessionId });
  });

  return fifoPath;
}

/**
 * Clean up voice FIFO resources: close file descriptor, remove pipe, reset state.
 */
function cleanupVoiceFifo(conn: TerminalConnection): void {
  if (conn.voiceFifoFd !== null) {
    try { fs.closeSync(conn.voiceFifoFd); } catch { /* may be closed */ }
    conn.voiceFifoFd = null;
  }
  if (conn.voiceFifoPath) {
    try { fs.unlinkSync(conn.voiceFifoPath); } catch { /* may be deleted */ }
    conn.voiceFifoPath = null;
  }
  conn.voiceFifoReady = false;
  conn.voiceAudioBuffer = [];
}

/**
 * Check if tmux is installed
 */
function checkTmuxInstalled(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists
 */
function tmuxSessionExists(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session with optimal settings
 * @param historyLimit - Scrollback buffer size (default: 50000 lines)
 */
function createTmuxSession(
  sessionName: string,
  cols: number,
  rows: number,
  cwd?: string,
  historyLimit: number = 50000
): void {
  const args = ["new-session", "-d", "-s", sessionName, "-x", String(cols), "-y", String(rows)];
  if (cwd) {
    args.push("-c", cwd);
  }
  execFileSync("tmux", args, { stdio: "pipe" });

  // Enable mouse mode for scrolling in alternate screen apps (vim, less, claude code, etc.)
  // Use Shift+click to bypass and select text with xterm.js
  execFileSync("tmux", ["set-option", "-t", sessionName, "mouse", "on"], { stdio: "pipe" });

  // Set scrollback buffer (history-limit) for performance tuning
  // Lower values reduce memory usage for long-running sessions
  execFileSync("tmux", ["set-option", "-t", sessionName, "history-limit", String(historyLimit)], { stdio: "pipe" });

  // Prevent tmux from resizing window to smallest attached client
  // This fixes the issue where switching tabs causes resize
  execFileSync("tmux", ["set-option", "-t", sessionName, "aggressive-resize", "off"], { stdio: "pipe" });
}

/**
 * Attach to a tmux session using a PTY wrapper.
 * SECURITY: Spawns tmux directly without shell interpolation to prevent command injection.
 */
function attachToTmuxSession(
  sessionName: string,
  cols: number,
  rows: number
): IPty {
  // SECURITY: Spawn tmux directly with array arguments - no shell interpolation
  // Use clean environment to prevent framework internal vars from leaking
  const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", sessionName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: getCleanEnvironment(),
  });

  return ptyProcess;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = "";
  await new Promise<void>((resolve) => {
    req.on("data", (chunk) => (body += chunk));
    req.on("end", resolve);
  });
  return body;
}

function isLocalhostRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  // Unix domain socket connections have no remoteAddress — they are inherently local
  if (!addr) return true;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

async function parseRequestJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  const body = await readRequestBody(req);
  try {
    return JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return null;
  }
}

async function handleInternalApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsedUrl = new URL(req.url || "", "http://localhost");
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  if (pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, { status: "ok", scheduler: schedulerOrchestrator.isStarted() });
    return true;
  }

  // --- Localhost restriction for ALL internal endpoints ---
  if (pathname.startsWith("/internal/")) {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
  }

  // Session drain notification for auto-update system
  // Called by AutoUpdateOrchestrator: POST /internal/drain
  if (pathname === "/internal/drain" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { countdownSeconds, version } = payload;

    internalLog.info("Drain notification received", { countdownSeconds, version });
    broadcastToClients({
      type: "update_pending",
      countdownSeconds: countdownSeconds ?? 0,
      version: version ?? "unknown",
    });

    sendJson(res, 200, getSessionCounts());
    return true;
  }

  // Session drain status query (no broadcast)
  // Called by AutoUpdateOrchestrator: POST /internal/drain-status
  if (pathname === "/internal/drain-status" && req.method === "POST") {
    sendJson(res, 200, getSessionCounts());
    return true;
  }

  // Handle agent exit notification from tmux hook
  // Called when agent process exits: POST /internal/agent-exit?sessionId=xxx&exitCode=0
  if (pathname === "/internal/agent-exit" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const exitCode = query.exitCode ? parseInt(query.exitCode as string, 10) : null;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    agentLog.info("Session exited", { sessionId, exitCode: exitCode ?? "unknown" });

    // Notify all connected clients for this session
    const clientCount = getConnectionsForSession(sessionId).length;
    if (clientCount > 0) {
      broadcastToSession(sessionId, agentExitedEvent(sessionId, exitCode));
      agentLog.debug("Notified clients", { sessionId, clientCount });
    } else {
      agentLog.debug("No active WebSocket connections", { sessionId });
    }

    sendJson(res, 200, { success: true, sessionId, exitCode });
    return true;
  }

  // Handle agent activity status from Claude Code hooks
  // Called by hooks: POST /internal/agent-status?sessionId=xxx&status=running|waiting
  if (pathname === "/internal/agent-status" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const status = query.status as string;

    if (!sessionId || !status) {
      sendJson(res, 400, { error: "Missing sessionId or status parameter" });
      return true;
    }

    // Broadcast to all clients so any connected client can update the sidebar indicator
    broadcastToClients({ type: "agent_activity_status", sessionId, status });

    // Persist to DB (fire-and-forget) so page refreshes restore the current activity state
    Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")])
      .then(([{ db }, { terminalSessions }, { eq }]) =>
        db.update(terminalSessions).set({ agentActivityStatus: status }).where(eq(terminalSessions.id, sessionId))
      )
      .catch((err) => agentStatusLog.error("Failed to persist activity status", { error: String(err) }));

    // Create in-app notification for waiting/error statuses (fire-and-forget, with 5s debounce via service)
    if (status === "waiting" || status === "error") {
      Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm"), import("@/services/notification-service")])
        .then(async ([{ db }, { terminalSessions }, { eq }, NotificationService]) => {
          // Look up session for name and userId
          const session = await db.query.terminalSessions.findFirst({
            where: eq(terminalSessions.id, sessionId),
            columns: { name: true, userId: true },
          });
          if (!session) return;
          const title = status === "waiting"
            ? "Agent waiting for input"
            : "Agent encountered an error";
          const body = `Session "${session.name}" needs attention`;
          const notification = await NotificationService.createNotification({
            userId: session.userId,
            sessionId,
            sessionName: session.name,
            type: status === "waiting" ? "agent_waiting" : "agent_error",
            title,
            body,
          });
          if (!notification) return; // debounced
          // Broadcast notification to clients for real-time update
          broadcastToClients({
            type: "notification",
            notification: {
              ...notification,
              createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : notification.createdAt,
              readAt: null,
            },
          });
        })
        .catch((err) => agentStatusLog.error("Failed to create notification", { error: String(err) }));
    }

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /internal/notify — create a notification from rdv CLI hooks
  if (pathname === "/internal/notify" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true; // invalid JSON already responded
    const { sessionId, type, title, body: notifBody } = payload;
    if (!sessionId || !type || !title) {
      sendJson(res, 400, { error: "Missing sessionId, type, or title" });
      return true;
    }

    Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm"), import("@/services/notification-service")])
      .then(async ([{ db }, { terminalSessions }, { eq }, NotificationService]) => {
        const session = await db.query.terminalSessions.findFirst({
          where: eq(terminalSessions.id, sessionId as string),
          columns: { name: true, userId: true },
        });
        if (!session) return;
        const notification = await NotificationService.createNotification({
          userId: session.userId,
          sessionId: sessionId as string,
          sessionName: session.name,
          type: type as import("@/types/notification").NotificationType,
          title: title as string,
          body: (notifBody as string) ?? undefined,
        });
        if (!notification) return; // debounced
        broadcastToClients({
          type: "notification",
          notification: {
            ...notification,
            createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : notification.createdAt,
            readAt: null,
          },
        });
      })
      .catch((err) => notifyLog.error("Failed to create notification", { error: String(err) }));

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /internal/notification-dismissed — broadcast that notifications were read/deleted
  if (pathname === "/internal/notification-dismissed" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;
    const { ids, all, userId } = payload;
    if (!userId) {
      sendJson(res, 400, { error: "Missing userId" });
      return true;
    }
    broadcastToUser(userId as string, {
      type: "notification_dismissed",
      ids: ids ?? [],
      all: all ?? false,
    });
    sendJson(res, 200, { success: true });
    return true;
  }

  // Handle beads issue updates — broadcast to UI clients
  // Called by hooks: POST /internal/beads-updated
  if (req.method === "POST" && pathname === "/internal/beads-updated") {
    try {
      const body = await readRequestBody(req);
      const { projectPath } = JSON.parse(body);
      broadcastToClients({ type: "beads_issues_updated", projectPath });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      internalLog.error("Beads update broadcast error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to broadcast beads update" });
    }
    return true;
  }

  // Handle browser frame broadcast for browser pane sessions
  // POST /internal/browser-frame { sessionId, data } - broadcasts base64 screenshot to session client
  if (pathname === "/internal/browser-frame" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const { sessionId, data } = JSON.parse(body) as { sessionId: string; data: string };
      broadcastToSession(sessionId, {
        type: "browser_frame",
        sessionId,
        data,
      });
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 400, { error: "Invalid request" });
    }
    return true;
  }

  // --- cmux parity: PTY control, screen capture, session metadata endpoints ---

  // POST /internal/pty-write — write text directly to a session's PTY
  if (pathname === "/internal/pty-write" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, text } = payload as { sessionId: string; text: string };
      if (!sessionId || text == null) {
        sendJson(res, 400, { error: "Missing sessionId or text" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn) {
        sendJson(res, 404, { error: "No active PTY session found" });
        return true;
      }
      conn.pty.write(text);
      ptyLog.debug("PTY write", { sessionId, connectionId: conn.connectionId, length: text.length });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("PTY write error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to write to PTY" });
    }
    return true;
  }

  // POST /internal/pty-key — send a named keystroke to a session via tmux send-keys
  if (pathname === "/internal/pty-key" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key } = payload as { sessionId: string; key: string };
      if (!sessionId || !key) {
        sendJson(res, 400, { error: "Missing sessionId or key" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn) {
        sendJson(res, 404, { error: "No active PTY session found" });
        return true;
      }
      const tmuxName = conn.tmuxSessionName;
      const mappedKey = TMUX_KEY_MAP[key];

      if (mappedKey) {
        await execFileAsync("tmux", ["send-keys", "-t", tmuxName, mappedKey]);
      } else if (key.length === 1) {
        await execFileAsync("tmux", ["send-keys", "-t", tmuxName, "-l", key]);
      } else {
        sendJson(res, 400, { error: `Unknown key: ${key}` });
        return true;
      }

      ptyLog.debug("PTY key sent", { sessionId, key, mappedKey: mappedKey || key });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("PTY key error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to send key" });
    }
    return true;
  }

  // GET /internal/screen?sessionId=xxx — capture terminal screen content
  if (pathname === "/internal/screen" && req.method === "GET") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const sessionId = query.sessionId as string;
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId" });
        return true;
      }
      const conn = getAnyConnectionForSession(sessionId);
      if (!conn) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane", "-t", conn.tmuxSessionName, "-p", "-J",
      ]);
      sendJson(res, 200, {
        sessionId,
        content: stdout,
        capturedAt: new Date().toISOString(),
      });
    } catch (error) {
      ptyLog.error("Screen capture error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to capture screen" });
    }
    return true;
  }

  // POST /internal/session-status — set a per-session status indicator
  if (pathname === "/internal/session-status" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key: statusKey, value, icon, color } = payload as {
        sessionId: string; key: string; value: string; icon?: string; color?: string;
      };
      if (!sessionId || !statusKey || value === undefined) {
        sendJson(res, 400, { error: "Missing sessionId, key, or value" });
        return true;
      }
      const indicator: StatusIndicator = {
        value,
        icon,
        color,
        updatedAt: new Date().toISOString(),
      };
      let indicators = sessionStatusIndicators.get(sessionId);
      if (!indicators) {
        indicators = new Map<string, StatusIndicator>();
        sessionStatusIndicators.set(sessionId, indicators);
      }
      indicators.set(statusKey, indicator);
      broadcastToClients({
        type: "session_status_update",
        sessionId,
        key: statusKey,
        indicator,
      });
      ptyLog.debug("Session status set", { sessionId, key: statusKey, value });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session status error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to set session status" });
    }
    return true;
  }

  // DELETE /internal/session-status — clear a per-session status indicator
  if (pathname === "/internal/session-status" && req.method === "DELETE") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, key: statusKey } = payload as { sessionId: string; key: string };
      if (!sessionId || !statusKey) {
        sendJson(res, 400, { error: "Missing sessionId or key" });
        return true;
      }
      const indicators = sessionStatusIndicators.get(sessionId);
      if (indicators) {
        indicators.delete(statusKey);
        if (indicators.size === 0) {
          sessionStatusIndicators.delete(sessionId);
        }
      }
      broadcastToClients({
        type: "session_status_cleared",
        sessionId,
        key: statusKey,
      });
      ptyLog.debug("Session status cleared", { sessionId, key: statusKey });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session status clear error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to clear session status" });
    }
    return true;
  }

  // POST /internal/session-progress — set per-session progress
  if (pathname === "/internal/session-progress" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, value, label } = payload as {
        sessionId: string; value: number; label?: string;
      };
      if (!sessionId || value === undefined) {
        sendJson(res, 400, { error: "Missing sessionId or value" });
        return true;
      }
      const clampedValue = Math.max(0.0, Math.min(1.0, Number(value)));
      const progress: SessionProgress = {
        value: clampedValue,
        label,
        updatedAt: new Date().toISOString(),
      };
      sessionProgressBars.set(sessionId, progress);
      broadcastToClients({
        type: "session_progress_update",
        sessionId,
        value: clampedValue,
        label,
      });
      ptyLog.debug("Session progress set", { sessionId, value: clampedValue, label });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session progress error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to set session progress" });
    }
    return true;
  }

  // DELETE /internal/session-progress — clear per-session progress
  if (pathname === "/internal/session-progress" && req.method === "DELETE") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId } = payload as { sessionId: string };
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId" });
        return true;
      }
      sessionProgressBars.delete(sessionId);
      broadcastToClients({
        type: "session_progress_cleared",
        sessionId,
      });
      ptyLog.debug("Session progress cleared", { sessionId });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session progress clear error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to clear session progress" });
    }
    return true;
  }

  // POST /internal/session-log — structured per-session log entry
  if (pathname === "/internal/session-log" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { sessionId, message, level, source } = payload as {
        sessionId: string; message: string; level?: string; source?: string;
      };
      if (!sessionId || !message) {
        sendJson(res, 400, { error: "Missing sessionId or message" });
        return true;
      }
      const sessionLog = createLogger(source || "SessionLog");
      const logData = { sessionId };
      switch (level) {
        case "error":
          sessionLog.error(message, logData);
          break;
        case "warn":
          sessionLog.warn(message, logData);
          break;
        case "debug":
          sessionLog.debug(message, logData);
          break;
        case "trace":
          sessionLog.trace(message, logData);
          break;
        default:
          sessionLog.info(message, logData);
          break;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Session log error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to write session log" });
    }
    return true;
  }

  // POST /internal/claude-session-map — map Claude Code session ID to rdv session ID
  if (pathname === "/internal/claude-session-map" && req.method === "POST") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const { claudeSessionId, rdvSessionId } = payload as {
        claudeSessionId: string; rdvSessionId: string;
      };
      if (!claudeSessionId || !rdvSessionId) {
        sendJson(res, 400, { error: "Missing claudeSessionId or rdvSessionId" });
        return true;
      }
      claudeSessionMap.set(claudeSessionId, rdvSessionId);
      ptyLog.debug("Claude session mapped", { claudeSessionId, rdvSessionId });
      sendJson(res, 200, { success: true });
    } catch (error) {
      ptyLog.error("Claude session map error", { error: String(error) });
      sendJson(res, 500, { error: "Failed to map Claude session" });
    }
    return true;
  }

  // GET /internal/claude-session-map?claudeSessionId=xxx — look up rdv session ID
  if (pathname === "/internal/claude-session-map" && req.method === "GET") {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
    const claudeSessionId = query.claudeSessionId as string;
    if (!claudeSessionId) {
      sendJson(res, 400, { error: "Missing claudeSessionId" });
      return true;
    }
    const rdvSessionId = claudeSessionMap.get(claudeSessionId);
    if (!rdvSessionId) {
      sendJson(res, 404, { error: "Claude session mapping not found" });
      return true;
    }
    sendJson(res, 200, { rdvSessionId });
    return true;
  }

  // ═══ Agent auto-title endpoint ═══════════════════════════════════════════

  // POST /internal/agent-title?sessionId=xxx — auto-title an agent session from its .jsonl
  if (pathname === "/internal/agent-title" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    try {
      const AgentTitleService = await import("@/services/agent-title-service");
      const result = await AgentTitleService.tryApplyAutoTitle(sessionId);

      if (result.applied && result.title && result.userId) {
        broadcastToUser(result.userId, {
          type: "session_renamed",
          sessionId,
          name: result.title,
          claudeSessionId: result.claudeSessionId,
        });
      }

      sendJson(res, 200, { applied: result.applied, title: result.title ?? null });
    } catch (err) {
      agentStatusLog.error("Auto-title failed", { error: String(err), sessionId });
      sendJson(res, 200, { applied: false });
    }
    return true;
  }

  // POST /internal/agent-title/set?sessionId=xxx&title=yyy — manually set agent session title (kebab-case)
  if (pathname === "/internal/agent-title/set" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const title = query.title as string;

    if (!sessionId || !title) {
      sendJson(res, 400, { error: "Missing sessionId or title parameter" });
      return true;
    }

    // Validate kebab-case: lowercase letters, digits, and hyphens, 3-5 hyphen-separated words
    const kebabWords = title.split("-");
    if (
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(title) ||
      kebabWords.length < 3 ||
      kebabWords.length > 5
    ) {
      sendJson(res, 400, {
        error: "Title must be kebab-case (lowercase letters, digits, and hyphens) with 3-5 words",
      });
      return true;
    }

    try {
      const [{ db }, { terminalSessions }, { eq }, { safeJsonParse }] = await Promise.all([
        import("@/db"),
        import("@/db/schema"),
        import("drizzle-orm"),
        import("@/lib/utils"),
      ]);

      const session = await db.query.terminalSessions.findFirst({
        where: eq(terminalSessions.id, sessionId),
        columns: { id: true, name: true, userId: true, typeMetadata: true },
      });

      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }

      const meta = safeJsonParse<Record<string, unknown>>(session.typeMetadata, {});

      // Append current name to titleHistory before overwriting (capped at 10)
      const history = Array.isArray(meta.titleHistory) ? [...meta.titleHistory] : [];
      if (session.name) {
        history.push(session.name);
      }
      meta.titleHistory = history.slice(-10);
      meta.titleLocked = true;

      await db
        .update(terminalSessions)
        .set({
          name: title,
          typeMetadata: JSON.stringify(meta),
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, sessionId));

      broadcastToUser(session.userId, {
        type: "session_renamed",
        sessionId,
        name: title,
      });

      agentStatusLog.info("Agent session title set manually", { sessionId, title });
      sendJson(res, 200, { applied: true, title });
    } catch (err) {
      agentStatusLog.error("Failed to set agent title", { error: String(err), sessionId });
      sendJson(res, 500, { error: "Failed to set title" });
    }
    return true;
  }

  // ═══ Peer communication endpoints ═════════════════════════════════════════

  // GET /internal/peers/list?sessionId=xxx
  if (pathname === "/internal/peers/list" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      const peers = await PeerService.getPeers(sessionId, (id) => sessionConnections.has(id));
      sendJson(res, 200, { peers });
    } catch (err) {
      peerLog.error("Failed to list peers", { error: String(err) });
      sendJson(res, 500, { error: "Failed to list peers" });
    }
    return true;
  }

  // POST /internal/peers/messages/send { fromSessionId, toSessionId?, body }
  if (pathname === "/internal/peers/messages/send" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, toSessionId, body: msgBody } = payload;
    if (!fromSessionId || !msgBody) {
      sendJson(res, 400, { error: "Missing fromSessionId or body" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      const result = await PeerService.sendMessage({
        fromSessionId: fromSessionId as string,
        toSessionId: toSessionId as string | undefined,
        body: msgBody as string,
      });

      broadcastToUser(result.userId, {
        type: "peer_message_created",
        folderId: result.folderId,
        channelId: result.channelId ?? null,
        message: {
          id: result.messageId,
          fromSessionId,
          fromSessionName: result.senderName,
          toSessionId: toSessionId ?? null,
          body: result.resolvedBody,
          isUserMessage: false,
          channelId: result.channelId ?? null,
          parentMessageId: null,
          replyCount: 0,
          createdAt: result.createdAt,
        },
      });

      // Push to MCP server sockets (fire-and-forget)
      const senderSid = String(fromSessionId);
      const mcpEvent: import("@/server/mcp-push").McpPushEvent = {
        type: "peer_message",
        messageId: result.messageId,
        fromSessionId: senderSid,
        fromSessionName: result.senderName,
        toSessionId: toSessionId ? String(toSessionId) : null,
        body: result.resolvedBody,
        channelId: result.channelId ?? null,
        channelName: null,
        parentMessageId: null,
        createdAt: result.createdAt,
      };
      if (toSessionId) {
        pushMcpEventToPeer(String(toSessionId), mcpEvent);
      } else {
        pushMcpEventToFolderPeers(result.folderId, senderSid, () => mcpEvent).catch(() => {});
      }

      sendJson(res, 200, { messageId: result.messageId, resolvedBody: result.resolvedBody });
    } catch (err) {
      peerLog.error("Failed to send peer message", { error: String(err) });
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /internal/peers/messages/poll?sessionId=xxx&since=<isoTimestamp>
  if (pathname === "/internal/peers/messages/poll" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    const since = query.since as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      const sinceDate = since ? new Date(since) : new Date(0);
      const PeerService = await import("@/services/peer-service");
      const messages = await PeerService.pollMessages(sessionId, sinceDate);
      sendJson(res, 200, { messages });
    } catch (err) {
      peerLog.error("Failed to poll peer messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to poll messages" });
    }
    return true;
  }

  // POST /internal/peers/summary { sessionId, summary }
  if (pathname === "/internal/peers/summary" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { sessionId, summary } = payload;
    if (!sessionId || typeof summary !== "string") {
      sendJson(res, 400, { error: "Missing sessionId or summary" });
      return true;
    }

    try {
      const PeerService = await import("@/services/peer-service");
      await PeerService.setSummary(sessionId as string, summary);
      broadcastToClients({ type: "peer_summary_updated", sessionId, summary });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      peerLog.error("Failed to set peer summary", { error: String(err) });
      sendJson(res, 500, { error: "Failed to set summary" });
    }
    return true;
  }

  // POST /internal/peers/broadcast { userId, folderId, message }
  // Used by Next.js API routes to broadcast peer messages to WebSocket clients
  if (pathname === "/internal/peers/broadcast" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { userId, folderId, message } = payload;
    if (!userId || !folderId || !message) {
      sendJson(res, 400, { error: "Missing userId, folderId, or message" });
      return true;
    }

    const eventType = (payload.type as string) || "peer_message_created";
    broadcastToUser(userId as string, {
      type: eventType,
      folderId,
      channelId: payload.channelId ?? null,
      parentMessageId: payload.parentMessageId ?? null,
      message,
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /internal/peers/cleanup
  if (pathname === "/internal/peers/cleanup" && req.method === "POST") {
    try {
      const PeerService = await import("@/services/peer-service");
      await PeerService.cleanupOldMessages();
      sendJson(res, 200, { ok: true });
    } catch (err) {
      peerLog.error("Failed to cleanup peer messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to cleanup" });
    }
    return true;
  }

  // ═══ Channel endpoints ════════════════════════════════════════════════════

  /** Look up a session's folderId and userId by session ID. */
  async function getSessionFolderContext(sessionId: string): Promise<{ folderId: string; userId: string } | null> {
    const { terminalSessions } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const session = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.id, sessionId),
      columns: { folderId: true, userId: true },
    });
    if (!session?.folderId || !session.userId) return null;
    return { folderId: session.folderId, userId: session.userId };
  }

  /** Resolve a channel name to its ID within a folder. */
  async function resolveChannelName(folderId: string, channelName: string): Promise<string | undefined> {
    const { channels: channelsTable } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const ch = await db.query.channels.findFirst({
      where: and(eq(channelsTable.folderId, folderId), eq(channelsTable.name, channelName)),
      columns: { id: true },
    });
    return ch?.id;
  }

  // GET /internal/channels/list?sessionId=xxx
  if (pathname === "/internal/channels/list" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(sessionId);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const ChannelService = await import("@/services/channel-service");
      const groups = await ChannelService.listChannelGroups(ctx.folderId, ctx.userId);
      sendJson(res, 200, { groups });
    } catch (err) {
      peerLog.error("Failed to list channels", { error: String(err) });
      sendJson(res, 500, { error: "Failed to list channels" });
    }
    return true;
  }

  // POST /internal/channels/create { fromSessionId, name, topic?, displayName? }
  if (pathname === "/internal/channels/create" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, name, topic, displayName } = payload;
    if (!fromSessionId || !name) {
      sendJson(res, 400, { error: "Missing fromSessionId or name" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(fromSessionId as string);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const ChannelService = await import("@/services/channel-service");
      const channel = await ChannelService.createChannel({
        folderId: ctx.folderId,
        name: name as string,
        displayName: displayName as string | undefined,
        topic: topic as string | undefined,
        createdBySessionId: fromSessionId as string,
      });

      broadcastToUser(ctx.userId, {
        type: "channel_created",
        folderId: ctx.folderId,
        channel,
      });

      sendJson(res, 201, { channel });
    } catch (err) {
      peerLog.error("Failed to create channel", { error: String(err) });
      sendJson(res, 400, { error: String(err) });
    }
    return true;
  }

  // POST /internal/channels/send { fromSessionId, channelId?, channelName?, body, parentMessageId? }
  if (pathname === "/internal/channels/send" && req.method === "POST") {
    const payload = await parseRequestJson(req, res);
    if (!payload) return true;

    const { fromSessionId, channelId, channelName, body: msgBody, parentMessageId } = payload;
    if (!fromSessionId || !msgBody) {
      sendJson(res, 400, { error: "Missing fromSessionId or body" });
      return true;
    }

    try {
      let resolvedChannelId = channelId as string | undefined;

      // Resolve channel name to ID if needed
      if (!resolvedChannelId && channelName) {
        const ctx = await getSessionFolderContext(fromSessionId as string);
        if (ctx) {
          resolvedChannelId = await resolveChannelName(ctx.folderId, channelName as string);
        }
        if (!resolvedChannelId) {
          sendJson(res, 404, { error: `Channel '${channelName}' not found` });
          return true;
        }
      }

      const PeerService = await import("@/services/peer-service");
      const result = await PeerService.sendMessage({
        fromSessionId: fromSessionId as string,
        body: msgBody as string,
        channelId: resolvedChannelId,
        parentMessageId: parentMessageId as string | undefined,
      });

      const eventType = parentMessageId ? "thread_reply_created" : "channel_message_created";
      const effectiveChannelId = result.channelId ?? resolvedChannelId ?? null;
      broadcastToUser(result.userId, {
        type: eventType,
        folderId: result.folderId,
        channelId: effectiveChannelId,
        parentMessageId: parentMessageId ?? null,
        message: {
          id: result.messageId,
          fromSessionId,
          fromSessionName: result.senderName,
          toSessionId: null,
          body: result.resolvedBody,
          isUserMessage: false,
          channelId: effectiveChannelId,
          parentMessageId: parentMessageId ?? null,
          replyCount: 0,
          createdAt: result.createdAt,
        },
      });

      // Push to MCP server sockets for channel messages (fire-and-forget)
      const mentionRe = /@<sid:([0-9a-f-]{36})>/g;
      const mentions = new Set<string>();
      let mentionMatch: RegExpExecArray | null;
      while ((mentionMatch = mentionRe.exec(result.resolvedBody)) !== null) {
        mentions.add(mentionMatch[1]);
      }
      const chSenderSid = String(fromSessionId);
      // Resolve channel name for the push event — may be null if sent by channelId only
      let resolvedChannelName = channelName ? String(channelName) : null;
      if (!resolvedChannelName && effectiveChannelId) {
        try {
          const { channels: channelsTable } = await import("@/db/schema");
          const { eq } = await import("drizzle-orm");
          const { db } = await import("@/db");
          const ch = await db.query.channels.findFirst({
            where: eq(channelsTable.id, effectiveChannelId),
            columns: { name: true },
          });
          if (ch) resolvedChannelName = ch.name;
        } catch { /* non-critical, name will be null in push */ }
      }
      pushMcpEventToFolderPeers(result.folderId, chSenderSid, (peerId) => ({
        type: mentions.has(peerId) ? "mention" : "channel_message",
        messageId: result.messageId,
        fromSessionId: chSenderSid,
        fromSessionName: result.senderName,
        toSessionId: null,
        body: result.resolvedBody,
        channelId: effectiveChannelId,
        channelName: resolvedChannelName,
        parentMessageId: parentMessageId ? String(parentMessageId) : null,
        createdAt: result.createdAt,
      })).catch(() => {});

      sendJson(res, 200, { messageId: result.messageId, resolvedBody: result.resolvedBody });
    } catch (err) {
      peerLog.error("Failed to send channel message", { error: String(err) });
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /internal/channels/messages?sessionId=xxx&channelName=yyy&limit=20
  if (pathname === "/internal/channels/messages" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    const channelName = query.channelName as string;
    const limit = Math.min(Math.max(1, parseInt(query.limit as string || "20", 10) || 20), 50);

    if (!sessionId || !channelName) {
      sendJson(res, 400, { error: "Missing sessionId or channelName" });
      return true;
    }

    try {
      const ctx = await getSessionFolderContext(sessionId);
      if (!ctx) {
        sendJson(res, 404, { error: "Session not found or has no folder" });
        return true;
      }

      const channelDbId = await resolveChannelName(ctx.folderId, channelName);
      if (!channelDbId) {
        sendJson(res, 404, { error: `Channel '${channelName}' not found` });
        return true;
      }

      const PeerService = await import("@/services/peer-service");
      const messages = await PeerService.listChannelMessages(channelDbId, { limit });
      sendJson(res, 200, { channelId: channelDbId, messages });
    } catch (err) {
      peerLog.error("Failed to read channel messages", { error: String(err) });
      sendJson(res, 500, { error: "Failed to read channel messages" });
    }
    return true;
  }

  // --- end cmux parity endpoints ---

  // --- ccflare process manager endpoints ---

  // POST /internal/ccflare/start — start the ccflare proxy process
  if (pathname === "/internal/ccflare/start" && req.method === "POST") {
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const port = typeof payload.port === "number" ? payload.port : 8787;
      const { ccflareProcessManager } = await import("@/services/ccflare-process-manager");
      await ccflareProcessManager.start({ port });
      sendJson(res, 200, ccflareProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to start ccflare", { error: String(err) });
      sendJson(res, 500, { error: "Failed to start ccflare" });
    }
    return true;
  }

  // POST /internal/ccflare/stop — stop the ccflare proxy process
  if (pathname === "/internal/ccflare/stop" && req.method === "POST") {
    try {
      const { ccflareProcessManager } = await import("@/services/ccflare-process-manager");
      await ccflareProcessManager.stop();
      sendJson(res, 200, { success: true });
    } catch (err) {
      internalLog.error("Failed to stop ccflare", { error: String(err) });
      sendJson(res, 500, { error: "Failed to stop ccflare" });
    }
    return true;
  }

  // POST /internal/ccflare/restart — restart the ccflare proxy process
  if (pathname === "/internal/ccflare/restart" && req.method === "POST") {
    try {
      const payload = await parseRequestJson(req, res);
      if (!payload) return true;
      const port = typeof payload.port === "number" ? payload.port : 8787;
      const { ccflareProcessManager } = await import("@/services/ccflare-process-manager");
      await ccflareProcessManager.restart({ port });
      sendJson(res, 200, ccflareProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to restart ccflare", { error: String(err) });
      sendJson(res, 500, { error: "Failed to restart ccflare" });
    }
    return true;
  }

  // GET /internal/ccflare/status — get the ccflare proxy status
  if (pathname === "/internal/ccflare/status" && req.method === "GET") {
    try {
      const { ccflareProcessManager } = await import("@/services/ccflare-process-manager");
      sendJson(res, 200, ccflareProcessManager.getStatus());
    } catch (err) {
      internalLog.error("Failed to get ccflare status", { error: String(err) });
      sendJson(res, 500, { error: "Failed to get ccflare status" });
    }
    return true;
  }

  // --- end ccflare endpoints ---

  if (!pathname?.startsWith("/internal/scheduler/")) {
    return false;
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${getAuthSecret()}`) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }

  const body = req.method === "POST" ? await readRequestBody(req) : "";
  const action = pathname.replace("/internal/scheduler/", "");

  try {
    const parsed = body ? JSON.parse(body) : {};

    switch (action) {
      case "add":
        await schedulerOrchestrator.addJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "update":
        await schedulerOrchestrator.updateJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "remove":
        schedulerOrchestrator.removeJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "pause":
        schedulerOrchestrator.pauseJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "resume":
        schedulerOrchestrator.resumeJob(parsed.scheduleId);
        sendJson(res, 200, { success: true });
        break;
      case "remove-session":
        schedulerOrchestrator.removeSessionJobs(parsed.sessionId);
        sendJson(res, 200, { success: true });
        break;
      case "status":
        sendJson(res, 200, {
          running: schedulerOrchestrator.isStarted(),
          jobCount: schedulerOrchestrator.getJobCount(),
          jobs: schedulerOrchestrator.getStatus(),
        });
        break;
      default:
        sendJson(res, 404, { error: "Unknown action" });
    }
  } catch (error) {
    internalLog.error("Scheduler error", { error: String(error) });
    sendJson(res, 500, { error: "Internal error" });
  }
  return true;
}

interface ServerOptions {
  port?: number;
  socket?: string;
}

export function createTerminalServer(options: ServerOptions = { port: 6002 }) {
  // Check tmux is installed at startup
  if (!checkTmuxInstalled()) {
    log.error("tmux is not installed. Please install with: brew install tmux");
    log.error("Terminal persistence will not work without tmux.");
    // Continue anyway for development, but log the warning
  } else {
    log.info("tmux detected - session persistence enabled");
  }

  // Create HTTP server to handle both WebSocket upgrades and internal API
  const server = createServer(async (req, res) => {
    // Try to handle as internal API request
    const handled = await handleInternalApi(req, res);
    if (!handled) {
      // Not an API request - return 404 for regular HTTP
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("WebSocket endpoint only");
    }
  });

  // Attach WebSocket server to HTTP server
  const wss = new WebSocketServer({ server });

  // Listen on socket or port
  if (options.socket) {
    server.listen(options.socket, () => {
      log.info("Terminal server running", { transport: "unix", socket: options.socket, websocket: `unix:${options.socket}`, internalApi: `unix:${options.socket}/internal/scheduler/*` });
    });
  } else {
    const port = options.port || 6002;
    server.listen(port, () => {
      log.info("Terminal server running", { transport: "http", port, websocket: `ws://localhost:${port}`, internalApi: `http://localhost:${port}/internal/scheduler/*` });
    });
  }

  // Periodic peer message cleanup (hourly, 24h TTL)
  setInterval(() => {
    import("@/services/peer-service")
      .then((PeerService) => PeerService.cleanupOldMessages())
      .catch((err) => peerLog.error("Periodic peer cleanup failed", { error: String(err) }));
  }, 60 * 60 * 1000);

  wss.on("connection", async (ws, req) => {
    const query = Object.fromEntries(new URL(req.url || "", "http://localhost").searchParams);

    // SECURITY: Validate authentication token
    const token = query.token as string | undefined;
    if (!token) {
      ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
      ws.close(4001, "Authentication required");
      return;
    }

    const authResult = validateWsToken(token);
    if (!authResult) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }));
      ws.close(4002, "Invalid or expired token");
      return;
    }

    // Parse connection parameters
    const sessionId = authResult.sessionId;
    const userId = authResult.userId;
    const tmuxSessionName = (query.tmuxSession as string) || `rdv-${sessionId}`;
    const cols = parseInt(query.cols as string) || 80;
    const rows = parseInt(query.rows as string) || 24;
    const rawCwd = query.cwd as string | undefined;
    // tmux history-limit (scrollback buffer) - default 50000 lines
    const tmuxHistoryLimit = parseInt(query.tmuxHistoryLimit as string) || 50000;
    // Terminal type for agent exit detection
    const terminalType = (query.terminalType as string) || "shell";

    // SECURITY: Validate tmux session name to prevent command injection
    if (!validateSessionName(tmuxSessionName)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid session name" }));
      ws.close(4003, "Invalid session name");
      return;
    }

    // SECURITY: Validate cwd to prevent path traversal
    const cwd = validatePath(rawCwd);

    // Generate a unique connection ID for multi-client support
    const connectionId = randomUUID();

    // Check if tmux session exists (for attach vs create decision)
    const tmuxExists = tmuxSessionExists(tmuxSessionName);

    log.debug("Connection request", { connectionId, sessionId, tmuxSessionName, tmuxExists });

    let ptyProcess: IPty;

    try {
      if (tmuxExists) {
        // Attach to existing tmux session
        log.debug("Attaching to existing tmux session", { tmuxSessionName });
        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_attached",
          sessionId,
          tmuxSessionName,
        }));
      } else {
        // Create new tmux session
        log.debug("Creating new tmux session", { tmuxSessionName, historyLimit: tmuxHistoryLimit });
        createTmuxSession(tmuxSessionName, cols, rows, cwd, tmuxHistoryLimit);

        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_created",
          sessionId,
          tmuxSessionName,
        }));
      }
    } catch (error) {
      log.error("Failed to create/attach tmux session", { connectionId, sessionId, error: String(error) });
      ws.send(JSON.stringify({
        type: "error",
        message: `Failed to create terminal session: ${(error as Error).message}`,
      }));
      ws.close();
      return;
    }

    const connection: TerminalConnection = {
      connectionId,
      pty: ptyProcess,
      ws,
      sessionId,
      tmuxSessionName,
      isAttached: true,
      lastCols: cols,
      lastRows: rows,
      pendingResize: null,
      resizeTimeout: null,
      terminalType,
      userId,
      voiceFifoPath: null,
      voiceFifoFd: null,
      voiceAudioBuffer: [],
      voiceFifoReady: false,
      voiceSpaceInterval: null,
    };

    // Register connection in both maps
    connections.set(connectionId, connection);
    if (!sessionConnections.has(sessionId)) {
      sessionConnections.set(sessionId, new Set());
    }
    sessionConnections.get(sessionId)!.add(connectionId);
    // Newest connection is primary for resize
    sessionPrimaryConnection.set(sessionId, connectionId);

    log.debug("Terminal connection started", { connectionId, sessionId, cols, rows, tmuxSessionName });

    // Note: Environment variables are now injected at session creation time
    // (in TmuxService.createSession) BEFORE the startup command runs.
    // The WebSocket environmentVars parameter is kept for potential future use
    // but is no longer used for injection here.

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.debug("PTY exited", { connectionId, sessionId, exitCode, terminalType });

      if (!connections.has(connectionId)) {
        log.debug("Stale PTY exit ignored", { connectionId, sessionId });
        return;
      }

      // Each connection has its own PTY (tmux attach-session process).
      // When the tmux session dies, ALL connections' PTYs exit independently.
      // Only notify THIS connection's WebSocket to avoid duplicate messages.
      if (ws.readyState === WebSocket.OPEN) {
        if (isAgentTerminalType(terminalType)) {
          agentLog.info("Agent PTY exited", { connectionId, sessionId, exitCode });
          ws.send(JSON.stringify(agentExitedEvent(sessionId, exitCode)));
        } else {
          ws.send(JSON.stringify({ type: "exit", code: exitCode }));
          ws.close();
        }
      }
      cleanupConnection(connectionId);
    });

    ws.on("message", (message, isBinary) => {
      try {
        // Handle binary voice audio frames
        if (isBinary) {
          const buf = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);
          if (buf.length > 1 && buf[0] === VOICE_AUDIO_PREFIX) {
            const pcmData = buf.subarray(1);
            if (connection.voiceFifoReady && connection.voiceFifoFd !== null) {
              fs.write(connection.voiceFifoFd, pcmData, (writeErr) => {
                if (writeErr) {
                  voiceLog.warn("FIFO write error", { error: writeErr.message });
                }
              });
            } else if (connection.voiceAudioBuffer.length < MAX_VOICE_BUFFER_CHUNKS) {
              connection.voiceAudioBuffer.push(pcmData);
            }
            return;
          }
        }

        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            connection.pty.write(msg.data);
            break;
          case "resize": {
            // Ignore resize events with invalid dimensions
            // This prevents tmux from shrinking when tabs are hidden
            const MIN_COLS = 10;
            const MIN_ROWS = 3;
            const nextCols = Number(msg.cols);
            const nextRows = Number(msg.rows);
            if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) {
              break;
            }
            if (nextCols < MIN_COLS || nextRows < MIN_ROWS) {
              break;
            }

            connection.pendingResize = { cols: nextCols, rows: nextRows };
            if (connection.resizeTimeout) {
              break;
            }

            connection.resizeTimeout = setTimeout(() => {
              const pending = connection.pendingResize;
              connection.pendingResize = null;
              connection.resizeTimeout = null;

              if (!pending) return;
              if (pending.cols === connection.lastCols && pending.rows === connection.lastRows) {
                return;
              }

              connection.lastCols = pending.cols;
              connection.lastRows = pending.rows;

              // Always resize this connection's PTY
              try {
                connection.pty.resize(pending.cols, pending.rows);
              } catch {
                // Ignore resize errors from pty
              }

              // Only resize the tmux window if this is the primary connection
              if (sessionPrimaryConnection.get(sessionId) === connectionId) {
                execFile(
                  "tmux",
                  [
                    "resize-window",
                    "-t",
                    tmuxSessionName,
                    "-x",
                    String(pending.cols),
                    "-y",
                    String(pending.rows),
                  ],
                  () => {}
                );
              }
            }, 50);
            break;
          }
          case "detach":
            log.debug("Detaching from tmux session", { connectionId, sessionId, tmuxSessionName });
            cleanupConnection(connectionId);
            ws.close();
            break;

          case "restart_agent": {
            if (!isAgentTerminalType(terminalType)) {
              ws.send(JSON.stringify({
                type: "error",
                message: "restart_agent is only valid for agent sessions",
              }));
              break;
            }

            agentLog.info("Restarting agent session", { connectionId, sessionId });
            // Collect other connections BEFORE the try block so the error
            // handler can clean up orphaned sessionConnections entries.
            const otherConns = getConnectionsForSession(sessionId).filter(
              (c) => c.connectionId !== connectionId
            );
            try {
              // Destroy PTYs for ALL connections to this session before
              // killing the tmux session, so their onExit handlers see the
              // connection already removed and skip the stale-exit path.
              for (const other of otherConns) {
                safeDestroyPty(other.pty);
                connections.delete(other.connectionId);
              }
              safeDestroyPty(connection.pty);

              // Use synchronous kill so the session is fully gone before we
              // recreate it — avoids a race between async kill and sync create.
              try {
                execFileSync("tmux", ["kill-session", "-t", tmuxSessionName], { stdio: "pipe" });
              } catch { /* session may already be dead */ }
              createTmuxSession(tmuxSessionName, connection.lastCols, connection.lastRows, cwd, tmuxHistoryLimit);

              const newPty = attachToTmuxSession(tmuxSessionName, connection.lastCols, connection.lastRows);
              connection.pty = newPty;

              // Reconnect other connections to the new tmux session
              for (const other of otherConns) {
                try {
                  const otherPty = attachToTmuxSession(tmuxSessionName, other.lastCols, other.lastRows);
                  other.pty = otherPty;
                  connections.set(other.connectionId, other);
                  otherPty.onData((data) => {
                    if (other.ws.readyState === WebSocket.OPEN) {
                      other.ws.send(JSON.stringify({ type: "output", data }));
                    }
                  });
                  otherPty.onExit(({ exitCode: otherExitCode }) => {
                    if (!connections.has(other.connectionId)) return;
                    if (other.ws.readyState === WebSocket.OPEN) {
                      other.ws.send(JSON.stringify(agentExitedEvent(sessionId, otherExitCode)));
                    }
                    cleanupConnection(other.connectionId);
                  });
                } catch (reattachErr) {
                  agentLog.warn("Failed to reattach other connection after restart", {
                    connectionId: other.connectionId,
                    error: String(reattachErr),
                  });
                  // Clean up the failed connection
                  const connSet = sessionConnections.get(sessionId);
                  if (connSet) connSet.delete(other.connectionId);
                  if (other.ws.readyState === WebSocket.OPEN) {
                    other.ws.send(JSON.stringify({
                      type: "error",
                      message: "Lost connection during agent restart",
                    }));
                    other.ws.close();
                  }
                }
              }

              newPty.onData((data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "output", data }));
                }
              });

              newPty.onExit(({ exitCode: newExitCode }) => {
                agentLog.info("Restarted agent session exited", { connectionId, sessionId, exitCode: newExitCode });
                if (!connections.has(connectionId)) {
                  log.debug("Stale restarted PTY exit ignored", { connectionId, sessionId });
                  return;
                }
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(agentExitedEvent(sessionId, newExitCode)));
                }
                cleanupConnection(connectionId);
              });

              broadcastToSession(sessionId, {
                type: "agent_restarted",
                sessionId,
                tmuxSessionName,
              });
            } catch (error) {
              agentLog.error("Failed to restart agent session", { connectionId, sessionId, error: String(error) });
              // Other connections were removed from `connections` but may still
              // be in `sessionConnections`. Clean up the orphaned entries so
              // session-level state is properly released.
              const connSet = sessionConnections.get(sessionId);
              if (connSet) {
                for (const other of otherConns) {
                  connSet.delete(other.connectionId);
                  if (other.ws.readyState === WebSocket.OPEN) {
                    other.ws.send(JSON.stringify({
                      type: "error",
                      message: "Lost connection during agent restart",
                    }));
                    other.ws.close();
                  }
                }
              }
              cleanupConnection(connectionId);
              ws.send(JSON.stringify({
                type: "error",
                message: `Failed to restart agent: ${(error as Error).message}`,
              }));
            }
            break;
          }

          case "voice_start": {
            if (!isAgentTerminalType(connection.terminalType)) {
              ws.send(JSON.stringify({ type: "voice_error", message: "Voice mode is only available for agent sessions" }));
              break;
            }
            try {
              const fifoPath = createVoiceFifo(connection);
              voiceLog.debug("Created FIFO", { connectionId, sessionId, fifoPath });
              // Simulate holding SPACE to trigger Claude Code voice recording.
              // Send initial space immediately, then repeat at 50ms to mimic key-hold.
              // Server-side avoids round-trip latency from browser -> WS -> server.
              connection.pty.write(" ");
              connection.voiceSpaceInterval = setInterval(() => {
                if (connections.has(connectionId)) {
                  connection.pty.write(" ");
                } else {
                  clearInterval(connection.voiceSpaceInterval!);
                  connection.voiceSpaceInterval = null;
                }
              }, 50);
              ws.send(JSON.stringify({ type: "voice_ready", sessionId }));
            } catch (error) {
              voiceLog.error("Failed to create FIFO", { connectionId, sessionId, error: String(error) });
              ws.send(JSON.stringify({ type: "voice_error", message: `Voice setup failed: ${(error as Error).message}` }));
            }
            break;
          }

          case "voice_stop": {
            voiceLog.debug("Stopping voice", { connectionId, sessionId });
            // Stop simulating SPACE hold
            if (connection.voiceSpaceInterval) {
              clearInterval(connection.voiceSpaceInterval);
              connection.voiceSpaceInterval = null;
            }
            if (connection.voiceFifoFd !== null) {
              try {
                const silencePadding = Buffer.alloc(3200); // 100ms silence at 16kHz/16bit
                fs.writeSync(connection.voiceFifoFd, silencePadding);
              } catch { /* ignore */ }
            }
            cleanupVoiceFifo(connection);
            break;
          }
        }
      } catch {
        // JSON parse error on non-binary message — forward raw text to PTY
        if (connections.has(connectionId)) {
          connection.pty.write(message.toString());
        }
      }
    });

    ws.on("close", () => {
      log.debug("WebSocket closed", { connectionId, sessionId });
      if (!connections.has(connectionId)) return;
      cleanupConnection(connectionId);
    });

    ws.on("error", (error) => {
      log.error("Terminal connection error", { connectionId, sessionId, error: String(error) });
      if (!connections.has(connectionId)) return;
      cleanupConnection(connectionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId, tmuxSessionName }));
  });

  return wss;
}

// Graceful shutdown: destroy PTY wrappers but preserve tmux sessions for reconnection
function cleanup() {
  log.info("Shutting down terminal server (tmux sessions preserved)...");
  for (const [id, conn] of connections) {
    cleanupVoiceFifo(conn);
    safeDestroyPty(conn.pty);
    conn.ws.close();
    log.debug("Closed PTY wrapper", { connectionId: id, sessionId: conn.sessionId });
  }
  connections.clear();
  sessionConnections.clear();
  sessionPrimaryConnection.clear();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
