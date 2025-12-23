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
 * Create a new tmux session
 * @param sessionName - Unique session name (e.g., "rdv-abc123")
 * @param cwd - Working directory for the session
 * @param startupCommand - Optional command to run after session creation
 */
export async function createSession(
  sessionName: string,
  cwd?: string,
  startupCommand?: string
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

  try {
    await execFile("tmux", args);

    // Enable mouse mode for scrollback support
    await execFile("tmux", [
      "set-option",
      "-t",
      sessionName,
      "mouse",
      "on",
    ]);

    // Execute startup command if provided
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

  const args = ["send-keys", "-t", sessionName, command];
  if (pressEnter) {
    args.push("Enter");
  }

  try {
    await execFile("tmux", args);
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
  // Use first 8 characters of UUID for readability
  return `rdv-${sessionId.substring(0, 8)}`;
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
