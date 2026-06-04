// @vitest-environment node
/**
 * Unit tests for AgentRunService — the run state machine + REAL agent launch
 * wiring (epic remote-dev-oyej.1/.4). The DB and the session launcher are
 * injected through `AgentRunDeps`, so these tests exercise the state machine
 * and dispatch wiring WITHOUT a live database or real tmux.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// The service imports `@/db` (and transitively the logger's SQLite log sidecar,
// whose native module isn't built in CI worktrees) at module load. These tests
// drive the state machine through INJECTED deps and never touch the real DB,
// so stub the heavy modules to keep the import graph light.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ agentRuns: {} }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
vi.mock("../session-service", () => ({ createSessionWithDedupFlag: vi.fn() }));
vi.mock("../tmux-service", () => ({ sendKeys: vi.fn(), capturePane: vi.fn() }));

import {
  launchAgentRun,
  supersedePriorRuns,
  type AgentRunDeps,
} from "../agent-run-service";
import type { AgentRunRow } from "../agent-run-service";

/** Build a fake AgentRunRow for a freshly-inserted pending run. */
function pendingRow(overrides: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: "run-1",
    userId: "user-1",
    projectId: "proj-1",
    scheduleId: null,
    triggerConfigId: null,
    source: "manual",
    agentProvider: "claude",
    agentFlags: "[]",
    prompt: "do the thing",
    sessionId: null,
    headSha: null,
    status: "pending",
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as AgentRunRow;
}

/**
 * Build a mock deps object. `insertRun` returns the pending row; `updateRun`
 * captures the patch and returns the merged row; the launcher returns a fake
 * session; tmux helpers are no-ops.
 */
function makeDeps(over: Partial<AgentRunDeps> = {}): {
  deps: AgentRunDeps;
  updates: Array<{ id: string; patch: Partial<AgentRunRow> }>;
  launched: number;
  sent: string[];
} {
  const updates: Array<{ id: string; patch: Partial<AgentRunRow> }> = [];
  let current = pendingRow();
  let launched = 0;
  const sent: string[] = [];

  const deps: AgentRunDeps = {
    insertRun: vi.fn(async (values) => {
      current = pendingRow(values as Partial<AgentRunRow>);
      return current;
    }),
    updateRun: vi.fn(async (id, patch) => {
      updates.push({ id, patch });
      current = { ...current, ...patch } as AgentRunRow;
      return current;
    }),
    supersede: vi.fn(async () => 0),
    launchSession: vi.fn(async () => {
      launched += 1;
      return { id: "sess-1", tmuxSessionName: "rdv-sess-1" };
    }),
    waitForAgentReady: vi.fn(async () => {}),
    sendPrompt: vi.fn(async (_tmux, prompt) => {
      sent.push(prompt);
    }),
    now: () => new Date("2026-06-03T00:00:00Z"),
    ...over,
  };

  return {
    deps,
    updates,
    get launched() {
      return launched;
    },
    sent,
  };
}

describe("AgentRunService.launchAgentRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts pending, launches a real session, sends the prompt, marks running", async () => {
    const h = makeDeps();
    const run = await launchAgentRun(
      {
        userId: "user-1",
        projectId: "proj-1",
        source: "manual",
        agentProvider: "claude",
        agentFlags: ["--foo"],
        prompt: "do the thing",
      },
      h.deps,
    );

    // Inserted as pending first.
    expect(h.deps.insertRun).toHaveBeenCalledOnce();
    // Real session launch happened.
    expect(h.launched).toBe(1);
    // Prompt delivered after readiness.
    expect(h.deps.waitForAgentReady).toHaveBeenCalledOnce();
    expect(h.sent).toEqual(["do the thing"]);
    // Final state: running, with sessionId + startedAt.
    expect(run.status).toBe("running");
    expect(run.sessionId).toBe("sess-1");
    const runningPatch = h.updates.find((u) => u.patch.status === "running");
    expect(runningPatch?.patch.sessionId).toBe("sess-1");
    expect(runningPatch?.patch.startedAt).toBeInstanceOf(Date);
  });

  it("passes worktree params to the session launcher when worktreeType is set", async () => {
    const h = makeDeps();
    await launchAgentRun(
      {
        userId: "user-1",
        projectId: "proj-1",
        source: "crown",
        agentProvider: "claude",
        agentFlags: [],
        prompt: "p",
        worktreeType: "feature",
        baseBranch: "main",
      },
      h.deps,
    );
    expect(h.deps.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        createWorktree: true,
        worktreeType: "feature",
        baseBranch: "main",
        terminalType: "agent",
        autoLaunchAgent: true,
      }),
    );
  });

  it("marks the run failed with errorMessage when the launch throws", async () => {
    const h = makeDeps({
      launchSession: vi.fn(async () => {
        throw new Error("tmux exploded");
      }),
    });

    await expect(
      launchAgentRun(
        {
          userId: "user-1",
          projectId: "proj-1",
          source: "manual",
          agentProvider: "claude",
          agentFlags: [],
          prompt: "p",
        },
        h.deps,
      ),
    ).rejects.toThrow("tmux exploded");

    const failedPatch = h.updates.find((u) => u.patch.status === "failed");
    expect(failedPatch).toBeDefined();
    expect(String(failedPatch?.patch.errorMessage)).toContain("tmux exploded");
    expect(failedPatch?.patch.completedAt).toBeInstanceOf(Date);
    // The prompt was never sent.
    expect(h.sent).toEqual([]);
  });

  it("serializes agentFlags to JSON on insert", async () => {
    const h = makeDeps();
    await launchAgentRun(
      {
        userId: "user-1",
        projectId: "proj-1",
        source: "manual",
        agentProvider: "codex",
        agentFlags: ["--a", "--b"],
        prompt: "p",
      },
      h.deps,
    );
    expect(h.deps.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentFlags: JSON.stringify(["--a", "--b"]) }),
    );
  });
});

describe("AgentRunService.supersedePriorRuns", () => {
  it("delegates to deps.supersede with the dedupe key and keep id", async () => {
    const supersede = vi.fn(async () => 3);
    const h = makeDeps({ supersede });
    const n = await supersedePriorRuns("cfg-1", "deadbeef", "keep-run", h.deps);
    expect(n).toBe(3);
    expect(supersede).toHaveBeenCalledWith("cfg-1", "deadbeef", "keep-run");
  });
});
