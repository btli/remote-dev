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
  agentRestartCount?: number | null;
  agentExitState?: string | null;
  updatedAt?: Date;
}
const state: {
  // Active-session pass candidates.
  candidates: FakeSession[];
  // [remote-dev-5xpc] Suspended-session pass candidates (silent clear).
  suspendedCandidates: FakeSession[];
  exitCandidates: Array<FakeSession & {
    agentRestartCount: number;
    agentExitCode: number | null;
    agentActivityStatus: string;
    agentExitedAt?: Date | null;
    status?: string;
  }>;
  tmuxPid: Record<string, string | null>; // tmuxSessionName → pid string, or null = no session
  deadPane: Record<string, { pid: string; exitCode: string; signal?: string }>;
  paneOutput: Record<string, string>;
  tmuxError: Record<string, string>;
  tmuxCommandError: Record<string, string>;
  updates: Array<{ id: string; set: Record<string, unknown> }>;
  updateWheres: unknown[];
  findWheres: unknown[];
  tmuxCommands: string[][];
  rejectUpdates: boolean;
  notificationMarks: number;
} = {
  candidates: [],
  suspendedCandidates: [],
  exitCandidates: [],
  tmuxPid: {},
  deadPane: {},
  paneOutput: {},
  tmuxError: {},
  tmuxCommandError: {},
  updates: [],
  updateWheres: [],
  findWheres: [],
  tmuxCommands: [],
  rejectUpdates: false,
  notificationMarks: 0,
};

/**
 * The service issues two findMany calls — one filtered to status="active", one
 * to status="suspended". The drizzle mock below stringifies the `where` so we
 * can route each call to the right candidate list.
 */
function isSuspendedQuery(where: unknown): boolean {
  return JSON.stringify(where ?? "").includes("suspended");
}

function isExitRepairQuery(where: unknown): boolean {
  return JSON.stringify(where ?? "").includes("exited");
}

const createNotification =
  vi.fn<(input: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({ id: "n1" }));

// tmux pane-pid probe: execFileAsync("tmux", ["list-panes", "-t", name, "-F",
// "#{pane_pid}"], { cwd }) — accept both the (cmd, args, cb) and
// (cmd, args, opts, cb) call shapes (remote-dev-ipbo added the opts).
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    optsOrCb: unknown,
    maybeCb?: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => {
    const cb = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as (
      err: Error | null,
      out: { stdout: string; stderr: string },
    ) => void;
    state.tmuxCommands.push(args);
    if (args[0] === "respawn-pane") {
      cb(null, { stdout: "", stderr: "" });
      return;
    }
    const tIdx = args.indexOf("-t");
    const name = tIdx >= 0 ? args[tIdx + 1] : "";
    const commandError = state.tmuxCommandError[`${args[0]}:${name}`];
    if (commandError !== undefined) {
      cb(Object.assign(new Error(commandError), { stderr: commandError }), { stdout: "", stderr: commandError });
      return;
    }
    if (state.tmuxError[name] !== undefined) {
      const stderr = state.tmuxError[name];
      cb(Object.assign(new Error(stderr), { stderr }), { stdout: "", stderr });
      return;
    }
    if (state.paneOutput[name] !== undefined) {
      cb(null, { stdout: state.paneOutput[name], stderr: "" });
      return;
    }
    const dead = state.deadPane[name];
    if (dead) {
      cb(null, {
        stdout: `%0\t1\t${dead.pid}\t1\t${dead.exitCode}\t${dead.signal ?? ""}\n`,
        stderr: "",
      });
      return;
    }
    const pid = state.tmuxPid[name];
    if (pid == null) {
      const stderr = `can't find session: ${name}`;
      cb(Object.assign(new Error(stderr), { stderr }), { stdout: "", stderr });
    } else {
      cb(null, { stdout: `%0\t1\t${pid}\t0\t\t\n`, stderr: "" });
    }
  },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      terminalSessions: {
        findMany: vi.fn(async (args?: { where?: unknown }) => {
          state.findWheres.push(args?.where);
          if (isExitRepairQuery(args?.where)) return state.exitCandidates;
          return isSuspendedQuery(args?.where) ? state.suspendedCandidates : state.candidates;
        }),
        findFirst: vi.fn(async () => state.exitCandidates[0] ?? null),
      },
    },
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          // capture the id from the most recent candidate loop via closure isn't
          // possible here; the service calls update().set().where(eq(id, s.id)).
          // We record set payloads; ids are asserted via createNotification args.
          const isNotificationMark = Object.keys(set).length === 1 && "agentExitNotificationAt" in set;
          if (isNotificationMark) {
            state.notificationMarks += 1;
          } else {
            state.updates.push({ id: "<captured-by-where>", set });
            state.updateWheres.push(where);
          }
          const result = Promise.resolve(undefined) as Promise<void> & {
            returning: () => Promise<Array<{ id: string }>>;
          };
          result.returning = async () => state.rejectUpdates ? [] : [{ id: "updated" }];
          return result;
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
  gte: (a: unknown, b: unknown) => ({ gte: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({ sql: parts.join("?"), values }),
}));

vi.mock("@/db/schema", () => ({
  terminalSessions: {
    id: "id",
    name: "name",
    userId: "userId",
    tmuxSessionName: "tmuxSessionName",
    agentActivityStatus: "agentActivityStatus",
    agentExitState: "agentExitState",
    agentRestartCount: "agentRestartCount",
    agentExitCode: "agentExitCode",
    agentExitedAt: "agentExitedAt",
    agentExitNotificationAt: "agentExitNotificationAt",
    agentActivityStatusAt: "agentActivityStatusAt",
    agentActivityOrder: "agentActivityOrder",
    updatedAt: "updatedAt",
    terminalType: "terminalType",
    status: "status",
  },
}));

vi.mock("@/services/notification-service", () => ({
  createNotification: (input: Record<string, unknown>) => createNotification(input),
  replaceIdempotentNotification: (input: Record<string, unknown>) => createNotification(input),
  pruneLifecycleDeliveryReceipts: vi.fn(async () => undefined),
}));

beforeEach(() => {
  state.candidates = [];
  state.suspendedCandidates = [];
  state.exitCandidates = [];
  state.tmuxPid = {};
  state.deadPane = {};
  state.paneOutput = {};
  state.tmuxError = {};
  state.tmuxCommandError = {};
  state.updates = [];
  state.updateWheres = [];
  state.findWheres = [];
  state.tmuxCommands = [];
  state.rejectUpdates = false;
  state.notificationMarks = 0;
  createNotification.mockClear();
  vi.resetModules();
});

async function loadService() {
  return import("../session-liveness-service");
}

describe("reconcileLiveness", () => {
  it("persists a dead PID without preempting the exact exit callback", async () => {
    state.candidates = [
      { id: "s1", name: "main", userId: "u1", tmuxSessionName: "rdv-s1", agentActivityStatus: "running" },
    ];
    // A PID that is essentially guaranteed not to exist.
    state.tmuxPid = { "rdv-s1": "2147483646" };

    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();

    expect(n).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
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

  it("persists an exact dead-pane exit for callback-first delivery", async () => {
    state.candidates = [
      { id: "s-dead", name: "dead", userId: "u1", tmuxSessionName: "rdv-dead", agentActivityStatus: "running" },
    ];
    state.deadPane = { "rdv-dead": { pid: "1234", exitCode: "9" } };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);

    expect(state.updates[0]?.set).toMatchObject({
      agentExitState: "exited",
      agentExitCode: 9,
      agentActivityStatus: "error",
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("recovers a dead pane even after Stop already changed activity to idle", async () => {
    state.candidates = [
      { id: "s-idle", name: "idle", userId: "u1", tmuxSessionName: "rdv-idle", agentActivityStatus: "idle" },
    ];
    state.deadPane = { "rdv-idle": { pid: "1234", exitCode: "0" } };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("persists SessionEnd completion without preempting its pane callback", async () => {
    state.candidates = [
      { id: "s-ended", name: "ended", userId: "u1", tmuxSessionName: "rdv-ended", agentActivityStatus: "ended" },
    ];

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(state.updates[0]?.set).toMatchObject({
      agentExitState: "exited",
      agentExitCode: 0,
      agentActivityStatus: "ended",
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("repairs a notification after exit state committed but notification insert did not", async () => {
    state.exitCandidates = [{
      id: "s-repair",
      name: "repair",
      userId: "u1",
      tmuxSessionName: "rdv-repair",
      agentActivityStatus: "error",
      agentRestartCount: 4,
      agentExitCode: 7,
    }];

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s-repair",
        type: "agent_error",
        idempotencyKey: "pane-exit:s-repair:4",
      }),
    );
  });

  it("leaves a fresh exact-exit intent for the in-flight callback to deliver", async () => {
    state.exitCandidates = [{
      id: "s-fresh-exit",
      name: "fresh exit",
      userId: "u1",
      tmuxSessionName: "rdv-fresh-exit",
      agentActivityStatus: "error",
      agentRestartCount: 5,
      agentExitCode: 9,
      agentExitedAt: new Date(),
    }];

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("repairs an active heuristic agent_stuck notification from the exited row", async () => {
    state.exitCandidates = [{
      id: "s-stuck-repair",
      name: "stuck repair",
      userId: "u1",
      tmuxSessionName: "rdv-stuck-repair",
      agentActivityStatus: "idle",
      agentRestartCount: 2,
      agentExitCode: null,
      status: "active",
    }];

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s-stuck-repair",
      type: "agent_stuck",
      idempotencyKey: "pane-exit:s-stuck-repair:2",
    }));
  });

  it("repairs a liveness intent only after the exact callback grace expires", async () => {
    state.candidates = [{
      id: "s-delayed-repair",
      name: "delayed repair",
      userId: "u1",
      tmuxSessionName: "rdv-delayed-repair",
      agentActivityStatus: "running",
      agentRestartCount: 3,
    }];

    const {
      reconcileLiveness,
      EXIT_NOTIFICATION_REPAIR_GRACE_MS,
    } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);

    state.candidates = [];
    state.exitCandidates = [{
      id: "s-delayed-repair",
      name: "delayed repair",
      userId: "u1",
      tmuxSessionName: "rdv-delayed-repair",
      agentActivityStatus: "idle",
      agentRestartCount: 3,
      agentExitCode: null,
      agentExitedAt: new Date(Date.now() - EXIT_NOTIFICATION_REPAIR_GRACE_MS - 1),
      status: "active",
    }];

    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s-delayed-repair",
      type: "agent_stuck",
      idempotencyKey: "pane-exit:s-delayed-repair:3",
    }));
    expect(state.notificationMarks).toBe(1);
  });

  it("marks a stale suspended heuristic intent delivered without notifying", async () => {
    state.exitCandidates = [{
      id: "s-suspended-repair",
      name: "suspended repair",
      userId: "u1",
      tmuxSessionName: "rdv-suspended-repair",
      agentActivityStatus: "idle",
      agentRestartCount: 6,
      agentExitCode: null,
      status: "suspended",
    }];

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(1);
  });

  it("treats a missing tmux session as dead (clears it)", async () => {
    state.candidates = [
      { id: "s3", name: "gone", userId: "u1", tmuxSessionName: "rdv-s3", agentActivityStatus: "running" },
    ];
    state.tmuxPid = {}; // no session → probe errors → treated as dead

    const { reconcileLiveness } = await loadService();
    const n = await reconcileLiveness();

    expect(n).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("does not treat a transient tmux probe error as process absence", async () => {
    state.candidates = [
      { id: "s-transient", name: "live", userId: "u1", tmuxSessionName: "rdv-transient", agentActivityStatus: "running" },
    ];
    state.tmuxError = { "rdv-transient": "tmux: permission denied opening server socket" };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("does not reconcile a stale restart on an inconclusive tmux probe", async () => {
    state.candidates = [{
      id: "s-restart-transient",
      name: "live restart",
      userId: "u1",
      tmuxSessionName: "rdv-restart-transient",
      agentActivityStatus: "running",
      agentRestartCount: 8,
      agentExitState: "restarting",
      updatedAt: new Date(Date.now() - 10 * 60_000),
    }];
    state.tmuxError = { "rdv-restart-transient": "tmux command timed out" };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(state.tmuxCommands.some((args) => args[0] === "respawn-pane")).toBe(false);
  });

  it("does not overwrite a newer generation when a stale liveness probe loses its CAS", async () => {
    state.candidates = [{
      id: "s-race",
      name: "race",
      userId: "u1",
      tmuxSessionName: "rdv-race",
      agentActivityStatus: "running",
      agentRestartCount: 3,
      agentExitState: "running",
    }];
    state.tmuxPid = {};
    // Models generation 4 winning after the sweep snapshot but before UPDATE.
    state.rejectUpdates = true;

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(JSON.stringify(state.updateWheres[0])).toContain("u1");
    expect(JSON.stringify(state.updateWheres[0])).toContain("3");
  });

  it("reconciles a dead pane left in restarting and queries that state explicitly", async () => {
    state.candidates = [{
      id: "s-restarting",
      name: "restarting",
      userId: "u1",
      tmuxSessionName: "rdv-restarting",
      agentActivityStatus: "running",
      agentRestartCount: 5,
      agentExitState: "restarting",
      updatedAt: new Date(Date.now() - 10 * 60_000),
    }];
    state.deadPane = { "rdv-restarting": { pid: "1234", exitCode: "17" } };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
    expect(JSON.stringify(state.findWheres[0])).toContain("restarting");
  });

  it("terminates and reconciles an abandoned restarting pane after the grace period", async () => {
    state.candidates = [{
      id: "s-abandoned",
      name: "abandoned",
      userId: "u1",
      tmuxSessionName: "rdv-abandoned",
      agentActivityStatus: "running",
      agentRestartCount: 6,
      agentExitState: "restarting",
      updatedAt: new Date(Date.now() - 10 * 60_000),
    }];
    state.tmuxPid = { "rdv-abandoned": String(process.pid) };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(state.tmuxCommands).toContainEqual(["kill-session", "-t", "rdv-abandoned"]);
    expect(state.tmuxCommands.some((args) => args[0] === "respawn-pane")).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("retains restarting when an abandoned tmux session cannot be confirmed absent", async () => {
    state.candidates = [{
      id: "s-uncertain-restart",
      name: "uncertain",
      userId: "u1",
      tmuxSessionName: "rdv-uncertain-restart",
      agentActivityStatus: "running",
      agentRestartCount: 7,
      agentExitState: "restarting",
      updatedAt: new Date(Date.now() - 10 * 60_000),
    }];
    state.tmuxPid = { "rdv-uncertain-restart": String(process.pid) };
    state.tmuxCommandError = {
      "kill-session:rdv-uncertain-restart": "tmux socket permission denied",
    };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(state.tmuxCommands).toContainEqual(["kill-session", "-t", "rdv-uncertain-restart"]);
    expect(state.tmuxCommands).toContainEqual(["has-session", "-t", "rdv-uncertain-restart"]);
    expect(state.updates).toHaveLength(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("leaves a fresh in-flight restart alone during its grace period", async () => {
    state.candidates = [{
      id: "s-fresh-restart",
      name: "fresh",
      userId: "u1",
      tmuxSessionName: "rdv-fresh-restart",
      agentActivityStatus: "running",
      agentRestartCount: 2,
      agentExitState: "restarting",
      updatedAt: new Date(),
    }];
    state.tmuxPid = { "rdv-fresh-restart": String(process.pid) };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(state.tmuxCommands.some((args) => args[0] === "respawn-pane")).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it("reconciles a definitively dead restarting pane without waiting for the grace period", async () => {
    state.candidates = [{
      id: "s-fast-dead-restart",
      name: "fast dead",
      userId: "u1",
      tmuxSessionName: "rdv-fast-dead-restart",
      agentActivityStatus: "running",
      agentRestartCount: 9,
      agentExitState: "restarting",
      updatedAt: new Date(),
    }];
    state.deadPane = { "rdv-fast-dead-restart": { pid: "1234", exitCode: "42" } };

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(1);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.notificationMarks).toBe(0);
  });

  it("ignores a dead auxiliary pane when the marked agent pane is alive", async () => {
    state.candidates = [{
      id: "s-split",
      name: "split",
      userId: "u1",
      tmuxSessionName: "rdv-split",
      agentActivityStatus: "running",
    }];
    state.paneOutput["rdv-split"] =
      `%1\t\t2147483646\t1\t23\t\n%2\t1\t${process.pid}\t0\t\t\n`;

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("leaves an ambiguous unmarked legacy split unchanged", async () => {
    state.candidates = [{
      id: "s-ambiguous",
      name: "ambiguous",
      userId: "u1",
      tmuxSessionName: "rdv-ambiguous",
      agentActivityStatus: "running",
      agentRestartCount: 1,
      agentExitState: "running",
    }];
    state.paneOutput["rdv-ambiguous"] =
      `%1\t\t2147483646\t1\t23\t\n%2\t\t${process.pid}\t0\t\t\n`;

    const { reconcileLiveness } = await loadService();
    expect(await reconcileLiveness()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
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

    it("defers both active and suspended delivery to callback/repair arbitration", async () => {
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
      expect(createNotification).not.toHaveBeenCalled();
      expect(state.notificationMarks).toBe(0);
      expect(state.updates.length).toBe(2);
    });
  });
});
