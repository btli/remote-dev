/**
 * [y5ch.9] PID-liveness reconciliation sweep.
 *
 * The real "agent crashed / stopped responding" signal. For each DB session in
 * an alive-ish activity state (running | waiting | compacting | subagent), we
 * resolve its tmux pane PID and probe it with `process.kill(pid, 0)`. If the
 * tmux session is gone or the process is dead, the agent crashed/exited: we
 * clear the stale status and emit exactly one `agent_stuck` (error) notification
 * per transition.
 *
 * Runs ONLY on the terminal server (it owns tmux); started by terminal.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STABLE_SPAWN_CWD } from "@/lib/exec";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import * as NotificationService from "@/services/notification-service";

const log = createLogger("SessionLiveness");
const execFileAsync = promisify(execFile);

/** Activity states that imply the agent process should be alive. */
const ALIVE_STATES = ["running", "waiting", "compacting", "subagent"] as const;

/** POSIX liveness probe — kill(pid,0) throws ESRCH when the process is gone. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM ⇒ exists but not ours (still alive). ESRCH ⇒ dead.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolve the pane PID of a tmux session, or null if the session is gone. */
async function tmuxPanePid(tmuxSessionName: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-t",
      tmuxSessionName,
      "-F",
      "#{pane_pid}",
    ], { cwd: STABLE_SPAWN_CWD });
    const first = stdout.split("\n").find((l) => l.trim().length > 0);
    const pid = first ? parseInt(first.trim(), 10) : NaN;
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null; // no such session
  }
}

/** Minimal candidate row shape used by both reconciliation passes. */
interface LivenessCandidate {
  id: string;
  name: string;
  userId: string;
  tmuxSessionName: string;
  agentActivityStatus: string | null;
}

const CANDIDATE_COLUMNS = {
  id: true,
  name: true,
  userId: true,
  tmuxSessionName: true,
  agentActivityStatus: true,
} as const;

/**
 * Shared probe-and-clear pass. Finds sessions in `sessionStatus` that are stuck
 * in an alive-ish activity state but whose agent process is dead, clears each to
 * idle/exited, runs `onCleared` for the per-session side effect (notify vs
 * silent), and returns the count cleared. Sessions mid-restart are skipped:
 *
 *   [y5ch.9 risk #5] restart_agent kills + recreates the tmux session, so a sweep
 *   landing mid-restart would see a missing session and emit a false agent_stuck.
 */
async function reconcileSessionsInState(
  sessionStatus: "active" | "suspended",
  onCleared: (session: LivenessCandidate) => Promise<void> | void,
): Promise<number> {
  const candidates: LivenessCandidate[] = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.status, sessionStatus),
      inArray(terminalSessions.agentActivityStatus, [...ALIVE_STATES]),
      ne(terminalSessions.agentExitState, "restarting"),
    ),
    columns: CANDIDATE_COLUMNS,
  });

  let cleared = 0;
  for (const s of candidates) {
    const pid = await tmuxPanePid(s.tmuxSessionName);
    const alive = pid != null && pidAlive(pid);
    if (alive) continue;

    // Dead agent → transition out of the alive state.
    await db
      .update(terminalSessions)
      .set({ agentActivityStatus: "idle", agentExitState: "exited" })
      .where(eq(terminalSessions.id, s.id));
    await onCleared(s);
    cleared++;
  }
  return cleared;
}

/**
 * First pass: ACTIVE sessions whose agent process is dead → emit exactly one
 * agent_stuck (error) notification per transition (the user is presumably
 * looking at / cares about active sessions).
 */
async function reconcileActiveSessions(): Promise<number> {
  return reconcileSessionsInState("active", async (s) => {
    await NotificationService.createNotification({
      userId: s.userId,
      sessionId: s.id,
      sessionName: s.name,
      type: "agent_stuck",
      severity: "error",
      title: "Agent stopped responding",
      body: `Session "${s.name}" was ${s.agentActivityStatus} but its process is gone.`,
      meta: {
        deepLinkSessionId: s.id,
        cta: { label: "Open session", action: "open_session" },
      },
    });
    log.warn("Cleared stale agent session", {
      sessionId: s.id,
      prevStatus: s.agentActivityStatus,
    });
  });
}

/**
 * [remote-dev-5xpc] Second pass: SUSPENDED sessions whose agent process is dead →
 * clear the status SILENTLY (no agent_stuck notification). Suspended sessions are
 * backgrounded; the DB snapshot on 2026-06-07 showed them keeping a stale
 * running/subagent forever because the sweep only looked at active rows.
 * Suppressing the notification avoids the y5ch notification-spam anti-goal for
 * sessions the user isn't watching.
 *
 * NOTE: a suspended session whose process is ALIVE is legitimately a live agent
 * running in the background (resume() no longer wipes its status, remote-dev-3m5s)
 * — left untouched so the sidebar shows it as active.
 */
async function reconcileSuspendedSessions(): Promise<number> {
  return reconcileSessionsInState("suspended", (s) => {
    log.debug("Cleared stale suspended agent session (silent)", {
      sessionId: s.id,
      prevStatus: s.agentActivityStatus,
    });
  });
}

/**
 * One reconciliation pass over BOTH active and suspended sessions. Active
 * sessions notify on a dead agent (agent_stuck); suspended sessions are cleared
 * silently. Returns the total number of sessions cleared across both passes.
 */
export async function reconcileLiveness(): Promise<number> {
  const activeCleared = await reconcileActiveSessions();
  const suspendedCleared = await reconcileSuspendedSessions();
  const cleared = activeCleared + suspendedCleared;
  if (cleared > 0) {
    log.info("Liveness sweep cleared sessions", {
      cleared,
      active: activeCleared,
      suspended: suspendedCleared,
    });
  }
  return cleared;
}
