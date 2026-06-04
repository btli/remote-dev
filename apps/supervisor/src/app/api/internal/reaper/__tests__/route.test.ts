import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Two claimed warm-pool rows; one ready+idle instance, one ready+busy.
const claimedRows = [{ instanceId: "inst-idle" }, { instanceId: "inst-busy" }];
const readyClaimed = [
  { id: "inst-idle", slug: "idle", status: "ready" },
  { id: "inst-busy", slug: "busy", status: "ready" },
];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: async () => {
          // The warmPool claimed query selects {instanceId}; the instance query
          // selects full rows — distinguish by the first row shape.
          return (t as { __table?: string })?.__table === "instance"
            ? readyClaimed
            : claimedRows;
        },
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  instance: { __table: "instance" },
  warmPool: { __table: "warm_pool", instanceId: "instance_id", status: "status" },
}));

const suspendMock = vi.fn(async () => ({ status: 202, body: {} }));
vi.mock("@/lib/lifecycle-actions", () => ({
  requestSuspend: (...a: unknown[]) => suspendMock(...(a as [])),
}));

// idle for inst-idle, not idle for inst-busy.
vi.mock("@/lib/idle-detector", () => ({
  isInstanceIdle: vi.fn(async (row: { id: string }) => row.id === "inst-idle"),
}));

const gcMock = vi.fn(async () => 3);
vi.mock("@/lib/warm-pool", () => ({ gcExpired: () => gcMock() }));

import { authorizeReaper, runReaper, POST } from "@/app/api/internal/reaper/route";

const ORIGINAL_SECRET = process.env.SUPERVISOR_REAPER_SECRET;
const ORIGINAL_ENV = process.env.NODE_ENV;
function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
  else (process.env as Record<string, string | undefined>)[k] = v;
}

beforeEach(() => {
  suspendMock.mockClear();
  gcMock.mockClear();
  setEnv("SUPERVISOR_REAPER_SECRET", "reap-secret");
});
afterEach(() => {
  setEnv("SUPERVISOR_REAPER_SECRET", ORIGINAL_SECRET);
  setEnv("NODE_ENV", ORIGINAL_ENV);
});

describe("authorizeReaper", () => {
  it("401 on a wrong/missing secret when configured", () => {
    const req = new Request("http://x/api/internal/reaper", { method: "POST" });
    expect(authorizeReaper(req)?.status).toBe(401);
  });
  it("allows a matching secret", () => {
    const req = new Request("http://x/api/internal/reaper", {
      method: "POST",
      headers: { "x-supervisor-internal-secret": "reap-secret" },
    });
    expect(authorizeReaper(req)).toBeNull();
  });
  it("503 in production when no secret is set", () => {
    setEnv("SUPERVISOR_REAPER_SECRET", undefined);
    setEnv("NODE_ENV", "production");
    const req = new Request("http://x/api/internal/reaper", { method: "POST" });
    expect(authorizeReaper(req)?.status).toBe(503);
  });
});

describe("runReaper", () => {
  it("suspends only the idle claimed instance + runs warm-pool GC", async () => {
    const result = await runReaper();
    expect(result.suspended).toBe(1);
    expect(result.warmPoolGc).toBe(3);
    expect(suspendMock).toHaveBeenCalledOnce();
    const [, id] = suspendMock.mock.calls[0] as unknown[];
    expect(id).toBe("inst-idle");
  });
});

describe("POST", () => {
  it("401s without the secret, 200s with it", async () => {
    const bad = await POST(
      new Request("http://x/api/internal/reaper", { method: "POST" }),
    );
    expect(bad.status).toBe(401);

    const ok = await POST(
      new Request("http://x/api/internal/reaper", {
        method: "POST",
        headers: { "x-supervisor-internal-secret": "reap-secret" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ suspended: 1, warmPoolGc: 3 });
  });
});
