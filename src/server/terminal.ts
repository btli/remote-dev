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

type ShellFramework = "oh-my-zsh" | "starship" | "powerlevel10k" | "none";

// Valid themes per framework (keep in sync with src/lib/shell-themes.ts)
const VALID_THEMES: Record<ShellFramework, Set<string>> = {
  "oh-my-zsh": new Set([
    "robbyrussell", "agnoster", "af-magic", "avit", "bira", "bureau", "candy",
    "clean", "cloud", "dst", "eastwood", "fino", "fino-time", "fishy", "frontcube",
    "gallois", "gentoo", "gnzh", "half-life", "jonathan", "josh", "kafeitu",
    "kennethreitz", "lambda", "minimal", "muse", "norm", "pygmalion", "refined",
    "simple", "sorin", "steeef", "sunrise", "ys", "random",
  ]),
  starship: new Set([
    "default", "nerd-font-symbols", "bracketed-segments", "plain-text-symbols",
    "no-runtime-versions", "pure-preset", "pastel-powerline", "tokyo-night",
    "gruvbox-rainbow", "jetpack",
  ]),
  powerlevel10k: new Set(["lean", "classic", "rainbow", "pure"]),
  none: new Set(),
};

/**
 * Validate that a theme is valid for the given framework
 */
function isValidTheme(framework: ShellFramework, theme: string): boolean {
  return VALID_THEMES[framework]?.has(theme) ?? false;
}

/**
 * Get environment variables for shell theming based on framework
 */
function getThemeEnvironment(framework: ShellFramework, theme: string): Record<string, string> {
  switch (framework) {
    case "oh-my-zsh":
      return { ZSH_THEME: theme };
    case "starship":
    case "powerlevel10k":
    case "none":
    default:
      return {};
  }
}

/**
 * Create a new tmux session
 * @param sessionName - Unique tmux session name
 * @param cols - Terminal columns
 * @param rows - Terminal rows
 * @param cwd - Working directory
 * @param shellFramework - Shell framework (oh-my-zsh, starship, powerlevel10k, none)
 * @param shellTheme - Theme for the shell framework
 */
function createTmuxSession(
  sessionName: string,
  cols: number,
  rows: number,
  cwd?: string,
  shellFramework?: ShellFramework,
  shellTheme?: string
): void {
  const args = ["new-session", "-d", "-s", sessionName, "-x", String(cols), "-y", String(rows)];
  if (cwd) {
    args.push("-c", cwd);
  }
  // Set environment variables based on shell framework
  if (shellFramework && shellTheme) {
    const envVars = getThemeEnvironment(shellFramework, shellTheme);
    for (const [key, value] of Object.entries(envVars)) {
      args.push("-e", `${key}=${value}`);
    }
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
    const shellFramework = (query.shellFramework as ShellFramework) || "oh-my-zsh";
    const shellTheme = query.shellTheme as string | undefined;

    // Check if this is an existing session we're reconnecting to
    const isExistingSession = tmuxSessionExists(tmuxSessionName);

    console.log(`Connection request: sessionId=${sessionId}, tmux=${tmuxSessionName}, existing=${isExistingSession}, framework=${shellFramework}, theme=${shellTheme || 'default'}`);

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
        // Create new tmux session with shell framework and theme
        console.log(`Creating new tmux session: ${tmuxSessionName} with framework: ${shellFramework}, theme: ${shellTheme || 'default'}`);
        createTmuxSession(tmuxSessionName, cols, rows, cwd, shellFramework, shellTheme);
        ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

        ws.send(JSON.stringify({
          type: "session_created",
          sessionId,
          tmuxSessionName,
          shellFramework,
          shellTheme: shellTheme || null,
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
      // First, try to parse as JSON
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(message.toString());
      } catch {
        // Not valid JSON - treat as raw terminal input
        ptyProcess.write(message.toString());
        return;
      }

      // Handle structured messages with proper error handling
      try {
        switch (msg.type) {
          case "input":
            ptyProcess.write(msg.data as string);
            break;
          case "resize":
            ptyProcess.resize(msg.cols as number, msg.rows as number);
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
            } catch (resizeError) {
              // Resize may fail if dimensions are too small - log but don't fail
              console.debug(`Tmux resize skipped for ${tmuxSessionName}:`, (resizeError as Error).message);
            }
            break;
          case "detach":
            // Detach from tmux but keep session alive
            console.log(`Detaching from tmux session: ${tmuxSessionName}`);
            // Just close the PTY wrapper, tmux session stays
            ptyProcess.kill();
            break;
          case "apply_theme":
            // Apply shell theme to the running session based on framework
            if (msg.theme && msg.framework) {
              const framework = msg.framework as ShellFramework;
              const theme = String(msg.theme);

              // Validate framework is valid
              if (!["oh-my-zsh", "starship", "powerlevel10k", "none"].includes(framework)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `Invalid shell framework: ${framework}`,
                }));
                break;
              }

              // Validate theme is valid for the framework (prevents command injection)
              if (!isValidTheme(framework, theme)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `Invalid theme "${theme}" for framework "${framework}"`,
                }));
                break;
              }

              console.log(`Applying ${framework} theme "${theme}" to session: ${tmuxSessionName}`);

              let themeCommand: string | null = null;
              switch (framework) {
                case "oh-my-zsh":
                  // Theme is validated above, safe to use
                  themeCommand = `export ZSH_THEME="${theme}" && source ~/.zshrc\n`;
                  break;
                case "starship":
                  if (theme !== "default") {
                    // Theme is validated above, safe to use
                    themeCommand = `starship preset ${theme} -o ~/.config/starship.toml && exec $SHELL\n`;
                  }
                  break;
                case "powerlevel10k":
                  // P10k requires running the configuration wizard
                  // Can't easily change at runtime
                  break;
                case "none":
                  break;
              }

              if (themeCommand) {
                ptyProcess.write(themeCommand);
              }

              ws.send(JSON.stringify({
                type: "theme_applied",
                framework,
                theme,
                tmuxSessionName,
              }));
            }
            break;
          default:
            console.warn(`Unknown message type: ${msg.type}`);
        }
      } catch (error) {
        console.error(`Error handling message type "${msg.type}":`, error);
        ws.send(JSON.stringify({
          type: "error",
          message: `Failed to process ${msg.type}: ${(error as Error).message}`,
        }));
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
