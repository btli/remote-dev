import { describe, it, expect } from "vitest";
import { ClaudeCredentials } from "./ClaudeCredentials";

describe("ClaudeCredentials", () => {
  const validFile = {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-secret",
      refreshToken: "sk-ant-ort01-secret",
      expiresAt: new Date("2026-06-13T12:00:00Z").getTime(),
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
    },
  };

  describe("parse", () => {
    it("parses a valid .credentials.json (string)", () => {
      const creds = ClaudeCredentials.parse(JSON.stringify(validFile));
      expect(creds).not.toBeNull();
      expect(creds?.getSubscriptionType()).toBe("max");
      expect(creds?.getScopes()).toEqual(["user:inference", "user:profile"]);
      expect(creds?.canRefresh()).toBe(true);
      expect(creds?.getExpiresAt()?.toISOString()).toBe(
        "2026-06-13T12:00:00.000Z"
      );
    });

    it("parses an already-parsed object", () => {
      const creds = ClaudeCredentials.parse(validFile);
      expect(creds?.getAccessToken()).toBe("sk-ant-oat01-secret");
    });

    it("returns null for an empty placeholder file ({})", () => {
      expect(ClaudeCredentials.parse("{}")).toBeNull();
      expect(ClaudeCredentials.parse("")).toBeNull();
      expect(ClaudeCredentials.parse("   ")).toBeNull();
    });

    it("returns null for malformed JSON (no throw)", () => {
      expect(ClaudeCredentials.parse("{not json")).toBeNull();
      expect(ClaudeCredentials.parse(null)).toBeNull();
      expect(ClaudeCredentials.parse(undefined)).toBeNull();
    });

    it("returns null when claudeAiOauth has no access token", () => {
      expect(
        ClaudeCredentials.parse({ claudeAiOauth: { refreshToken: "x" } })
      ).toBeNull();
    });

    it("tolerates a missing refresh token / expiry / scopes", () => {
      const creds = ClaudeCredentials.parse({
        claudeAiOauth: { accessToken: "sk-ant-oat01-x" },
      });
      expect(creds).not.toBeNull();
      expect(creds?.canRefresh()).toBe(false);
      expect(creds?.getExpiresAt()).toBeNull();
      expect(creds?.getScopes()).toEqual([]);
      expect(creds?.getSubscriptionType()).toBeNull();
    });
  });

  describe("isExpired", () => {
    const creds = ClaudeCredentials.parse(JSON.stringify(validFile))!;

    it("is not expired well before expiry", () => {
      expect(creds.isExpired(new Date("2026-06-13T10:00:00Z"))).toBe(false);
    });

    it("is expired at/after expiry", () => {
      expect(creds.isExpired(new Date("2026-06-13T12:00:01Z"))).toBe(true);
    });

    it("is expired within the default skew window (5m)", () => {
      // 2 minutes before expiry → inside the 5m skew → treated as expired.
      expect(creds.isExpired(new Date("2026-06-13T11:58:00Z"))).toBe(true);
    });

    it("treats unknown expiry as NOT expired", () => {
      const noExp = ClaudeCredentials.parse({
        claudeAiOauth: { accessToken: "sk-ant-oat01-x" },
      })!;
      expect(noExp.isExpired(new Date("2099-01-01T00:00:00Z"))).toBe(false);
    });
  });

  describe("redacted", () => {
    it("never leaks tokens", () => {
      const creds = ClaudeCredentials.parse(JSON.stringify(validFile))!;
      const red = creds.redacted();
      const serialized = JSON.stringify(red);
      expect(serialized).not.toContain("sk-ant-oat01-secret");
      expect(serialized).not.toContain("sk-ant-ort01-secret");
      expect(red.hasAccessToken).toBe(true);
      expect(red.hasRefreshToken).toBe(true);
      expect(red.subscriptionType).toBe("max");
      expect(red.expiresAt).toBe(
        new Date("2026-06-13T12:00:00Z").getTime()
      );
    });
  });

  describe("msUntilExpiry", () => {
    const creds = ClaudeCredentials.parse(JSON.stringify(validFile))!;
    it("returns positive ms before expiry", () => {
      const ms = creds.msUntilExpiry(new Date("2026-06-13T11:00:00Z"));
      expect(ms).toBe(60 * 60 * 1000);
    });
    it("returns 0 once expired", () => {
      expect(creds.msUntilExpiry(new Date("2026-06-13T13:00:00Z"))).toBe(0);
    });
    it("returns null when expiry unknown", () => {
      const noExp = ClaudeCredentials.parse({
        claudeAiOauth: { accessToken: "x" },
      })!;
      expect(noExp.msUntilExpiry(new Date())).toBeNull();
    });
  });

  describe("equals", () => {
    it("is value-equal for identical inputs", () => {
      const a = ClaudeCredentials.parse(JSON.stringify(validFile))!;
      const b = ClaudeCredentials.parse(JSON.stringify(validFile))!;
      expect(a.equals(b)).toBe(true);
    });
    it("differs when tier changes", () => {
      const a = ClaudeCredentials.parse(JSON.stringify(validFile))!;
      const b = ClaudeCredentials.parse({
        claudeAiOauth: { ...validFile.claudeAiOauth, subscriptionType: "pro" },
      })!;
      expect(a.equals(b)).toBe(false);
    });
  });
});
