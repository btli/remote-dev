// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const validateApiKey = vi.fn();
const touchApiKey = vi.fn();
vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey,
  touchApiKey,
}));

const getSessionWithMetadata = vi.fn();
vi.mock("@/services/session-service", () => ({
  getSessionWithMetadata,
  SessionServiceError: class extends Error {},
}));
vi.mock("@/services/worktree-service", () => ({}));
vi.mock("@/services/github-service", () => ({}));
vi.mock("@/services/trash-service", () => ({}));
vi.mock("@/services/schedule-service", () => ({}));
vi.mock("@/services/preferences-service", () => ({}));
vi.mock("@/lib/scheduler-client", () => ({}));
vi.mock("@/lib/broadcast", () => ({}));
vi.mock("@/services/claude-account-service", () => ({
  CLAUDE_USAGE_SETUP_SESSION_MARKER: "usageSetupSession",
}));

beforeEach(() => {
  validateApiKey.mockReset().mockResolvedValue({
    userId: "user-1",
    keyId: "key-1",
  });
  touchApiKey.mockReset().mockResolvedValue(undefined);
  getSessionWithMetadata.mockReset().mockResolvedValue({
    id: "session-1",
    projectId: "project-1",
  });
});

describe("GET /api/sessions/[id] agent authentication", () => {
  it("allows the session-scoped rdv client to resolve its owned project", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/sessions/session-1", {
        headers: { authorization: "Bearer rdv-agent-key" },
      }),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(200);
    expect(validateApiKey).toHaveBeenCalledWith("rdv-agent-key");
    expect(getSessionWithMetadata).toHaveBeenCalledWith("session-1", "user-1");
    await expect(response.json()).resolves.toMatchObject({
      id: "session-1",
      projectId: "project-1",
    });
  });
});
