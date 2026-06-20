// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks (declared before importing the module under test) --------------

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Shared mock state via vi.hoisted (safe to reference in hoisted vi.mock
// factories; plain top-level consts are not — they aren't initialized yet).
const h = vi.hoisted(() => {
  // The session row returned by getSession() → mapDbSessionToSession().
  const sessionRow = {
    id: "sess-1",
    userId: "user-1",
    name: "brilliant-mqtt 3",
    tmuxSessionName: "rdv-sess-1",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "proj-1",
    profileId: null,
    terminalType: "shell",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    agentActivityStatusAt: null,
    typeMetadata: null,
    scopeKey: "scope-1",
    parentSessionId: null,
    status: "suspended",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Capture the values passed to the status-write so we can assert on them.
  const updateSet = vi.fn();
  const killSession = vi.fn();
  const db = {
    query: {
      terminalSessions: {
        findFirst: vi.fn().mockResolvedValue(sessionRow),
      },
    },
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };
  return { sessionRow, updateSet, killSession, db };
});

const { sessionRow, updateSet, killSession, db } = h;

vi.mock("@/db", () => ({ db: h.db }));

// TmuxService.killSession throws — the WHOLE point of the test.
vi.mock("./tmux-service", () => ({
  killSession: (name: string) => h.killSession(name),
  generateSessionName: (id: string) => `rdv-${id}`,
}));

// Plugin registry: shell uses tmux (so killSession is attempted). `register`
// is a no-op stub because session-service calls initializeServerPlugins() at
// module load (also stubbed below).
vi.mock("@/lib/terminal-plugins/server", () => ({
  TerminalTypeServerRegistry: {
    get: () => ({ useTmux: true }),
    getOrDefault: () => ({ useTmux: true }),
    register: () => {},
  },
}));
vi.mock("@/lib/terminal-plugins/init-server", () => ({
  initializeServerPlugins: () => {},
}));

// Container + dynamically-imported cleanup helpers — neutralize side effects.
vi.mock("@/infrastructure/container", () => ({
  githubAccountRepository: {},
  gitCredentialManager: { cleanupSession: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("./port-claims-service", () => ({
  releasePortsForSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./model-proxy-token-service", () => ({
  revokeTokensForSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/task-service", () => ({
  cancelOpenAgentTasks: vi.fn().mockResolvedValue(undefined),
}));

import { closeSession } from "./session-service";

describe("closeSession — tmux kill failure must not block the DB close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.terminalSessions.findFirst.mockResolvedValue(sessionRow);
  });

  it("still marks the session closed when TmuxService.killSession throws", async () => {
    killSession.mockRejectedValueOnce(
      new Error("tmux: failed to connect to server")
    );

    // Must NOT throw despite the kill failing.
    await expect(closeSession("sess-1", "user-1")).resolves.toBeUndefined();

    // The kill was attempted...
    expect(killSession).toHaveBeenCalledWith("rdv-sess-1");
    // ...and the status='closed' / scopeKey=null write STILL ran.
    expect(updateSet).toHaveBeenCalledTimes(1);
    const written = updateSet.mock.calls[0][0] as {
      status: string;
      scopeKey: string | null;
    };
    expect(written.status).toBe("closed");
    expect(written.scopeKey).toBeNull();
  });

  it("marks closed normally when the kill succeeds (idempotent path)", async () => {
    killSession.mockResolvedValueOnce(undefined);

    await expect(closeSession("sess-1", "user-1")).resolves.toBeUndefined();
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect((updateSet.mock.calls[0][0] as { status: string }).status).toBe(
      "closed"
    );
  });
});
