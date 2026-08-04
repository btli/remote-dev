// @vitest-environment node
/**
 * Public session API regressions for the server-owned usage OAuth binding.
 * Generic authenticated callers may still own ordinary plugin metadata, but
 * cannot forge the usage marker or rewrite its account/scratch authority.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/services/api-key-service", () => ({
  validateApiKey: vi.fn(),
  touchApiKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api-validation", () => ({
  validateProjectPath: (value: string | undefined) => value,
}));
vi.mock("@/lib/broadcast", () => ({ broadcastSidebarChanged: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/services/session-service", () => {
  class SessionServiceError extends Error {
    constructor(
      message: string,
      readonly code: string
    ) {
      super(message);
    }
  }
  return {
    SessionServiceError,
    createSessionWithDedupFlag: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
  };
});
vi.mock("@/services/worktree-service", () => ({}));
vi.mock("@/services/github-service", () => ({}));
vi.mock("@/services/trash-service", () => ({}));
vi.mock("@/services/schedule-service", () => ({}));
vi.mock("@/lib/scheduler-client", () => ({ notifySessionJobsRemoved: vi.fn() }));
vi.mock("@/services/preferences-service", () => ({
  getFolderPreferences: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import { CLAUDE_USAGE_SETUP_SESSION_MARKER } from "@/services/claude-account-service";
import { POST } from "./route";
import { PATCH } from "./[id]/route";

function postRequest(typeMetadata: Record<string, unknown>) {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "project-1", typeMetadata }),
  });
}

function patchRequest(typeMetadataPatch: Record<string, unknown>) {
  return new Request("http://localhost/api/sessions/session-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeMetadataPatch }),
  });
}

function patch(request: Request) {
  return PATCH(request, { params: Promise.resolve({ id: "session-1" }) });
}

const ordinarySession = {
  id: "session-1",
  typeMetadata: { pluginOwned: true },
};

const usageSession = {
  id: "session-1",
  typeMetadata: {
    [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true,
    accountId: "account-1",
    scratchDir: "/tmp/rdv/claude-oauth/session-1",
  },
};

beforeEach(() => {
  vi.mocked(getAuthSession).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(SessionService.createSessionWithDedupFlag).mockReset();
  vi.mocked(SessionService.createSessionWithDedupFlag).mockResolvedValue({
    session: { id: "new-session" },
    reused: false,
  } as never);
  vi.mocked(SessionService.getSession).mockReset();
  vi.mocked(SessionService.getSession).mockResolvedValue(
    ordinarySession as never
  );
  vi.mocked(SessionService.updateSession).mockReset();
  vi.mocked(SessionService.updateSession).mockResolvedValue(
    ordinarySession as never
  );
});

describe("generic session usage metadata authority", () => {
  it.each([true, false, null])(
    "rejects generic creation carrying the usage marker value %j",
    async (markerValue) => {
      const response = await POST(
        postRequest({
          [CLAUDE_USAGE_SETUP_SESSION_MARKER]: markerValue,
          accountId: "forged-account",
          scratchDir: "/Users/victim/.claude",
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "PROTECTED_SESSION_METADATA",
      });
      expect(
        SessionService.createSessionWithDedupFlag
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects every public mutation of the usage marker", async () => {
    const response = await patch(
      patchRequest({ [CLAUDE_USAGE_SETUP_SESSION_MARKER]: true })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROTECTED_SESSION_METADATA",
    });
    expect(SessionService.getSession).not.toHaveBeenCalled();
    expect(SessionService.updateSession).not.toHaveBeenCalled();
  });

  it.each(["accountId", "scratchDir"] as const)(
    "rejects public %s mutation on a durable marked usage session",
    async (key) => {
      vi.mocked(SessionService.getSession).mockResolvedValue(
        usageSession as never
      );

      const response = await patch(patchRequest({ [key]: "forged" }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "PROTECTED_SESSION_METADATA",
      });
      expect(SessionService.getSession).toHaveBeenCalledWith(
        "session-1",
        "user-1"
      );
      expect(SessionService.updateSession).not.toHaveBeenCalled();
    }
  );

  it("continues to allow accountId/scratchDir metadata for ordinary sessions", async () => {
    const response = await patch(
      patchRequest({ accountId: "plugin-account", scratchDir: "plugin-path" })
    );

    expect(response.status).toBe(200);
    expect(SessionService.updateSession).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      {
        typeMetadataPatch: {
          accountId: "plugin-account",
          scratchDir: "plugin-path",
        },
      }
    );
  });

  it("allows unrelated plugin metadata on a marked usage session", async () => {
    vi.mocked(SessionService.getSession).mockResolvedValue(
      usageSession as never
    );

    const response = await patch(
      patchRequest({ selectedIssueNumber: 42 })
    );

    expect(response.status).toBe(200);
    expect(SessionService.updateSession).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      { typeMetadataPatch: { selectedIssueNumber: 42 } }
    );
  });
});
