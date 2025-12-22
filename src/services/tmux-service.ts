/**
 * TmuxService - Manages tmux session lifecycle for terminal persistence
 */
import { execFile, execFileNoThrow } from "@/lib/exec";
import { TmuxServiceError } from "@/lib/errors";

export { TmuxServiceError };

export interface TmuxSessionInfo {
  name: string;
  windowCount: number;
  created: Date;
  attached: boolean;
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
 */
export async function createSession(
  sessionName: string,
  cwd?: string
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
