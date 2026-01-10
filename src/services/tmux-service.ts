/**
 * TmuxService - Manages tmux session lifecycle for terminal persistence
 */
import { execFile, execFileCheck, execFileNoThrow } from "@/lib/exec";
import { TmuxServiceError } from "@/lib/errors";

// Re-export for backwards compatibility
export { TmuxServiceError };

export interface TmuxSessionInfo {
  name: string;
  windowCount: number;
  created: Date;
  attached: boolean;
}

/**
 * Check if tmux is installed on the system
 */
export async function isTmuxInstalled(): Promise<boolean> {
  return execFileCheck("tmux", ["-V"]);
}

/**
 * Get tmux version string
 */
export async function getTmuxVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFile("tmux", ["-V"]);
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Check if a tmux session with the given name exists
 */
export async function sessionExists(sessionName: string): Promise<boolean> {
  const result = await execFileNoThrow("tmux", ["has-session", "-t", sessionName]);
  return result.exitCode === 0;
}

/**
 * List all tmux sessions
 */
export async function listSessions(): Promise<TmuxSessionInfo[]> {
  const result = await execFileNoThrow("tmux", [
    "list-sessions",
    "-F",
    "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}",
  ]);

  if (result.exitCode !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout.split("\n").map((line) => {
    const [name, windowCount, created, attached] = line.split("|");
    return {
      name,
      windowCount: parseInt(windowCount, 10),
      created: new Date(parseInt(created, 10) * 1000),
      attached: attached === "1",
    };
  });
}

export interface CreateSessionOptions {
  /** Unique session name (e.g., "rdv-abc123") */
  sessionName: string;
  /** Working directory for the session */
  cwd?: string;
  /**
   * Command to run as the session process.
   * If provided, this runs directly as the tmux session process (no shell).
   * If not provided, starts a shell and uses startupCommand via sendKeys.
   */
  command?: string;
  /**
   * @deprecated Use `command` instead for native process spawning.
   * Legacy: Command to inject via sendKeys after shell starts.
   */
  startupCommand?: string;
  /** Environment variables to set for the session */
  env?: Record<string, string>;
  /**
   * @deprecated Use `env` instead with native command spawning.
   * Legacy: Shell environment variables to export via sendKeys.
   */
  shellEnv?: Record<string, string>;
  /** tmux history-limit (scrollback buffer, default: 50000) */
  historyLimit?: number;
  /** Auto-respawn process when it exits (for orchestrators, default: false) */
  autoRespawn?: boolean;
}

/**
 * Create a new tmux session
 *
 * Preferred approach: Pass `command` to run it directly as the session process.
 * This uses tmux's native process spawning (no shell injection).
 *
 * Legacy approach: Omit `command` to start a shell, then use `startupCommand`
 * and `shellEnv` which are injected via sendKeys.
 */
export async function createSession(
  sessionNameOrOptions: string | CreateSessionOptions,
  cwd?: string,
  startupCommand?: string,
  env?: Record<string, string>,
  shellEnv?: Record<string, string>,
  historyLimit: number = 50000
): Promise<void> {
  // Support both old signature and new options object
  const options: CreateSessionOptions =
    typeof sessionNameOrOptions === "string"
      ? {
          sessionName: sessionNameOrOptions,
          cwd,
          startupCommand,
          env,
          shellEnv,
          historyLimit,
        }
      : sessionNameOrOptions;

  const {
    sessionName,
    cwd: optCwd,
    command,
    startupCommand: optStartupCommand,
    env: optEnv,
    shellEnv: optShellEnv,
    historyLimit: optHistoryLimit = 50000,
    autoRespawn = false,
  } = options;

  // Check if session already exists
  if (await sessionExists(sessionName)) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" already exists`,
      "SESSION_EXISTS"
    );
  }

  const args = [
    "new-session",
    "-d", // Detached
    "-s",
    sessionName,
  ];

  // Set working directory
  if (optCwd) {
    args.push("-c", optCwd);
  }

  // Native command spawning: pass command directly to tmux new-session
  // This runs the command as the process, not via shell injection
  if (command) {
    args.push(command);
  }

  // Build execution options with environment overlay
  // Cast to NodeJS.ProcessEnv since execFile merges with process.env
  const execOptions = optEnv ? { env: optEnv as NodeJS.ProcessEnv } : undefined;

  try {
    await execFile("tmux", args, execOptions);

    // Enable mouse mode for scrolling in alternate screen apps (vim, less, claude code, etc.)
    // Use Shift+click to bypass and select text with xterm.js
    await execFile("tmux", [
      "set-option",
      "-t",
      sessionName,
      "mouse",
      "on",
    ]);

    // Set scrollback buffer (history-limit) for performance tuning
    // Lower values reduce memory usage for long-running sessions
    await execFile("tmux", [
      "set-option",
      "-t",
      sessionName,
      "history-limit",
      String(optHistoryLimit),
    ]);

    // Auto-respawn: Set up pane-died hook to automatically restart the process
    // This respawns immediately when process exits - no dead panes, no polling
    if (autoRespawn) {
      await execFile("tmux", [
        "set-hook",
        "-t",
        sessionName,
        "pane-died",
        "respawn-pane -k",
      ]);
    }

    // Legacy path: If no native command was provided, use shell injection
    if (!command) {
      // Inject shell environment variables BEFORE startup command
      // These are exported in the shell session so they're available to all commands
      if (optShellEnv && Object.keys(optShellEnv).length > 0) {
        const exports = Object.entries(optShellEnv)
          .map(([key, value]) => {
            // SECURITY: Escape single quotes to prevent shell injection
            const escapedValue = value.replace(/'/g, "'\\''");
            return `export ${key}='${escapedValue}'`;
          })
          .join("; ");
        await sendKeys(sessionName, exports);
      }

      // Execute startup command if provided
      if (optStartupCommand && optStartupCommand.trim()) {
        await sendKeys(sessionName, optStartupCommand.trim());
      }
    }
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to create tmux session: ${(error as Error).message}`,
      "CREATE_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Kill a tmux session
 */
export async function killSession(sessionName: string): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    // Session doesn't exist, nothing to do
    return;
  }

  try {
    await execFile("tmux", ["kill-session", "-t", sessionName]);
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to kill tmux session: ${(error as Error).message}`,
      "KILL_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Send keys to a tmux session (execute a command)
 */
export async function sendKeys(
  sessionName: string,
  command: string,
  pressEnter = true
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    // Send command text in literal mode (-l) to avoid tmux interpreting
    // special characters like !, #, \, etc. This ensures the exact text
    // is sent to the terminal/application.
    if (command) {
      await execFile("tmux", ["send-keys", "-t", sessionName, "-l", command]);
    }

    // Send Enter key separately. This works reliably across shells and
    // interactive applications (like claude CLI, vim, etc.) because:
    // 1. The text was sent literally without interpretation
    // 2. Enter/C-m is a recognized tmux key binding that sends the actual keypress
    if (pressEnter) {
      await execFile("tmux", ["send-keys", "-t", sessionName, "Enter"]);
    }
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to send keys to tmux session: ${(error as Error).message}`,
      "SEND_KEYS_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Resize a tmux session's window
 */
export async function resizeSession(
  sessionName: string,
  cols: number,
  rows: number
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    await execFile("tmux", [
      "resize-window",
      "-t",
      sessionName,
      "-x",
      cols.toString(),
      "-y",
      rows.toString(),
    ]);
  } catch {
    // Resize may fail if client not attached, ignore
  }
}

/**
 * Get the list of sessions with a specific prefix (for cleanup)
 */
export async function listSessionsWithPrefix(
  prefix: string
): Promise<TmuxSessionInfo[]> {
  const allSessions = await listSessions();
  return allSessions.filter((session) => session.name.startsWith(prefix));
}

/**
 * Clean up orphaned sessions that aren't in the database
 * @param validSessionNames - Set of session names that should exist
 * @param prefix - Prefix to filter sessions (e.g., "rdv-")
 */
export async function cleanupOrphanedSessions(
  validSessionNames: Set<string>,
  prefix: string
): Promise<string[]> {
  const orphanedSessions: string[] = [];
  const sessions = await listSessionsWithPrefix(prefix);

  for (const session of sessions) {
    if (!validSessionNames.has(session.name)) {
      await killSession(session.name);
      orphanedSessions.push(session.name);
    }
  }

  return orphanedSessions;
}

/**
 * Generate a unique tmux session name
 */
export function generateSessionName(sessionId: string): string {
  // Use full UUID for uniqueness and domain validation compatibility
  return `rdv-${sessionId}`;
}

/**
 * Capture the scrollback buffer from a tmux session
 *
 * This is useful for Agent API to retrieve terminal output programmatically.
 * The terminal server sets history-limit to 50000 lines.
 *
 * @param sessionName - Tmux session name
 * @param lines - Number of lines to capture from scrollback (default: 10000)
 * @returns Terminal output as a string
 */
export async function captureOutput(
  sessionName: string,
  lines: number = 10000
): Promise<string> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    // capture-pane flags:
    // -p: print to stdout instead of internal buffer
    // -S: start line (negative = from scrollback, -lines means last N lines)
    // -E: end line (empty = current line)
    // -J: join wrapped lines
    const { stdout } = await execFile("tmux", [
      "capture-pane",
      "-t",
      sessionName,
      "-p",
      "-S",
      `-${lines}`,
      "-J",
    ]);
    return stdout;
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to capture output: ${(error as Error).message}`,
      "CAPTURE_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Get the current pane content (visible area only, no scrollback)
 *
 * Useful for getting just the current visible state of the terminal.
 *
 * @param sessionName - Tmux session name
 * @returns Current visible terminal content
 */
export async function capturePane(sessionName: string): Promise<string> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    // Without -S/-E flags, captures only the visible pane
    const { stdout } = await execFile("tmux", [
      "capture-pane",
      "-t",
      sessionName,
      "-p",
      "-J",
    ]);
    return stdout;
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to capture pane: ${(error as Error).message}`,
      "CAPTURE_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Check if the pane in a session is dead (process exited but pane remains).
 * This is used with remain-on-exit to detect when a process has exited.
 *
 * @param sessionName - Tmux session name
 * @returns true if the pane exists but its process has exited
 */
export async function isPaneDead(sessionName: string): Promise<boolean> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    const { stdout } = await execFile("tmux", [
      "list-panes",
      "-t",
      sessionName,
      "-F",
      "#{pane_dead}",
    ]);
    // pane_dead is "1" if dead, "0" if alive
    return stdout.trim() === "1";
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to check pane status: ${(error as Error).message}`,
      "PANE_STATUS_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Respawn a dead pane with a new command.
 * Used to restart a process after it exits when remain-on-exit is enabled.
 *
 * @param sessionName - Tmux session name
 * @param command - Optional command to run (if not provided, uses original command)
 */
export async function respawnPane(
  sessionName: string,
  command?: string
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    const args = ["respawn-pane", "-t", sessionName, "-k"];
    if (command) {
      args.push(command);
    }
    await execFile("tmux", args);
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to respawn pane: ${(error as Error).message}`,
      "RESPAWN_FAILED",
      (error as Error).message
    );
  }
}

export interface PaneStatus {
  sessionName: string;
  isDead: boolean;
  pid: number | null;
}

/**
 * Get detailed pane status for a session.
 *
 * @param sessionName - Tmux session name
 * @returns Pane status including dead state and PID
 */
export async function getPaneStatus(sessionName: string): Promise<PaneStatus> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    const { stdout } = await execFile("tmux", [
      "list-panes",
      "-t",
      sessionName,
      "-F",
      "#{pane_dead}:#{pane_pid}",
    ]);
    const parts = stdout.trim().split(":");
    const isDead = parts[0] === "1";
    const pid = parts[1] ? parseInt(parts[1], 10) : null;

    return {
      sessionName,
      isDead,
      pid: Number.isNaN(pid) ? null : pid,
    };
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to get pane status: ${(error as Error).message}`,
      "PANE_STATUS_FAILED",
      (error as Error).message
    );
  }
}
