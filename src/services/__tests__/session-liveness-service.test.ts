// @vitest-environment node
/**
 * [y5ch.9] Tests for the PID-liveness reconciliation sweep.
 *
 * We mock `node:child_process` execFile (the tmux pane-PID probe), `@/db` (the
 * candidate query + the status-clear update), and `@/services/notification-service`
 * (so we can assert exactly one agent_stuck is emitted per cleared session).
 *
 * The "alive" case uses the test process's own PID (process.pid) so the real
 * `process.kill(pid, 0)` probe sees a live process — mirrors the deploy/status
 * route test's pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock state, mutated per test -----------------------------------------
interface FakeSession {
  id: string;
  name: string;
  userId: string;
  tmuxSessionName: string;
  agentActivityStatus: string;
}
const state: {
  // Active-session pass candidates.
  candidates: FakeSession[];
  // [remote-dev-5xpc] Suspended-session pass candidates (silent clear).
  suspendedCandidates: FakeSession[];
  tmuxPid: Record<string, string | null>; // tmuxSessionName → pid string, or null = no session
  updates: Array<{ id: string; set: Record<string, unknown> }>;
} = { candidates: [], suspendedCandidates: [], tmuxPid: {}, updates: [] };

/**
 * The service issues two findMany calls — one filtered to status="active", one
 * to status="suspended". The drizzle mock below stringifies the `where` so we
 * can route each call to the right candidate list.
 */
function isSuspendedQuery(where: unknown): boolean {
  return JSON.stringify(where ?? "").includes("suspended");
}

const createNotification =
  vi.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({ id: "n1" }));

// tmux pane-pid probe: execFileAsync("tmux", ["list-panes", "-t", name, "-F", "#{pane_pid}"])
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => {
    const tIdx = args.indexOf("-t");
    const name = tIdx >= 0 ? args[tIdx + 1] : "";
    const pid = state.tmuxPid[name];
    if (pid == null) {
      cb(new Error("no such session"), { stdout: "", stderr: "no session" });
    } else {
      cb(null, { stdout: `${pid}\n`, stderr: "" });
    }
  },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      terminalSessions: {
        findMany: vi.fn(async (args?: { where?: unknown }) =>
          isSuspendedQuery(args?.where) ? state.suspendedCandidates : state.candidates
        ),
      },
    },
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          // capture the id from the most recent candidate loop via closure isn't
          // possible here; the service calls update().set().where(eq(id, s.id)).
          // We record set payloads; ids are asserted via createNotification args.
          state.updates.push({ id: "<captured-by-where>", set });
          return undefined;
        },
      }),
    })),
  },
}));

// Drizzle helpers are imported by the service; stub them to no-ops/passthroughs.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
}));

vi.mock("@/db/schema", () => ({
  terminalSessions: {
    id: "id",
    name: "name",
    userId: "userId",
    tmuxSessionName: "tmuxSessionName",
    agentActivityStatus: "agentActivityStatus",
    agentExitState: "agentExitState",
    status: "status",
  },
}));

vi.mock("@/services/notification-service", () => ({
  createNotification: (input: Record<string, unknown>) => createNotification(input),
}));

beforeEach(() => {
  state.candidates = [];
  state.suspendedCandidates = [];
  state.tmuxPid = {};
  state.updates = [];
  createNotification.mockClear();
  vi.resetModules();
});

async function loadService() {
  return import("../session-liveness-service");
}

describe("reconcileLiveness", () => {
  it("clears a session whose pane PID is dead and emits one agent_stuck", async () => {
    state.candidates = [
      { id: "s1", name: "main", userId: "u1", tmuxSessionName: "rdv-s1", agentActivityStatus: "running" },
    ];
    // A PID that is essentially guaranteed not to exist.
    state.tmuxPid = { "rdv-s1": "2147483646" };

    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();

    expect(n).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    const arg = createNotification.mock.calls[0][0] as {
      type: string;
      severity: string;
      sessionId: string;
    };
    expect(arg.type).toBe("agent_stuck");
    expect(arg.severity).toBe("error");
    expect(arg.sessionId).toBe("s1");
    // status was cleared
    expect(state.updates.length).toBe(1);
    expect(state.updates[0].set).toMatchObject({ agentActivityStatus: "idle", agentExitState: "exited" });
  });

  it("leaves a session alone when its pane PID is alive", async () => {
    state.candidates = [
      { id: "s2", name: "live", userId: "u1", tmuxSessionName: "rdv-s2", agentActivityStatus: "waiting" },
    ];
    state.tmuxPid = { "rdv-s2": String(process.pid) }; // the test process is alive

    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();

    expect(n).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.updates.length).toBe(0);
  });

  it("treats a missing tmux session as dead (clears it)", async () => {
    state.candidates = [
      { id: "s3", name: "gone", userId: "u1", tmuxSessionName: "rdv-s3", agentActivityStatus: "running" },
    ];
    state.tmuxPid = {}; // no session → probe errors → treated as dead

    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();

    expect(n).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    const arg = createNotification.mock.calls[0][0] as { type: string };
    expect(arg.type).toBe("agent_stuck");
  });

  it("returns 0 and notifies nothing when there are no alive-state candidates", async () => {
    state.candidates = [];
    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();
    expect(n).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  // [remote-dev-5xpc] Second pass over suspended sessions.
  describe("suspended-session pass", () => {
    it("clears a dead suspended session SILENTLY (no notification)", async () => {
      state.suspendedCandidates = [
        { id: "sus1", name: "bg", userId: "u1", tmuxSessionName: "rdv-sus1", agentActivityStatus: "running" },
      ];
      state.tmuxPid = { "rdv-sus1": "2147483646" }; // dead PID

      const { reconcileLiveness } = await loadService();
      const n = await reconcileLiveness();

      expect(n).toBe(1);
      // Silent: no agent_stuck notification for backgrounded sessions.
      expect(createNotification).not.toHaveBeenCalled();
      expect(state.updates.length).toBe(1);
      expect(state.updates[0].set).toMatchObject({ agentActivityStatus: "idle", agentExitState: "exited" });
    });

    it("treats a missing tmux session as dead and clears it silently", async () => {
      state.suspendedCandidates = [
        { id: "sus2", name: "gone", userId: "u1", tmuxSessionName: "rdv-sus2", agentActivityStatus: "subagent" },
      ];
      state.tmuxPid = {}; // no session → dead

      const { reconcileLiveness } = await loadService();
      const n = await reconcileLiveness();

      expect(n).toBe(1);
      expect(createNotification).not.toHaveBeenCalled();
    });

    it("leaves a suspended session whose process is ALIVE untouched", async () => {
      // resume() no longer wipes status (remote-dev-3m5s), so a live background
      // agent is legitimate — keep its status.
      state.suspendedCandidates = [
        { id: "sus3", name: "live-bg", userId: "u1", tmuxSessionName: "rdv-sus3", agentActivityStatus: "running" },
      ];
      state.tmuxPid = { "rdv-sus3": String(process.pid) };

      const { reconcileLiveness } = await loadService();
      const n = await reconcileLiveness();

      expect(n).toBe(0);
      expect(createNotification).not.toHaveBeenCalled();
      expect(state.updates.length).toBe(0);
    });

    it("processes both passes: active notifies, suspended is silent", async () => {
      state.candidates = [
        { id: "act1", name: "active", userId: "u1", tmuxSessionName: "rdv-act1", agentActivityStatus: "running" },
      ];
      state.suspendedCandidates = [
        { id: "sus1", name: "bg", userId: "u1", tmuxSessionName: "rdv-sus1", agentActivityStatus: "running" },
      ];
      state.tmuxPid = { "rdv-act1": "2147483646", "rdv-sus1": "2147483645" }; // both dead

      const { reconcileLiveness } = await loadService();
      const n = await reconcileLiveness();

      expect(n).toBe(2);
      // Exactly one notification — for the active session only.
      expect(createNotification).toHaveBeenCalledTimes(1);
      const arg = createNotification.mock.calls[0][0] as { sessionId: string; type: string };
      expect(arg.sessionId).toBe("act1");
      expect(arg.type).toBe("agent_stuck");
      expect(state.updates.length).toBe(2);
    });
  });
});
