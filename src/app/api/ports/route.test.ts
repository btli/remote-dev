// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PortStatus } from "@/types/port";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const getPortsForUser = vi.fn();
const listByUser = vi.fn();
const checkPorts = vi.fn();
const getActiveClaimsForUser = vi.fn();
const listSessions = vi.fn();

vi.mock("@/services/port-registry-service", () => ({
  getPortsForUser,
}));

vi.mock("@/services/project-service", () => ({
  ProjectService: { listByUser },
}));

vi.mock("@/services/port-monitoring-service", () => ({
  checkPorts,
}));

vi.mock("@/services/port-claims-service", () => ({
  getActiveClaimsForUser,
}));

vi.mock("@/services/session-service", () => ({
  listSessions,
}));

beforeEach(() => {
  getPortsForUser.mockReset();
  listByUser.mockReset();
  checkPorts.mockReset();
  getActiveClaimsForUser.mockReset();
  listSessions.mockReset();

  listByUser.mockResolvedValue([{ id: "proj-1", name: "My Project" }]);
  getActiveClaimsForUser.mockResolvedValue([]);
  listSessions.mockResolvedValue([]);
});

describe("GET /api/ports", () => {
  it("returns real isActive/isListening from a single scan (no hardcoded false)", async () => {
    getPortsForUser.mockResolvedValue([
      {
        id: "a1",
        projectId: "proj-1",
        userId: "user-1",
        port: 3000,
        variableName: "PORT",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "a2",
        projectId: "proj-1",
        userId: "user-1",
        port: 3001,
        variableName: "API_PORT",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    const statuses: PortStatus[] = [
      { port: 3000, isListening: true, process: "node", pid: 999 },
      { port: 3001, isListening: false },
    ];
    checkPorts.mockResolvedValue(statuses);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports"));

    expect(response.status).toBe(200);
    const body = await response.json();
    const byPort = Object.fromEntries(
      body.allocations.map((a: { port: number }) => [a.port, a]),
    );

    // The single scan covered exactly the allocated ports.
    expect(checkPorts).toHaveBeenCalledWith([3000, 3001]);

    expect(byPort[3000]).toMatchObject({
      port: 3000,
      isActive: true,
      isListening: true,
      pid: 999,
      process: "node",
      folderName: "My Project",
    });
    expect(byPort[3001]).toMatchObject({
      port: 3001,
      isActive: false,
      isListening: false,
      pid: null,
      process: null,
    });
  });

  it("attaches sessionId/sessionName from a matching claim", async () => {
    getPortsForUser.mockResolvedValue([
      {
        id: "a1",
        projectId: "proj-1",
        userId: "user-1",
        port: 3000,
        variableName: "PORT",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    checkPorts.mockResolvedValue([
      { port: 3000, isListening: true, process: "node", pid: 5 },
    ]);
    getActiveClaimsForUser.mockResolvedValue([
      {
        id: "c1",
        sessionId: "sess-x",
        userId: "user-1",
        projectId: "proj-1",
        port: 3000,
        variableName: "PORT",
        isListening: true,
        pid: 5,
        expiresAt: new Date(Date.now() + 3_600_000),
        claimedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    listSessions.mockResolvedValue([{ id: "sess-x", name: "Dev Server" }]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports"));

    const body = await response.json();
    expect(body.allocations[0]).toMatchObject({
      port: 3000,
      sessionId: "sess-x",
      sessionName: "Dev Server",
    });
  });

  it("returns an empty allocations list and skips a wasted scan path", async () => {
    getPortsForUser.mockResolvedValue([]);
    checkPorts.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ allocations: [] });
    expect(checkPorts).toHaveBeenCalledWith([]);
  });
});
