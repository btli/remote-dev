// @vitest-environment node
/**
 * Tests for `src/services/proxyable-ports-service.ts` — the runtime
 * `(listening ∪ claimed)` membership gate (remote-dev-urjg) shared by the HTTP
 * proxy route and the WS bridge.
 *
 * The listening scan and the user's claims are mocked so the union/filter logic
 * is exercised in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortClaim } from "@/services/port-claims-service";

const { getListeningPorts, getActiveClaimsForUser } = vi.hoisted(() => ({
  getListeningPorts: vi.fn(),
  getActiveClaimsForUser: vi.fn(),
}));

vi.mock("@/services/port-monitoring-service", () => ({ getListeningPorts }));
vi.mock("@/services/port-claims-service", () => ({ getActiveClaimsForUser }));

import {
  computeProxyablePortSet,
  getProxyablePortSet,
  isPortProxyableForUser,
} from "@/services/proxyable-ports-service";

function claim(port: number): PortClaim {
  return {
    id: `claim-${port}`,
    sessionId: "sess-a",
    userId: "user-1",
    projectId: null,
    port,
    variableName: "PORT",
    isListening: null,
    pid: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    claimedAt: new Date(),
    updatedAt: new Date(),
  };
}

function listening(
  ...ports: number[]
): Map<number, { process?: string; pid?: number }> {
  return new Map(ports.map((p) => [p, { process: "node", pid: p }]));
}

beforeEach(() => {
  getListeningPorts.mockReset();
  getActiveClaimsForUser.mockReset();
});

describe("computeProxyablePortSet (pure)", () => {
  it("unions listening + claimed and filters the syntactic blocklist", () => {
    const set = computeProxyablePortSet(
      // 3000 listening, 6001 listening (hard-blocked), 80 listening (privileged)
      listening(3000, 6001, 80),
      // 3001 claimed, 22 claimed (privileged)
      [claim(3001), claim(22)],
    );
    expect([...set].sort((a, b) => a - b)).toEqual([3000, 3001]);
  });
});

describe("getProxyablePortSet", () => {
  it("fetches both sources and returns the filtered union", async () => {
    getListeningPorts.mockResolvedValue(listening(5173));
    getActiveClaimsForUser.mockResolvedValue([claim(4000)]);
    const set = await getProxyablePortSet("user-1");
    expect([...set].sort((a, b) => a - b)).toEqual([4000, 5173]);
    expect(getActiveClaimsForUser).toHaveBeenCalledWith("user-1");
  });
});

describe("isPortProxyableForUser", () => {
  it("accepts a listening port", async () => {
    getListeningPorts.mockResolvedValue(listening(3000));
    getActiveClaimsForUser.mockResolvedValue([]);
    await expect(isPortProxyableForUser("user-1", 3000)).resolves.toBe(true);
  });

  it("accepts a claimed-but-not-yet-listening port (union semantics)", async () => {
    getListeningPorts.mockResolvedValue(listening());
    getActiveClaimsForUser.mockResolvedValue([claim(4000)]);
    await expect(isPortProxyableForUser("user-1", 4000)).resolves.toBe(true);
  });

  it("rejects a random port that is neither listening nor claimed", async () => {
    getListeningPorts.mockResolvedValue(listening(3000));
    getActiveClaimsForUser.mockResolvedValue([claim(4000)]);
    await expect(isPortProxyableForUser("user-1", 9999)).resolves.toBe(false);
  });

  it("short-circuits a hard-blocked port WITHOUT querying the sources", async () => {
    await expect(isPortProxyableForUser("user-1", 6001)).resolves.toBe(false);
    expect(getListeningPorts).not.toHaveBeenCalled();
    expect(getActiveClaimsForUser).not.toHaveBeenCalled();
  });

  it("short-circuits a privileged port WITHOUT querying the sources", async () => {
    await expect(isPortProxyableForUser("user-1", 80)).resolves.toBe(false);
    expect(getListeningPorts).not.toHaveBeenCalled();
  });
});
