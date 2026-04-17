import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteDevApiClient } from "../../packages/mobile/src/infrastructure/api/RemoteDevApiClient";

describe("RemoteDevApiClient.restartAgentSession", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the restart endpoint and returns the updated session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          id: "session-1",
          agentExitState: "running",
          agentRestartCount: 3,
        })
      ),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new RemoteDevApiClient({
      baseUrl: "https://remote-dev.test",
      apiKey: "test-key",
    });

    const session = await client.restartAgentSession("session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://remote-dev.test/api/sessions/session-1/restart",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
    expect(session.agentExitState).toBe("running");
    expect(session.agentRestartCount).toBe(3);
  });
});
