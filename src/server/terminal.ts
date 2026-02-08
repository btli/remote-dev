import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { parse } from "url";
import { execFile, execFileSync } from "child_process";
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
}

const sessions = new Map<string, TerminalSession>();

// Track sessions currently in the process of connecting to prevent rapid reconnection
// that can exhaust PTY/FD resources and cause posix_spawnp failures
const connectingSessionIds = new Set<string>();

/**
 * Safely cleanup a terminal session, preventing double-cleanup race conditions.
 * Multiple events (PTY exit, WebSocket close, WebSocket error) can fire simultaneously,
 * so we use a guard pattern to ensure cleanup only happens once.
 */
function cleanupSession(sessionId: string): void {
  // Always remove from connecting set on cleanup
  connectingSessionIds.delete(sessionId);
  const session = sessions.get(sessionId);
  if (!session) return; // Already cleaned up by another event

  // Clear any pending resize timeout
  if (session.resizeTimeout) {
    clearTimeout(session.resizeTimeout);
    session.resizeTimeout = null;
    session.pendingResize = null;
  }

  // Remove from map (this prevents other events from double-cleaning)
  sessions.delete(sessionId);
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

async function handleInternalApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { pathname, query } = parse(req.url || "", true);

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

  wss.on("connection", (ws, req) => {
    const query = parse(req.url || "", true).query;

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

    ws.on("message", (message) => {
      try {
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
            // Detach from tmux but keep session alive
            console.log(`Detaching from tmux session: ${tmuxSessionName}`);
            // Just close the PTY wrapper, tmux session stays
            ptyProcess.kill();
            break;

          case "restart_agent":
            // Restart an agent session after it has exited
            if (terminalType !== "agent") {
              ws.send(JSON.stringify({
                type: "error",
                message: "restart_agent is only valid for agent sessions",
              }));
              break;
            }

            console.log(`Restarting agent session: ${sessionId}`);
            try {
              // Kill existing tmux session
              execFile("tmux", ["kill-session", "-t", tmuxSessionName], () => {});

              // Create a new tmux session
              createTmuxSession(tmuxSessionName, session.lastCols, session.lastRows, cwd, tmuxHistoryLimit);

              // Create new PTY and attach
              const newPty = attachToTmuxSession(tmuxSessionName, session.lastCols, session.lastRows);

              // Replace PTY in session
              session.pty = newPty;

              // Wire up new PTY events
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
              });

              ws.send(JSON.stringify({
                type: "agent_restarted",
                sessionId,
                tmuxSessionName,
              }));
            } catch (error) {
              console.error(`Failed to restart agent session ${sessionId}:`, error);
              ws.send(JSON.stringify({
                type: "error",
                message: `Failed to restart agent: ${(error as Error).message}`,
              }));
            }
            break;
        }
      } catch {
        // Raw input fallback
        ptyProcess.write(message.toString());
      }
    });

    ws.on("close", () => {
      console.log(`WebSocket closed for session ${sessionId}`);
      // Kill the PTY wrapper but NOT the tmux session
      // This allows reconnection to the same tmux session later
      ptyProcess.kill();
      cleanupSession(sessionId);
    });

    ws.on("error", (error) => {
      console.error(`Terminal session ${sessionId} error:`, error);
      ptyProcess.kill();
      cleanupSession(sessionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId, tmuxSessionName }));
  });

  return wss;
}

// Cleanup on exit - DON'T kill tmux sessions, only PTY wrappers
function cleanup() {
  console.log("Shutting down terminal server...");
  console.log("Note: tmux sessions are preserved for reconnection");
  for (const [id, session] of sessions) {
    session.pty.kill();
    session.ws.close();
    console.log(`Closed PTY wrapper for session ${id}`);
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
