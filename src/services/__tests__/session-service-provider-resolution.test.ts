// @vitest-environment node
/**
 * [remote-dev-u02r] Provider-resolution contract for createSession.
 *
 * Bug: when a client OMITS `agentProvider` for an agent/loop session and the
 * resolved folder/user default is non-claude (e.g. "codex"), the session
 * actually launches codex (the plugin command is built from the *merged*
 * provider) and the DB row records codex — but everything keyed off the old
 * `effectiveAgentProvider` (which read the RAW `input.agentProvider`) recorded
 * "claude": the durable resume binding `provider`, the model-proxy
 * `providerScope`, and the claude-defaults env gate. A terminal-server restart
 * would then try to resume a codex conversation with the claude CLI.
 *
 * These tests drive `createSessionWithDedupFlag` end-to-end with the real
 * terminal-type plugins + real resume-binding builder, mocking only the I/O
 * boundaries (db / tmux / worktree / github / preferences / profile / api-key
 * / container / proxy-token). We then assert the *recorded* provider — the DB
 * `agentProvider` column, the persisted `resumeBinding.provider`, and the
 * proxy-token `providerScope` — all follow the MERGED resolution, not the raw
 * (absent) input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Captured payload from the single `db.insert(...).values(...)` write. */
let insertedValues: Record<string, unknown> | null = null;
/** Captured options passed to the mocked `issueProxyToken`. */
let proxyTokenOpts: { providerScope?: string[] } | null = null;
let installedHooks: Array<{
  configDir: string;
  provider: string;
  env?: Record<string, string>;
}> = [];
let installedTmuxLifecycles: Array<{
  sessionName: string;
  command: string;
}> = [];
let launchedTmuxCommands: Array<{
  sessionName: string;
  command: string;
  options?: { replaceShell?: boolean };
}> = [];
let createdTmuxSessions: Array<{
  startupCommand: string | undefined;
  env: Record<string, string> | undefined;
}> = [];

/**
 * Profile-resolution doubles (mutated per-test before importing the service):
 *  - `ownedProfiles`: ids the mocked `getProfile(id, userId)` will resolve (an
 *    unowned/garbage id resolves to null, mirroring a foreign/stale pin).
 *  - `autoSelectResult`: what the mocked `selectProfileUseCase.execute` returns.
 */
let ownedProfiles: Record<string, { id: string; provider: string }> = {};
let autoSelectResult: { profileId: string | null; wasAutoSelected: boolean } = {
  profileId: null,
  wasAutoSelected: false,
};

/**
 * Resolved preferences returned by the mocked preferences-service. Tests mutate
 * `defaultAgentProvider` before importing the service to exercise the merge.
 */
const resolvedPreferences: {
  defaultAgentProvider?: string;
  defaultWorkingDirectory?: string;
  agentProviderSettings?: Record<string, unknown>;
} = {};
let resolvedFolderEnvironment: Record<string, string> = {};

/**
 * Install all the I/O-boundary mocks. Called inside each test AFTER
 * `vi.resetModules()` so the dynamically-imported session-service binds to
 * these doubles. Only the external surface is faked — the terminal-type plugin
 * registry and the resume-binding builder run for real.
 */
function installMocks() {
  insertedValues = null;
  proxyTokenOpts = null;
  installedHooks = [];
  installedTmuxLifecycles = [];
  launchedTmuxCommands = [];
  createdTmuxSessions = [];

  // --- Database: dedup SELECTs return empty, INSERT echoes the row back. ---
  const insertChain = {
    values: (vals: Record<string, unknown>) => {
      insertedValues = vals;
      return {
        // `.returning()` resolves to the inserted row (id + values) so
        // mapDbSessionToSession has a complete record to map.
        returning: () =>
          Promise.resolve([
            {
              ...fullRow(vals),
            },
          ]),
      };
    },
  };
  vi.doMock("@/db", () => ({
    db: {
      query: {
        terminalSessions: {
          // No existing scope-keyed row, and tabOrder lookup → empty.
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    },
  }));
  // drizzle-orm helpers are only used to build where-clauses we never inspect.
  vi.doMock("drizzle-orm", () => ({
    eq: vi.fn(),
    and: vi.fn(),
    asc: vi.fn(),
    desc: vi.fn(),
    inArray: vi.fn(),
  }));
  vi.doMock("@/db/schema", () => ({
    terminalSessions: {
      userId: "userId",
      terminalType: "terminalType",
      scopeKey: "scopeKey",
      status: "status",
      tabOrder: "tabOrder",
      lastActivityAt: "lastActivityAt",
    },
    githubRepositories: {},
    apiKeys: { userId: "userId", name: "name" },
  }));

  // --- tmux: record nothing, just succeed. ---
  vi.doMock("@/services/tmux-service", () => ({
    generateSessionName: (id: string) => `rdv-${id}`,
    createSession: vi.fn(async (
      _name: string,
      _cwd: string,
      startupCommand?: string,
      env?: Record<string, string>,
    ) => {
      createdTmuxSessions.push({ startupCommand, env });
    }),
    setSessionEnvironment: vi.fn().mockResolvedValue(undefined),
    getSessionEnvironment: vi.fn().mockResolvedValue({ RDV_API_KEY: "rdv_test_key" }),
    configureAgentPaneLifecycle: vi.fn(async (sessionName: string, command: string) => {
      installedTmuxLifecycles.push({ sessionName, command });
    }),
    launchCommand: vi.fn(async (
      sessionName: string,
      command: string,
      options?: { replaceShell?: boolean },
    ) => {
      launchedTmuxCommands.push({ sessionName, command, options });
    }),
    killSession: vi.fn().mockResolvedValue(undefined),
    TmuxServiceError: class TmuxServiceError extends Error {},
  }));

  // --- worktree / github: not exercised by these (no createWorktree) inputs. ---
  vi.doMock("@/services/worktree-service", () => ({
    isGitRepo: vi.fn().mockResolvedValue(false),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("@/services/github-service", () => ({}));

  // --- preferences: agent default provider comes from here. ---
  vi.doMock("@/services/preferences-service", () => ({
    getResolvedPreferences: vi.fn().mockResolvedValue(resolvedPreferences),
    getFolderPreferences: vi.fn().mockResolvedValue(null),
    getEnvironmentForSession: vi.fn(async () => resolvedFolderEnvironment),
    getFolderGitIdentity: vi.fn().mockResolvedValue({ env: {} }),
  }));

  // --- profile: getProfile resolves ONLY ids in `ownedProfiles` (an unowned /
  // stale pin → null). Capture hook installation so provider dispatch remains
  // aligned with the CLI that is actually launched. ---
  vi.doMock("@/services/agent-profile-service", () => ({
    getProfile: vi.fn(async (profileId: string) => {
      const p = ownedProfiles[profileId];
      return p
        ? {
            id: p.id,
            userId: "u1",
            name: p.id,
            provider: p.provider,
            configDir: `/cfg/${p.id}`,
            isDefault: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null;
    }),
    getProfileEnvironment: vi.fn().mockResolvedValue(undefined),
    installAgentHooks: vi.fn(
      async (configDir: string, provider: string, env?: Record<string, string>) => {
        installedHooks.push({ configDir, provider, env });
      },
    ),
    validateAgentHooks: vi.fn().mockResolvedValue({ valid: true }),
  }));

  // --- api keys: agent runtime mints one; return a stub. ---
  vi.doMock("@/services/api-key-service", () => ({
    createApiKey: vi.fn().mockResolvedValue({ key: "rdv_test_key" }),
  }));
  vi.doMock("@/services/clipboard-shims", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/services/clipboard-shims")>();
    return {
      ...actual,
      ensureClipboardShims: vi.fn(() => "/test/rdv/clipboard-bin"),
    };
  });

  // --- DI container: git-credential + github-account env. No bound account →
  // the GitHubAccountEnvironment.create branch is never reached. ---
  vi.doMock("@/infrastructure/container", () => ({
    githubAccountRepository: {
      findByProject: vi.fn().mockResolvedValue(null),
      findDefault: vi.fn().mockResolvedValue(null),
      getAccessToken: vi.fn().mockResolvedValue(null),
    },
    gitCredentialManager: {
      buildSessionEnv: vi
        .fn()
        .mockResolvedValue({ toRecord: () => ({ GIT_TERMINAL_PROMPT: "0" }) }),
    },
    // Claude auto-select: returns whatever `autoSelectResult` is set to.
    selectProfileUseCase: {
      execute: vi.fn(async () => autoSelectResult),
    },
  }));

  // --- model-proxy token: capture the providerScope it's minted with. ---
  vi.doMock("@/services/model-proxy-token-service", () => ({
    issueProxyToken: vi.fn(async (opts: { providerScope?: string[] }) => {
      proxyTokenOpts = opts;
      return { token: "mp_test_token" };
    }),
  }));
}

/** Build a complete terminalSessions row by layering insert values over defaults. */
function fullRow(over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    userId: "u1",
    name: "Agent",
    tmuxSessionName: "rdv-123e4567-e89b-12d3-a456-426614174000",
    status: "active",
    projectPath: "/p",
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "folder-1",
    profileId: null,
    terminalType: "agent",
    agentProvider: "claude",
    agentExitState: "running",
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata: null,
    scopeKey: null,
    parentSessionId: null,
    pinned: false,
    tabOrder: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  // Default: folder/user preference default provider is codex (non-claude).
  resolvedPreferences.defaultAgentProvider = "codex";
  resolvedPreferences.defaultWorkingDirectory = "/p";
  resolvedPreferences.agentProviderSettings = {};
  // Default profile-resolution doubles: nothing owned, no auto-select result.
  ownedProfiles = {};
  autoSelectResult = { profileId: null, wasAutoSelected: false };
  resolvedFolderEnvironment = {};
  installMocks();
  // Enable the model-proxy so providerScopeFor(effectiveAgentProvider) runs.
  process.env.RDV_MODEL_PROXY_ENABLED = "1";
  vi.stubEnv("HOME", "/home/rdv-test");
});

afterEach(() => {
  delete process.env.RDV_MODEL_PROXY_ENABLED;
  vi.unstubAllEnvs();
});

describe("createSession provider resolution (remote-dev-u02r)", () => {
  it("records the MERGED provider (codex) when input omits agentProvider for an agent session", async () => {
    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    const { session } = await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      // agentProvider intentionally OMITTED — folder default ("codex") applies.
      autoLaunchAgent: true,
    });

    // DB row: agentProvider column follows the merged resolution.
    expect(insertedValues).not.toBeNull();
    expect(insertedValues!.agentProvider).toBe("codex");

    // Durable resume binding: provider must be codex, NOT the old "claude".
    // (Bug 1: a claude binding here would resume a codex chat with claude.)
    const meta = JSON.parse(insertedValues!.typeMetadata as string) as {
      resumeBinding?: { provider?: string };
    };
    expect(meta.resumeBinding?.provider).toBe("codex");

    // Model-proxy scope: minted for openai (codex), not anthropic (claude).
    expect(proxyTokenOpts).not.toBeNull();
    expect(proxyTokenOpts!.providerScope).toEqual(["openai"]);

    // Sanity: the mapped session surfaces the merged provider too.
    expect(session.agentProvider).toBe("codex");

    // Codex must receive hooks in the same HOME-derived config root it launches
    // with; the old provider guard skipped this call entirely.
    expect(installedHooks).toContainEqual({
      configDir: "/home/rdv-test",
      provider: "codex",
      env: expect.objectContaining({ RDV_SESSION_ID: session.id }),
    });

    // The process-exit fallback must keep the dead pane addressable and include
    // tmux's authoritative status + signal. Authentication and generation are
    // read from the tmux session environment when the hook fires.
    expect(installedTmuxLifecycles).toContainEqual({
      sessionName: session.tmuxSessionName,
      command: expect.stringMatching(
        /Authorization: Bearer.*generation=0.*exitCode=#\{pane_dead_status\}.*signal=#\{pane_dead_signal\}/,
      ),
    });

    // The agent must replace the bootstrap shell so its exit is the pane exit.
    // Launch happens only after the DB row exists (the service defers it until
    // after insert), closing the instant-crash callback race.
    expect(launchedTmuxCommands).toContainEqual({
      sessionName: session.tmuxSessionName,
      command: "codex",
      options: { replaceShell: true },
    });
    expect(createdTmuxSessions).toContainEqual({
      startupCommand: undefined,
      env: expect.objectContaining({
        RDV_AGENT_PROVIDER: "codex",
        DISABLE_AUTO_UPDATE: "true",
        DISABLE_UPDATE_PROMPT: "true",
      }),
    });
  });

  it("still records claude when neither input nor preference default is set", async () => {
    // No preference default → merge falls back to "claude".
    resolvedPreferences.defaultAgentProvider = undefined;
    installMocks();

    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      autoLaunchAgent: true,
    });

    expect(insertedValues!.agentProvider).toBe("claude");
    const meta = JSON.parse(insertedValues!.typeMetadata as string) as {
      resumeBinding?: { provider?: string };
    };
    expect(meta.resumeBinding?.provider).toBe("claude");
    expect(proxyTokenOpts!.providerScope).toEqual(["anthropic"]);
  });

  it("passes the launch-time CODEX_HOME override to hook installation", async () => {
    resolvedFolderEnvironment = { CODEX_HOME: "/custom/codex-home" };
    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      agentProvider: "codex",
      autoLaunchAgent: true,
    });

    expect(installedHooks).toContainEqual({
      configDir: "/home/rdv-test",
      provider: "codex",
      env: expect.objectContaining({ CODEX_HOME: "/custom/codex-home" }),
    });
  });

  it("honors an explicit input provider over the preference default", async () => {
    // Folder default is codex (from beforeEach), but the client explicitly
    // requests gemini — explicit input must win (OVERRIDE semantics).
    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      agentProvider: "gemini",
      autoLaunchAgent: true,
    });

    expect(insertedValues!.agentProvider).toBe("gemini");
    const meta = JSON.parse(insertedValues!.typeMetadata as string) as {
      resumeBinding?: { provider?: string };
    };
    expect(meta.resumeBinding?.provider).toBe("gemini");
    expect(proxyTokenOpts!.providerScope).toEqual(["gemini"]);
  });
});

/**
 * [remote-dev-vk1z / hardening] Explicit `profileId` pin resolution.
 *
 * A pin must resolve to a profile THIS user owns. A foreign / stale / garbage id
 * must NOT be launched-with and must NOT be persisted — it falls through to the
 * Claude auto-select path (or null when nothing is configured), so we never
 * launch with the wrong configDir or write an unowned id to the session row.
 */
describe("createSession explicit profileId resolution (remote-dev-vk1z)", () => {
  it("falls back to the auto-selected profile when the explicit pin is unowned", async () => {
    // The pin "foreign-x" is NOT in ownedProfiles → resolves to null. The
    // project's Claude auto-select resolves "auto-owned" instead.
    ownedProfiles = { "auto-owned": { id: "auto-owned", provider: "claude" } };
    autoSelectResult = { profileId: "auto-owned", wasAutoSelected: true };
    installMocks();

    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    const { session } = await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      agentProvider: "claude",
      autoLaunchAgent: true,
      profileId: "foreign-x", // unowned / stale pin
    });

    // The unowned id is NEVER written; the resolved (auto-selected) one is.
    expect(insertedValues!.profileId).toBe("auto-owned");
    expect(insertedValues!.profileId).not.toBe("foreign-x");
    expect(session.profileId).toBe("auto-owned");
  });

  it("records NO profile (null) when the pin is unowned and nothing is configured", async () => {
    // Pin unowned AND auto-select finds nothing → null. The bad id is dropped.
    ownedProfiles = {};
    autoSelectResult = { profileId: null, wasAutoSelected: false };
    installMocks();

    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    const { session } = await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      agentProvider: "claude",
      autoLaunchAgent: true,
      profileId: "garbage-id",
    });

    expect(insertedValues!.profileId).toBeNull();
    expect(insertedValues!.profileId).not.toBe("garbage-id");
    expect(session.profileId).toBeNull();
  });

  it("honors and records an explicit pin the user owns (no auto-select)", async () => {
    ownedProfiles = { "owned-pin": { id: "owned-pin", provider: "claude" } };
    // If auto-select were (incorrectly) consulted it would return this — assert
    // it is NOT used, proving the owned pin short-circuits selection.
    autoSelectResult = { profileId: "should-not-be-used", wasAutoSelected: true };
    installMocks();

    const { createSessionWithDedupFlag } = await import(
      "@/services/session-service"
    );

    const { session } = await createSessionWithDedupFlag("u1", {
      projectId: "folder-1",
      name: "Agent",
      terminalType: "agent",
      agentProvider: "claude",
      autoLaunchAgent: true,
      profileId: "owned-pin",
    });

    expect(insertedValues!.profileId).toBe("owned-pin");
    expect(session.profileId).toBe("owned-pin");
  });
});
