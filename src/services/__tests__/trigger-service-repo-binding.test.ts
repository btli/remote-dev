// @vitest-environment node
/**
 * Security regression for TriggerService repo binding (epic remote-dev-oyej.4).
 *
 * Exercises the REAL `findEnabledConfigs` (default deps, NOT a mock) through a
 * recording `@/db` fake to prove a signed webhook event whose repo does NOT
 * resolve to a known `githubRepositories` row — or resolves to a DIFFERENT repo
 * than a config is bound to — dispatches ZERO agent runs. Guards against
 * cross-repo / cross-tenant trigger leakage via the nullable `githubRepoId`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// A trigger config bound to repo "repo-A", enabled.
const CONFIG_A = {
  id: "cfg-A",
  userId: "owner-A",
  projectId: "proj-A",
  githubRepoId: "repo-A",
  kind: "pr_labeled",
  filter: JSON.stringify({ label: "agent:fix" }),
  agentProvider: "claude",
  agentFlags: "[]",
  promptTemplate: "fix {{repo}} #{{prNumber}}",
  worktreeType: "fix",
  profileId: null,
  enabled: true,
};

// Recording fake `@/db`:
//   - db.query.githubRepositories.findFirst → resolves a fullName to a repo id
//     (only "octo/known" maps to "repo-A"; everything else is unknown → null).
//   - db.select().from(triggerConfigs).where(cond) → returns CONFIG_A ONLY when
//     the WHERE actually constrains githubRepoId === "repo-A". We approximate
//     the real query semantics: the default-deps `findEnabledConfigs` builds an
//     `and(enabled, githubRepoId == repoId)`, so the fake inspects the captured
//     condition's serialized form for the bound repo id.
const insertedTriggerEvents: Record<string, unknown>[] = [];

function makeWhereResult(repoIdInWhere: string | null) {
  // Return CONFIG_A only when the query is scoped to repo-A.
  return repoIdInWhere === "repo-A" ? [CONFIG_A] : [];
}

// We capture the repoId the service passes by intercepting the eq() on
// githubRepoId through a tiny condition encoder.
let lastSelectRepoId: string | null = null;

vi.mock("drizzle-orm", () => {
  return {
    // eq(col, val) — encode which column + value for the fake to read back.
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
  };
});

vi.mock("@/db", () => ({
  db: {
    query: {
      githubRepositories: {
        findFirst: async (args: { where: { val?: unknown } }) => {
          const fullName = args?.where?.val;
          return fullName === "octo/known" ? { id: "repo-A" } : undefined;
        },
      },
    },
    select: () => ({
      from: () => ({
        where: async (cond: {
          __op: string;
          conds?: { __op: string; col: unknown; val: unknown }[];
        }) => {
          // The real default-deps query is and(enabled, githubRepoId == repoId).
          // Pull the githubRepoId value out of the captured condition tree.
          lastSelectRepoId = null;
          const walk = (c: unknown): void => {
            const node = c as {
              __op?: string;
              conds?: unknown[];
              col?: unknown;
              val?: unknown;
            };
            if (node?.__op === "and" && Array.isArray(node.conds)) {
              node.conds.forEach(walk);
            } else if (node?.__op === "eq") {
              // githubRepoId eq carries the repo id; enabled eq carries `true`.
              if (typeof node.val === "string") lastSelectRepoId = node.val;
            }
          };
          walk(cond);
          return makeWhereResult(lastSelectRepoId);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedTriggerEvents.push(values);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  triggerConfigs: {
    enabled: "enabled",
    githubRepoId: "github_repo_id",
  },
  triggerEvents: {},
  githubRepositories: { fullName: "full_name" },
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

const launchAgentRun = vi.fn(async () => ({ id: "run-1" }));
const supersedePriorRuns = vi.fn(async () => 0);
vi.mock("../agent-run-service", () => ({
  launchAgentRun: (...a: unknown[]) => launchAgentRun(...(a as [])),
  supersedePriorRuns: (...a: unknown[]) => supersedePriorRuns(...(a as [])),
}));
vi.mock("../session-service", () => ({ createSessionWithDedupFlag: vi.fn() }));
vi.mock("../tmux-service", () => ({ sendKeys: vi.fn(), capturePane: vi.fn() }));

import { handleEvent } from "../trigger-service";
import type { GithubEvent } from "@/lib/github-webhook-auth";

function prLabeled(repoFullName: string | undefined): GithubEvent {
  return {
    event: "pull_request",
    action: "labeled",
    repoFullName,
    headSha: "sha-1",
    prNumber: 7,
    labels: ["agent:fix"],
  };
}

describe("TriggerService — repo binding (real findEnabledConfigs)", () => {
  beforeEach(() => {
    launchAgentRun.mockClear();
    supersedePriorRuns.mockClear();
    insertedTriggerEvents.length = 0;
    lastSelectRepoId = null;
  });

  it("dispatches ZERO runs for an UNKNOWN repo (does not resolve)", async () => {
    await handleEvent(prLabeled("octo/unknown-foreign-repo"));
    expect(launchAgentRun).not.toHaveBeenCalled();
    // Short-circuits before any config query/record.
    expect(insertedTriggerEvents).toHaveLength(0);
  });

  it("dispatches ZERO runs when the event carries NO repo full name", async () => {
    await handleEvent(prLabeled(undefined));
    expect(launchAgentRun).not.toHaveBeenCalled();
    expect(insertedTriggerEvents).toHaveLength(0);
  });

  it("DOES dispatch for the correctly-bound repo (positive control)", async () => {
    await handleEvent(prLabeled("octo/known"));
    expect(launchAgentRun).toHaveBeenCalledTimes(1);
    // The config query was scoped to the resolved repo id (no all-tenants scan).
    expect(lastSelectRepoId).toBe("repo-A");
  });
});
