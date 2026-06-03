// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const getActivePorts = vi.fn();

// Mock the DI container so importing the route doesn't spin up Drizzle repos,
// tmux gateways, or the startup claim-prune side effect.
vi.mock("@/infrastructure/container", () => ({
  portMonitor: { getActivePorts },
}));

beforeEach(() => {
  getActivePorts.mockReset();
});

describe("GET /api/ports/active", () => {
  it("returns the tmux-env active ports for the user", async () => {
    const activePorts = [
      {
        sessionId: "sess-a",
        sessionName: "My Session",
        port: 5173,
        variableName: "VITE_PORT",
        projectId: "proj-1",
      },
    ];
    getActivePorts.mockResolvedValue(activePorts);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/active"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activePorts });
    expect(getActivePorts).toHaveBeenCalledWith("user-1");
  });

  it("returns an empty list when no sessions expose ports", async () => {
    getActivePorts.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/ports/active"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activePorts: [] });
  });
});
