/**
 * [y5ch.9] PID-liveness reconciliation sweep.
 *
 * The real "agent crashed / stopped responding" signal. For each DB session in
 * an alive-ish activity state (running | waiting | compacting | subagent), we
 * resolve its tmux pane PID and probe it with `process.kill(pid, 0)`. If the
 * tmux session is gone or the process is dead, the agent crashed/exited: we
 * persist durable exit intent. The exact pane callback gets a bounded window to
 * deliver focus-aware notification/push state; a later sweep repairs any intent
 * it did not finish.
 *
 * Runs ONLY on the terminal server (it owns tmux); started by terminal.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STABLE_SPAWN_CWD } from "@/lib/exec";
import { db } from "@/db";
import { terminalSessions } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import {
  ensureAgentExitNotification,
  ensureAgentStuckNotification,
  markAgentExitNotificationDelivered,
} from "@/services/agent-exit-notification-service";
import {
  agentExitStateUpdate,
  parseAgentExitCode,
  parseAgentExitSignal,
} from "@/server/agent-exit-state";
import {
  stopTmuxSessionAndConfirmAbsent,
  tmuxAbsenceConfirmed,
} from "@/server/tmux-containment";
import { withAgentExitDeliveryLock } from "@/server/agent-exit-delivery-lock";

const log = createLogger("SessionLiveness");
const execFileAsync = promisify(execFile);

/** Activity states that imply the agent process should be alive. */
const ALIVE_STATES = ["running", "waiting", "compacting", "subagent"] as const;
/** Allow an ordinary launch ample time before treating its restart claim as abandoned. */
const RESTART_RECONCILE_GRACE_MS = 2 * 60_000;
/** Longer than the pane callback's bounded 6s retry window. */
export const EXIT_NOTIFICATION_REPAIR_GRACE_MS = 10_000;

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

interface TmuxPaneState {
  paneId: string;
  pid: number | null;
  dead: boolean;
  exitCode: number | null;
  signal: string | null;
}

type TmuxPaneLookup =
  | { kind: "found"; pane: TmuxPaneState }
  | { kind: "absent" }
  | { kind: "ambiguous" }
  | { kind: "probe-error"; error: string };

/** Resolve both liveness and tmux's durable dead-pane result. */
async function tmuxPaneState(
  tmuxSessionName: string,
): Promise<TmuxPaneLookup> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-panes",
      "-s",
      "-t",
      tmuxSessionName,
      "-F",
      "#{pane_id}\t#{@rdv_agent_pane}\t#{pane_pid}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}",
    ], { cwd: STABLE_SPAWN_CWD });
    const panes = stdout.split("\n").filter((line) => line.trim().length > 0);
    // New sessions mark their lifecycle owner. A single unmarked pane is a
    // safe legacy fallback; multiple unmarked panes are ambiguous and must not
    // let an auxiliary pane decide the agent's state.
    const marked = panes.filter((line) => line.split("\t")[1]?.trim() === "1");
    const selected = marked.length === 1
      ? marked[0]
      : marked.length === 0 && panes.length === 1
        ? panes[0]
        : undefined;
    if (!selected) return panes.length === 0
      ? { kind: "absent" }
      : { kind: "ambiguous" };
    const [paneId, , rawPid, rawDead, rawExitCode, rawSignal] = selected.split("\t");
    const parsedPid = Number.parseInt(rawPid?.trim() ?? "", 10);
    return {
      kind: "found",
      pane: {
        paneId,
        pid: Number.isNaN(parsedPid) ? null : parsedPid,
        dead: rawDead?.trim() === "1",
        exitCode: parseAgentExitCode(rawExitCode?.trim()),
        signal: parseAgentExitSignal(rawSignal?.trim()),
      },
    };
  } catch (error) {
    return tmuxAbsenceConfirmed(error)
      ? { kind: "absent" }
      : { kind: "probe-error", error: String(error) };
  }
}

/** Minimal candidate row shape used by both reconciliation passes. */
interface LivenessCandidate {
  id: string;
  name: string;
  userId: string;
  tmuxSessionName: string;
  agentActivityStatus: string | null;
  agentRestartCount: number | null;
  agentExitState: string | null;
  updatedAt: Date;
}

const CANDIDATE_COLUMNS = {
  id: true,
  name: true,
  userId: true,
  tmuxSessionName: true,
  agentActivityStatus: true,
  agentRestartCount: true,
  agentExitState: true,
  updatedAt: true,
} as const;

type DeadPaneReconcileResult = "not-dead" | "updated" | "stale";

async function reconcileDeadPane(
  s: LivenessCandidate,
  pane: TmuxPaneState,
  source = "dead tmux pane",
): Promise<DeadPaneReconcileResult> {
  if (!pane.dead || (pane.exitCode === null && pane.signal === null)) return "not-dead";
  const generation = s.agentRestartCount ?? 0;
  const statusAt = Date.now();
  const updated = await db
    .update(terminalSessions)
    .set(agentExitStateUpdate(pane.exitCode, pane.signal, statusAt))
    .where(and(
      eq(terminalSessions.id, s.id),
      eq(terminalSessions.userId, s.userId),
      sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${generation}`,
      sql`(${terminalSessions.agentExitState} IS NULL OR ${terminalSessions.agentExitState} IN ('running', 'restarting'))`,
    ))
    .returning({ id: terminalSessions.id });
  if (updated.length === 0) return "stale";

  log.warn("Persisted agent exit during reconciliation", {
    sessionId: s.id,
    source,
    generation,
    exitCode: pane.exitCode,
    signal: pane.signal,
  });
  return "updated";
}

/**
 * Shared probe-and-clear pass. It scans every unexited agent pane so an idle
 * turn whose CLI subsequently dies can still recover tmux's exact exit. The
 * heuristic agent_stuck fallback remains limited to alive-ish activity states.
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
      inArray(terminalSessions.terminalType, ["agent", "loop"]),
      sql`(${terminalSessions.agentExitState} IS NULL OR ${terminalSessions.agentExitState} IN ('running', 'restarting'))`,
    ),
    columns: CANDIDATE_COLUMNS,
  });

  let cleared = 0;
  for (const s of candidates) {
    const paneLookup = await tmuxPaneState(s.tmuxSessionName);
    if (paneLookup.kind === "ambiguous") {
      log.debug("Skipped ambiguous multi-pane agent session", {
        sessionId: s.id,
        tmuxSessionName: s.tmuxSessionName,
      });
      continue;
    }
    if (paneLookup.kind === "probe-error") {
      log.warn("Skipped liveness mutation after inconclusive tmux probe", {
        sessionId: s.id,
        tmuxSessionName: s.tmuxSessionName,
        error: paneLookup.error,
      });
      continue;
    }
    const pane = paneLookup.kind === "found" ? paneLookup.pane : null;
    let forceTreatAsDead = false;
    if (s.agentExitState === "restarting") {
      const claimAge = Date.now() - s.updatedAt.getTime();
      const hasExactDeath = Boolean(
        pane?.dead && (pane.exitCode !== null || pane.signal !== null),
      );
      if (!hasExactDeath && claimAge < RESTART_RECONCILE_GRACE_MS) {
        continue;
      }
      if (pane && !pane.dead && pane.pid !== null && pidAlive(pane.pid)) {
        // The owner died after claiming but before completing. Terminate the
        // uncertain old/replacement process so it cannot keep running under a
        // generation the DB no longer trusts, then expose a restartable error.
        const processStopped = await stopTmuxSessionAndConfirmAbsent(s.tmuxSessionName);
        if (processStopped) {
          forceTreatAsDead = true;
        } else {
          log.warn("Could not confirm abandoned restart session stopped", {
            sessionId: s.id,
            generation: s.agentRestartCount ?? 0,
          });
          continue;
        }
      }
    }
    if (pane) {
      const result = await reconcileDeadPane(s, pane);
      if (result !== "not-dead") {
        if (result === "updated") cleared++;
        continue;
      }
    }
    const alive = !forceTreatAsDead && pane?.pid != null && pidAlive(pane.pid);
    if (s.agentActivityStatus === "ended" && !alive) {
      const result = await reconcileDeadPane(
        s,
        {
          paneId: pane?.paneId ?? "",
          pid: pane?.pid ?? null,
          dead: true,
          exitCode: 0,
          signal: null,
        },
        "provider SessionEnd with no live pane",
      );
      if (result === "updated") cleared++;
      continue;
    }
    const activityStatus = s.agentActivityStatus;
    if (
      activityStatus === null ||
      !ALIVE_STATES.includes(activityStatus as (typeof ALIVE_STATES)[number])
    ) {
      continue;
    }
    if (alive) continue;

    // Dead agent → transition out of the alive state, but only if the exact
    // owner/generation/activity snapshot still matches. A concurrent restart or
    // newer hook status wins this CAS and suppresses the stale notification.
    const now = new Date();
    const updated = await db
      .update(terminalSessions)
      .set({
        agentActivityStatus: "idle",
        agentActivityStatusAt: now.getTime(),
        agentExitState: "exited",
        agentExitCode: null,
        agentExitedAt: now,
        agentExitNotificationAt: null,
        agentActivityOrder: now.getTime() * 1_000,
        updatedAt: now,
      })
      .where(and(
        eq(terminalSessions.id, s.id),
        eq(terminalSessions.userId, s.userId),
        eq(terminalSessions.agentActivityStatus, activityStatus),
        sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${s.agentRestartCount ?? 0}`,
        sql`(${terminalSessions.agentExitState} IS NULL OR ${terminalSessions.agentExitState} IN ('running', 'restarting'))`,
      ))
      .returning({ id: terminalSessions.id });
    if (updated.length === 0) continue;
    await onCleared(s);
    cleared++;
  }
  return cleared;
}

/**
 * An exited row is durable notification intent. Repair the narrow crash window
 * between lifecycle persistence and notification insert on startup/every sweep.
 */
async function reconcileExitNotifications(): Promise<number> {
  const exited = await db.query.terminalSessions.findMany({
    where: and(
      inArray(terminalSessions.terminalType, ["agent", "loop"]),
      eq(terminalSessions.agentExitState, "exited"),
      isNull(terminalSessions.agentExitNotificationAt),
    ),
    columns: {
      id: true,
      name: true,
      userId: true,
      agentRestartCount: true,
      agentExitCode: true,
      agentExitedAt: true,
      agentActivityStatus: true,
      status: true,
    },
  });
  let repaired = 0;
  for (const snapshot of exited) {
    const generation = snapshot.agentRestartCount ?? 0;
    await withAgentExitDeliveryLock(snapshot.id, generation, async () => {
      // The callback may have completed while this sweep waited for its lock.
      // Re-read the guarded intent instead of acting on the stale scan row.
      const s = await db.query.terminalSessions.findFirst({
        where: and(
          eq(terminalSessions.id, snapshot.id),
          eq(terminalSessions.userId, snapshot.userId),
          eq(terminalSessions.agentExitState, "exited"),
          isNull(terminalSessions.agentExitNotificationAt),
          sql`COALESCE(${terminalSessions.agentRestartCount}, 0) = ${generation}`,
        ),
        columns: {
          id: true,
          name: true,
          userId: true,
          agentRestartCount: true,
          agentExitCode: true,
          agentExitedAt: true,
          agentActivityStatus: true,
          status: true,
        },
      });
      if (!s) return;
      // A freshly committed row belongs to an in-flight exact callback. Give
      // its bounded transport ample time to apply focus-aware push policy and
      // broadcast the notification before crash repair is eligible.
      if (
        s.agentExitedAt &&
        Date.now() - s.agentExitedAt.getTime() < EXIT_NOTIFICATION_REPAIR_GRACE_MS
      ) {
        return;
      }

      const genericStuck = s.agentExitCode === null && s.agentActivityStatus === "idle";
      // Preserve the long-standing silent policy for background/suspended
      // heuristic loss; exact exit/error rows still repair their notification.
      if (genericStuck && s.status === "suspended") {
        await markAgentExitNotificationDelivered({
          id: s.id,
          userId: s.userId,
          generation,
        });
        return;
      }
      const notification = genericStuck
        ? await ensureAgentStuckNotification({
            id: s.id,
            userId: s.userId,
            name: s.name,
            generation,
          })
        : await ensureAgentExitNotification({
            id: s.id,
            userId: s.userId,
            name: s.name,
            generation,
            exitCode: s.agentExitCode,
            failed:
              s.agentActivityStatus === "error" ||
              (s.agentExitCode !== null && s.agentExitCode !== 0),
          });
      await markAgentExitNotificationDelivered({
        id: s.id,
        userId: s.userId,
        generation,
      });
      if (notification) repaired++;
    });
  }
  return repaired;
}

/**
 * First pass: persist durable exit intent for ACTIVE sessions whose process is
 * dead. Notification creation is deferred to callback/repair arbitration so a
 * focus-aware exact callback cannot lose to a heuristic liveness observation.
 */
async function reconcileActiveSessions(): Promise<number> {
  return reconcileSessionsInState("active", (s) => {
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
 * One reconciliation pass over BOTH active and suspended sessions. Fresh exit
 * intents wait for an exact callback; old active intents are repaired with an
 * agent_stuck notification and old suspended heuristic intents are marked
 * delivered silently. Returns the total number of sessions cleared.
 */
export async function reconcileLiveness(): Promise<number> {
  const activeCleared = await reconcileActiveSessions();
  const suspendedCleared = await reconcileSuspendedSessions();
  const cleared = activeCleared + suspendedCleared;
  const repairedNotifications = await reconcileExitNotifications();
  const { pruneLifecycleDeliveryReceipts } = await import(
    "@/services/notification-service"
  );
  await pruneLifecycleDeliveryReceipts();
  if (cleared > 0) {
    log.info("Liveness sweep cleared sessions", {
      cleared,
      active: activeCleared,
      suspended: suspendedCleared,
      repairedNotifications,
    });
  }
  return cleared;
}
