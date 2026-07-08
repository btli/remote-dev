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

vi.mock("@/services/agent-profile-service", () => ({
  fetchProfileSecrets: vi.fn(),
}));

const pollEnabled = { value: true };
vi.mock("./poll-config", () => ({
  isUsagePollEnabled: () => pollEnabled.value,
}));

import { db } from "@/db";
import { readFile } from "node:fs/promises";
import { fetchClaudeUsage } from "@/infrastructure/external/anthropic-usage-adapter";
import { fetchProfileSecrets } from "@/services/agent-profile-service";
import { UsageEndpointPoller } from "./UsageEndpointPoller";

const claudeAccountsFindFirst = db.query.claudeAccounts.findFirst as ReturnType<
  typeof vi.fn
>;
const agentProfilesFindFirst = db.query.agentProfiles.findFirst as ReturnType<
  typeof vi.fn
>;
const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const fetchUsageMock = fetchClaudeUsage as unknown as ReturnType<typeof vi.fn>;
const fetchSecretsMock = fetchProfileSecrets as unknown as ReturnType<
  typeof vi.fn
>;

const OAUTH_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: "oauth-access-token" },
});

beforeEach(() => {
  vi.clearAllMocks();
  pollEnabled.value = true;
  delete process.env.ANTHROPIC_API_KEY;
  fetchSecretsMock.mockResolvedValue(null);
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
    it("resolves the profile's encrypted key, probes, and folds the org snapshot into the 5h slot", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });
      fetchSecretsMock.mockResolvedValue({ ANTHROPIC_API_KEY: "sk-ant-profile" });
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

      // The adapter is invoked with the profile key + the api_key kind.
      expect(fetchUsageMock).toHaveBeenCalledWith("sk-ant-profile", "api_key");
      // No OAuth credentials file is read on the api_key path.
      expect(readFileMock).not.toHaveBeenCalled();
      // The org dimension folds onto the 5h slot of the result.
      expect(result?.window5hPct).toBe(100);
      expect(result?.resetAt5h).toBe(orgReset);
      expect(result?.isLimited).toBe(true);
    });

    it("falls back to the ANTHROPIC_API_KEY env var when the profile has no secret", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });
      fetchSecretsMock.mockResolvedValue(null);
      process.env.ANTHROPIC_API_KEY = "sk-ant-env";
      fetchUsageMock.mockResolvedValue({
        window5hPct: null,
        window7dPct: null,
        resetAt5h: null,
        resetAt7d: null,
        orgPct: 20,
        resetAtOrg: null,
      });

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(fetchUsageMock).toHaveBeenCalledWith("sk-ant-env", "api_key");
      expect(result?.window5hPct).toBe(20);
      expect(result?.isLimited).toBe(false);
    });

    it("prefers the profile secret over the env fallback", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });
      fetchSecretsMock.mockResolvedValue({ ANTHROPIC_API_KEY: "sk-ant-profile" });
      process.env.ANTHROPIC_API_KEY = "sk-ant-env";
      fetchUsageMock.mockResolvedValue({
        window5hPct: null,
        window7dPct: null,
        resetAt5h: null,
        resetAt7d: null,
        orgPct: 10,
        resetAtOrg: null,
      });

      const poller = new UsageEndpointPoller();
      await poller.fetchLimitState("profile-1");

      expect(fetchUsageMock).toHaveBeenCalledWith("sk-ant-profile", "api_key");
    });

    it("returns null (no probe) when no key is resolvable", async () => {
      claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });
      fetchSecretsMock.mockResolvedValue(null); // no profile secret, no env var

      const poller = new UsageEndpointPoller();
      const result = await poller.fetchLimitState("profile-1");

      expect(result).toBeNull();
      expect(fetchUsageMock).not.toHaveBeenCalled();
    });

    it("never logs the resolved api key", async () => {
      const consoleSpies = [
        vi.spyOn(console, "log").mockImplementation(() => {}),
        vi.spyOn(console, "info").mockImplementation(() => {}),
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
        vi.spyOn(console, "debug").mockImplementation(() => {}),
      ];
      try {
        claudeAccountsFindFirst.mockResolvedValue({ accountKind: "api_key" });
        fetchSecretsMock.mockResolvedValue({ ANTHROPIC_API_KEY: "sk-ant-secret" });
        fetchUsageMock.mockResolvedValue({
          window5hPct: null,
          window7dPct: null,
          resetAt5h: null,
          resetAt7d: null,
          orgPct: 50,
          resetAtOrg: null,
        });

        const poller = new UsageEndpointPoller();
        await poller.fetchLimitState("profile-1");

        for (const spy of consoleSpies) {
          for (const call of spy.mock.calls) {
            expect(JSON.stringify(call)).not.toContain("sk-ant-secret");
          }
        }
      } finally {
        for (const spy of consoleSpies) spy.mockRestore();
      }
    });
  });

  it("never throws — a DB error resolves to null", async () => {
    claudeAccountsFindFirst.mockRejectedValue(new Error("db down"));

    const poller = new UsageEndpointPoller();
    await expect(poller.fetchLimitState("profile-1")).resolves.toBeNull();
  });
});
