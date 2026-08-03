// @vitest-environment node
/**
 * Tests for POST /api/claude-accounts/capture — the length floor + invalid-token
 * surfacing added by [remote-dev-307w].
 *
 * The route's provenance/ownership checks are exercised with mocked session +
 * tmux services; `extractSetupToken` / `isLikelyTruncatedToken` run REAL (they
 * are the contract under test) while `saveAccountToken` is mocked so no DB, CLI
 * or network is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/session-service", () => ({
  getSession: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/tmux-service", () => ({
  captureOutput: vi.fn(),
  clearHistory: vi.fn().mockResolvedValue(undefined),
}));
// The service module pulls in the live DB client at import time; neither is
// exercised here (saveAccountToken is mocked below).
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ claudeAccounts: {}, projectProfileLinks: {} }));

const saveAccountTokenMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/claude-account-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/claude-account-service")>();
  return { ...actual, saveAccountToken: saveAccountTokenMock };
});

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import * as TmuxService from "@/services/tmux-service";
import {
  CLAUDE_SETUP_SESSION_MARKER,
  INVALID_TOKEN_MESSAGE,
} from "@/services/claude-account-service";
import { POST } from "./route";

const FULL_TOKEN = `sk-ant-oat01-${"A".repeat(95)}`;
/** What an ~80-col pane leaves of a real token (observed live: 79 chars). */
const CLIPPED_TOKEN = FULL_TOKEN.slice(0, 79);

const SETUP_SESSION = {
  id: "sess-1",
  tmuxSessionName: "rdv-sess-1",
  typeMetadata: { [CLAUDE_SETUP_SESSION_MARKER]: true },
};

function captureRequest(body: Record<string, unknown> = { sessionId: "sess-1" }) {
  return new Request("http://localhost/api/claude-accounts/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue({
    user: { id: "user-1" },
  } as unknown as Awaited<ReturnType<typeof getAuthSession>>);
  vi.mocked(SessionService.getSession).mockResolvedValue(
    SETUP_SESSION as never
  );
  vi.mocked(TmuxService.captureOutput).mockReset();
  saveAccountTokenMock.mockReset();
});

describe("POST /api/claude-accounts/capture — truncation floor [remote-dev-307w]", () => {
  it("rejects a pane-clipped 79-char fragment with TOKEN_TRUNCATED instead of storing it", async () => {
    vi.mocked(TmuxService.captureOutput).mockResolvedValue(
      `$ claude setup-token\nOpening browser…\n${CLIPPED_TOKEN}\n$ `
    );

    const response = await POST(captureRequest());
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("TOKEN_TRUNCATED");
    expect(body.error).toMatch(/truncated/i);
    // Never stored, and the fragment never appears in the response.
    expect(saveAccountTokenMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(CLIPPED_TOKEN);
    // The session stays open for a retry (widen / re-run / paste flow).
    expect(SessionService.closeSession).not.toHaveBeenCalled();
  });

  it("accepts a full-length token and stores it", async () => {
    vi.mocked(TmuxService.captureOutput).mockResolvedValue(`\n${FULL_TOKEN}\n`);
    saveAccountTokenMock.mockResolvedValue({
      account: { id: "acct-1" },
      identity: { loggedIn: true },
      updated: false,
      tokenValid: true,
    });

    const response = await POST(captureRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(saveAccountTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: FULL_TOKEN, userId: "user-1" })
    );
    expect(body.tokenValid).toBe(true);
    expect(body.tokenError).toBeUndefined();
  });

  it("surfaces tokenValid:false + tokenError when Anthropic 401s the captured token", async () => {
    vi.mocked(TmuxService.captureOutput).mockResolvedValue(`\n${FULL_TOKEN}\n`);
    saveAccountTokenMock.mockResolvedValue({
      account: { id: "acct-1" },
      // The CLI probe says loggedIn — the network probe is what caught it.
      identity: { loggedIn: true },
      updated: false,
      tokenValid: false,
    });

    const response = await POST(captureRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.tokenValid).toBe(false);
    expect(body.tokenError).toBe(INVALID_TOKEN_MESSAGE);
  });
});
