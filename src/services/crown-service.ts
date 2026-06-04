/**
 * CrownService — best-of-N run-and-compare (epic remote-dev-oyej.5/.6).
 *
 * Crown = same prompt → N agents → N worktree branches → collect filtered diffs
 * → LLM judge picks a winner → auto-PR the winner. Built on the same fan-out
 * primitive `rdv teams` uses, driven server-side via N
 * `AgentRunService.launchAgentRun({ source:"crown", worktreeType:"feature" })`
 * calls sharing a `crownRunId`.
 *
 * Run lifecycle: `running → judging → completed | failed`. Each candidate's
 * "done" is inferred from its agent run reaching a terminal status (same signal
 * `teams wait` uses); a timeout bounds the wait.
 *
 * Testability: the DB + launcher + diff collector + judge + gh are injected via
 * {@link CrownDeps} (defaulting to the real implementations).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crownRuns, crownCandidates, agentRuns } from "@/db/schema";
import { execFile } from "@/lib/exec";
import { createLogger } from "@/lib/logger";
import * as AgentRunService from "./agent-run-service";
import * as SessionService from "./session-service";
import * as WorktreeService from "./worktree-service";
import { collectDiff } from "./crown-diff-collector";
import { judge as judgeImpl } from "./crown-judge";
import type { CrownInput, CrownDiffStats } from "@/types/crown";

const log = createLogger("Crown");

export type CrownRunRow = typeof crownRuns.$inferSelect;
export type CrownCandidateRow = typeof crownCandidates.$inferSelect;

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const POLL_INTERVAL_MS = 5000;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "superseded"]);

/** What a candidate launch yields (run + session + worktree coordinates). */
export interface LaunchedCandidate {
  runId: string;
  sessionId: string;
  branch: string;
  worktreePath: string;
}

export interface CrownDeps {
  insertRun(values: typeof crownRuns.$inferInsert): Promise<CrownRunRow>;
  updateRun(id: string, patch: Partial<CrownRunRow>): Promise<CrownRunRow>;
  insertCandidate(
    values: typeof crownCandidates.$inferInsert,
  ): Promise<CrownCandidateRow>;
  updateCandidate(
    id: string,
    patch: Partial<CrownCandidateRow>,
  ): Promise<CrownCandidateRow>;
  getRun(id: string, userId: string): Promise<CrownRunRow | null>;
  getCandidates(crownRunId: string): Promise<CrownCandidateRow[]>;
  launchCandidate(input: {
    userId: string;
    projectId: string;
    source: "crown";
    agentProvider: string;
    prompt: string;
    worktreeType: "feature";
    baseBranch: string | null;
  }): Promise<LaunchedCandidate>;
  waitForCandidates(runIds: string[], timeoutMs: number): Promise<void>;
  collectDiff(
    worktreePath: string,
    branch: string,
    baseBranch: string,
  ): Promise<{ diff: string; stats: CrownDiffStats; truncated: boolean }>;
  judge(opts: {
    userId: string;
    prompt: string;
    candidates: { id: string; branch: string; diff: string }[];
    model?: string;
  }): Promise<{ winner: string; reason: string }>;
  openPr(input: {
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    cwd: string;
  }): Promise<string>;
  resolveBaseBranch(worktreePath: string): Promise<string>;
}

// ── default deps ─────────────────────────────────────────────────────────────

function defaultDeps(): CrownDeps {
  return {
    insertRun: async (values) => {
      const [row] = await db.insert(crownRuns).values(values).returning();
      return row;
    },
    updateRun: async (id, patch) => {
      const [row] = await db
        .update(crownRuns)
        .set(patch)
        .where(eq(crownRuns.id, id))
        .returning();
      return row;
    },
    insertCandidate: async (values) => {
      const [row] = await db
        .insert(crownCandidates)
        .values(values)
        .returning();
      return row;
    },
    updateCandidate: async (id, patch) => {
      const [row] = await db
        .update(crownCandidates)
        .set(patch)
        .where(eq(crownCandidates.id, id))
        .returning();
      return row;
    },
    getRun: async (id, userId) => {
      const row = await db.query.crownRuns.findFirst({
        where: and(eq(crownRuns.id, id), eq(crownRuns.userId, userId)),
      });
      return row ?? null;
    },
    getCandidates: async (crownRunId) =>
      db
        .select()
        .from(crownCandidates)
        .where(eq(crownCandidates.crownRunId, crownRunId)),
    launchCandidate: async (input) => {
      const run = await AgentRunService.launchAgentRun({
        userId: input.userId,
        projectId: input.projectId,
        source: "crown",
        agentProvider: input.agentProvider,
        agentFlags: [],
        prompt: input.prompt,
        worktreeType: input.worktreeType,
        baseBranch: input.baseBranch,
      });
      // The launch created an agent session in its own worktree; read its
      // branch + working path back from the session row.
      const session = run.sessionId
        ? await SessionService.getSession(run.sessionId, input.userId)
        : null;
      return {
        runId: run.id,
        sessionId: run.sessionId ?? "",
        branch: session?.worktreeBranch ?? "",
        worktreePath: session?.projectPath ?? "",
      };
    },
    waitForCandidates: async (runIds, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const rows = await db
          .select({ id: agentRuns.id, status: agentRuns.status })
          .from(agentRuns);
        const mine = rows.filter((r) => runIds.includes(r.id));
        const allDone =
          mine.length === runIds.length &&
          mine.every((r) => TERMINAL_RUN_STATUSES.has(r.status));
        if (allDone) return;
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      }
      log.warn("crown waitForCandidates timed out", { runIds });
    },
    collectDiff,
    judge: judgeImpl,
    openPr: async ({ branch, baseBranch, title, body, cwd }) => {
      const res = await execFile(
        "gh",
        [
          "pr",
          "create",
          "--head",
          branch,
          "--base",
          baseBranch,
          "--title",
          title,
          "--body",
          body,
        ],
        { cwd, timeout: 60_000 },
      );
      // gh prints the PR URL on stdout.
      return res.stdout.trim();
    },
    resolveBaseBranch: async (worktreePath) => {
      try {
        return await WorktreeService.getDefaultBranch(worktreePath);
      } catch {
        return "main";
      }
    },
  };
}

// ── orchestration ────────────────────────────────────────────────────────────

/**
 * Insert the `crown_run` row (status `running`) and return it WITHOUT running
 * the (slow) fan-out. The API route uses this to get the run id deterministically
 * before kicking {@link runCrownOrchestration} detached.
 */
export async function beginCrown(
  input: CrownInput,
  userId: string,
  injectedDeps?: CrownDeps,
): Promise<CrownRunRow> {
  const deps = injectedDeps ?? defaultDeps();
  const provider = input.agentProvider ?? "claude";
  const count = Math.max(1, input.count);
  return deps.insertRun({
    userId,
    projectId: input.projectId,
    prompt: input.prompt,
    agentProvider: provider,
    candidateCount: count,
    judgeModel: input.judgeModel ?? null,
    baseBranch: input.baseBranch ?? null,
    status: "running",
  });
}

/**
 * Start a Crown run end-to-end: insert the run, fan out N candidates, wait,
 * collect diffs, judge, auto-PR the winner. Returns the crown run row
 * (status `completed` on success, `failed` on a launch/orchestration error).
 */
export async function startCrown(
  input: CrownInput,
  userId: string,
  injectedDeps?: CrownDeps,
): Promise<CrownRunRow> {
  const deps = injectedDeps ?? defaultDeps();
  const run = await beginCrown(input, userId, deps);
  return runCrownOrchestration(run, input, userId, deps);
}

/**
 * Run the fan-out → wait → collect → judge → auto-PR pipeline for an already-
 * inserted crown run. Separated so the API can return the run id immediately
 * and let this run detached.
 */
export async function runCrownOrchestration(
  run: CrownRunRow,
  input: CrownInput,
  userId: string,
  injectedDeps?: CrownDeps,
): Promise<CrownRunRow> {
  const deps = injectedDeps ?? defaultDeps();
  const provider = input.agentProvider ?? "claude";
  const count = Math.max(1, input.count);

  try {
    // 1. Fan out: launch N candidates, each in its own worktree branch.
    const launched: Array<{ candidateId: string; runId: string } & LaunchedCandidate> =
      [];
    for (let i = 0; i < count; i++) {
      const lc = await deps.launchCandidate({
        userId,
        projectId: input.projectId,
        source: "crown",
        agentProvider: provider,
        prompt: input.prompt,
        worktreeType: "feature",
        baseBranch: input.baseBranch ?? null,
      });
      const candidate = await deps.insertCandidate({
        crownRunId: run.id,
        runId: lc.runId,
        branch: lc.branch,
        worktreePath: lc.worktreePath || null,
      });
      launched.push({ ...lc, candidateId: candidate.id });
    }

    // 2. Wait for all candidate runs to reach a terminal state (bounded).
    await deps.waitForCandidates(
      launched.map((l) => l.runId),
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    // 3. Resolve the base branch (from the first candidate's worktree) + collect
    //    filtered diffs per candidate.
    const baseBranch =
      input.baseBranch ??
      (launched[0]?.worktreePath
        ? await deps.resolveBaseBranch(launched[0].worktreePath)
        : "main");

    const judged: { id: string; branch: string; diff: string }[] = [];
    for (const l of launched) {
      if (!l.worktreePath || !l.branch) {
        await deps.updateCandidate(l.candidateId, { diff: "", diffStats: JSON.stringify({ files: 0, additions: 0, deletions: 0 }) });
        judged.push({ id: l.candidateId, branch: l.branch, diff: "" });
        continue;
      }
      const collected = await deps.collectDiff(
        l.worktreePath,
        l.branch,
        baseBranch,
      );
      await deps.updateCandidate(l.candidateId, {
        diff: collected.diff,
        diffStats: JSON.stringify(collected.stats),
      });
      judged.push({ id: l.candidateId, branch: l.branch, diff: collected.diff });
    }

    // 4. Judge.
    await deps.updateRun(run.id, { status: "judging" });
    const result = await deps.judge({
      userId,
      prompt: input.prompt,
      candidates: judged,
      model: input.judgeModel,
    });

    // 5. Auto-PR the winner.
    const winner = launched.find((l) => l.candidateId === result.winner);
    let prUrl: string | null = null;
    if (winner && winner.branch && winner.worktreePath) {
      try {
        prUrl = await deps.openPr({
          branch: winner.branch,
          baseBranch,
          title: `Crown winner: ${winner.branch}`,
          body: result.reason,
          cwd: winner.worktreePath,
        });
      } catch (err) {
        log.warn("crown auto-PR failed; winner recorded without PR", {
          crownRunId: run.id,
          error: String(err),
        });
      }
    }

    const completed = await deps.updateRun(run.id, {
      status: "completed",
      winnerCandidateId: result.winner,
      crownReason: result.reason,
      prUrl,
    });
    log.info("crown completed", {
      crownRunId: run.id,
      winner: result.winner,
      prUrl,
    });
    return completed;
  } catch (err) {
    await deps.updateRun(run.id, {
      status: "failed",
      errorMessage: String(err),
    });
    log.error("crown failed", { crownRunId: run.id, error: String(err) });
    throw err;
  }
}

/** Fetch a crown run + its candidates (owner-scoped). */
export async function getCrown(
  id: string,
  userId: string,
  injectedDeps?: CrownDeps,
): Promise<{ run: CrownRunRow; candidates: CrownCandidateRow[] } | null> {
  const deps = injectedDeps ?? defaultDeps();
  const run = await deps.getRun(id, userId);
  if (!run) return null;
  const candidates = await deps.getCandidates(id);
  return { run, candidates };
}

/** List the caller's crown runs. */
export async function listCrowns(userId: string): Promise<CrownRunRow[]> {
  return db
    .select()
    .from(crownRuns)
    .where(eq(crownRuns.userId, userId))
    .orderBy(crownRuns.createdAt);
}

/**
 * Manual override: open a PR for an operator-chosen candidate, ignoring the
 * judge's pick. Records the chosen candidate as the winner. Returns the PR URL.
 */
export async function prForCandidate(
  crownRunId: string,
  candidateId: string,
  userId: string,
  injectedDeps?: CrownDeps,
): Promise<string | null> {
  const deps = injectedDeps ?? defaultDeps();
  const run = await deps.getRun(crownRunId, userId);
  if (!run) return null;
  const candidates = await deps.getCandidates(crownRunId);
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate || !candidate.branch || !candidate.worktreePath) return null;

  const baseBranch =
    run.baseBranch ?? (await deps.resolveBaseBranch(candidate.worktreePath));

  const prUrl = await deps.openPr({
    branch: candidate.branch,
    baseBranch,
    title: `Crown (manual): ${candidate.branch}`,
    body: `Operator-selected candidate ${candidate.id}.`,
    cwd: candidate.worktreePath,
  });

  await deps.updateRun(crownRunId, {
    winnerCandidateId: candidateId,
    prUrl,
  });
  return prUrl;
}
