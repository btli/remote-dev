/**
 * AgentRunService — REAL non-interactive agent launches + the run state machine
 * (epic remote-dev-oyej.1/.4).
 *
 * An agent RUN creates a FRESH `terminalType:"agent"` session (autoLaunchAgent),
 * optionally in a worktree, then delivers a prompt to the agent. This is the
 * opposite of the keystroke-only `sessionSchedules`/`scheduleCommands` path
 * (which sends keystrokes to an EXISTING session and whose "success" only means
 * the keystrokes were sent). Distinct lifecycle → distinct tables (`agentRuns`).
 *
 * State machine: `pending → running → completed | failed`, plus `superseded`
 * for an older same-(triggerConfig, headSha) run replaced by a newer delivery.
 *
 * Testability: the DB operations + the session launcher + tmux are injected via
 * {@link AgentRunDeps} (defaulting to the real implementations) so the state
 * machine and dispatch wiring are unit-testable without a live DB or real tmux.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { AgentProviderType, WorktreeType } from "@/types/session";
import type { AgentRunSource } from "@/types/agent-run";
import * as SessionService from "./session-service";
import * as TmuxService from "./tmux-service";

const log = createLogger("AgentRun");

/** Row type for an `agent_run` record (inferred from the active dialect). */
export type AgentRunRow = typeof agentRuns.$inferSelect;
type AgentRunInsert = typeof agentRuns.$inferInsert;

export interface LaunchAgentRunInput {
  userId: string;
  projectId: string;
  source: AgentRunSource;
  agentProvider: string;
  agentFlags: string[];
  prompt: string;
  worktreeType?: string | null;
  baseBranch?: string | null;
  scheduleId?: string | null;
  triggerConfigId?: string | null;
  headSha?: string | null;
  /**
   * Explicit Claude profile to PIN this run to. `null`/undefined means
   * "auto-select" — session-service picks the project's primary profile (and
   * its fallback pool, skipping limited accounts) for a Claude run. The
   * resolved profile is recorded on the run row regardless (see below).
   */
  profileId?: string | null;
}

/** The session handle the launcher must return (subset of TerminalSession). */
export interface LaunchedSession {
  id: string;
  tmuxSessionName: string;
  /**
   * The profile the session actually launched with — the explicit pin if one
   * was passed, otherwise the auto-selected one (or null if none applied). The
   * run row records THIS resolved value, not the requested one.
   */
  profileId: string | null;
}

/**
 * Injectable dependencies. Defaults wire to the real DB + SessionService +
 * TmuxService; tests pass fakes.
 */
export interface AgentRunDeps {
  insertRun(values: AgentRunInsert): Promise<AgentRunRow>;
  updateRun(id: string, patch: Partial<AgentRunRow>): Promise<AgentRunRow>;
  /** Mark non-terminal sibling runs (same key) superseded; returns count. */
  supersede(
    triggerConfigId: string,
    headSha: string,
    keepRunId: string,
  ): Promise<number>;
  /** REAL agent session launch (the interactive create path). */
  launchSession(input: {
    name: string;
    projectId: string;
    terminalType: "agent";
    agentProvider: AgentProviderType;
    autoLaunchAgent: true;
    agentFlags: string[];
    createWorktree: boolean;
    worktreeType?: WorktreeType;
    baseBranch?: string;
    /** Explicit profile pin (null/undefined → session-service auto-selects). */
    profileId?: string | null;
  }): Promise<LaunchedSession>;
  /** Best-effort wait until the agent CLI is at a prompt. */
  waitForAgentReady(tmuxSessionName: string): Promise<void>;
  /** Deliver the prompt to the agent (tmux send-keys with \r). */
  sendPrompt(tmuxSessionName: string, prompt: string): Promise<void>;
  now(): Date;
}

/**
 * Best-effort wait until a freshly-launched agent pane stops emitting output
 * (the agent CLI finished booting and is sitting at its prompt), so boot-time
 * output can't race the prompt we send. Mirrors the pane-quiescent guard the
 * project added in `createSession` (memory: startup_cmd_first_char — a shell-init
 * prompt ate the first keystroke). Agents boot slower than shells, so the
 * default window is wider. Never throws — readiness is an optimization.
 */
async function defaultWaitForAgentReady(
  tmuxSessionName: string,
  intervalMs = 250,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previous: string | null = null;
  while (Date.now() < deadline) {
    let snapshot: string;
    try {
      snapshot = (await TmuxService.capturePane(tmuxSessionName)).replace(
        /\s+$/,
        "",
      );
    } catch {
      return;
    }
    if (previous !== null && snapshot === previous && snapshot.length > 0) {
      return;
    }
    previous = snapshot;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Real dependencies. `userId` is needed to scope the session launch + (via
 * SessionService) the auto-created agent API key. Tests pass their own deps.
 */
function defaultDeps(userId: string): AgentRunDeps {
  return {
    insertRun: async (values) => {
      const [row] = await db.insert(agentRuns).values(values).returning();
      return row;
    },
    updateRun: async (id, patch) => {
      const [row] = await db
        .update(agentRuns)
        .set(patch)
        .where(eq(agentRuns.id, id))
        .returning();
      return row;
    },
    supersede: async (triggerConfigId, headSha, keepRunId) => {
      const updated = await db
        .update(agentRuns)
        .set({ status: "superseded" })
        .where(
          and(
            eq(agentRuns.triggerConfigId, triggerConfigId),
            eq(agentRuns.headSha, headSha),
            ne(agentRuns.id, keepRunId),
            inArray(agentRuns.status, ["pending", "running"]),
          ),
        )
        .returning({ id: agentRuns.id });
      return updated.length;
    },
    launchSession: async (input) => {
      const { session } = await SessionService.createSessionWithDedupFlag(
        userId,
        input as never,
      );
      // `session` is a mapped TerminalSession; `session.profileId` is the
      // RESOLVED profile (the explicit pin OR session-service's auto-selection),
      // so the run row can record what actually launched.
      return {
        id: session.id,
        tmuxSessionName: session.tmuxSessionName,
        profileId: session.profileId ?? null,
      };
    },
    waitForAgentReady: defaultWaitForAgentReady,
    // tmux send-keys uses \r (pressEnter) — the Claude/Codex TUI requires the
    // carriage return to SUBMIT (project memory: terminal_carriage_return).
    sendPrompt: async (tmuxSessionName, prompt) => {
      await TmuxService.sendKeys(tmuxSessionName, prompt, true);
    },
    now: () => new Date(),
  };
}

/**
 * Launch a REAL agent run: insert `pending`, create the agent session, deliver
 * the prompt, transition to `running`. On any failure, transition to `failed`
 * with the error message and rethrow.
 */
export async function launchAgentRun(
  input: LaunchAgentRunInput,
  injectedDeps?: AgentRunDeps,
): Promise<AgentRunRow> {
  const deps = injectedDeps ?? defaultDeps(input.userId);

  const run = await deps.insertRun({
    userId: input.userId,
    projectId: input.projectId,
    source: input.source,
    agentProvider: input.agentProvider,
    agentFlags: JSON.stringify(input.agentFlags),
    prompt: input.prompt,
    scheduleId: input.scheduleId ?? null,
    triggerConfigId: input.triggerConfigId ?? null,
    headSha: input.headSha ?? null,
    // The EXPLICIT pin requested (may be null → auto-select). On success we
    // overwrite this with the RESOLVED profile the session actually used.
    profileId: input.profileId ?? null,
    status: "pending",
  });

  try {
    const session = await deps.launchSession({
      name: `run/${input.source}/${run.id.slice(0, 8)}`,
      projectId: input.projectId,
      terminalType: "agent",
      agentProvider: input.agentProvider as AgentProviderType,
      autoLaunchAgent: true,
      agentFlags: input.agentFlags,
      createWorktree: !!input.worktreeType,
      worktreeType: (input.worktreeType ?? undefined) as WorktreeType | undefined,
      baseBranch: input.baseBranch ?? undefined,
      profileId: input.profileId,
    });

    await deps.waitForAgentReady(session.tmuxSessionName);
    await deps.sendPrompt(session.tmuxSessionName, input.prompt);

    const running = await deps.updateRun(run.id, {
      status: "running",
      sessionId: session.id,
      // Record the RESOLVED profile (auto-selected or explicit) so the run row
      // reflects which Claude account actually ran — not just what was asked.
      profileId: session.profileId,
      startedAt: deps.now(),
    });
    log.info("agent run launched", {
      runId: run.id,
      sessionId: session.id,
      source: input.source,
    });
    return running;
  } catch (err) {
    await deps.updateRun(run.id, {
      status: "failed",
      errorMessage: String(err),
      completedAt: deps.now(),
    });
    log.error("agent run launch failed", {
      runId: run.id,
      error: String(err),
    });
    throw err;
  }
}

/**
 * Mark older non-terminal runs sharing the same dedupe key
 * (triggerConfigId, headSha) as `superseded`, keeping `keepRunId`. Returns the
 * number of rows superseded.
 */
export async function supersedePriorRuns(
  triggerConfigId: string,
  headSha: string,
  keepRunId: string,
  injectedDeps?: AgentRunDeps,
): Promise<number> {
  // supersede needs no userId; pass a throwaway when building default deps.
  const deps = injectedDeps ?? defaultDeps("");
  return deps.supersede(triggerConfigId, headSha, keepRunId);
}

/** Fetch a single run by id (owner-scoped). */
export async function getRun(
  userId: string,
  id: string,
): Promise<AgentRunRow | null> {
  const row = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.id, id), eq(agentRuns.userId, userId)),
  });
  return row ?? null;
}

/** List runs for a user with optional filters. */
export async function listRuns(
  userId: string,
  filters: {
    scheduleId?: string;
    triggerConfigId?: string;
    status?: AgentRunRow["status"];
  } = {},
): Promise<AgentRunRow[]> {
  const conds = [eq(agentRuns.userId, userId)];
  if (filters.scheduleId)
    conds.push(eq(agentRuns.scheduleId, filters.scheduleId));
  if (filters.triggerConfigId)
    conds.push(eq(agentRuns.triggerConfigId, filters.triggerConfigId));
  if (filters.status) conds.push(eq(agentRuns.status, filters.status));
  return db
    .select()
    .from(agentRuns)
    .where(and(...conds))
    .orderBy(agentRuns.createdAt);
}
