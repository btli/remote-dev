// @vitest-environment node
/** Usage setup cancellation keeps all path authority in session metadata. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
const abortCapture = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-utils", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => logMocks }));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/session-service", () => ({ getSession: vi.fn() }));
vi.mock("@/services/claude-account-service", () => ({
  CLAUDE_USAGE_SETUP_SESSION_MARKER: "rdvClaudeUsageSetupSession",
}));
vi.mock("@/services/claude-usage-credential-service", () => ({
  abortUsageCredentialCapture: abortCapture,
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import { CLAUDE_USAGE_SETUP_SESSION_MARKER } from "@/services/claude-account-service";
import { POST } from "./route";

const session = {
  id: "session-1",
  tmuxSessionName: "rdv-session-1",
  typeMetadata: {
    [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
    accountId: "metadata-account",
    scratchDir: "/tmp/rdv/claude-oauth/session-1",
  },
};

function request(body: unknown) {
  return new Request("http://localhost/api/claude-accounts/usage-abort", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(SessionService.getSession).mockReset();
  vi.mocked(SessionService.getSession).mockResolvedValue(session as never);
  abortCapture.mockReset();
  abortCapture.mockResolvedValue(true);
  logMocks.error.mockReset();
});

describe("POST /api/claude-accounts/usage-abort", () => {
  it.each([null, [], {}, { sessionId: "" }, { sessionId: 42 }])(
    "rejects invalid body %j before session lookup",
    async (body) => {
      const response = await POST(request(body));

      expect(response.status).toBe(400);
      expect(SessionService.getSession).not.toHaveBeenCalled();
      expect(abortCapture).not.toHaveBeenCalled();
    }
  );

  it("uses the owner-scoped session lookup", async () => {
    vi.mocked(SessionService.getSession).mockResolvedValue(null);

    const response = await POST(request({ sessionId: "foreign-session" }));

    expect(response.status).toBe(404);
    expect(SessionService.getSession).toHaveBeenCalledWith(
      "foreign-session",
      "user-1"
    );
    expect(abortCapture).not.toHaveBeenCalled();
  });

  it("rejects sessions outside the usage setup flow", async () => {
    vi.mocked(SessionService.getSession).mockResolvedValue({
      ...session,
      typeMetadata: null,
    } as never);

    const response = await POST(request({ sessionId: "session-1" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "NOT_A_USAGE_SETUP_SESSION" });
    expect(abortCapture).not.toHaveBeenCalled();
  });

  it("takes the scratch path only from trusted metadata", async () => {
    const response = await POST(
      request({
        sessionId: "session-1",
        scratchDir: "/Users/victim/.claude",
      })
    );

    expect(response.status).toBe(200);
    expect(abortCapture).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      tmuxSessionName: "rdv-session-1",
      scratchDir: "/tmp/rdv/claude-oauth/session-1",
    });
    await expect(response.json()).resolves.toEqual({ cleanupComplete: true });
  });

  it("reports incomplete best-effort cleanup", async () => {
    abortCapture.mockResolvedValue(false);

    const response = await POST(request({ sessionId: "session-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cleanupComplete: false });
  });

  it("logs safe text and returns a generic failure when cleanup cannot start", async () => {
    abortCapture.mockRejectedValue(new Error("unsafe scratch metadata"));

    const response = await POST(request({ sessionId: "session-1" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "ABORT_FAILED" });
    expect(logMocks.error).toHaveBeenCalledWith(
      "Could not abort Claude usage credential setup",
      { sessionId: "session-1", error: "Error: unsafe scratch metadata" }
    );
  });
});
