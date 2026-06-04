import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ instance: {}, instanceAuditLog: {} }));
vi.mock("@/lib/instance-proxy", () => ({ instanceFetch: vi.fn() }));
vi.mock("@/lib/lifecycle-actions", () => ({ requestResume: vi.fn() }));

import { dispatchAgentRun, type DispatchDeps } from "../agent-dispatch";
import type { InstanceRow } from "@/db/schema";

const user = { id: "op-1", email: "op@example.com", role: "operator" as const };

function row(status: string): InstanceRow {
  return { id: "inst-1", slug: "alpha", status, ownerId: "op-1" } as InstanceRow;
}

function makeDeps(over: Partial<DispatchDeps> = {}): {
  deps: DispatchDeps;
  resumed: number;
} {
  let resumed = 0;
  const deps: DispatchDeps = {
    instanceFetch: vi.fn(async () => ({
      status: 202,
      json: async () => ({ id: "run-1", status: "running" }),
    })) as unknown as DispatchDeps["instanceFetch"],
    requestResume: vi.fn(async () => {
      resumed += 1;
      return { status: 202, body: {} };
    }) as unknown as DispatchDeps["requestResume"],
    ...over,
  };
  return {
    deps,
    get resumed() {
      return resumed;
    },
  };
}

const body = { projectId: "p1", prompt: "go" };

describe("dispatchAgentRun", () => {
  it("proxies the run for a ready instance (no resume)", async () => {
    const h = makeDeps();
    const res = await dispatchAgentRun(user, row("ready"), body, h.deps);
    expect(res.status).toBe(202);
    expect(h.resumed).toBe(0);
    expect(h.deps.instanceFetch).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "alpha" }),
      "/api/agent-runs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("wakes a suspended instance before proxying", async () => {
    const h = makeDeps();
    const res = await dispatchAgentRun(user, row("suspended"), body, h.deps);
    expect(h.resumed).toBe(1);
    expect(res.status).toBe(202);
    expect(h.deps.instanceFetch).toHaveBeenCalledOnce();
  });

  it("returns 409 for a terminating instance (not launchable)", async () => {
    const h = makeDeps();
    const res = await dispatchAgentRun(user, row("terminating"), body, h.deps);
    expect(res.status).toBe(409);
    expect(h.deps.instanceFetch).not.toHaveBeenCalled();
  });

  it("mirrors the instance's status code + payload", async () => {
    const h = makeDeps({
      instanceFetch: vi.fn(async () => ({
        status: 500,
        json: async () => ({ error: "instance blew up" }),
      })) as unknown as DispatchDeps["instanceFetch"],
    });
    const res = await dispatchAgentRun(user, row("ready"), body, h.deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "instance blew up" });
  });
});
