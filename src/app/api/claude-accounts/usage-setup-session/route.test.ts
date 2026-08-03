// @vitest-environment node
/**
 * Usage setup route tests. Session, tmux, filesystem preparation, auth, and DB
 * ownership are mocked so this suite cannot launch a real shell or Claude CLI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/session-service", () => ({
  createSession: vi.fn(),
  updateSession: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/tmux-service", () => ({ sendKeys: vi.fn() }));
vi.mock("@/services/claude-account-service", () => ({
  CLAUDE_USAGE_SETUP_SESSION_MARKER: "rdvClaudeUsageSetupSession",
  getAccount: vi.fn(),
}));
vi.mock("@/services/claude-usage-credential-service", () => ({
  prepareUsageCredentialScratch: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  getAccount,
} from "@/services/claude-account-service";
import { prepareUsageCredentialScratch } from "@/services/claude-usage-credential-service";
import { POST } from "./route";

const session = {
  id: "actual-session-id",
  tmuxSessionName: "rdv-actual-session-id",
};
const scratchDir = "/tmp/rdv/claude-oauth/actual-session-id";
const command =
  `CLAUDE_CONFIG_DIR='${scratchDir}' CLAUDE_CODE_OAUTH_TOKEN='' ` +
  "ANTHROPIC_API_KEY='' ANTHROPIC_AUTH_TOKEN='' claude auth login";

function request(body: Record<string, unknown>) {
  return new Request(
    "http://localhost/api/claude-accounts/usage-setup-session",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(getAccount).mockReset();
  vi.mocked(getAccount).mockResolvedValue({
    id: "account-1",
    emailAddress: "target@example.com",
  } as never);
  vi.mocked(SessionService.createSession).mockReset();
  vi.mocked(SessionService.createSession).mockResolvedValue(session as never);
  vi.mocked(SessionService.updateSession).mockReset();
  vi.mocked(SessionService.updateSession).mockResolvedValue(session as never);
  vi.mocked(SessionService.closeSession).mockReset();
  vi.mocked(SessionService.closeSession).mockResolvedValue(undefined);
  vi.mocked(prepareUsageCredentialScratch).mockReset();
  vi.mocked(prepareUsageCredentialScratch).mockResolvedValue({
    scratchDir,
    command,
  });
  vi.mocked(TmuxService.sendKeys).mockReset();
  vi.mocked(TmuxService.sendKeys).mockResolvedValue(undefined);
});

describe("POST /api/claude-accounts/usage-setup-session", () => {
  it.each([
    [{ accountId: "account-1" }, /projectId/i],
    [{ projectId: "", accountId: "account-1" }, /projectId/i],
    [{ projectId: 42, accountId: "account-1" }, /projectId/i],
    [{ projectId: "project-1" }, /accountId/i],
    [{ projectId: "project-1", accountId: "" }, /accountId/i],
    [{ projectId: "project-1", accountId: {} }, /accountId/i],
  ])("validates body %j before side effects", async (body, message) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: message });
    expect(getAccount).not.toHaveBeenCalled();
    expect(SessionService.createSession).not.toHaveBeenCalled();
    expect(prepareUsageCredentialScratch).not.toHaveBeenCalled();
  });

  it("404s a missing or foreign account before creating a session", async () => {
    vi.mocked(getAccount).mockResolvedValue(null);

    const response = await POST(
      request({ projectId: "project-1", accountId: "foreign-account" })
    );

    expect(response.status).toBe(404);
    expect(getAccount).toHaveBeenCalledWith("foreign-account", "user-1");
    expect(SessionService.createSession).not.toHaveBeenCalled();
  });

  it("creates the required shell session then stamps scratch metadata from its actual id", async () => {
    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(201);
    expect(SessionService.createSession).toHaveBeenCalledWith("user-1", {
      name: "Enable Claude usage tracking",
      projectId: "project-1",
      terminalType: "shell",
      autoLaunchAgent: false,
      initialCols: 220,
      initialRows: 50,
      typeMetadata: {
        [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
        accountId: "account-1",
      },
    });
    expect(prepareUsageCredentialScratch).toHaveBeenCalledWith(
      "actual-session-id"
    );
    expect(SessionService.updateSession).toHaveBeenCalledWith(
      "actual-session-id",
      "user-1",
      { typeMetadataPatch: { scratchDir } }
    );
    expect(TmuxService.sendKeys).toHaveBeenCalledWith(
      "rdv-actual-session-id",
      command
    );
  });

  it("returns exactly the safe command handoff and complete instructions", async () => {
    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body).toEqual({
      sessionId: "actual-session-id",
      command,
      commandSent: true,
      instructions: expect.any(Array),
    });
    const prose = (body.instructions as string[]).join(" ");
    expect(prose).toMatch(/browser sign-in/i);
    expect(prose).toMatch(/URL/i);
    expect(prose).toMatch(/paste.*code/i);
    expect(prose).toMatch(/Finish/i);
    expect(prose).not.toContain("—");
  });

  it("keeps the prepared session available when automatic command sending fails", async () => {
    vi.mocked(TmuxService.sendKeys).mockRejectedValue(new Error("tmux down"));

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      command,
      commandSent: false,
    });
    expect(SessionService.closeSession).not.toHaveBeenCalled();
  });

  it.each(["prepare", "metadata"] as const)(
    "best-effort closes the created session when %s fails",
    async (failure) => {
      if (failure === "prepare") {
        vi.mocked(prepareUsageCredentialScratch).mockRejectedValue(
          new Error("mkdir failed")
        );
      } else {
        vi.mocked(SessionService.updateSession).mockRejectedValue(
          new Error("DB failed")
        );
      }

      const response = await POST(
        request({ projectId: "project-1", accountId: "account-1" })
      );

      expect(response.status).toBe(500);
      expect(SessionService.closeSession).toHaveBeenCalledWith(
        "actual-session-id",
        "user-1"
      );
      expect(TmuxService.sendKeys).not.toHaveBeenCalled();
    }
  );

  it("still surfaces preparation failure when best-effort session close also fails", async () => {
    vi.mocked(prepareUsageCredentialScratch).mockRejectedValue(
      new Error("mkdir failed")
    );
    vi.mocked(SessionService.closeSession).mockRejectedValue(
      new Error("close failed")
    );

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(500);
    expect(TmuxService.sendKeys).not.toHaveBeenCalled();
  });
});
