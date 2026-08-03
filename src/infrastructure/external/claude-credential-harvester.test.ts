// @vitest-environment node
/**
 * Credential harvester tests. Every OS interaction is injected: these tests
 * never invoke `security` and never read or delete a real credential file.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeCredentialHarvester,
  CredentialHarvesterError,
  deriveClaudeCredentialServiceName,
} from "./claude-credential-harvester";

const SCRATCH_DIR = "/tmp/rdv-test-oauth/session-42";
const ACCESS_TOKEN = "test-access-token";
const REFRESH_TOKEN = "test-refresh-token";

function credentialJson(
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    mcpOAuth: { ignored: true },
    claudeAiOauth: {
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: 1_785_793_317_600,
      scopes: ["user:inference", "user:profile", "future:scope"],
      subscriptionType: "future-plan",
      rateLimitTier: "future-tier",
      ...overrides,
    },
  });
}

describe("deriveClaudeCredentialServiceName", () => {
  it("uses Claude Code's un-hashed service for the default config dir", () => {
    expect(deriveClaudeCredentialServiceName()).toBe(
      "Claude Code-credentials"
    );
  });

  it("pins the verified custom-config derivation vector", () => {
    expect(
      deriveClaudeCredentialServiceName(
        "/Users/bryanli/.remote-dev/profiles/a04f4587-977c-450c-b361-7827659bd894/.claude"
      )
    ).toBe("Claude Code-credentials-174cb014");
  });

  it("hashes the literal path without normalizing its trailing slash", () => {
    expect(deriveClaudeCredentialServiceName("/tmp/scratch")).not.toBe(
      deriveClaudeCredentialServiceName("/tmp/scratch/")
    );
  });
});

describe("ClaudeCredentialHarvester.harvest", () => {
  it("reads macOS credentials through execFile with exact executable and args", async () => {
    const execFile = vi.fn(async () => ({
      stdout: credentialJson(),
      stderr: "",
    }));
    const readFile = vi.fn();
    const harvester = new ClaudeCredentialHarvester({
      platform: "darwin",
      username: "test-user",
      execFile,
      readFile,
      deleteFile: vi.fn(),
    });

    await expect(harvester.harvest(SCRATCH_DIR)).resolves.toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: 1_785_793_317_600,
      scopes: ["user:inference", "user:profile", "future:scope"],
      subscriptionType: "future-plan",
      rateLimitTier: "future-tier",
    });
    expect(execFile).toHaveBeenCalledWith("security", [
      "find-generic-password",
      "-s",
      deriveClaudeCredentialServiceName(SCRATCH_DIR),
      "-a",
      "test-user",
      "-w",
    ]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads Linux credentials from exactly <configDir>/.credentials.json", async () => {
    const readFile = vi.fn(async () => credentialJson());
    const execFile = vi.fn();
    const harvester = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile,
      readFile,
      deleteFile: vi.fn(),
    });

    await expect(harvester.harvest(SCRATCH_DIR)).resolves.toMatchObject({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    });
    expect(readFile).toHaveBeenCalledWith(
      `${SCRATCH_DIR}/.credentials.json`,
      "utf8"
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns null while login has not created usable claudeAiOauth data", async () => {
    const payloads = [
      JSON.stringify({ mcpOAuth: { unrelated: true } }),
      "not-json-yet",
      credentialJson({ accessToken: " " }),
      credentialJson({ refreshToken: "" }),
      credentialJson({ expiresAt: "1785793317600" }),
      '{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","expiresAt":1e400,"scopes":[]}}',
      credentialJson({ scopes: "user:profile" }),
      credentialJson({ scopes: ["user:profile", 42] }),
    ];

    for (const payload of payloads) {
      const harvester = new ClaudeCredentialHarvester({
        platform: "linux",
        username: "unused",
        execFile: vi.fn(),
        readFile: vi.fn(async () => payload),
        deleteFile: vi.fn(),
      });
      await expect(harvester.harvest(SCRATCH_DIR)).resolves.toBeNull();
    }
  });

  it("treats an absent Keychain item or Linux file as not ready", async () => {
    const absent = Object.assign(new Error("absent"), { code: "ENOENT" });
    const linux = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(async () => {
        throw absent;
      }),
      deleteFile: vi.fn(),
    });
    const darwin = new ClaudeCredentialHarvester({
      platform: "darwin",
      username: "test-user",
      execFile: vi.fn(async () => {
        throw Object.assign(new Error("item missing"), { code: 44 });
      }),
      readFile: vi.fn(),
      deleteFile: vi.fn(),
    });

    await expect(linux.harvest(SCRATCH_DIR)).resolves.toBeNull();
    await expect(darwin.harvest(SCRATCH_DIR)).resolves.toBeNull();
  });

  it("surfaces unexpected reads and unsupported platforms as typed errors", async () => {
    const failedRead = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(async () => {
        throw new Error("permission denied");
      }),
      deleteFile: vi.fn(),
    });
    const unsupported = new ClaudeCredentialHarvester({
      platform: "win32",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(),
    });

    await expect(failedRead.harvest(SCRATCH_DIR)).rejects.toMatchObject({
      name: "CredentialHarvesterError",
      code: "READ_FAILED",
    });
    await expect(unsupported.harvest(SCRATCH_DIR)).rejects.toBeInstanceOf(
      CredentialHarvesterError
    );
    await expect(unsupported.harvest(SCRATCH_DIR)).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM",
    });
  });
});

describe("ClaudeCredentialHarvester.delete", () => {
  it("deletes only the derived macOS Keychain item through execFile", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const harvester = new ClaudeCredentialHarvester({
      platform: "darwin",
      username: "test-user",
      execFile,
      readFile: vi.fn(),
      deleteFile: vi.fn(),
    });

    await expect(harvester.delete(SCRATCH_DIR)).resolves.toBe("deleted");
    expect(execFile).toHaveBeenCalledWith("security", [
      "delete-generic-password",
      "-s",
      deriveClaudeCredentialServiceName(SCRATCH_DIR),
      "-a",
      "test-user",
    ]);
  });

  it("deletes only the exact Linux credentials file", async () => {
    const deleteFile = vi.fn(async () => undefined);
    const harvester = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile,
    });

    await expect(harvester.delete(SCRATCH_DIR)).resolves.toBe("deleted");
    expect(deleteFile).toHaveBeenCalledWith(
      `${SCRATCH_DIR}/.credentials.json`
    );
  });

  it("treats missing deletion targets as absent and surfaces other failures", async () => {
    const absentHarvester = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(async () => {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }),
    });
    const failedHarvester = new ClaudeCredentialHarvester({
      platform: "linux",
      username: "unused",
      execFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    });

    await expect(absentHarvester.delete(SCRATCH_DIR)).resolves.toBe("absent");
    await expect(failedHarvester.delete(SCRATCH_DIR)).rejects.toMatchObject({
      code: "DELETE_FAILED",
    });
  });
});
