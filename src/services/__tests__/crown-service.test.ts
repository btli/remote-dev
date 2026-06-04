// @vitest-environment node
/**
 * Unit tests for CrownService (epic remote-dev-oyej.5/.6): fan-out into N
 * candidates, diff collection, judge wiring, auto-PR of the winner, and the
 * manual override. The DB + launcher + diff collector + judge + gh are injected
 * via CrownDeps so the orchestration is tested without a DB or real agents.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({
  crownRuns: {},
  crownCandidates: {},
  agentRuns: {},
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
// These tests inject CrownDeps; stub the heavy leaf modules crown-service
// imports so the import graph stays light (no native modules / real exec).
vi.mock("../agent-run-service", () => ({ launchAgentRun: vi.fn() }));
vi.mock("../session-service", () => ({ getSession: vi.fn() }));
vi.mock("../worktree-service", () => ({ getDefaultBranch: vi.fn() }));
vi.mock("../crown-diff-collector", () => ({ collectDiff: vi.fn() }));
vi.mock("../crown-judge", () => ({ judge: vi.fn() }));
vi.mock("@/lib/exec", () => ({ execFile: vi.fn() }));

import {
  startCrown,
  prForCandidate,
  type CrownDeps,
  type CrownRunRow,
  type CrownCandidateRow,
} from "../crown-service";

function makeDeps(over: Partial<CrownDeps> = {}): {
  deps: CrownDeps;
  state: {
    run: CrownRunRow;
    candidates: CrownCandidateRow[];
    patches: Partial<CrownRunRow>[];
  };
  launches: number;
} {
  let launches = 0;
  const candidates: CrownCandidateRow[] = [];
  const run: CrownRunRow = {
    id: "crown-1",
    userId: "u1",
    projectId: "p1",
    prompt: "do it",
    agentProvider: "claude",
    candidateCount: 3,
    judgeModel: null,
    baseBranch: "main",
    status: "running",
    winnerCandidateId: null,
    crownReason: null,
    prUrl: null,
    errorMessage: null,
    createdAt: new Date(),
  } as CrownRunRow;
  const patches: Partial<CrownRunRow>[] = [];

  const deps: CrownDeps = {
    insertRun: vi.fn(async () => run),
    updateRun: vi.fn(async (_id, patch) => {
      patches.push(patch);
      Object.assign(run, patch);
      return run;
    }),
    insertCandidate: vi.fn(async (values) => {
      const c = {
        id: `cand-${candidates.length + 1}`,
        crownRunId: "crown-1",
        runId: null,
        branch: "",
        worktreePath: null,
        diff: null,
        diffStats: null,
        createdAt: new Date(),
        ...values,
      } as CrownCandidateRow;
      candidates.push(c);
      return c;
    }),
    updateCandidate: vi.fn(async (id, patch) => {
      const c = candidates.find((x) => x.id === id)!;
      Object.assign(c, patch);
      return c;
    }),
    getRun: vi.fn(async () => run),
    getCandidates: vi.fn(async () => candidates),
    launchCandidate: vi.fn(async (_input) => {
      launches += 1;
      return {
        runId: `run-${launches}`,
        sessionId: `sess-${launches}`,
        branch: `crown/${launches}`,
        worktreePath: `/wt/${launches}`,
      };
    }),
    waitForCandidates: vi.fn(async () => {}),
    collectDiff: vi.fn(async (_wt, branch) => ({
      diff: `diff for ${branch}`,
      stats: { files: 1, additions: 10, deletions: 2 },
      truncated: false,
    })),
    judge: vi.fn(async (_o) => ({ winner: "cand-2", reason: "best one" })),
    openPr: vi.fn(async () => "https://github.com/o/r/pull/1"),
    resolveBaseBranch: vi.fn(async () => "main"),
    ...over,
  };

  return {
    deps,
    state: { run, candidates, patches },
    get launches() {
      return launches;
    },
  };
}

describe("CrownService.startCrown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a crown run + N candidates, each launched in its own worktree", async () => {
    const h = makeDeps();
    await startCrown(
      { projectId: "p1", prompt: "do it", count: 3, agentProvider: "claude" },
      "u1",
      h.deps,
    );
    expect(h.deps.insertRun).toHaveBeenCalledOnce();
    expect(h.launches).toBe(3);
    expect(h.state.candidates).toHaveLength(3);
    // Each candidate launch requested a worktree.
    expect(h.deps.launchCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeType: "feature", source: "crown" }),
    );
  });

  it("collects diffs, invokes the judge, stores winner+reason, opens a PR, completes", async () => {
    const h = makeDeps();
    await startCrown(
      { projectId: "p1", prompt: "do it", count: 2 },
      "u1",
      h.deps,
    );
    expect(h.deps.collectDiff).toHaveBeenCalledTimes(2);
    expect(h.deps.judge).toHaveBeenCalledOnce();
    expect(h.deps.openPr).toHaveBeenCalledOnce();
    // Final run reflects judge result + PR + completed status.
    expect(h.state.run.winnerCandidateId).toBe("cand-2");
    expect(h.state.run.crownReason).toBe("best one");
    expect(h.state.run.prUrl).toBe("https://github.com/o/r/pull/1");
    expect(h.state.run.status).toBe("completed");
  });

  it("marks the run failed when the launch phase throws", async () => {
    const h = makeDeps({
      launchCandidate: vi.fn(async () => {
        throw new Error("launch boom");
      }),
    });
    await expect(
      startCrown({ projectId: "p1", prompt: "x", count: 2 }, "u1", h.deps),
    ).rejects.toThrow();
    expect(
      h.state.patches.some((p) => p.status === "failed"),
    ).toBe(true);
  });
});

describe("CrownService.prForCandidate (manual override)", () => {
  it("opens a PR for the operator-chosen candidate, ignoring the judge", async () => {
    const h = makeDeps();
    // Seed two candidates with branches.
    await h.deps.insertCandidate({
      crownRunId: "crown-1",
      branch: "crown/1",
      worktreePath: "/wt/1",
    } as never);
    await h.deps.insertCandidate({
      crownRunId: "crown-1",
      branch: "crown/2",
      worktreePath: "/wt/2",
    } as never);

    const url = await prForCandidate("crown-1", "cand-1", "u1", h.deps);
    expect(url).toBe("https://github.com/o/r/pull/1");
    expect(h.deps.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "crown/1" }),
    );
    // The override records the chosen candidate as the winner.
    expect(h.state.run.winnerCandidateId).toBe("cand-1");
  });
});
