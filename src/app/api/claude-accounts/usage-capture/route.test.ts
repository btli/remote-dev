// @vitest-environment node
/**
 * Usage capture route tests. The session metadata is the sole account/scratch
 * authority; all credential, account, CLI, network, tmux, and filesystem work
 * is mocked behind the orchestration service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageMocks = vi.hoisted(() => {
  class CaptureError extends Error {
    readonly name = "UsageCredentialCaptureError";
    constructor(
      readonly code:
        | "CREDENTIALS_NOT_READY"
        | "MISSING_SCOPE"
        | "ACCOUNT_MISMATCH",
      message: string
    ) {
      super(message);
    }
  }
  return { capture: vi.fn(), CaptureError };
});

vi.mock("@/lib/auth-utils", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/session-service", () => ({ getSession: vi.fn() }));
vi.mock("@/services/claude-account-service", () => ({
  CLAUDE_USAGE_SETUP_SESSION_MARKER: "rdvClaudeUsageSetupSession",
  getAccount: vi.fn(),
}));
vi.mock("@/services/claude-usage-credential-service", () => ({
  captureUsageCredential: usageMocks.capture,
  UsageCredentialCaptureError: usageMocks.CaptureError,
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import {
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  getAccount,
} from "@/services/claude-account-service";
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

const account = {
  id: "metadata-account",
  emailAddress: "target@example.com",
  usageCredential: false,
};

const savedAccount = { ...account, usageCredential: true };

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/claude-accounts/usage-capture", {
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
  vi.mocked(getAccount).mockReset();
  vi.mocked(getAccount).mockResolvedValue(account as never);
  usageMocks.capture.mockReset();
  usageMocks.capture.mockResolvedValue({
    account: savedAccount,
    usageValidated: true,
  });
});

describe("POST /api/claude-accounts/usage-capture", () => {
  it.each([
    [{}, /sessionId/i],
    [{ sessionId: "" }, /sessionId/i],
    [{ sessionId: "   " }, /sessionId/i],
    [{ sessionId: 42 }, /sessionId/i],
  ])("validates body %j before any session lookup", async (body, message) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: message });
    expect(SessionService.getSession).not.toHaveBeenCalled();
    expect(usageMocks.capture).not.toHaveBeenCalled();
  });

  it("uses the owner-scoped session lookup and 404s missing/foreign sessions", async () => {
    vi.mocked(SessionService.getSession).mockResolvedValue(null);

    const response = await POST(request({ sessionId: "foreign-session" }));

    expect(response.status).toBe(404);
    expect(SessionService.getSession).toHaveBeenCalledWith(
      "foreign-session",
      "user-1"
    );
    expect(getAccount).not.toHaveBeenCalled();
    expect(usageMocks.capture).not.toHaveBeenCalled();
  });

  it("rejects a session without the exact usage-flow marker", async () => {
    vi.mocked(SessionService.getSession).mockResolvedValue({
      ...session,
      typeMetadata: { ...session.typeMetadata, [CLAUDE_USAGE_SETUP_SESSION_MARKER]: false },
    } as never);

    const response = await POST(request({ sessionId: "session-1" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.code).toBe("NOT_A_USAGE_SETUP_SESSION");
    expect(getAccount).not.toHaveBeenCalled();
    expect(usageMocks.capture).not.toHaveBeenCalled();
  });

  it.each([
    [{ scratchDir: session.typeMetadata.scratchDir }, "accountId"],
    [{ accountId: "metadata-account" }, "scratchDir"],
    [
      { accountId: "", scratchDir: session.typeMetadata.scratchDir },
      "accountId",
    ],
    [{ accountId: "metadata-account", scratchDir: " " }, "scratchDir"],
  ])(
    "rejects malformed trusted metadata missing %s",
    async (metadata, _missingField) => {
      vi.mocked(SessionService.getSession).mockResolvedValue({
        ...session,
        typeMetadata: {
          [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
          ...metadata,
        },
      } as never);

      const response = await POST(request({ sessionId: "session-1" }));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body.code).toBe("INVALID_USAGE_SETUP_SESSION");
      expect(getAccount).not.toHaveBeenCalled();
      expect(usageMocks.capture).not.toHaveBeenCalled();
    }
  );

  it("re-checks account ownership from metadata before capture", async () => {
    vi.mocked(getAccount).mockResolvedValue(null);

    const response = await POST(request({ sessionId: "session-1" }));

    expect(response.status).toBe(404);
    expect(getAccount).toHaveBeenCalledWith("metadata-account", "user-1");
    expect(usageMocks.capture).not.toHaveBeenCalled();
  });

  it("ignores caller-supplied account/scratch authority and forwards only trusted metadata", async () => {
    const response = await POST(
      request({
        sessionId: "session-1",
        accountId: "attacker-account",
        scratchDir: "/Users/victim/.claude",
        targetEmail: "attacker@example.com",
      })
    );

    expect(response.status).toBe(200);
    expect(usageMocks.capture).toHaveBeenCalledWith({
      userId: "user-1",
      accountId: "metadata-account",
      targetEmail: "target@example.com",
      sessionId: "session-1",
      tmuxSessionName: "rdv-session-1",
      scratchDir: "/tmp/rdv/claude-oauth/session-1",
    });
    const forwarded = usageMocks.capture.mock.calls[0][0];
    expect(JSON.stringify(forwarded)).not.toContain("attacker");
    expect(JSON.stringify(forwarded)).not.toContain("/Users/victim/.claude");
  });

  it.each([
    [
      "CREDENTIALS_NOT_READY",
      /finish.*sign-in.*try again/i,
    ],
    ["MISSING_SCOPE", /user:profile.*sign in again/i],
    ["ACCOUNT_MISMATCH", /different Claude account.*this row/i],
  ] as const)("maps %s to an actionable 409", async (code, message) => {
    usageMocks.capture.mockRejectedValue(
      new usageMocks.CaptureError(code, "internal safe classification")
    );

    const response = await POST(request({ sessionId: "session-1" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body.code).toBe(code);
    expect(body.error).toEqual(expect.stringMatching(message));
  });

  it("maps environmental failures to a token-free CAPTURE_FAILED response", async () => {
    const secret = "captured-access-token-must-not-leak";
    usageMocks.capture.mockRejectedValue(new Error(`failure ${secret}`));

    const response = await POST(request({ sessionId: "session-1" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "CAPTURE_FAILED" });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("404s when account ownership vanishes during the owner-scoped store", async () => {
    usageMocks.capture.mockResolvedValue({
      account: null,
      usageValidated: false,
    });

    const response = await POST(request({ sessionId: "session-1" }));

    expect(response.status).toBe(404);
  });

  it("returns exactly the token-free account projection and validation flag", async () => {
    const response = await POST(request({ sessionId: "session-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ account: savedAccount, usageValidated: true });
    expect(JSON.stringify(body)).not.toMatch(/accessToken|refreshToken|scopes/i);
  });
});
