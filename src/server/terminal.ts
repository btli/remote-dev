import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { parse } from "url";
import { execFileSync } from "child_process";

interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
  sessionId: string;
  tmuxSessionName: string;
  isAttached: boolean;
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
 * Create a new tmux session
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
}

/**
 * Attach to a tmux session using a PTY wrapper
 */
function attachToTmuxSession(
  sessionName: string,
  cols: number,
  rows: number
): IPty {
  const shell = process.platform === "win32" ? "powershell.exe" : "zsh";

  // Use zsh/bash to exec into tmux attach
  const ptyProcess = pty.spawn(shell, ["-c", `tmux attach-session -t ${sessionName}`], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.HOME || process.cwd(),
    env: process.env as Record<string, string>,
  });

  return ptyProcess;
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

    // Parse connection parameters
    const sessionId = (query.sessionId as string) || crypto.randomUUID();
    const tmuxSessionName = (query.tmuxSession as string) || `rdv-${sessionId.substring(0, 8)}`;
    const cols = parseInt(query.cols as string) || 80;
    const rows = parseInt(query.rows as string) || 24;
    const cwd = query.cwd as string | undefined;

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
    };

    sessions.set(sessionId, session);

    console.log(`Terminal session ${sessionId} started (${cols}x${rows}) - tmux: ${tmuxSessionName}`);

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
      sessions.delete(sessionId);
    });

    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data);
            break;
          case "resize":
            ptyProcess.resize(msg.cols, msg.rows);
            // Also resize the tmux session
            try {
              execFileSync("tmux", [
                "resize-window",
                "-t",
                tmuxSessionName,
                "-x",
                String(msg.cols),
                "-y",
                String(msg.rows),
              ], { stdio: "pipe" });
            } catch {
              // Resize may fail if dimensions are too small, ignore
            }
            break;
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
      sessions.delete(sessionId);
    });

    ws.on("error", (error) => {
      console.error(`Terminal session ${sessionId} error:`, error);
      ptyProcess.kill();
      sessions.delete(sessionId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: "ready", sessionId, tmuxSessionName }));
  });

  return wss;
}

// Cleanup on exit - DON'T kill tmux sessions, only PTY wrappers
process.on("SIGINT", () => {
  console.log("Shutting down terminal server...");
  console.log("Note: tmux sessions are preserved for reconnection");
  for (const [id, session] of sessions) {
    session.pty.kill();
    session.ws.close();
    console.log(`Closed PTY wrapper for session ${id}`);
  }
  process.exit(0);
});
