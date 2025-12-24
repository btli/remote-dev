import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { parse } from "url";
import { execFile, execFileSync } from "child_process";
import { createHmac, timingSafeEqual } from "crypto";
import { resolve as pathResolve } from "path";

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

/**
 * Generate a WebSocket authentication token for a session.
 * This should be called by the Next.js server and passed to the client.
 */
export function generateWsToken(sessionId: string, userId: string): string {
  const secret = process.env.AUTH_SECRET || "development-secret";
  const timestamp = Date.now();
  const data = `${sessionId}:${userId}:${timestamp}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(`${data}:${hmac}`).toString("base64");
}

/**
 * Validate a WebSocket authentication token.
 * Tokens expire after 5 minutes.
 */
function validateWsToken(token: string): { sessionId: string; userId: string } | null {
  try {
    const secret = process.env.AUTH_SECRET || "development-secret";
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 4) return null;

    const [sessionId, userId, timestampStr, providedHmac] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Check token expiry (5 minutes)
    if (Date.now() - timestamp > 5 * 60 * 1000) return null;

    // Verify HMAC
    const data = `${sessionId}:${userId}:${timestampStr}`;
    const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

    // Use timing-safe comparison
    if (!timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return null;
    }

    return { sessionId, userId };
  } catch {
    return null;
  }
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
  envInjectionTimeout: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, TerminalSession>();

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
 */
function createTmuxSession(
  sessionName: string,
  cols: number,
  rows: number,
  cwd?: string
): void {
  const args = ["new-session", "-d", "-s", sessionName, "-x", String(cols), "-y", String(rows)];
  if (cwd) {
    args.push("-c", cwd);
  }
  execFileSync("tmux", args, { stdio: "pipe" });

  // Enable mouse mode for scrolling and selection
  execFileSync("tmux", ["set-option", "-t", sessionName, "mouse", "on"], { stdio: "pipe" });

  // Increase scrollback buffer (default is 2000)
  execFileSync("tmux", ["set-option", "-t", sessionName, "history-limit", "50000"], { stdio: "pipe" });

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
  const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", sessionName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: process.env as Record<string, string>,
  });

  return ptyProcess;
}

/**
 * Inject environment variables into a PTY session.
 *
 * Sends export commands to set the environment variables in the shell.
 * This is used for new sessions to set up the environment from folder preferences.
 *
 * SECURITY: Values are properly escaped to prevent command injection.
 */
function injectEnvironmentVariables(
  ptyProcess: IPty,
  envVars: Record<string, string>
): void {
  if (!envVars || Object.keys(envVars).length === 0) {
    return;
  }

  // Build export commands, escaping values to prevent injection
  const exports = Object.entries(envVars)
    .map(([key, value]) => {
      // SECURITY: Escape single quotes in values to prevent injection
      // Replace ' with '\'' (end quote, escaped quote, start quote)
      const escapedValue = value.replace(/'/g, "'\\''");
      return `export ${key}='${escapedValue}'`;
    })
    .join("; ");

  // Send the export commands followed by clear (to hide the export commands)
  // The \r simulates pressing Enter
  ptyProcess.write(`${exports}; clear\r`);
}

/**
 * Parse environment variables from WebSocket query.
 *
 * SECURITY: Validates and sanitizes the input to prevent injection attacks.
 */
function parseEnvironmentVarsFromQuery(
  envVarsJson: string | undefined
): Record<string, string> | null {
  if (!envVarsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(envVarsJson));

    // Validate it's an object
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn("Invalid environmentVars format, expected object");
      return null;
    }

    // Validate all keys and values are strings
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      // SECURITY: Only allow valid env var names (uppercase alphanumeric + underscore)
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        console.warn(`Skipping invalid env var key: ${key}`);
        continue;
      }

      if (typeof value !== "string") {
        console.warn(`Skipping non-string env var value for: ${key}`);
        continue;
      }

      // SECURITY: Limit value length to prevent abuse
      if (value.length > 10240) {
        console.warn(`Skipping oversized env var value for: ${key}`);
        continue;
      }

      result[key] = value;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    console.warn("Failed to parse environmentVars JSON:", error);
    return null;
  }
}

export function createTerminalServer(port: number = 3001) {
  // Check tmux is installed at startup
  if (!checkTmuxInstalled()) {
    console.error("ERROR: tmux is not installed. Please install with: brew install tmux");
    console.error("Terminal persistence will not work without tmux.");
    // Continue anyway for development, but log the warning
  } else {
    console.log("tmux detected - session persistence enabled");
  }

  const wss = new WebSocketServer({ port });

  console.log(`Terminal WebSocket server running on ws://localhost:${port}`);

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
    const tmuxSessionName = (query.tmuxSession as string) || `rdv-${sessionId.substring(0, 8)}`;
    const cols = parseInt(query.cols as string) || 80;
    const rows = parseInt(query.rows as string) || 24;
    const rawCwd = query.cwd as string | undefined;
    const rawEnvVars = query.environmentVars as string | undefined;

    // SECURITY: Validate tmux session name to prevent command injection
    if (!validateSessionName(tmuxSessionName)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid session name" }));
      ws.close(4003, "Invalid session name");
      return;
    }

    // SECURITY: Validate cwd to prevent path traversal
    const cwd = validatePath(rawCwd);

    // Parse environment variables from query
    const envVars = parseEnvironmentVarsFromQuery(rawEnvVars);

    // Check if this is an existing session we're reconnecting to
    const isExistingSession = tmuxSessionExists(tmuxSessionName);

    console.log(`Connection request: sessionId=${sessionId}, tmux=${tmuxSessionName}, existing=${isExistingSession}`);

    let ptyProcess: IPty;

    try {
      if (isExistingSession) {
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
        console.log(`Creating new tmux session: ${tmuxSessionName}`);
        createTmuxSession(tmuxSessionName, cols, rows, cwd);
        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_created",
          sessionId,
          tmuxSessionName,
        }));
      }
    } catch (error) {
      console.error(`Failed to create/attach tmux session: ${error}`);
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
      envInjectionTimeout: null,
    };

    sessions.set(sessionId, session);

    console.log(`Terminal session ${sessionId} started (${cols}x${rows}) - tmux: ${tmuxSessionName}`);

    // Inject environment variables into new sessions (not reconnections)
    if (!isExistingSession && envVars) {
      console.log(`Injecting ${Object.keys(envVars).length} environment variables`);
      // Small delay to ensure the shell is ready to receive commands
      // Store timeout ID so it can be cancelled if session closes early
      session.envInjectionTimeout = setTimeout(() => {
        session.envInjectionTimeout = null;
        // Only inject if session is still active
        if (sessions.has(sessionId)) {
          injectEnvironmentVariables(ptyProcess, envVars);
        }
      }, 100);
    }

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Terminal session ${sessionId} PTY exited with code ${exitCode}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
      if (session.resizeTimeout) {
        clearTimeout(session.resizeTimeout);
        session.resizeTimeout = null;
        session.pendingResize = null;
      }
      if (session.envInjectionTimeout) {
        clearTimeout(session.envInjectionTimeout);
        session.envInjectionTimeout = null;
      }
      sessions.delete(sessionId);
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
      if (session.resizeTimeout) {
        clearTimeout(session.resizeTimeout);
        session.resizeTimeout = null;
        session.pendingResize = null;
      }
      if (session.envInjectionTimeout) {
        clearTimeout(session.envInjectionTimeout);
        session.envInjectionTimeout = null;
      }
      sessions.delete(sessionId);
    });

    ws.on("error", (error) => {
      console.error(`Terminal session ${sessionId} error:`, error);
      ptyProcess.kill();
      if (session.resizeTimeout) {
        clearTimeout(session.resizeTimeout);
        session.resizeTimeout = null;
        session.pendingResize = null;
      }
      if (session.envInjectionTimeout) {
        clearTimeout(session.envInjectionTimeout);
        session.envInjectionTimeout = null;
      }
      sessions.delete(sessionId);
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
