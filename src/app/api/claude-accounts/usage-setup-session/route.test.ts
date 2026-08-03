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
  listSessions: vi.fn(),
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
  removeUsageCredentialScratch: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  getAccount,
} from "@/services/claude-account-service";
import {
  prepareUsageCredentialScratch,
  removeUsageCredentialScratch,
} from "@/services/claude-usage-credential-service";
import { POST } from "./route";

const session = {
  id: "actual-session-id",
  tmuxSessionName: "rdv-actual-session-id",
};
const scratchDir = "/tmp/rdv/claude-oauth/actual-session-id";
const command =
  `CLAUDE_CONFIG_DIR='${scratchDir}' CLAUDE_CODE_OAUTH_TOKEN='' ` +
  "ANTHROPIC_API_KEY='' ANTHROPIC_AUTH_TOKEN='' claude auth login";

function request(body: unknown) {
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
    accountKind: "subscription",
  } as never);
  vi.mocked(SessionService.listSessions).mockReset();
  vi.mocked(SessionService.listSessions).mockResolvedValue([]);
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
  vi.mocked(removeUsageCredentialScratch).mockReset();
  vi.mocked(removeUsageCredentialScratch).mockResolvedValue(undefined);
  vi.mocked(TmuxService.sendKeys).mockReset();
  vi.mocked(TmuxService.sendKeys).mockResolvedValue(undefined);
});

describe("POST /api/claude-accounts/usage-setup-session", () => {
  it.each([
    [null, /JSON object/i],
    [[], /JSON object/i],
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
      recovered: false,
      instructions: expect.any(Array),
    });
    const prose = (body.instructions as string[]).join(" ");
    expect(prose).toMatch(/browser sign-in/i);
    expect(prose).toMatch(/URL/i);
    expect(prose).toMatch(/paste.*code/i);
    expect(prose).toMatch(/Finish/i);
    expect(prose).not.toContain("—");
  });

  it("rejects api_key accounts before session or filesystem effects", async () => {
    vi.mocked(getAccount).mockResolvedValue({
      id: "account-1",
      accountKind: "api_key",
    } as never);

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "USAGE_TRACKING_UNSUPPORTED_ACCOUNT_KIND",
    });
    expect(SessionService.listSessions).not.toHaveBeenCalled();
    expect(SessionService.createSession).not.toHaveBeenCalled();
    expect(prepareUsageCredentialScratch).not.toHaveBeenCalled();
  });

  it("returns an existing open account-matched setup session", async () => {
    vi.mocked(SessionService.listSessions).mockResolvedValue([
      {
        id: "existing-session",
        tmuxSessionName: "rdv-existing-session",
        status: "active",
        typeMetadata: {
          [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
          accountId: "account-1",
          scratchDir: "/tmp/rdv/claude-oauth/existing-session",
        },
      },
    ] as never);

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "existing-session",
      command: null,
      commandSent: null,
      recovered: true,
      instructions: expect.any(Array),
    });
    expect(SessionService.createSession).not.toHaveBeenCalled();
    expect(prepareUsageCredentialScratch).not.toHaveBeenCalled();
    expect(TmuxService.sendKeys).not.toHaveBeenCalled();
  });

  it("coalesces concurrent setup requests for the same owner and account", async () => {
    let resolveCreate!: (value: typeof session) => void;
    vi.mocked(SessionService.createSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: typeof session) => void;
        }) as never
    );

    const first = POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );
    await vi.waitFor(() =>
      expect(SessionService.createSession).toHaveBeenCalledTimes(1)
    );
    const second = POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );
    await Promise.resolve();
    expect(SessionService.createSession).toHaveBeenCalledTimes(1);

    resolveCreate(session);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(SessionService.createSession).toHaveBeenCalledTimes(1);
    expect(prepareUsageCredentialScratch).toHaveBeenCalledTimes(1);
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

  it("best-effort closes the created session when scratch preparation fails", async () => {
    vi.mocked(prepareUsageCredentialScratch).mockRejectedValue(
      new Error("mkdir failed")
    );

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(500);
    expect(removeUsageCredentialScratch).not.toHaveBeenCalled();
    expect(SessionService.closeSession).toHaveBeenCalledWith(
      "actual-session-id",
      "user-1"
    );
    expect(TmuxService.sendKeys).not.toHaveBeenCalled();
  });

  it("removes the prepared scratch directory before closing after metadata update failure", async () => {
    vi.mocked(SessionService.updateSession).mockRejectedValue(
      new Error("DB failed")
    );

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(500);
    expect(removeUsageCredentialScratch).toHaveBeenCalledWith(scratchDir);
    expect(
      vi.mocked(removeUsageCredentialScratch).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(SessionService.closeSession).mock.invocationCallOrder[0]
    );
    expect(SessionService.closeSession).toHaveBeenCalledWith(
      "actual-session-id",
      "user-1"
    );
    expect(TmuxService.sendKeys).not.toHaveBeenCalled();
  });

  it("still closes the session when metadata-failure scratch removal also fails", async () => {
    vi.mocked(SessionService.updateSession).mockRejectedValue(
      new Error("DB failed")
    );
    vi.mocked(removeUsageCredentialScratch).mockRejectedValue(
      new Error("rm failed")
    );

    const response = await POST(
      request({ projectId: "project-1", accountId: "account-1" })
    );

    expect(response.status).toBe(500);
    expect(SessionService.closeSession).toHaveBeenCalledWith(
      "actual-session-id",
      "user-1"
    );
  });

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
