// @vitest-environment node
/**
 * Tests for SessionService.updateSession — typeMetadataPatch merge semantics.
 *
 * F3: `patch[key] === null` deletes the key; defined values overwrite. This
 * test locks in the server-side behavior that the client's optimistic
 * merge now mirrors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

const hoisted = vi.hoisted(() => ({
  existingRow: null as Row | null,
  updateSetCapture: vi.fn<(values: Row) => void>(),
  updateReturning: vi.fn<() => Promise<Row[]>>(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      terminalSessions: {
        findFirst: vi.fn(async () => hoisted.existingRow),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Row) => {
        hoisted.updateSetCapture(values);
        return {
          where: vi.fn(() => ({
            returning: hoisted.updateReturning,
          })),
        };
      }),
    })),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _eq: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  asc: (v: unknown) => ({ _asc: v }),
  desc: (v: unknown) => ({ _desc: v }),
  inArray: (...args: unknown[]) => ({ _inArray: args }),
}));

vi.mock("@/db/schema", () => ({
  terminalSessions: new Proxy(
    {},
    { get: (_t, prop) => ({ _col: String(prop) }) }
  ),
  githubRepositories: new Proxy(
    {},
    { get: (_t, prop) => ({ _col: String(prop) }) }
  ),
  apiKeys: new Proxy({}, { get: (_t, prop) => ({ _col: String(prop) }) }),
}));

vi.mock("@/services/tmux-service", () => ({
  generateSessionName: (id: string) => `rdv-${id}`,
  createSession: vi.fn(),
  killSession: vi.fn(async () => undefined),
  setSessionEnvironment: vi.fn(),
  setHook: vi.fn(),
  sessionExists: vi.fn(async () => true),
  TmuxServiceError: class TmuxServiceError extends Error {},
}));

vi.mock("@/services/worktree-service", () => ({
  WorktreeServiceError: class WorktreeServiceError extends Error {},
}));

vi.mock("@/services/github-service", () => ({}));
vi.mock("@/services/agent-profile-service", () => ({
  getProfile: vi.fn(async () => null),
  getProfileEnvironment: vi.fn(async () => null),
  resolveEffectiveHome: vi.fn(async () => null),
  installAgentHooks: vi.fn(async () => undefined),
  validateAgentHooks: vi.fn(async () => ({ valid: true })),
}));
vi.mock("@/services/preferences-service", () => ({
  getResolvedPreferences: vi.fn(async () => ({})),
  getFolderPreferences: vi.fn(async () => null),
  getEnvironmentForSession: vi.fn(async () => ({})),
  getFolderGitIdentity: vi.fn(async () => ({ env: {} })),
}));
vi.mock("@/services/api-key-service", () => ({ createApiKey: vi.fn() }));
vi.mock("@/services/voice-shim-service", () => ({ ensureSoxShim: vi.fn() }));
vi.mock("@/infrastructure/container", () => ({
  githubAccountRepository: {
    findByProject: vi.fn(),
    findDefault: vi.fn(),
    getAccessToken: vi.fn(),
  },
  gitCredentialManager: {
    buildSessionEnv: vi.fn(async () => ({ toRecord: () => ({}) })),
    cleanupSession: vi.fn(),
  },
}));
vi.mock("@/domain/value-objects/GitHubAccountEnvironment", () => ({
  GitHubAccountEnvironment: {
    create: () => ({ toEnvironment: () => ({ toRecord: () => ({}) }) }),
  },
}));
vi.mock("@/lib/terminal-plugins/init-server", () => ({
  initializeServerPlugins: () => {},
}));

import { updateSession } from "./session-service";

function makeRow(overrides: Row = {}): Row {
  const now = new Date();
  return {
    id: "s1",
    userId: "user-1",
    name: "name",
    tmuxSessionName: "rdv-s1",
    projectPath: "/tmp",
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "project-1",
    profileId: null,
    terminalType: "settings",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    scopeKey: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("SessionService.updateSession — typeMetadataPatch semantics (F3)", () => {
  beforeEach(() => {
    hoisted.updateSetCapture.mockClear();
  });

  it("deletes keys when patch value is null; preserves existing keys when absent", async () => {
    hoisted.existingRow = makeRow({
      typeMetadata: JSON.stringify({ keep: "a", drop: "b", overwrite: "old" }),
    });
    const resultRow = makeRow({
      typeMetadata: JSON.stringify({ keep: "a", overwrite: "new" }),
    });
    hoisted.updateReturning.mockResolvedValueOnce([resultRow]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { drop: null, overwrite: "new" },
    });

    expect(hoisted.updateSetCapture).toHaveBeenCalledTimes(1);
    const updateValues = hoisted.updateSetCapture.mock.calls[0][0] as {
      typeMetadata?: string;
    };
    expect(updateValues.typeMetadata).toBeTypeOf("string");
    const stored = JSON.parse(updateValues.typeMetadata!);
    expect(stored).toEqual({ keep: "a", overwrite: "new" });
    // drop is gone, null is NOT stored
    expect("drop" in stored).toBe(false);
  });

  it("round-trips a null patch when no existing metadata", async () => {
    hoisted.existingRow = makeRow({ typeMetadata: null });
    hoisted.updateReturning.mockResolvedValueOnce([makeRow()]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { ghost: null, keeper: "x" },
    });

    const updateValues = hoisted.updateSetCapture.mock.calls[0][0] as {
      typeMetadata?: string;
    };
    const stored = JSON.parse(updateValues.typeMetadata!);
    expect(stored).toEqual({ keeper: "x" });
    expect("ghost" in stored).toBe(false);
  });

  it("drops a single key from existing metadata: {a:1,b:2} + {b:null} → {a:1}", async () => {
    hoisted.existingRow = makeRow({
      typeMetadata: JSON.stringify({ a: 1, b: 2 }),
    });
    hoisted.updateReturning.mockResolvedValueOnce([makeRow()]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { b: null },
    });

    const updateValues = hoisted.updateSetCapture.mock.calls[0][0] as {
      typeMetadata?: string;
    };
    const stored = JSON.parse(updateValues.typeMetadata!);
    expect(stored).toEqual({ a: 1 });
    expect("b" in stored).toBe(false);
  });

  it("mixed values+nulls: {a:1,b:2} + {a:3,b:null,c:4} → {a:3,c:4}", async () => {
    hoisted.existingRow = makeRow({
      typeMetadata: JSON.stringify({ a: 1, b: 2 }),
    });
    hoisted.updateReturning.mockResolvedValueOnce([makeRow()]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { a: 3, b: null, c: 4 },
    });

    const updateValues = hoisted.updateSetCapture.mock.calls[0][0] as {
      typeMetadata?: string;
    };
    const stored = JSON.parse(updateValues.typeMetadata!);
    expect(stored).toEqual({ a: 3, c: 4 });
    expect("b" in stored).toBe(false);
  });

  it("two consecutive patches merge correctly (stateful round-trip)", async () => {
    // Start: {a:1,b:2}
    // After patch 1 ({b:null, c:3}): {a:1, c:3}
    // After patch 2 ({a:null, d:4}): {c:3, d:4}
    hoisted.existingRow = makeRow({
      typeMetadata: JSON.stringify({ a: 1, b: 2 }),
    });
    hoisted.updateReturning.mockResolvedValueOnce([
      makeRow({ typeMetadata: JSON.stringify({ a: 1, c: 3 }) }),
    ]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { b: null, c: 3 },
    });

    const firstStored = JSON.parse(
      (hoisted.updateSetCapture.mock.calls[0][0] as { typeMetadata?: string })
        .typeMetadata!
    );
    expect(firstStored).toEqual({ a: 1, c: 3 });

    // Simulate the DB now reflecting the first patch; apply the second.
    hoisted.existingRow = makeRow({
      typeMetadata: JSON.stringify({ a: 1, c: 3 }),
    });
    hoisted.updateReturning.mockResolvedValueOnce([makeRow()]);

    await updateSession("s1", "user-1", {
      typeMetadataPatch: { a: null, d: 4 },
    });

    const secondStored = JSON.parse(
      (hoisted.updateSetCapture.mock.calls[1][0] as { typeMetadata?: string })
        .typeMetadata!
    );
    expect(secondStored).toEqual({ c: 3, d: 4 });
    expect("a" in secondStored).toBe(false);
    expect("b" in secondStored).toBe(false);
  });
});
