// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Shared mock state. vi.hoisted runs before the hoisted vi.mock factories, so
// these are safe to reference inside them (unlike plain top-level consts).
const h = vi.hoisted(() => {
  const state = {
    // Candidate rows returned by the select(...).from(...).where(...) chain.
    candidates: [] as Array<{
      id: string;
      userId: string;
      tmuxSessionName: string;
      terminalType: string;
    }>,
    // Records which session ids got the status='closed' write.
    closedUpdates: [] as Array<{ values: unknown }>,
    sessionExists: vi.fn(),
  };
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(state.candidates),
      }),
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        state.closedUpdates.push({ values });
        return { where: () => Promise.resolve(undefined) };
      },
    })),
  };
  return { state, db };
});

const { state, db } = h;
const { sessionExists } = state;

vi.mock("@/db", () => ({ db: h.db }));

// withBusyRetry → just run the fn (retry behavior is covered by its own test).
vi.mock("@/db/busy-retry", () => ({
  withBusyRetry: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/services/tmux-service", () => ({
  sessionExists: (name: string) => h.state.sessionExists(name),
}));

// All known terminal types use tmux here.
vi.mock("@/lib/terminal-plugins/server", () => ({
  TerminalTypeServerRegistry: { get: () => ({ useTmux: true }) },
}));
vi.mock("@/lib/terminal-plugins/init-server", () => ({
  initializeServerPlugins: vi.fn(),
}));

import { reconcileSessionsWithTmux } from "./session-reconcile";

describe("reconcileSessionsWithTmux", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.candidates = [];
    state.closedUpdates.length = 0;
  });

  it("closes a ghost (active row, tmux missing)", async () => {
    state.candidates = [
      { id: "ghost-1", userId: "u1", tmuxSessionName: "rdv-ghost-1", terminalType: "shell" },
    ];
    sessionExists.mockResolvedValue(false); // tmux is gone

    const result = await reconcileSessionsWithTmux();

    expect(result.healed).toBe(1);
    expect(state.closedUpdates).toHaveLength(1);
    const written = state.closedUpdates[0].values as {
      status: string;
      scopeKey: string | null;
    };
    expect(written.status).toBe("closed");
    expect(written.scopeKey).toBeNull();
  });

  it("leaves a healthy row (tmux present) untouched", async () => {
    state.candidates = [
      { id: "live-1", userId: "u1", tmuxSessionName: "rdv-live-1", terminalType: "shell" },
    ];
    sessionExists.mockResolvedValue(true); // tmux is alive

    const result = await reconcileSessionsWithTmux();

    expect(result.healed).toBe(0);
    expect(state.closedUpdates).toHaveLength(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("heals only the ghosts in a mixed batch", async () => {
    state.candidates = [
      { id: "ghost-1", userId: "u1", tmuxSessionName: "rdv-ghost-1", terminalType: "shell" },
      { id: "live-1", userId: "u1", tmuxSessionName: "rdv-live-1", terminalType: "agent" },
      { id: "ghost-2", userId: "u2", tmuxSessionName: "rdv-ghost-2", terminalType: "shell" },
    ];
    sessionExists.mockImplementation((name: string) =>
      Promise.resolve(name === "rdv-live-1")
    );

    const result = await reconcileSessionsWithTmux();

    expect(result.healed).toBe(2);
    expect(state.closedUpdates).toHaveLength(2);
  });

  it("does NOT heal when the tmux existence check throws (uncertainty)", async () => {
    state.candidates = [
      { id: "unk-1", userId: "u1", tmuxSessionName: "rdv-unk-1", terminalType: "shell" },
    ];
    sessionExists.mockRejectedValue(new Error("tmux unavailable"));

    const result = await reconcileSessionsWithTmux();

    expect(result.healed).toBe(0);
    expect(state.closedUpdates).toHaveLength(0);
  });
});
