import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const toResponse = vi.fn();
const broadcastSidebarChanged = vi.fn();

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
  }),
}));

vi.mock("@/infrastructure/container", () => ({
  restartAgentUseCase: {
    execute,
  },
}));

vi.mock("@/interface/presenters/SessionPresenter", () => ({
  SessionPresenter: {
    toResponse,
  },
}));

vi.mock("@/lib/broadcast", () => ({
  broadcastSidebarChanged,
}));

describe("POST /api/sessions/[id]/restart", () => {
  it("restarts the agent session and returns the updated session payload", async () => {
    const fakeSession = { id: "session-1" };
    const fakeResponse = {
      id: "session-1",
      agentExitState: "running",
      agentRestartCount: 2,
    };

    execute.mockResolvedValue({ session: fakeSession, wasRecreated: false });
    toResponse.mockReturnValue(fakeResponse);

    const { POST } = await import("./route");

    const response = await POST(new Request("http://localhost/api/sessions/session-1/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(execute).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
    });
    expect(broadcastSidebarChanged).toHaveBeenCalledWith("user-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeResponse);
  });
});
