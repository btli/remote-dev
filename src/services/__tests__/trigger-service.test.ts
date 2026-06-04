// @vitest-environment node
/**
 * Unit tests for TriggerService (epic remote-dev-oyej.4) — event matching,
 * filters, per-head-SHA dedupe, and dispatch. The DB lookups + AgentRunService
 * are injected via TriggerDeps so we test matching/dispatch without a DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({
  triggerConfigs: {},
  triggerEvents: {},
  githubRepositories: {},
  agentRuns: {},
  webhookDeliveries: {},
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
// trigger-service → agent-run-service → session-service pulls in the heavy
// (native-module) chain. These tests inject deps, so stub the leaf services.
vi.mock("../agent-run-service", () => ({
  launchAgentRun: vi.fn(),
  supersedePriorRuns: vi.fn(),
}));
vi.mock("../session-service", () => ({ createSessionWithDedupFlag: vi.fn() }));
vi.mock("../tmux-service", () => ({ sendKeys: vi.fn(), capturePane: vi.fn() }));

import {
  handleEvent,
  claimDelivery,
  renderTemplate,
  type TriggerDeps,
  type TriggerConfigLike,
} from "../trigger-service";
import type { GithubEvent } from "@/lib/github-webhook-auth";

function cfg(over: Partial<TriggerConfigLike> = {}): TriggerConfigLike {
  return {
    id: "cfg-1",
    userId: "u1",
    projectId: "p1",
    githubRepoId: "repo-1",
    kind: "pr_labeled",
    filter: JSON.stringify({ label: "agent:fix" }),
    agentProvider: "claude",
    agentFlags: "[]",
    promptTemplate: "Fix PR {{prNumber}} in {{repo}}",
    worktreeType: "fix",
    enabled: true,
    ...over,
  };
}

function makeDeps(over: Partial<TriggerDeps> = {}): {
  deps: TriggerDeps;
  records: Array<{ configId: string; matched: boolean; runId: string | null }>;
  launches: number;
} {
  const records: Array<{
    configId: string;
    matched: boolean;
    runId: string | null;
  }> = [];
  let launches = 0;
  const deps: TriggerDeps = {
    resolveRepoId: vi.fn(async (full) => (full === "octo/repo" ? "repo-1" : null)),
    findEnabledConfigs: vi.fn(async () => [cfg()]),
    launchAgentRun: vi.fn(async () => {
      launches += 1;
      return { id: `run-${launches}` };
    }),
    supersedePriorRuns: vi.fn(async () => 0),
    record: vi.fn(async (configId, _e, matched, runId) => {
      records.push({ configId, matched, runId });
    }),
    recordDelivery: vi.fn(async () => true),
    ...over,
  };
  return {
    deps,
    records,
    get launches() {
      return launches;
    },
  };
}

const prLabeled: GithubEvent = {
  event: "pull_request",
  action: "labeled",
  repoFullName: "octo/repo",
  headSha: "sha-1",
  prNumber: 7,
  labels: ["agent:fix"],
};

describe("renderTemplate", () => {
  it("substitutes repo/prNumber/issueNumber placeholders", () => {
    expect(
      renderTemplate("PR {{prNumber}} ({{repo}}) issue {{issueNumber}}", {
        ...prLabeled,
        issueNumber: 9,
      }),
    ).toBe("PR 7 (octo/repo) issue 9");
  });

  it("renders missing placeholders as empty", () => {
    expect(renderTemplate("x {{issueNumber}} y", prLabeled)).toBe("x  y");
  });
});

describe("TriggerService.handleEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches one run + supersedes + records matched on a matching label", async () => {
    const h = makeDeps();
    await handleEvent(prLabeled, h.deps);
    expect(h.launches).toBe(1);
    expect(h.deps.launchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        projectId: "p1",
        source: "trigger",
        triggerConfigId: "cfg-1",
        headSha: "sha-1",
        prompt: "Fix PR 7 in octo/repo",
        worktreeType: "fix",
      }),
    );
    expect(h.deps.supersedePriorRuns).toHaveBeenCalledWith(
      "cfg-1",
      "sha-1",
      "run-1",
    );
    expect(h.records).toEqual([
      { configId: "cfg-1", matched: true, runId: "run-1" },
    ]);
  });

  it("does NOT dispatch when the label filter does not match", async () => {
    const h = makeDeps();
    await handleEvent({ ...prLabeled, labels: ["other"] }, h.deps);
    expect(h.launches).toBe(0);
    expect(h.records).toEqual([
      { configId: "cfg-1", matched: false, runId: null },
    ]);
  });

  it("treats a duplicate (unique-index) delivery as a no-op second run", async () => {
    const h = makeDeps({
      launchAgentRun: vi.fn(async () => {
        const err = new Error("UNIQUE constraint failed: agent_run...");
        throw err;
      }),
    });
    await handleEvent(prLabeled, h.deps);
    // No throw escaped; recorded as matched with a null runId.
    expect(h.records).toEqual([
      { configId: "cfg-1", matched: true, runId: null },
    ]);
  });

  it("rethrows non-unique launch errors", async () => {
    const h = makeDeps({
      launchAgentRun: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(handleEvent(prLabeled, h.deps)).rejects.toThrow("boom");
  });

  it("ci_failed only fires on conclusion=failure", async () => {
    const ciCfg = cfg({
      id: "cfg-ci",
      kind: "ci_failed",
      filter: "{}",
      promptTemplate: "CI failed on {{repo}}",
    });
    const base: GithubEvent = {
      event: "check_suite",
      action: "completed",
      repoFullName: "octo/repo",
      headSha: "sha-ci",
      labels: [],
    };

    // conclusion=success → no dispatch
    const ok = makeDeps({ findEnabledConfigs: vi.fn(async () => [ciCfg]) });
    await handleEvent({ ...base, conclusion: "success" }, ok.deps);
    expect(ok.launches).toBe(0);

    // conclusion=failure → dispatch
    const fail = makeDeps({ findEnabledConfigs: vi.fn(async () => [ciCfg]) });
    await handleEvent({ ...base, conclusion: "failure" }, fail.deps);
    expect(fail.launches).toBe(1);
  });

  it("issue_opened dispatches with the issue number rendered", async () => {
    const issueCfg = cfg({
      id: "cfg-i",
      kind: "issue_opened",
      filter: "{}",
      promptTemplate: "Triage issue {{issueNumber}}",
    });
    const h = makeDeps({ findEnabledConfigs: vi.fn(async () => [issueCfg]) });
    await handleEvent(
      {
        event: "issues",
        action: "opened",
        repoFullName: "octo/repo",
        issueNumber: 42,
        labels: [],
      },
      h.deps,
    );
    expect(h.deps.launchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Triage issue 42" }),
    );
  });
});

describe("claimDelivery (delivery-id replay dedupe)", () => {
  it("returns true the first time a delivery id is seen, false on redelivery", async () => {
    const seen = new Set<string>();
    // Simulate the atomic ON CONFLICT DO NOTHING + RETURNING store.
    const recordDelivery = vi.fn(async (id: string) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    expect(await claimDelivery("uuid-1", "issues", recordDelivery)).toBe(true);
    expect(await claimDelivery("uuid-1", "issues", recordDelivery)).toBe(false);
    expect(recordDelivery).toHaveBeenCalledTimes(2);
  });

  it("treats a blank delivery id as a first delivery without touching the store", async () => {
    const recordDelivery = vi.fn(async () => true);
    expect(await claimDelivery("", "issues", recordDelivery)).toBe(true);
    expect(recordDelivery).not.toHaveBeenCalled();
  });
});
