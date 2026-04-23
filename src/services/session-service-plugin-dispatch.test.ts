// @vitest-environment node
/**
 * Tests for SessionService.createSession — plugin dispatch + scope-key dedup.
 *
 * Covers the new terminal-plugin-driven code paths introduced by the modals
 * epic:
 *   1. Plugin's `createSession()` drives `useTmux`, `shellCommand`, initial
 *      `typeMetadata`.
 *   2. `validateInput` errors short-circuit with a clear SessionServiceError.
 *   3. `scopeKey` dedup returns existing (non-closed) row for same
 *      (userId, terminalType, scopeKey); no dedup when scopeKey is null; a
 *      closed row does NOT dedup.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — all module-level side-effects in session-service.ts are stubbed so
// the focus stays on dedup + plugin dispatch logic.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// vi.hoisted to make mutable state accessible to hoisted vi.mock factories
const hoisted = vi.hoisted(() => {
  const state = {
    inserted: [] as Row[],
    queryFindManyCalls: 0,
  };
  return {
    state,
    tmuxCreate: vi.fn(async () => undefined),
    tmuxKill: vi.fn(async () => undefined),
    insertReturning: vi.fn<(values: Row) => Promise<Row[]>>(),
    findManyDedup: vi.fn<(args: unknown) => Promise<Row[]>>(),
    findManyTabOrder: vi.fn<(args: unknown) => Promise<Row[]>>(),
    getResolvedPreferences: vi.fn(async () => ({
      defaultWorkingDirectory: "/tmp",
      startupCommand: undefined as string | undefined,
    })),
  };
});

const dbState = hoisted.state;
const dbMocks = {
  insertReturning: hoisted.insertReturning,
  findManyDedup: hoisted.findManyDedup,
  findManyTabOrder: hoisted.findManyTabOrder,
  get queryFindManyCalls() {
    return hoisted.state.queryFindManyCalls;
  },
};
const tmuxCreate = hoisted.tmuxCreate;
const tmuxKill = hoisted.tmuxKill;

vi.mock("@/db", () => ({
  db: {
    query: {
      terminalSessions: {
        findMany: vi.fn(async (args: unknown) => {
          hoisted.state.queryFindManyCalls += 1;
          // The dedup query's where-clause includes scopeKey; the tab-order
          // query does not. Route based on that rather than call index so
          // the test stays stable when scopeKey is null (no dedup call).
          const serialized = JSON.stringify(args);
          if (serialized.includes("scopeKey") || serialized.includes("scope_key")) {
            return hoisted.findManyDedup(args);
          }
          return hoisted.findManyTabOrder(args);
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((values: Row) => ({
        returning: vi.fn(async () => {
          hoisted.state.inserted.push(values);
          return hoisted.insertReturning(values);
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      })
    ),
  },
}));

// drizzle-orm helpers: return opaque markers so the db mock doesn't need
// to interpret them — findMany receives `where` args but ignores them.
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _eq: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  asc: (v: unknown) => ({ _asc: v }),
  desc: (v: unknown) => ({ _desc: v }),
  inArray: (...args: unknown[]) => ({ _inArray: args }),
}));

// Schema columns: the service imports them for use with eq(…). Any object will do.
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
  createSession: hoisted.tmuxCreate,
  killSession: hoisted.tmuxKill,
  setSessionEnvironment: vi.fn(async () => undefined),
  setHook: vi.fn(async () => undefined),
  TmuxServiceError: class TmuxServiceError extends Error {},
}));

vi.mock("@/services/worktree-service", () => ({
  isGitRepo: vi.fn(async () => false),
  createBranchWithWorktree: vi.fn(),
  copyEnvFilesToWorktree: vi.fn(),
  removeWorktree: vi.fn(async () => undefined),
  sanitizeBranchName: (s: string) => s,
  WorktreeServiceError: class WorktreeServiceError extends Error {},
}));

vi.mock("@/services/github-service", () => ({
  getRepository: vi.fn(),
}));

vi.mock("@/services/agent-profile-service", () => ({
  getProfile: vi.fn(async () => null),
  getProfileEnvironment: vi.fn(async () => null),
  resolveEffectiveHome: vi.fn(async () => null),
  installAgentHooks: vi.fn(async () => undefined),
  validateAgentHooks: vi.fn(async () => ({ valid: true })),
}));

vi.mock("@/services/preferences-service", () => ({
  getResolvedPreferences: hoisted.getResolvedPreferences,
  getFolderPreferences: vi.fn(async () => null),
  getEnvironmentForSession: vi.fn(async () => ({})),
  getFolderGitIdentity: vi.fn(async () => ({ env: {} })),
}));

vi.mock("@/services/api-key-service", () => ({
  createApiKey: vi.fn(async () => ({ key: "test-api-key" })),
}));

vi.mock("@/services/voice-shim-service", () => ({
  ensureSoxShim: vi.fn(() => "/tmp/sox-shim"),
}));

vi.mock("@/infrastructure/container", () => ({
  githubAccountRepository: {
    findByProject: vi.fn(async () => null),
    findDefault: vi.fn(async () => null),
    getAccessToken: vi.fn(async () => null),
  },
  gitCredentialManager: {
    buildSessionEnv: vi.fn(async () => ({ toRecord: () => ({}) })),
    cleanupSession: vi.fn(async () => undefined),
  },
}));

vi.mock("@/domain/value-objects/GitHubAccountEnvironment", () => ({
  GitHubAccountEnvironment: {
    create: () => ({ toEnvironment: () => ({ toRecord: () => ({}) }) }),
  },
}));

// Plugin init: make it a no-op so we can register our own plugins in each
// test without fighting the built-ins.
vi.mock("@/lib/terminal-plugins/init-server", () => ({
  initializeServerPlugins: () => {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports after all mocks are configured.
// ─────────────────────────────────────────────────────────────────────────────
import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
import type { TerminalTypeServerPlugin } from "@/types/terminal-type-server";
import type { CreateSessionInput } from "@/types/session";
import {
  createSession,
  createSessionWithDedupFlag,
  SessionServiceError,
} from "./session-service";

function makeFakePlugin(
  type: string,
  overrides: Partial<ReturnType<TerminalTypeServerPlugin["createSession"]>> = {}
): TerminalTypeServerPlugin {
  return {
    type,
    priority: 0,
    createSession: () => ({
      shellCommand: null,
      shellArgs: [],
      environment: {},
      useTmux: false,
      metadata: { foo: "bar" },
      ...overrides,
    }),
  };
}

function makeDbRow(overrides: Row = {}): Row {
  const now = new Date();
  return {
    id: "db-row-id",
    userId: "user-1",
    name: "name",
    tmuxSessionName: "rdv-db-row-id",
    projectPath: "/tmp",
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "project-1",
    profileId: null,
    terminalType: "fake",
    agentProvider: "claude",
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

function baseInput(): CreateSessionInput {
  return {
    name: "Test",
    projectId: "project-1",
    terminalType: "fake",
  };
}

describe("SessionService.createSession — plugin dispatch", () => {
  beforeEach(() => {
    TerminalTypeServerRegistry.clear();
    dbState.inserted = [];
    hoisted.state.queryFindManyCalls = 0;
    tmuxCreate.mockClear();
    tmuxKill.mockClear();

    // Default: dedup query finds nothing, tab-order query returns empty
    dbMocks.findManyDedup.mockResolvedValue([]);
    dbMocks.findManyTabOrder.mockResolvedValue([]);
    dbMocks.insertReturning.mockImplementation(async (values) => [
      makeDbRow(values as Row),
    ]);
    hoisted.getResolvedPreferences.mockResolvedValue({
      defaultWorkingDirectory: "/tmp",
      startupCommand: undefined,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the plugin: useTmux=false skips tmux, metadata merges plugin + input", async () => {
    const plugin = makeFakePlugin("fake", {
      useTmux: false,
      shellCommand: null,
      metadata: { pluginKey: "plugin-val", shared: "from-plugin" },
    });
    TerminalTypeServerRegistry.register(plugin);
    TerminalTypeServerRegistry.setDefaultType("fake");

    const result = await createSession("user-1", {
      ...baseInput(),
      typeMetadata: { userKey: "user-val", shared: "from-caller" },
    });

    expect(tmuxCreate).not.toHaveBeenCalled();
    expect(result.terminalType).toBe("fake");

    // Inspect the row that was inserted — that's the only place where the
    // service writes the merged metadata.
    expect(dbState.inserted).toHaveLength(1);
    const inserted = dbState.inserted[0] as { typeMetadata: string | null };
    expect(inserted.typeMetadata).toBeTypeOf("string");
    const parsed = JSON.parse(inserted.typeMetadata!);
    expect(parsed).toEqual({
      pluginKey: "plugin-val",
      // caller wins on key conflicts
      shared: "from-caller",
      userKey: "user-val",
    });
  });

  it("creates a tmux session when the plugin's config useTmux=true", async () => {
    const plugin = makeFakePlugin("fake", {
      useTmux: true,
      shellCommand: "fake-cli",
    });
    TerminalTypeServerRegistry.register(plugin);
    TerminalTypeServerRegistry.setDefaultType("fake");

    await createSession("user-1", baseInput());

    expect(tmuxCreate).toHaveBeenCalledTimes(1);
    const call = tmuxCreate.mock.calls[0] as unknown as [
      string,
      string | undefined,
      string | undefined,
      Record<string, string> | undefined,
    ];
    const [, cwd, shellCmd] = call;
    expect(cwd).toBeDefined();
    // Plugin-provided shell command is passed to tmux
    expect(shellCmd).toBe("fake-cli");
  });

  it("threads folder-resolved startupCommand into plugin.createSession via startupCommandOverride (F1)", async () => {
    // Folder preference supplies a wrapper command like `jclaude`.
    hoisted.getResolvedPreferences.mockResolvedValueOnce({
      defaultWorkingDirectory: "/tmp",
      startupCommand: "jclaude",
    });

    // Record what the plugin sees in its createSession input.
    let seenOverride: string | undefined;
    const plugin: TerminalTypeServerPlugin = {
      type: "fake",
      priority: 0,
      createSession: (pluginInput) => {
        seenOverride = pluginInput.startupCommandOverride;
        return {
          // Emulate an agent-style plugin: use the override as the shell
          // command so SessionService passes it to tmux.
          shellCommand: pluginInput.startupCommandOverride ?? "provider-default",
          shellArgs: [],
          environment: {},
          useTmux: true,
          metadata: {},
        };
      },
    };
    TerminalTypeServerRegistry.register(plugin);
    TerminalTypeServerRegistry.setDefaultType("fake");

    await createSession("user-1", baseInput());

    expect(seenOverride).toBe("jclaude");
    expect(tmuxCreate).toHaveBeenCalledTimes(1);
    const [, , shellCmd] = tmuxCreate.mock.calls[0] as unknown as [
      string,
      string | undefined,
      string | undefined,
      Record<string, string> | undefined,
    ];
    // Wrapper wins over the plugin's provider default.
    expect(shellCmd).toBe("jclaude");
  });

  it("throws SessionServiceError when the plugin's validateInput returns an error", async () => {
    const plugin: TerminalTypeServerPlugin = {
      ...makeFakePlugin("fake"),
      validateInput: () => "bad input",
    };
    TerminalTypeServerRegistry.register(plugin);
    TerminalTypeServerRegistry.setDefaultType("fake");

    await expect(createSession("user-1", baseInput())).rejects.toBeInstanceOf(
      SessionServiceError
    );
    await expect(createSession("user-1", baseInput())).rejects.toHaveProperty(
      "message",
      "bad input"
    );
    // DB insert should NOT have been attempted
    expect(dbState.inserted).toHaveLength(0);
  });
});

describe("SessionService.createSession — scope-key dedup", () => {
  beforeEach(() => {
    TerminalTypeServerRegistry.clear();
    TerminalTypeServerRegistry.register(makeFakePlugin("fake"));
    TerminalTypeServerRegistry.setDefaultType("fake");

    dbState.inserted = [];
    hoisted.state.queryFindManyCalls = 0;
    tmuxCreate.mockClear();
    dbMocks.findManyDedup.mockResolvedValue([]);
    dbMocks.findManyTabOrder.mockResolvedValue([]);
    dbMocks.insertReturning.mockImplementation(async (values) => [
      makeDbRow(values as Row),
    ]);
  });

  it("returns the existing row when (userId, terminalType, scopeKey) matches an open session", async () => {
    const existing = makeDbRow({
      id: "existing-1",
      scopeKey: "repo-123",
      terminalType: "fake",
      status: "active",
    });
    // First findMany call is the dedup query
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([existing]);

    const result = await createSession("user-1", {
      ...baseInput(),
      scopeKey: "repo-123",
    });

    expect(result.id).toBe("existing-1");
    // No new row inserted
    expect(dbState.inserted).toHaveLength(0);
    expect(tmuxCreate).not.toHaveBeenCalled();
  });

  it("creates a new row when scopeKey is null (no dedup)", async () => {
    // Even if there's a row with scopeKey=null and same terminalType, null
    // input means the service skips the dedup query entirely.
    await createSession("user-1", {
      ...baseInput(),
      scopeKey: null,
    });

    expect(dbState.inserted).toHaveLength(1);
    // Dedup query should NOT have been called
    expect(dbMocks.findManyDedup).not.toHaveBeenCalled();
  });

  it("creates a new row when scopeKey differs", async () => {
    // dedup query returns nothing (different key in DB)
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([]);

    await createSession("user-1", {
      ...baseInput(),
      scopeKey: "repo-different",
    });

    expect(dbMocks.findManyDedup).toHaveBeenCalledTimes(1);
    expect(dbState.inserted).toHaveLength(1);
  });

  it("createSessionWithDedupFlag reports reused=true when dedup hits (F2)", async () => {
    const existing = makeDbRow({
      id: "existing-1",
      scopeKey: "settings",
      terminalType: "fake",
      status: "active",
    });
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([existing]);

    const result = await createSessionWithDedupFlag("user-1", {
      ...baseInput(),
      scopeKey: "settings",
    });

    expect(result.reused).toBe(true);
    expect(result.session.id).toBe("existing-1");
    expect(dbState.inserted).toHaveLength(0);
  });

  it("createSessionWithDedupFlag reports reused=false on new insert (F2)", async () => {
    const result = await createSessionWithDedupFlag("user-1", {
      ...baseInput(),
      scopeKey: "settings",
    });

    expect(result.reused).toBe(false);
    expect(dbState.inserted).toHaveLength(1);
  });

  it("does NOT reuse a closed session — the dedup query filters those out", async () => {
    // The service's dedup query uses inArray(status, ["active", "suspended"]).
    // Simulate the DB returning no match (as the real query would filter a closed row).
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([]);

    await createSession("user-1", {
      ...baseInput(),
      scopeKey: "repo-123",
    });

    expect(dbMocks.findManyDedup).toHaveBeenCalledTimes(1);
    expect(dbState.inserted).toHaveLength(1);

    // Assert the dedup query's `where` included the status inArray filter.
    const whereArg = (dbMocks.findManyDedup.mock.calls[0][0] as {
      where: { _and: unknown[] };
    }).where;
    const flat = JSON.stringify(whereArg);
    expect(flat).toContain("active");
    expect(flat).toContain("suspended");
    // Closed should NOT be in the allowed status list
    expect(flat).not.toContain("closed");
  });

  it("reuses a suspended row unchanged — does NOT auto-resume via tmux (F4)", async () => {
    // When two agent tabs share a scope-key and one of them has been
    // suspended, dedup must return that row as-is. The service should not
    // attempt to re-create the tmux session or mutate status on reuse;
    // callers explicitly call resumeSession when they want to wake it up.
    const suspended = makeDbRow({
      id: "existing-suspended",
      scopeKey: "agent-scope",
      terminalType: "fake",
      status: "suspended",
    });
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([suspended]);

    const result = await createSession("user-1", {
      ...baseInput(),
      scopeKey: "agent-scope",
    });

    expect(result.id).toBe("existing-suspended");
    expect(result.status).toBe("suspended");
    expect(dbState.inserted).toHaveLength(0);
    expect(tmuxCreate).not.toHaveBeenCalled();
  });

  it("recovers from a UNIQUE INSERT race — returns the winning row as reused (F7)", async () => {
    // Simulate two concurrent createSession calls with the same scope key:
    //   1. Both pass the initial dedup SELECT (no existing match).
    //   2. Both attempt to INSERT.
    //   3. The UNIQUE partial index on (user_id, terminal_type, scope_key)
    //      causes the loser's INSERT to fail with SQLITE_CONSTRAINT.
    //   4. The losing path re-runs the SELECT and returns the winner.
    //
    // This test drives the loser's code path: initial SELECT empty, INSERT
    // throws SQLITE_CONSTRAINT, follow-up SELECT returns the winning row.
    const winningRow = makeDbRow({
      id: "race-winner",
      scopeKey: "race-key",
      terminalType: "fake",
      status: "active",
    });

    // First findManyDedup call (initial lookup): empty → triggers INSERT.
    // Second findManyDedup call (post-conflict lookup): returns the winner.
    (dbMocks.findManyDedup as Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([winningRow]);

    // Make the INSERT throw a SQLite unique-constraint error on the first call.
    dbMocks.insertReturning.mockImplementationOnce(async () => {
      throw new Error(
        "SQLITE_CONSTRAINT: UNIQUE constraint failed: terminal_session.user_id, terminal_session.terminal_type, terminal_session.scope_key"
      );
    });

    const result = await createSessionWithDedupFlag("user-1", {
      ...baseInput(),
      scopeKey: "race-key",
    });

    // The loser sees the same row as the winner — only ONE row exists in the DB.
    expect(result.reused).toBe(true);
    expect(result.session.id).toBe("race-winner");
    // The INSERT was attempted exactly once (and failed).
    expect(dbMocks.insertReturning).toHaveBeenCalledTimes(1);
    // Two dedup queries total: before INSERT (empty) and after conflict (winner).
    expect(dbMocks.findManyDedup).toHaveBeenCalledTimes(2);
  });

  it("does NOT attempt race-recovery SELECT when error is not a constraint violation", async () => {
    // A non-constraint error (e.g. connection lost) should propagate — we
    // only recover when the error text indicates a unique-index collision.
    (dbMocks.findManyDedup as Mock).mockResolvedValueOnce([]);
    dbMocks.insertReturning.mockImplementationOnce(async () => {
      throw new Error("ECONNRESET: database connection closed");
    });

    await expect(
      createSession("user-1", { ...baseInput(), scopeKey: "race-key" })
    ).rejects.toThrow();

    // Only the initial dedup SELECT — no post-conflict retry.
    expect(dbMocks.findManyDedup).toHaveBeenCalledTimes(1);
  });
});
