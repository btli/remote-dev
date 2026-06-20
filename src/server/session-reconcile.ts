/**
 * Startup janitor: reconcile DB session state with live tmux.
 *
 * A session row can be left `active`/`suspended` while its tmux session is gone
 * — e.g. the terminal server (or whole pod) restarted, or a `status='closed'`
 * write failed under SQLITE_BUSY. These "ghosts" (DB says alive, tmux dead)
 * show up stuck in the UI and never close on their own. This heals them by
 * marking the row closed (and freeing its scope slot).
 *
 * SAFETY: only GHOSTS are healed. The opposite case — an ORPHAN tmux (DB closed
 * but tmux still alive) — is intentionally LEFT ALONE: it may be a live agent
 * that should keep running, and auto-killing it would destroy work.
 *
 * Server-wide scope (all users); the terminal server is the single owner.
 */
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import * as TmuxService from "@/services/tmux-service";
import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
import { initializeServerPlugins } from "@/lib/terminal-plugins/init-server";
import { withBusyRetry } from "@/db/busy-retry";
import { createLogger } from "@/lib/logger";

const log = createLogger("SessionReconcile");

/** Does this terminal type use tmux? Mirrors session-service's `sessionUsesTmux`. */
function usesTmux(terminalType: string | null): boolean {
  // Default to "shell" for null (DB default), matching mapDbSessionToSession.
  return TerminalTypeServerRegistry.get(terminalType ?? "shell")?.useTmux ?? true;
}

/**
 * Close DB sessions whose tmux session no longer exists (ghosts). Returns the
 * number healed. Never throws to the caller — failures are logged.
 */
export async function reconcileSessionsWithTmux(): Promise<{ healed: number }> {
  // The `useTmux` check reads the plugin registry; make sure it's populated.
  initializeServerPlugins();

  let candidates: Array<{
    id: string;
    userId: string;
    tmuxSessionName: string;
    terminalType: string | null;
  }>;
  try {
    candidates = await db
      .select({
        id: terminalSessions.id,
        userId: terminalSessions.userId,
        tmuxSessionName: terminalSessions.tmuxSessionName,
        terminalType: terminalSessions.terminalType,
      })
      .from(terminalSessions)
      .where(inArray(terminalSessions.status, ["active", "suspended"]));
  } catch (error) {
    log.error("Failed to query sessions for reconcile", { error: String(error) });
    return { healed: 0 };
  }

  let healed = 0;
  for (const row of candidates) {
    // Only tmux-backed types can be ghosts; file/browser sessions have no tmux.
    if (!usesTmux(row.terminalType)) continue;

    let exists: boolean;
    try {
      exists = await TmuxService.sessionExists(row.tmuxSessionName);
    } catch (error) {
      // Can't tell → leave it alone (never heal on uncertainty).
      log.warn("tmux existence check failed during reconcile; skipping", {
        sessionId: row.id,
        tmuxSessionName: row.tmuxSessionName,
        error: String(error),
      });
      continue;
    }

    // tmux is alive → healthy, untouched.
    if (exists) continue;

    // Ghost: DB says alive, tmux is gone. Close it (and free the scope slot).
    try {
      await withBusyRetry(
        () =>
          db
            .update(terminalSessions)
            .set({ status: "closed", scopeKey: null, updatedAt: new Date() })
            .where(
              and(
                eq(terminalSessions.id, row.id),
                eq(terminalSessions.userId, row.userId)
              )
            ),
        { label: "reconcile-close" }
      );
      healed++;
    } catch (error) {
      log.error("Failed to heal ghost session", {
        sessionId: row.id,
        tmuxSessionName: row.tmuxSessionName,
        error: String(error),
      });
    }
  }

  log.info("Session reconcile complete", { healed });
  return { healed };
}
