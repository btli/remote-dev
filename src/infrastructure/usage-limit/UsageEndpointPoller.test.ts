// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (declared before importing the SUT) ──────────────────────────────

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: { findFirst: vi.fn() },
      agentProfiles: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  claudeAccounts: { profileId: "profile_id" },
  agentProfiles: { id: "id" },
}));

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

vi.mock("@/lib/dynamic-fs", () => ({
  runtimeJoin: (...parts: string[]) => parts.join("/"),
}));

vi.mock("@/infrastructure/external/anthropic-usage-adapter", () => ({
  fetchClaudeUsage: vi.fn(),
}));

const pollEnabled = { value: true };
vi.mock("./poll-config", () => ({
  isUsagePollEnabled: () => pollEnabled.value,
}));

import { db } from "@/db";
import { readFile } from "node:fs/promises";
import { fetchClaudeUsage } from "@/infrastructure/external/anthropic-usage-adapter";
import { UsageEndpointPoller } from "./UsageEndpointPoller";

const claudeAccountsFindFirst = db.query.claudeAccounts.findFirst as ReturnType<
  typeof vi.fn
>;
const agentProfilesFindFirst = db.query.agentProfiles.findFirst as ReturnType<
  typeof vi.fn
>;
const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const fetchUsageMock = fetchClaudeUsage as unknown as ReturnType<typeof vi.fn>;

const OAUTH_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: "oauth-access-token" },
});

beforeEach(() => {
  vi.clearAllMocks();
  pollEnabled.value = true;
});

describe("UsageEndpointPoller.supports", () => {
  it("supports subscription and api_key when the flag is on", () => {
    const poller = new UsageEndpointPoller();
    expect(poller.supports("subscription")).toBe(true);
    expect(poller.supports("api_key")).toBe(true);
  });

  it("supports nothing when the flag is off", () => {
    pollEnabled.value = false;
    const poller = new UsageEndpointPoller();
    expect(poller.supports("subscription")).toBe(false);
    expect(poller.supports("api_key")).toBe(false);
  });
});

describe("UsageEndpointPoller.fetchLimitState", () => {
  it("returns null immediately when the flag is off (no DB/network)", async () => {
    pollEnabled.value = false;
    const poller = new UsageEndpointPoller();

    const result = await poller.fetchLimitState("profile-1");

    expect(result).toBeNull();
    expect(claudeAccountsFindFirst).not.toHaveBeenCalled();
    expect(fetchUsageMock).not.toHaveBeenCalled();
  });

  describe("subscription", () => {
    it("loads the OAuth token, probes, and maps the 5h/7d snapshot", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      agentProfilesFindFirst.mockResolvedValue({ configDir: "/cfg/dir" });
      readFileMock.mockResolvedValue(OAUTH_CREDS);
      const reset5h = new Date("2025-06-13T15:00:00Z");
      fetchUsageMock.mockResolvedValue({
        window5hPct: 80,
        window7dPct: 40,
        resetAt5h: reset5h,
        resetAt7d: null,
        orgPct: null,
        resetAtOrg: null,
      });

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(fetchUsageMock).toHaveBeenCalledWith(
        "oauth-access-token",
        "subscription"
      );
      expect(result).toEqual({
        profileId: "profile-1",
        isLimited: false,
        resetAt5h: reset5h,
        resetAt7d: null,
        window5hPct: 80,
        window7dPct: 40,
        source: "poller",
      });
    });

    it("marks limited when a window is at/over 100%", async () => {
      claudeAccountsFindFirst.mockResolvedValue(undefined); // absent → subscription
      agentProfilesFindFirst.mockResolvedValue({ configDir: "/cfg/dir" });
      readFileMock.mockResolvedValue(OAUTH_CREDS);
      fetchUsageMock.mockResolvedValue({
        window5hPct: 100,
        window7dPct: 50,
        resetAt5h: null,
        resetAt7d: null,
        orgPct: null,
        resetAtOrg: null,
      });

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result?.isLimited).toBe(true);
    });

    it("returns null (no probe) when the credentials file is absent", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      agentProfilesFindFirst.mockResolvedValue({ configDir: "/cfg/dir" });
      readFileMock.mockRejectedValue(new Error("ENOENT"));

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result).toBeNull();
      expect(fetchUsageMock).not.toHaveBeenCalled();
    });

    it("returns null when the adapter reports no snapshot", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      agentProfilesFindFirst.mockResolvedValue({ configDir: "/cfg/dir" });
      readFileMock.mockResolvedValue(OAUTH_CREDS);
      fetchUsageMock.mockResolvedValue(null);

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result).toBeNull();
    });
  });

  describe("api_key", () => {
    it("returns null without probing — the raw key isn't wired in this path", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result).toBeNull();
      // No OAuth file read and no probe for api_key (credential not available).
      expect(agentProfilesFindFirst).not.toHaveBeenCalled();
      expect(fetchUsageMock).not.toHaveBeenCalled();
    });

    it("folds an org-dimension snapshot into the 5h slot when given one", async () => {
      // Drive the mapping directly: an api_key-shaped snapshot (org only) maps
      // its org pct/reset onto the result's 5h slot. (The poller's own api_key
      // credential path is not yet wired, so we exercise the mapping via a
      // subscription-kind probe returning an org-only snapshot.)
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "subscription" });
      agentProfilesFindFirst.mockResolvedValue({ configDir: "/cfg/dir" });
      readFileMock.mockResolvedValue(OAUTH_CREDS);
      const orgReset = new Date("2025-06-13T16:00:00Z");
      fetchUsageMock.mockResolvedValue({
        window5hPct: null,
        window7dPct: null,
        resetAt5h: null,
        resetAt7d: null,
        orgPct: 100,
        resetAtOrg: orgReset,
      });

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result?.window5hPct).toBe(100);
      expect(result?.resetAt5h).toBe(orgReset);
      expect(result?.isLimited).toBe(true);
    });
  });

  it("never throws — a DB error resolves to null", async () => {
    claudeAccountsFindFirst.mockRejectedValue(new Error("db down"));

    const poller = new UsageEndpointPoller();
    await expect(poller.fetchLimitState("profile-1")).resolves.toBeNull();
  });
});
