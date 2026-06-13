import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capture insert/upsert calls so we can assert the persisted display fields.
const insertCalls: Array<Record<string, unknown>> = [];
const upsertSetCalls: Array<Record<string, unknown>> = [];

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: (vals: Record<string, unknown>) => {
        insertCalls.push(vals);
        return {
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            upsertSetCalls.push(set);
            return Promise.resolve();
          },
        };
      },
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  claudeAccounts: { profileId: "profile_id" },
}));

const getProfileMock = vi.fn();
vi.mock("@/services/agent-profile-service", () => ({
  getProfile: (...args: unknown[]) => getProfileMock(...args),
}));

import { db } from "@/db";
import * as ClaudeLoginService from "./claude-login-service";

const USER = "user-1";
const PROFILE = "profile-1";

let tmpRoot: string;

/** Write the profile's `.credentials.json` + `.claude.json` under a temp dir. */
async function seedProfileFiles(
  configDir: string,
  opts: {
    creds?: unknown;
    oauthAccount?: { emailAddress?: string; organizationName?: string };
  }
): Promise<void> {
  const claudeDir = join(configDir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  if (opts.creds !== undefined) {
    await writeFile(
      join(claudeDir, ".credentials.json"),
      typeof opts.creds === "string" ? opts.creds : JSON.stringify(opts.creds)
    );
  }
  if (opts.oauthAccount) {
    await writeFile(
      join(claudeDir, ".claude.json"),
      JSON.stringify({ oauthAccount: opts.oauthAccount })
    );
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  upsertSetCalls.length = 0;
  tmpRoot = await mkdtemp(join(tmpdir(), "claude-login-test-"));
  (db.query.claudeAccounts.findFirst as Mock).mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("claude-login-service", () => {
  describe("buildLoginEnv (env construction)", () => {
    it("points CLAUDE_CONFIG_DIR at <configDir>/.claude and neutralizes API keys", () => {
      const env = ClaudeLoginService.buildLoginEnv("/profiles/p1");
      expect(env.CLAUDE_CONFIG_DIR).toBe("/profiles/p1/.claude");
      // API-key precedence must not hijack the subscription OAuth login.
      expect(env.ANTHROPIC_API_KEY).toBe("");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("");
    });

    it("derives credential + config paths under the .claude dir", () => {
      expect(ClaudeLoginService.credentialsPathFor("/p")).toBe(
        "/p/.claude/.credentials.json"
      );
      expect(ClaudeLoginService.claudeJsonPathFor("/p")).toBe(
        "/p/.claude/.claude.json"
      );
    });
  });

  describe("prepareFileBasedLogin", () => {
    it("seeds a placeholder credentials file so macOS uses file-based creds", async () => {
      const configDir = join(tmpRoot, "p1");
      const path = await ClaudeLoginService.prepareFileBasedLogin(configDir);
      const contents = await readFile(path, "utf-8");
      expect(contents.trim()).toBe("{}");
    });

    it("does not overwrite an existing credentials file", async () => {
      const configDir = join(tmpRoot, "p1");
      await seedProfileFiles(configDir, {
        creds: { claudeAiOauth: { accessToken: "sk-ant-oat01-keep" } },
      });
      await ClaudeLoginService.prepareFileBasedLogin(configDir);
      const contents = await readFile(
        ClaudeLoginService.credentialsPathFor(configDir),
        "utf-8"
      );
      expect(contents).toContain("sk-ant-oat01-keep");
    });
  });

  describe("syncAccountFromCredentials (creds-file parse → account upsert)", () => {
    it("upserts email/tier/kind=subscription/credentialMode=file and never persists a token", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      await seedProfileFiles(configDir, {
        creds: {
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-SECRET",
            refreshToken: "sk-ant-ort01-SECRET",
            expiresAt: new Date("2099-01-01T00:00:00Z").getTime(),
            subscriptionType: "max",
          },
        },
        oauthAccount: {
          emailAddress: "dev@example.com",
          organizationName: "Acme",
        },
      });

      const status = await ClaudeLoginService.syncAccountFromCredentials(
        PROFILE,
        USER
      );

      expect(status.loggedIn).toBe(true);
      expect(status.email).toBe("dev@example.com");
      expect(status.organizationName).toBe("Acme");
      expect(status.tier).toBe("max");
      expect(status.credentialMode).toBe("file");
      expect(status.expired).toBe(false);

      // The persisted values carry display fields only — NO token.
      const persisted = JSON.stringify([insertCalls, upsertSetCalls]);
      expect(persisted).not.toContain("sk-ant-oat01-SECRET");
      expect(persisted).not.toContain("sk-ant-ort01-SECRET");
      expect(insertCalls[0]).toMatchObject({
        profileId: PROFILE,
        userId: USER,
        accountKind: "subscription",
        credentialMode: "file",
        emailAddress: "dev@example.com",
        rateLimitTier: "max",
      });
    });

    it("returns loggedIn:false and does NOT upsert when only a placeholder file exists", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      await seedProfileFiles(configDir, { creds: "{}" });

      const status = await ClaudeLoginService.syncAccountFromCredentials(
        PROFILE,
        USER
      );
      expect(status.loggedIn).toBe(false);
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects a non-Claude profile", async () => {
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "codex",
        configDir: join(tmpRoot, "p1"),
      });
      await expect(
        ClaudeLoginService.syncAccountFromCredentials(PROFILE, USER)
      ).rejects.toThrow("not Claude-capable");
    });

    it("throws when the profile is missing", async () => {
      getProfileMock.mockResolvedValue(null);
      await expect(
        ClaudeLoginService.syncAccountFromCredentials(PROFILE, USER)
      ).rejects.toThrow("Profile not found");
    });
  });

  describe("getAuthStatus (expiry detection)", () => {
    it("flags needsRelogin when expired AND no refresh token", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      await seedProfileFiles(configDir, {
        creds: {
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-x",
            // no refreshToken → not refreshable
            expiresAt: new Date("2020-01-01T00:00:00Z").getTime(), // past
            subscriptionType: "pro",
          },
        },
      });

      const status = await ClaudeLoginService.getAuthStatus(PROFILE, USER);
      expect(status.loggedIn).toBe(true);
      expect(status.expired).toBe(true);
      expect(status.needsRelogin).toBe(true);
    });

    it("does NOT need relogin when expired but refreshable", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      await seedProfileFiles(configDir, {
        creds: {
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-x",
            refreshToken: "sk-ant-ort01-x", // refreshable
            expiresAt: new Date("2020-01-01T00:00:00Z").getTime(), // past
          },
        },
      });

      const status = await ClaudeLoginService.getAuthStatus(PROFILE, USER);
      expect(status.expired).toBe(true);
      expect(status.needsRelogin).toBe(false);
    });

    it("reports loggedIn:false when no credentials file exists", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      // no files seeded
      const status = await ClaudeLoginService.getAuthStatus(PROFILE, USER);
      expect(status.loggedIn).toBe(false);
      expect(status.needsRelogin).toBe(false);
    });
  });

  describe("initiateLogin", () => {
    it("returns the command + env + steps and seeds the file-based path", async () => {
      const configDir = join(tmpRoot, "p1");
      getProfileMock.mockResolvedValue({
        id: PROFILE,
        provider: "claude",
        configDir,
      });
      const initiation = await ClaudeLoginService.initiateLogin(PROFILE, USER);
      expect(initiation.command).toBe(ClaudeLoginService.CLAUDE_LOGIN_COMMAND);
      expect(initiation.configDir).toBe(join(configDir, ".claude"));
      expect(initiation.env.CLAUDE_CONFIG_DIR).toBe(join(configDir, ".claude"));
      expect(initiation.instructions.length).toBeGreaterThan(0);
      // The placeholder file now exists.
      const contents = await readFile(
        ClaudeLoginService.credentialsPathFor(configDir),
        "utf-8"
      );
      expect(contents.trim()).toBe("{}");
    });
  });
});
