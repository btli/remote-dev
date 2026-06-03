// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortClaim } from "@/services/port-claims-service";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const getListeningPorts = vi.fn();
const getActiveClaimsForUser = vi.fn();
const listSessions = vi.fn();

vi.mock("@/services/port-monitoring-service", () => ({
  getListeningPorts,
}));

vi.mock("@/services/port-claims-service", () => ({
  getActiveClaimsForUser,
}));

vi.mock("@/services/session-service", () => ({
  listSessions,
}));

function claim(overrides: Partial<PortClaim> & { port: number }): PortClaim {
  return {
    id: `claim-${overrides.port}`,
    sessionId: "sess-a",
    userId: "user-1",
    projectId: "proj-1",
    variableName: "PORT",
    isListening: null,
    pid: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    claimedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  getListeningPorts.mockReset();
  getActiveClaimsForUser.mockReset();
  listSessions.mockReset();
  listSessions.mockResolvedValue([{ id: "sess-a", name: "My Session" }]);
});

describe("GET /api/ports/proxyable", () => {
  it("merges listening + claims and classifies the `source` field", async () => {
    // 3000 listening + claimed → both; 3001 listening only → listening;
    // 3002 claimed only → claim.
    getListeningPorts.mockResolvedValue(
      new Map<number, { process?: string; pid?: number }>([
        [3000, { process: "node", pid: 111 }],
        [3001, { process: "vite", pid: 222 }],
      ]),
    );
    getActiveClaimsForUser.mockResolvedValue([
      claim({ port: 3000, sessionId: "sess-a", variableName: "PORT" }),
      claim({ port: 3002, sessionId: "sess-a", variableName: "API_PORT", pid: 333 }),
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/proxyable"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const byPort = Object.fromEntries(
      body.ports.map((p: { port: number }) => [p.port, p]),
    );

    // Sorted ascending.
    expect(body.ports.map((p: { port: number }) => p.port)).toEqual([
      3000, 3001, 3002,
    ]);

    expect(byPort[3000]).toMatchObject({
      port: 3000,
      isListening: true,
      pid: 111,
      process: "node",
      sessionId: "sess-a",
      sessionName: "My Session",
      projectId: "proj-1",
      variableName: "PORT",
      source: "both",
    });

    expect(byPort[3001]).toMatchObject({
      port: 3001,
      isListening: true,
      pid: 222,
      process: "vite",
      sessionId: null,
      sessionName: null,
      projectId: null,
      variableName: null,
      source: "listening",
    });

    expect(byPort[3002]).toMatchObject({
      port: 3002,
      isListening: false,
      // not listening → pid falls back to the claim's pid
      pid: 333,
      process: null,
      sessionId: "sess-a",
      sessionName: "My Session",
      source: "claim",
    });
  });

  it("excludes hard-blocked (6001/6002) and privileged (<1024) ports", async () => {
    getListeningPorts.mockResolvedValue(
      new Map<number, { process?: string; pid?: number }>([
        [6001, { process: "next", pid: 1 }], // hard-blocked
        [6002, { process: "terminal", pid: 2 }], // hard-blocked
        [80, { process: "nginx", pid: 3 }], // privileged
        [443, { process: "nginx", pid: 4 }], // privileged
        [8080, { process: "app", pid: 5 }], // proxyable
      ]),
    );
    getActiveClaimsForUser.mockResolvedValue([
      claim({ port: 6001 }), // hard-blocked via claim too
      claim({ port: 22 }), // privileged via claim
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/proxyable"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ports.map((p: { port: number }) => p.port)).toEqual([8080]);
  });

  it("sets sessionName to null when the claim's session is unknown", async () => {
    listSessions.mockResolvedValue([]); // no sessions resolvable
    getListeningPorts.mockResolvedValue(
      new Map<number, { process?: string; pid?: number }>(),
    );
    getActiveClaimsForUser.mockResolvedValue([
      claim({ port: 4000, sessionId: "ghost" }),
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/proxyable"));

    const body = await response.json();
    expect(body.ports).toHaveLength(1);
    expect(body.ports[0]).toMatchObject({
      port: 4000,
      sessionId: "ghost",
      sessionName: null,
      source: "claim",
    });
  });

  it("returns an empty list when nothing is listening or claimed", async () => {
    getListeningPorts.mockResolvedValue(
      new Map<number, { process?: string; pid?: number }>(),
    );
    getActiveClaimsForUser.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/proxyable"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ports: [] });
  });
});
