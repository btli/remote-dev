// @vitest-environment node
/**
 * Tests for POST /api/claude-accounts (paste-a-token fallback) — the length
 * floor + invalid-token surfacing added by [remote-dev-307w].
 *
 * `looksLikeOAuthToken` / `isLikelyTruncatedToken` run REAL (they are the
 * contract under test); `saveAccountToken` is mocked so no DB, CLI or network
 * is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
// The service module pulls in the live DB client at import time; neither is
// exercised here (saveAccountToken is mocked below).
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ claudeAccounts: {}, projectProfileLinks: {} }));

const saveAccountTokenMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/claude-account-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/claude-account-service")>();
  return {
    ...actual,
    saveAccountToken: saveAccountTokenMock,
    listAccounts: vi.fn().mockResolvedValue([]),
  };
});

import { getAuthSession } from "@/lib/auth-utils";
import { INVALID_TOKEN_MESSAGE } from "@/services/claude-account-service";
import { POST } from "./route";

const FULL_TOKEN = `sk-ant-oat01-${"A".repeat(95)}`;
/** A pattern-valid but partial paste (same 79-char shape the pane clip left). */
const CLIPPED_TOKEN = FULL_TOKEN.slice(0, 79);

function pasteRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/claude-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue({
    user: { id: "user-1" },
  } as unknown as Awaited<ReturnType<typeof getAuthSession>>);
  saveAccountTokenMock.mockReset();
});

describe("POST /api/claude-accounts — paste path length floor [remote-dev-307w]", () => {
  it("rejects a pattern-valid but truncated token with TOKEN_TRUNCATED", async () => {
    const response = await POST(pasteRequest({ token: CLIPPED_TOKEN }));
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("TOKEN_TRUNCATED");
    expect(body.error).toMatch(/truncated/i);
    expect(saveAccountTokenMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(CLIPPED_TOKEN);
  });

  it("still rejects non-token pastes with INVALID_TOKEN_FORMAT (pattern before length)", async () => {
    const response = await POST(
      pasteRequest({ token: "sk-ant-api03-not-an-oauth-token" })
    );
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_TOKEN_FORMAT");
    expect(saveAccountTokenMock).not.toHaveBeenCalled();
  });

  it("stores a full-length token and reports tokenValid:true", async () => {
    saveAccountTokenMock.mockResolvedValue({
      account: { id: "acct-1" },
      identity: { loggedIn: true },
      updated: false,
      tokenValid: true,
    });

    const response = await POST(pasteRequest({ token: FULL_TOKEN }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(saveAccountTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: FULL_TOKEN, userId: "user-1" })
    );
    expect(body.tokenValid).toBe(true);
    expect(body.tokenError).toBeUndefined();
  });

  it("surfaces tokenValid:false + tokenError when Anthropic 401s the pasted token", async () => {
    saveAccountTokenMock.mockResolvedValue({
      account: { id: "acct-1" },
      identity: { loggedIn: true },
      updated: false,
      tokenValid: false,
    });

    const response = await POST(pasteRequest({ token: FULL_TOKEN }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.tokenValid).toBe(false);
    expect(body.tokenError).toBe(INVALID_TOKEN_MESSAGE);
  });
});
