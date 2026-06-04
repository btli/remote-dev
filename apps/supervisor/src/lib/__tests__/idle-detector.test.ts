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
vi.mock("@/lib/instance-proxy", () => ({ instanceFetch: vi.fn() }));

import { isInstanceIdle, type IdleDeps } from "../idle-detector";

const NOW = 1_000_000_000_000;
function deps(over: Partial<IdleDeps> = {}): IdleDeps {
  return {
    probe: vi.fn(async () => ({ activeSessions: 0, reachable: true })),
    now: () => NOW,
    ...over,
  };
}

const oldRow = {
  slug: "alpha",
  provisionedAt: new Date(NOW - 60 * 60 * 1000), // 1h ago
  updatedAt: new Date(NOW - 60 * 60 * 1000),
};

describe("isInstanceIdle", () => {
  it("idle when reachable, zero sessions, and past the timeout", async () => {
    const idle = await isInstanceIdle(oldRow, 30 * 60 * 1000, deps());
    expect(idle).toBe(true);
  });

  it("NOT idle when there are active sessions", async () => {
    const idle = await isInstanceIdle(
      oldRow,
      30 * 60 * 1000,
      deps({ probe: vi.fn(async () => ({ activeSessions: 2, reachable: true })) }),
    );
    expect(idle).toBe(false);
  });

  it("NOT idle (fail-safe) when the instance is unreachable", async () => {
    const idle = await isInstanceIdle(
      oldRow,
      30 * 60 * 1000,
      deps({ probe: vi.fn(async () => ({ activeSessions: 0, reachable: false })) }),
    );
    expect(idle).toBe(false);
  });

  it("NOT idle when last activity is within the timeout", async () => {
    const fresh = {
      slug: "alpha",
      provisionedAt: new Date(NOW - 60 * 1000), // 1 min ago
      updatedAt: new Date(NOW - 60 * 1000),
    };
    const idle = await isInstanceIdle(fresh, 30 * 60 * 1000, deps());
    expect(idle).toBe(false);
  });
});
