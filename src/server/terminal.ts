import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

import { execFile, execFileSync } from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import { resolve as pathResolve } from "path";
import { schedulerOrchestrator } from "../services/scheduler-orchestrator.js";
import { validateWsToken, getAuthSecret } from "../lib/ws-token.js";

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
  return env;
}

/**
 * Validate a tmux session name to prevent command injection.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
function validateSessionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
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


interface TerminalSession {
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

const sessions = new Map<string, TerminalSession>();

/** Broadcast a JSON message to all connected WebSocket clients */
function broadcastToClients(data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  for (const [, s] of sessions) {
    if (s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(message);
    }
  }
}

/** Broadcast a JSON message to clients connected to a specific session */
function broadcastToSession(sessionId: string, data: Record<string, unknown>): void {
  const message = JSON.stringify(data);
  const session = sessions.get(sessionId);
  if (session?.ws.readyState === WebSocket.OPEN) {
    session.ws.send(message);
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

// Track sessions currently in the process of connecting to prevent rapid reconnection
// that can exhaust PTY/FD resources and cause posix_spawnp failures
const connectingSessionIds = new Set<string>();

/**
 * Safely cleanup a terminal session. Guards against double-cleanup from
 * concurrent events (PTY exit, WebSocket close, WebSocket error).
 */
function cleanupSession(sessionId: string): void {
  connectingSessionIds.delete(sessionId);

  const session = sessions.get(sessionId);
  if (!session) return;

  // Remove first to prevent concurrent cleanup from other event handlers
  sessions.delete(sessionId);

  if (session.resizeTimeout) {
    clearTimeout(session.resizeTimeout);
  }

  // Clean up voice space interval and FIFO
  if (session.voiceSpaceInterval) {
    clearInterval(session.voiceSpaceInterval);
    session.voiceSpaceInterval = null;
  }
  cleanupVoiceFifo(session);

  try {
    destroyPty(session.pty);
  } catch {
    // PTY may already be dead
  }
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
function createVoiceFifo(session: TerminalSession): string {
  const fifoPath = `${tmpdir()}/rdv-voice-${session.sessionId}.fifo`;
  try { fs.unlinkSync(fifoPath); } catch { /* may not exist */ }
  execFileSync("mkfifo", ["-m", "0600", fifoPath]);
  session.voiceFifoPath = fifoPath;
  session.voiceAudioBuffer = [];
  session.voiceFifoReady = false;

  // Open FIFO for writing asynchronously — blocks until reader opens
  fs.open(fifoPath, fs.constants.O_WRONLY, (err, fd) => {
    if (err) {
      console.error(`[Voice] Failed to open FIFO for writing: ${err.message}`);
      return;
    }
    session.voiceFifoFd = fd;
    // Flush buffered audio before marking ready
    for (const chunk of session.voiceAudioBuffer) {
      try {
        fs.writeSync(fd, chunk);
      } catch (flushErr) {
        console.warn(`[Voice] Failed to flush buffered chunk: ${flushErr}`);
        break;
      }
    }
    session.voiceAudioBuffer = [];
    session.voiceFifoReady = true;
    console.log(`[Voice] FIFO writer connected for session ${session.sessionId}`);
  });

  return fifoPath;
}

/**
 * Clean up voice FIFO resources: close file descriptor, remove pipe, reset state.
 */
function cleanupVoiceFifo(session: TerminalSession): void {
  if (session.voiceFifoFd !== null) {
    try { fs.closeSync(session.voiceFifoFd); } catch { /* may be closed */ }
    session.voiceFifoFd = null;
  }
  if (session.voiceFifoPath) {
    try { fs.unlinkSync(session.voiceFifoPath); } catch { /* may be deleted */ }
    session.voiceFifoPath = null;
  }
  session.voiceFifoReady = false;
  session.voiceAudioBuffer = [];
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

  // Handle agent exit notification from tmux hook
  // Called when agent process exits: POST /internal/agent-exit?sessionId=xxx&exitCode=0
  if (pathname === "/internal/agent-exit" && req.method === "POST") {
    const sessionId = query.sessionId as string;
    const exitCode = query.exitCode ? parseInt(query.exitCode as string, 10) : null;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    console.log(`[Agent Exit] Session ${sessionId} exited with code ${exitCode ?? "unknown"}`);

    // Find the WebSocket connection for this session and notify the client
    const session = sessions.get(sessionId);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: "agent_exited",
          sessionId,
          exitCode,
          exitedAt: new Date().toISOString(),
        })
      );
      console.log(`[Agent Exit] Notified client for session ${sessionId}`);
    } else {
      console.log(`[Agent Exit] No active WebSocket for session ${sessionId}`);
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
      .catch((err) => console.error("[Agent Status] Failed to persist activity status:", err));

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
        .catch((err) => console.error("[Agent Status] Failed to create notification:", err));
    }

    sendJson(res, 200, { success: true });
    return true;
  }

  // --- Localhost restriction for internal task endpoints ---
  const isInternalTaskEndpoint =
    pathname === "/internal/agent-stop-check" ||
    pathname === "/internal/agent-todos" ||
    pathname === "/internal/tasks" ||
    pathname.startsWith("/internal/tasks/");
  if (isInternalTaskEndpoint) {
    if (!isLocalhostRequest(req)) {
      sendJson(res, 403, { error: "Forbidden: localhost only" });
      return true;
    }
  }

  // Handle agent stop task check from Claude Code Stop hook
  // Called by hooks: POST /internal/agent-stop-check?sessionId=xxx
  // Returns incomplete tasks as text (agent should continue) or empty (agent can stop)
  if (pathname === "/internal/agent-stop-check" && req.method === "POST") {
    const sessionId = query.sessionId as string;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    try {
      const { checkTasksOnStop } = await import("@/services/agent-todo-sync");
      const message = await checkTasksOnStop(sessionId);
      const wantsText = req.headers.accept?.includes("text/plain");
      if (wantsText) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(message ?? "");
      } else {
        sendJson(res, 200, { message: message ?? null });
      }
    } catch (error) {
      console.error("[Agent Stop Check] Error:", error);
      // On error, allow the agent to stop (don't block on failures)
      const wantsText = req.headers.accept?.includes("text/plain");
      if (wantsText) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("");
      } else {
        sendJson(res, 200, { message: null });
      }
    }

    return true;
  }

  // Handle agent task sync from Claude Code PostToolUse hooks
  // Called by hooks: POST /internal/agent-todos?sessionId=xxx
  // Body: Claude Code PostToolUse stdin JSON (TaskCreate/TaskUpdate/TodoWrite)
  if (pathname === "/internal/agent-todos" && req.method === "POST") {
    const sessionId = query.sessionId as string;

    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const { syncAgentTodos } = await import("@/services/agent-todo-sync");
      const result = await syncAgentTodos(sessionId, payload);
      broadcastToClients({ type: "agent_todos_updated", sessionId, ...result });
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      console.error("[Agent Todos] Sync error:", error);
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }

    return true;
  }

  // Handle direct task CRUD from rdv CLI
  // GET /internal/tasks?sessionId=xxx - list tasks for session
  if (pathname === "/internal/tasks" && req.method === "GET") {
    const sessionId = query.sessionId as string;
    if (!sessionId) {
      sendJson(res, 400, { error: "Missing sessionId parameter" });
      return true;
    }
    try {
      const { getSessionContext, getAllTasksBySession } = await import("@/services/task-service");
      const session = await getSessionContext(sessionId);
      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      const tasks = await getAllTasksBySession(sessionId, session.userId);
      sendJson(res, 200, tasks);
    } catch (error) {
      console.error("[Internal Tasks] List error:", error);
      sendJson(res, 500, { error: "Failed to list tasks" });
    }
    return true;
  }

  // POST /internal/tasks - create task for session
  if (pathname === "/internal/tasks" && req.method === "POST") {
    const input = await parseRequestJson(req, res);
    if (!input) return true;
    try {
      const sessionId = input.sessionId as string;
      if (!sessionId) {
        sendJson(res, 400, { error: "Missing sessionId in body" });
        return true;
      }
      const title = input.title as string | undefined;
      if (!title?.trim()) {
        sendJson(res, 400, { error: "title is required" });
        return true;
      }
      const { getSessionContext, createTask } = await import("@/services/task-service");
      const session = await getSessionContext(sessionId);
      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      const task = await createTask(session.userId, {
        folderId: session.folderId,
        sessionId,
        title,
        description: (input.description as string | null) ?? null,
        priority: (input.priority as "critical" | "high" | "medium" | "low" | undefined) ?? "medium",
        source: "agent",
      });
      broadcastToClients({ type: "agent_todos_updated", sessionId, created: 1, updated: 0 });
      sendJson(res, 201, task);
    } catch (error) {
      console.error("[Internal Tasks] Create error:", error);
      sendJson(res, 500, { error: "Failed to create task" });
    }
    return true;
  }

  // PATCH /internal/tasks/:id - update task
  if (pathname.startsWith("/internal/tasks/") && req.method === "PATCH") {
    const taskId = pathname.replace("/internal/tasks/", "");
    if (!taskId) {
      sendJson(res, 400, { error: "Missing task ID" });
      return true;
    }
    const input = await parseRequestJson(req, res);
    if (!input) return true;
    try {
      const { getSessionContext, updateTask, getTaskOwner } = await import("@/services/task-service");

      // Resolve userId: try sessionId from query/body, then look up from task
      const sessionId = (query.sessionId as string) || (input.sessionId as string);
      let userId: string | undefined;

      if (sessionId) {
        const session = await getSessionContext(sessionId);
        if (session) userId = session.userId;
      }

      if (!userId) {
        const owner = await getTaskOwner(taskId);
        if (owner) userId = owner.userId;
      }

      if (!userId) {
        sendJson(res, 404, { error: "Task not found" });
        return true;
      }

      const task = await updateTask(taskId, userId, input);
      if (!task) {
        sendJson(res, 404, { error: "Task not found" });
        return true;
      }

      if (task.sessionId) {
        broadcastToClients({ type: "agent_todos_updated", sessionId: task.sessionId, created: 0, updated: 1 });
      }
      sendJson(res, 200, task);
    } catch (error) {
      console.error("[Internal Tasks] Update error:", error);
      sendJson(res, 500, { error: "Failed to update task" });
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
    console.error("[InternalAPI] Scheduler error:", error);
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
    console.error("ERROR: tmux is not installed. Please install with: brew install tmux");
    console.error("Terminal persistence will not work without tmux.");
    // Continue anyway for development, but log the warning
  } else {
    console.log("tmux detected - session persistence enabled");
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
      console.log(`Terminal server running on unix:${options.socket}`);
      console.log(`  - WebSocket: unix:${options.socket}`);
      console.log(`  - Internal API: unix:${options.socket}/internal/scheduler/*`);
    });
  } else {
    const port = options.port || 6002;
    server.listen(port, () => {
      console.log(`Terminal server running on http://localhost:${port}`);
      console.log(`  - WebSocket: ws://localhost:${port}`);
      console.log(`  - Internal API: http://localhost:${port}/internal/scheduler/*`);
    });
  }

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

    // Prevent rapid reconnection attempts that can exhaust PTY resources
    // If this session is already in the process of connecting, reject
    if (connectingSessionIds.has(sessionId)) {
      console.warn(`Connection rejected: session ${sessionId} is already connecting`);
      ws.send(JSON.stringify({ type: "error", message: "Connection in progress, please wait" }));
      ws.close(4004, "Connection in progress");
      return;
    }
    connectingSessionIds.add(sessionId);

    // Check if tmux session exists (for attach vs create decision)
    const tmuxExists = tmuxSessionExists(tmuxSessionName);

    console.log(`Connection request: sessionId=${sessionId}, tmux=${tmuxSessionName}, tmuxExists=${tmuxExists}`);

    let ptyProcess: IPty;

    try {
      if (tmuxExists) {
        // Attach to existing tmux session
        console.log(`Attaching to existing tmux session: ${tmuxSessionName}`);
        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_attached",
          sessionId,
          tmuxSessionName,
        }));
      } else {
        // Create new tmux session
        console.log(`Creating new tmux session: ${tmuxSessionName} (history-limit: ${tmuxHistoryLimit})`);
        createTmuxSession(tmuxSessionName, cols, rows, cwd, tmuxHistoryLimit);

        // Set up voice mode environment for agent sessions
        if (terminalType === "agent") {
          try {
            const { ensureSoxShim } = await import("@/services/voice-shim-service.js");
            const shimDir = ensureSoxShim();
            execFileSync("tmux", ["set-environment", "-t", tmuxSessionName, "PATH", `${shimDir}:${process.env.PATH || ""}`]);
          } catch (error) {
            console.warn(`[Voice] Failed to install sox shim for ${sessionId}:`, error);
            // Non-fatal — voice just won't work for this session
          }
        }

        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_created",
          sessionId,
          tmuxSessionName,
        }));
      }
    } catch (error) {
      console.error(`Failed to create/attach tmux session: ${error}`);
      connectingSessionIds.delete(sessionId);
      ws.send(JSON.stringify({
        type: "error",
        message: `Failed to create terminal session: ${(error as Error).message}`,
      }));
      ws.close();
      return;
    }

    const session: TerminalSession = {
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

    sessions.set(sessionId, session);
    // Connection established, allow future reconnection attempts
    connectingSessionIds.delete(sessionId);

    console.log(`Terminal session ${sessionId} started (${cols}x${rows}) - tmux: ${tmuxSessionName}`);

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
      console.log(`Terminal session ${sessionId} PTY exited with code ${exitCode} (type: ${terminalType})`);

      if (ws.readyState === WebSocket.OPEN) {
        // For agent terminals, send a special agent_exited message
        // The frontend will show an exit screen with restart/close options
        if (terminalType === "agent") {
          console.log(`Agent session ${sessionId} exited - sending agent_exited event`);
          ws.send(JSON.stringify({
            type: "agent_exited",
            sessionId,
            exitCode,
            exitedAt: new Date().toISOString(),
          }));
          // Don't close the WebSocket yet - let the frontend handle it
          // The user may want to restart the agent
        } else {
          // For shell terminals, just send exit and close
          ws.send(JSON.stringify({ type: "exit", code: exitCode }));
          ws.close();
        }
      }
      cleanupSession(sessionId);
    });

    ws.on("message", (message, isBinary) => {
      try {
        // Handle binary voice audio frames
        if (isBinary) {
          const buf = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);
          if (buf.length > 1 && buf[0] === VOICE_AUDIO_PREFIX) {
            const pcmData = buf.subarray(1);
            if (session.voiceFifoReady && session.voiceFifoFd !== null) {
              fs.write(session.voiceFifoFd, pcmData, (writeErr) => {
                if (writeErr) {
                  console.warn(`[Voice] FIFO write error: ${writeErr.message}`);
                }
              });
            } else if (session.voiceAudioBuffer.length < MAX_VOICE_BUFFER_CHUNKS) {
              session.voiceAudioBuffer.push(pcmData);
            }
            return;
          }
        }

        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
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

            session.pendingResize = { cols: nextCols, rows: nextRows };
            if (session.resizeTimeout) {
              break;
            }

            session.resizeTimeout = setTimeout(() => {
              const pending = session.pendingResize;
              session.pendingResize = null;
              session.resizeTimeout = null;

              if (!pending) return;
              if (pending.cols === session.lastCols && pending.rows === session.lastRows) {
                return;
              }

              session.lastCols = pending.cols;
              session.lastRows = pending.rows;

              try {
                ptyProcess.resize(pending.cols, pending.rows);
              } catch {
                // Ignore resize errors from pty
              }

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
            }, 50);
            break;
          }
          case "detach":
            console.log(`Detaching from tmux session: ${tmuxSessionName}`);
            cleanupSession(sessionId);
            ws.close();
            break;

          case "restart_agent": {
            if (terminalType !== "agent") {
              ws.send(JSON.stringify({
                type: "error",
                message: "restart_agent is only valid for agent sessions",
              }));
              break;
            }

            console.log(`Restarting agent session: ${sessionId}`);
            try {
              try { destroyPty(session.pty); } catch { /* old PTY may be dead */ }

              execFile("tmux", ["kill-session", "-t", tmuxSessionName], () => {});
              createTmuxSession(tmuxSessionName, session.lastCols, session.lastRows, cwd, tmuxHistoryLimit);

              const newPty = attachToTmuxSession(tmuxSessionName, session.lastCols, session.lastRows);
              session.pty = newPty;

              newPty.onData((data) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "output", data }));
                }
              });

              newPty.onExit(({ exitCode: newExitCode }) => {
                console.log(`Restarted agent session ${sessionId} exited with code ${newExitCode}`);
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: "agent_exited",
                    sessionId,
                    exitCode: newExitCode,
                    exitedAt: new Date().toISOString(),
                  }));
                }
                cleanupSession(sessionId);
              });

              ws.send(JSON.stringify({
                type: "agent_restarted",
                sessionId,
                tmuxSessionName,
              }));
            } catch (error) {
              console.error(`Failed to restart agent session ${sessionId}:`, error);
              cleanupSession(sessionId);
              ws.send(JSON.stringify({
                type: "error",
                message: `Failed to restart agent: ${(error as Error).message}`,
              }));
            }
            break;
          }

          case "voice_start": {
            if (session.terminalType !== "agent") {
              ws.send(JSON.stringify({ type: "voice_error", message: "Voice mode is only available for agent sessions" }));
              break;
            }
            try {
              const fifoPath = createVoiceFifo(session);
              console.log(`[Voice] Created FIFO for session ${sessionId}: ${fifoPath}`);
              // Simulate holding SPACE to trigger Claude Code voice recording.
              // Send initial space immediately, then repeat at 50ms to mimic key-hold.
              // Server-side avoids round-trip latency from browser → WS → server.
              ptyProcess.write(" ");
              session.voiceSpaceInterval = setInterval(() => {
                if (sessions.has(sessionId)) {
                  ptyProcess.write(" ");
                } else {
                  clearInterval(session.voiceSpaceInterval!);
                  session.voiceSpaceInterval = null;
                }
              }, 50);
              ws.send(JSON.stringify({ type: "voice_ready", sessionId }));
            } catch (error) {
              console.error(`[Voice] Failed to create FIFO for ${sessionId}:`, error);
              ws.send(JSON.stringify({ type: "voice_error", message: `Voice setup failed: ${(error as Error).message}` }));
            }
            break;
          }

          case "voice_stop": {
            console.log(`[Voice] Stopping voice for session ${sessionId}`);
            // Stop simulating SPACE hold
            if (session.voiceSpaceInterval) {
              clearInterval(session.voiceSpaceInterval);
              session.voiceSpaceInterval = null;
            }
            if (session.voiceFifoFd !== null) {
              try {
                const silencePadding = Buffer.alloc(3200); // 100ms silence at 16kHz/16bit
                fs.writeSync(session.voiceFifoFd, silencePadding);
              } catch { /* ignore */ }
            }
            cleanupVoiceFifo(session);
            break;
          }
        }
      } catch {
        // JSON parse error on non-binary message — forward raw text to PTY
        if (sessions.has(sessionId)) {
          ptyProcess.write(message.toString());
        }
      }
    });

    ws.on("close", () => {
      console.log(`WebSocket closed for session ${sessionId}`);
      cleanupSession(sessionId);
    });

    ws.on("error", (error) => {
      console.error(`Terminal session ${sessionId} error:`, error);
      cleanupSession(sessionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId, tmuxSessionName }));
  });

  return wss;
}

// Graceful shutdown: destroy PTY wrappers but preserve tmux sessions for reconnection
function cleanup() {
  console.log("Shutting down terminal server (tmux sessions preserved)...");
  for (const [id, session] of sessions) {
    cleanupVoiceFifo(session);
    try { destroyPty(session.pty); } catch { /* PTY may already be dead */ }
    session.ws.close();
    console.log(`Closed PTY wrapper for session ${id}`);
  }
  sessions.clear();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
