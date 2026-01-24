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

/**
 * Create a new tmux session.
 *
 * This function creates the tmux session with basic configuration (mouse mode,
 * history-limit) and optionally runs a startup command.
 *
 * ## Two-Layer Environment Model
 *
 * Environment variables are handled in two layers:
 *
 * 1. **PTY Environment** (`env` parameter): Passed to node-pty when spawning
 *    the shell process. These are the initial shell environment variables.
 *
 * 2. **Session Environment**: Set via `setSessionEnvironment()` AFTER session
 *    creation. These persist at the tmux session level and survive shell exits.
 *    Callers should call `setSessionEnvironment()` after `createSession()` to
 *    set persistent variables like API keys, XDG paths, etc.
 *
 * The separation is intentional - it allows different lifecycle management for
 * different types of environment variables.
 *
 * @param sessionName - Unique session name (e.g., "rdv-abc123")
 * @param cwd - Working directory for the session
 * @param startupCommand - Optional command to run after session creation
 * @param env - Optional environment variables for PTY spawn (initial shell env)
 * @param historyLimit - Optional tmux history-limit (scrollback buffer, default: 50000)
 */
export async function createSession(
  sessionName: string,
  cwd?: string,
  startupCommand?: string,
  env?: Record<string, string>,
  historyLimit: number = 50000
): Promise<void> {
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
  if (cwd) {
    args.push("-c", cwd);
  }

  // Build execution options with environment overlay
  // Note: lib/exec.ts now filters out framework internal vars automatically
  const execOptions = env ? { env: env as NodeJS.ProcessEnv } : undefined;

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
      String(historyLimit),
    ]);

    // Note: Session-level environment variables should be set via
    // setSessionEnvironment() after createSession() returns. This provides
    // persistent environment that survives shell exits.

    // Execute startup command if provided
    // Using sendKeys allows aliases and shell functions to work
    if (startupCommand && startupCommand.trim()) {
      await sendKeys(sessionName, startupCommand.trim());
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

// ═══════════════════════════════════════════════════════════════════════════
// Session Environment Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set environment variables at the tmux session level.
 *
 * These variables persist across shell exits and are inherited by all
 * processes spawned in the session. Uses `tmux set-environment`.
 *
 * @param sessionName - Tmux session name
 * @param vars - Environment variables to set (key-value pairs)
 */
export async function setSessionEnvironment(
  sessionName: string,
  vars: Record<string, string>
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    // Set each variable using tmux set-environment
    for (const [key, value] of Object.entries(vars)) {
      await execFile("tmux", ["set-environment", "-t", sessionName, key, value]);
    }
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to set environment: ${(error as Error).message}`,
      "SET_ENV_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Get environment variables from a tmux session.
 *
 * @param sessionName - Tmux session name
 * @returns Environment variables as key-value pairs
 */
export async function getSessionEnvironment(
  sessionName: string
): Promise<Record<string, string>> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    const { stdout } = await execFile("tmux", [
      "show-environment",
      "-t",
      sessionName,
    ]);

    const env: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      // Lines starting with - are unset variables, skip them
      if (line.startsWith("-")) continue;
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }
    return env;
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to get environment: ${(error as Error).message}`,
      "GET_ENV_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Unset environment variables from a tmux session.
 *
 * @param sessionName - Tmux session name
 * @param keys - Environment variable names to unset
 */
export async function unsetSessionEnvironment(
  sessionName: string,
  keys: string[]
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    for (const key of keys) {
      await execFile("tmux", ["set-environment", "-t", sessionName, "-u", key]);
    }
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to unset environment: ${(error as Error).message}`,
      "UNSET_ENV_FAILED",
      (error as Error).message
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Hooks Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook trigger events for tmux.
 */
export type TmuxHookName =
  | "pane-exited"
  | "session-closed"
  | "client-attached"
  | "client-detached"
  | "window-linked";

/**
 * Set a hook on a tmux session.
 *
 * @param sessionName - Tmux session name
 * @param hookName - Hook trigger event name
 * @param command - Shell command to run when hook triggers
 */
export async function setHook(
  sessionName: string,
  hookName: TmuxHookName,
  command: string
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    await execFile("tmux", ["set-hook", "-t", sessionName, hookName, command]);
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to set hook: ${(error as Error).message}`,
      "SET_HOOK_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Remove a hook from a tmux session.
 *
 * @param sessionName - Tmux session name
 * @param hookName - Hook name to remove
 */
export async function removeHook(
  sessionName: string,
  hookName: TmuxHookName
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    await execFile("tmux", ["set-hook", "-t", sessionName, "-u", hookName]);
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to remove hook: ${(error as Error).message}`,
      "REMOVE_HOOK_FAILED",
      (error as Error).message
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Options Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set a tmux session option.
 *
 * @param sessionName - Tmux session name
 * @param option - Option name
 * @param value - Option value
 */
export async function setOption(
  sessionName: string,
  option: string,
  value: string
): Promise<void> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    await execFile("tmux", ["set-option", "-t", sessionName, option, value]);
  } catch (error) {
    throw new TmuxServiceError(
      `Failed to set option: ${(error as Error).message}`,
      "SET_OPTION_FAILED",
      (error as Error).message
    );
  }
}

/**
 * Get a tmux session option value.
 *
 * @param sessionName - Tmux session name
 * @param option - Option name
 * @returns Option value or null if not set
 */
export async function getOption(
  sessionName: string,
  option: string
): Promise<string | null> {
  if (!(await sessionExists(sessionName))) {
    throw new TmuxServiceError(
      `Tmux session "${sessionName}" does not exist`,
      "SESSION_NOT_FOUND"
    );
  }

  try {
    const { stdout } = await execFile("tmux", [
      "show-option",
      "-t",
      sessionName,
      "-v",
      option,
    ]);
    return stdout.trim() || null;
  } catch {
    // Option not set or doesn't exist
    return null;
  }
}
