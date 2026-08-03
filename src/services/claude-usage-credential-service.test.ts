// @vitest-environment node
/**
 * Usage OAuth orchestration tests. Every filesystem, Claude CLI, Anthropic,
 * Keychain/file-harvester, tmux, and session effect is injected; this suite
 * never reaches a real user credential or external process.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import type {
  ClaudeUsageFetchResult,
  ClaudeUsageSnapshot,
} from "@/infrastructure/external/anthropic-usage-adapter";

const logMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => logMocks }));

import {
  ClaudeUsageCredentialService,
  UsageCredentialCaptureError,
  buildUsageLoginCommand,
  isStrictlyWithinUsageScratchRoot,
  type UsageCredentialServiceDependencies,
} from "./claude-usage-credential-service";

const DATA_DIR = "/tmp/rdv usage data";
const ROOT = `${DATA_DIR}/claude-oauth`;
const SCRATCH = `${ROOT}/session-1`;
const CANONICAL_ROOT = `/private${ROOT}`;
const CANONICAL_SCRATCH = `${CANONICAL_ROOT}/session-1`;
const NOW = new Date("2026-08-03T12:00:00.000Z");

const credential = {
  accessToken: "captured-access-token",
  refreshToken: "captured-refresh-token",
  expiresAt: NOW.getTime() + 60 * 60 * 1000,
  scopes: ["user:inference", "user:profile", "future:scope"],
  subscriptionType: "max",
  rateLimitTier: "default_claude_max",
};

const snapshot: ClaudeUsageSnapshot = {
  window5hPct: 45,
  window7dPct: 73,
  resetAt5h: new Date("2026-08-03T15:00:00.000Z"),
  resetAt7d: new Date("2026-08-09T00:00:00.000Z"),
  orgPct: null,
  resetAtOrg: null,
  limits: [
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 88,
      severity: "future-severity",
      resetAt: new Date("2026-08-09T00:00:00.000Z"),
      scopeModel: "Fable",
      scopeSurface: null,
      isActive: true,
    },
  ],
};

const account = {
  id: "account-1",
  emailAddress: "target@example.com",
  usageCredential: true,
};

type LstatEntry = Awaited<
  ReturnType<UsageCredentialServiceDependencies["fileSystem"]["lstat"]>
>;

function realDirectoryEntry(identity: number = 1): LstatEntry {
  return {
    dev: 1,
    ino: identity,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  };
}

function regularFileEntry(identity: number = 2): LstatEntry {
  return {
    dev: 1,
    ino: identity,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

function symlinkEntry(): LstatEntry {
  return {
    dev: 1,
    ino: 99,
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => true,
  };
}

function makeDependencies(
  overrides: Partial<UsageCredentialServiceDependencies> = {}
): UsageCredentialServiceDependencies {
  return {
    getDataDir: () => DATA_DIR,
    platform: "darwin",
    now: () => NOW,
    fileSystem: {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
      stat: vi.fn(async () => ({ mtimeMs: NOW.getTime() })),
      lstat: vi.fn(async (path: string) => {
        if (path.endsWith("/.credentials.json")) {
          throw Object.assign(new Error("absent"), { code: "ENOENT" });
        }
        return realDirectoryEntry();
      }),
      realpath: vi.fn(async (path: string) => path),
    },
    harvester: {
      harvest: vi.fn(async () => credential),
      delete: vi.fn(async () => "deleted" as const),
    },
    fetchUsage: vi.fn(
      async (): Promise<ClaudeUsageFetchResult> => ({
        outcome: "snapshot",
        snapshot,
      })
    ),
    probeIdentity: vi.fn(async () => ({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "target@example.com",
      orgId: "org-1",
      orgName: "Target Org",
      subscriptionType: "max",
    })),
    storeCredential: vi.fn(async () => account as never),
    trackUsage: vi.fn(async () => ({ wrote: true })),
    clearHistory: vi.fn(async () => undefined),
    closeSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

const captureInput = {
  userId: "user-1",
  accountId: "account-1",
  targetEmail: "target@example.com",
  sessionId: "session-1",
  tmuxSessionName: "rdv-session-1",
  scratchDir: SCRATCH,
};

beforeEach(() => {
  vi.restoreAllMocks();
  logMocks.error.mockReset();
  logMocks.warn.mockReset();
  logMocks.info.mockReset();
  logMocks.debug.mockReset();
});

describe("scratch preparation and command", () => {
  it("creates missing data parents, then proves the root before the private session and seed", async () => {
    const deps = makeDependencies();
    const service = new ClaudeUsageCredentialService(deps);

    const prepared = await service.prepareScratch("session-1");

    expect(prepared.scratchDir).toBe(SCRATCH);
    expect(deps.fileSystem.mkdir).toHaveBeenNthCalledWith(1, ROOT, {
      recursive: true,
      mode: 0o700,
    });
    expect(deps.fileSystem.mkdir).toHaveBeenNthCalledWith(2, SCRATCH, {
      recursive: false,
      mode: 0o700,
    });
    expect(deps.fileSystem.writeFile).toHaveBeenCalledWith(
      `${SCRATCH}/.claude.json`,
      expect.any(String),
      { encoding: "utf8", mode: 0o600 }
    );
    const seed = JSON.parse(
      vi.mocked(deps.fileSystem.writeFile).mock.calls[0][1]
    ) as Record<string, unknown>;
    expect(seed).toMatchObject({
      hasCompletedOnboarding: true,
      theme: "dark",
    });
    expect(prepared.command).toBe(buildUsageLoginCommand(SCRATCH));
  });

  it.each([
    ["symlink", symlinkEntry()],
    ["non-directory", regularFileEntry()],
  ] as const)(
    "rejects an existing %s scratch root before creating a session or seed file",
    async (_kind, rootEntry) => {
      const deps = makeDependencies();
      vi.mocked(deps.fileSystem.mkdir).mockImplementation(async (path) => {
        if (path === ROOT) {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }
      });
      vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
        path === ROOT ? rootEntry : realDirectoryEntry()
      );
      const service = new ClaudeUsageCredentialService(deps);

      await expect(service.prepareScratch("session-1")).rejects.toThrow(
        /scratch root.*real directory/i
      );
      expect(deps.fileSystem.mkdir).toHaveBeenCalledTimes(1);
      expect(deps.fileSystem.mkdir).toHaveBeenCalledWith(ROOT, {
        recursive: true,
        mode: 0o700,
      });
      expect(deps.fileSystem.writeFile).not.toHaveBeenCalled();
      expect(deps.harvester.harvest).not.toHaveBeenCalled();
      expect(deps.harvester.delete).not.toHaveBeenCalled();
    }
  );

  it("allows a stable real scratch root beneath a canonicalized ancestor", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.mkdir).mockImplementation(async (path) => {
      if (path === ROOT) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
    });
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) => {
      if (path === ROOT) return CANONICAL_ROOT;
      if (path === SCRATCH) return CANONICAL_SCRATCH;
      return path;
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.prepareScratch("session-1")).resolves.toMatchObject({
      scratchDir: SCRATCH,
    });
    expect(deps.fileSystem.mkdir).toHaveBeenCalledWith(SCRATCH, {
      recursive: false,
      mode: 0o700,
    });
    expect(deps.fileSystem.writeFile).toHaveBeenCalledWith(
      `${SCRATCH}/.claude.json`,
      expect.any(String),
      { encoding: "utf8", mode: 0o600 }
    );
  });

  it("revalidates a root rebound during session creation before writing the seed", async () => {
    const deps = makeDependencies();
    let rootRebound = false;
    vi.mocked(deps.fileSystem.mkdir).mockImplementation(async (path) => {
      if (path === SCRATCH) rootRebound = true;
    });
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (path === ROOT) {
        return rootRebound ? symlinkEntry() : realDirectoryEntry();
      }
      return realDirectoryEntry();
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.prepareScratch("session-1")).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.fileSystem.mkdir).toHaveBeenCalledWith(SCRATCH, {
      recursive: false,
      mode: 0o700,
    });
    expect(deps.fileSystem.writeFile).not.toHaveBeenCalled();
  });

  it("quotes a single quote in the literal scratch path and blanks ambient auth", () => {
    expect(buildUsageLoginCommand("/tmp/rdv's oauth/session")).toBe(
      "CLAUDE_CONFIG_DIR='/tmp/rdv'\"'\"'s oauth/session' " +
        "CLAUDE_CODE_OAUTH_TOKEN='' ANTHROPIC_API_KEY='' " +
        "ANTHROPIC_AUTH_TOKEN='' claude auth login"
    );
  });

  it("rejects a session id that would place preparation outside the root", async () => {
    const deps = makeDependencies();
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.prepareScratch("../escape")).rejects.toThrow(
      /scratch root/i
    );
    expect(deps.fileSystem.mkdir).not.toHaveBeenCalled();
  });

  it("makes the scratch root absolute when RDV_DATA_DIR is relative", () => {
    const deps = makeDependencies({ getDataDir: () => "relative-rdv-data" });
    const service = new ClaudeUsageCredentialService(deps);

    expect(service.scratchRoot).toBe(
      resolve("relative-rdv-data", "claude-oauth")
    );
  });
});

describe("capture validation and storage", () => {
  it("uses a stable canonicalized root for child containment while harvesting the literal path", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) => {
      if (path === ROOT) return CANONICAL_ROOT;
      if (path === SCRATCH) return CANONICAL_SCRATCH;
      return path;
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toMatchObject({
      account,
      usageValidated: true,
    });
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.probeIdentity).toHaveBeenCalledWith(SCRATCH);
    expect(deps.harvester.delete).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fileSystem.rm).toHaveBeenCalledWith(SCRATCH, {
      recursive: true,
      force: true,
    });
  });

  it("rejects a linked scratch root before credential or identity effects", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (path === ROOT) return symlinkEntry();
      if (path.endsWith("/.credentials.json")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      return realDirectoryEntry();
    });
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) =>
      path === ROOT
        ? "/external/claude-oauth"
        : path === SCRATCH
          ? "/external/claude-oauth/session-1"
          : path
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.harvester.harvest).not.toHaveBeenCalled();
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it("rejects a root rebound across validation before the identity probe", async () => {
    let rootRebound = false;
    const deps = makeDependencies({
      fetchUsage: vi.fn(async () => {
        rootRebound = true;
        return { outcome: "snapshot", snapshot } as const;
      }),
    });
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (path === ROOT) {
        return rootRebound ? symlinkEntry() : realDirectoryEntry();
      }
      if (path.endsWith("/.credentials.json")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      return realDirectoryEntry();
    });
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) => {
      if (!rootRebound) return path;
      if (path === ROOT) return "/external/claude-oauth";
      if (path === SCRATCH) return "/external/claude-oauth/session-1";
      return path;
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fetchUsage).toHaveBeenCalledOnce();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it.each([
    ROOT,
    `${ROOT}-prefix-sibling/session-1`,
    `${ROOT}/../default-claude-config`,
  ])(
    "rejects corrupted scratch metadata %s before any credential or identity access",
    async (scratchDir) => {
      const deps = makeDependencies();
      const service = new ClaudeUsageCredentialService(deps);

      await expect(
        service.capture({ ...captureInput, scratchDir })
      ).rejects.toThrow(/exact scratch directory|scratch root/i);
      expect(deps.harvester.harvest).not.toHaveBeenCalled();
      expect(deps.fetchUsage).not.toHaveBeenCalled();
      expect(deps.probeIdentity).not.toHaveBeenCalled();
      expect(deps.storeCredential).not.toHaveBeenCalled();
      expect(deps.harvester.delete).not.toHaveBeenCalled();
    }
  );

  it.each([
    `${ROOT}/session-2`,
    `${ROOT}/session-1/nested`,
    `${ROOT}/temporary/../session-1`,
  ])(
    "requires the exact prepared literal for session.id, rejecting rebound path %s",
    async (scratchDir) => {
      const deps = makeDependencies();
      const service = new ClaudeUsageCredentialService(deps);

      await expect(
        service.capture({ ...captureInput, scratchDir })
      ).rejects.toThrow(/exact scratch directory/i);
      expect(deps.fileSystem.lstat).not.toHaveBeenCalled();
      expect(deps.harvester.harvest).not.toHaveBeenCalled();
      expect(deps.probeIdentity).not.toHaveBeenCalled();
      expect(deps.storeCredential).not.toHaveBeenCalled();
    }
  );

  it("rejects a scratch symlink before harvest or any downstream effect", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
      path === ROOT ? realDirectoryEntry() : symlinkEntry()
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /real directory/i
    );
    expect(deps.harvester.harvest).not.toHaveBeenCalled();
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("rejects a canonical target outside the canonical scratch root before harvest", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) =>
      path === ROOT ? ROOT : "/outside/session-1"
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /canonical scratch root/i
    );
    expect(deps.harvester.harvest).not.toHaveBeenCalled();
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("rejects a symlinked credential file inside an otherwise safe scratch directory before harvest", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
      path.endsWith("/.credentials.json")
        ? symlinkEntry()
        : realDirectoryEntry()
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /credential file.*regular/i
    );
    expect(deps.harvester.harvest).not.toHaveBeenCalled();
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("revalidates a present credential file before identity and rejects a symlink rebound", async () => {
    const deps = makeDependencies();
    let credentialInspections = 0;
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (!path.endsWith("/.credentials.json")) {
        return realDirectoryEntry();
      }
      credentialInspections += 1;
      return credentialInspections === 1
        ? regularFileEntry()
        : symlinkEntry();
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /credential file.*regular/i
    );
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fetchUsage).toHaveBeenCalledOnce();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("requires the credential file to exist after a successful Linux harvest", async () => {
    const deps = makeDependencies({ platform: "linux" });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /Linux credential file.*missing/i
    );
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("revalidates after network validation and rejects a rebound before identity access", async () => {
    const deps = makeDependencies();
    let directoryInspections = 0;
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (path === ROOT) return realDirectoryEntry();
      if (path.endsWith("/.credentials.json")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      directoryInspections += 1;
      return directoryInspections === 1
        ? realDirectoryEntry()
        : symlinkEntry();
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toThrow(
      /real directory/i
    );
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fetchUsage).toHaveBeenCalledOnce();
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it("surfaces CREDENTIALS_NOT_READY without any later effect", async () => {
    const deps = makeDependencies({
      harvester: {
        harvest: vi.fn(async () => null),
        delete: vi.fn(),
      },
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toMatchObject({
      name: "UsageCredentialCaptureError",
      code: "CREDENTIALS_NOT_READY",
    });
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
    expect(deps.clearHistory).not.toHaveBeenCalled();
    expect(deps.closeSession).not.toHaveBeenCalled();
  });

  it("requires the exact user:profile scope before validation", async () => {
    const deps = makeDependencies({
      harvester: {
        harvest: vi.fn(async () => ({
          ...credential,
          scopes: ["user:profile:read", "USER:PROFILE"],
        })),
        delete: vi.fn(),
      },
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toMatchObject({
      code: "MISSING_SCOPE",
    });
    expect(deps.fetchUsage).not.toHaveBeenCalled();
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it("maps a forbidden validation to MISSING_SCOPE and leaves the session for diagnosis", async () => {
    const deps = makeDependencies({
      fetchUsage: vi.fn(
        async (): Promise<ClaudeUsageFetchResult> => ({
          outcome: "forbidden",
        })
      ),
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toMatchObject({
      code: "MISSING_SCOPE",
    });
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it.each(["rate-limited", "no-data"] as const)(
    "allows an indeterminate %s validation but reports usageValidated false",
    async (outcome) => {
      const deps = makeDependencies({
        fetchUsage: vi.fn(async () =>
          outcome === "rate-limited"
            ? { outcome, retryAt: new Date(NOW.getTime() + 1000) }
            : { outcome }
        ),
      });
      const service = new ClaudeUsageCredentialService(deps);

      await expect(service.capture(captureInput)).resolves.toEqual({
        account,
        usageValidated: false,
      });
      expect(deps.storeCredential).toHaveBeenCalledOnce();
      expect(deps.trackUsage).not.toHaveBeenCalled();
    }
  );

  it("rejects a nonblank mismatched email before storage or cleanup", async () => {
    const deps = makeDependencies({
      probeIdentity: vi.fn(async () => ({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: null,
        email: "different@example.com",
        orgId: null,
        orgName: null,
        subscriptionType: "max",
      })),
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
    });
    expect(deps.storeCredential).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["", "different@example.com"],
    ["target@example.com", ""],
    [null, "different@example.com"],
    ["TARGET@example.com", "target@example.com"],
  ] as const)(
    "allows missing identity data and normalized email matches (%s, %s)",
    async (targetEmail, scratchEmail) => {
      const deps = makeDependencies({
        probeIdentity: vi.fn(async () => ({
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: null,
          email: scratchEmail,
          orgId: null,
          orgName: null,
          subscriptionType: "max",
        })),
      });
      const service = new ClaudeUsageCredentialService(deps);

      await expect(
        service.capture({ ...captureInput, targetEmail })
      ).resolves.toMatchObject({ account });
    }
  );

  it("stores the harvested credential under owner/account and records the same validation snapshot without refetching", async () => {
    const deps = makeDependencies();
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toEqual({
      account,
      usageValidated: true,
    });

    expect(deps.fetchUsage).toHaveBeenCalledOnce();
    expect(deps.fetchUsage).toHaveBeenCalledWith(
      credential.accessToken,
      "subscription"
    );
    expect(deps.storeCredential).toHaveBeenCalledWith(
      "account-1",
      "user-1",
      credential,
      expect.objectContaining({ email: "target@example.com" }),
      NOW
    );
    expect(deps.trackUsage).toHaveBeenCalledOnce();
    expect(deps.trackUsage).toHaveBeenCalledWith({
      accountId: "account-1",
      userId: "user-1",
      source: "poller",
      isLimited: false,
      resetAt5h: snapshot.resetAt5h,
      resetAt7d: snapshot.resetAt7d,
      window5hPct: 45,
      window7dPct: 73,
      windows: [
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 88,
          severity: "future-severity",
          resetsAt: snapshot.limits[0].resetAt,
          scopeModel: "Fable",
          scopeSurface: null,
          isActive: true,
        },
      ],
      observedAt: NOW,
    });
  });

  it("returns account-not-found after cleaning the harvested credential when ownership vanishes", async () => {
    const deps = makeDependencies({
      storeCredential: vi.fn(async () => null),
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toEqual({
      account: null,
      usageValidated: false,
    });
    expect(deps.trackUsage).not.toHaveBeenCalled();
    expect(deps.harvester.delete).toHaveBeenCalledWith(SCRATCH);
    expect(deps.fileSystem.rm).toHaveBeenCalledWith(SCRATCH, {
      recursive: true,
      force: true,
    });
    expect(deps.clearHistory).toHaveBeenCalledWith("rdv-session-1");
    expect(deps.closeSession).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("treats a rejected or stale snapshot write as not validated", async () => {
    const deps = makeDependencies({
      trackUsage: vi.fn(async () => ({ wrote: false })),
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toEqual({
      account,
      usageValidated: false,
    });
  });

  it("treats snapshot persistence failure as best-effort and still cleans up", async () => {
    const deps = makeDependencies({
      trackUsage: vi.fn(async () => {
        throw new Error("state DB unavailable");
      }),
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toEqual({
      account,
      usageValidated: false,
    });
    expect(deps.harvester.delete).toHaveBeenCalledWith(SCRATCH);
    expect(deps.closeSession).toHaveBeenCalled();
  });

  it("exposes only the declared token-safe typed capture errors", () => {
    const error = new UsageCredentialCaptureError(
      "ACCOUNT_MISMATCH",
      "different account"
    );
    expect(error).toMatchObject({
      name: "UsageCredentialCaptureError",
      code: "ACCOUNT_MISMATCH",
      message: "different account",
    });
    expect(JSON.stringify(error)).not.toContain(credential.accessToken);
  });
});

describe("successful capture cleanup", () => {
  it("runs credential deletion, guarded directory removal, history clear, and close in exact order", async () => {
    const order: string[] = [];
    const deps = makeDependencies({
      harvester: {
        harvest: vi.fn(async () => credential),
        delete: vi.fn(async (path) => {
          order.push(`credential:${path}`);
          return "deleted" as const;
        }),
      },
      clearHistory: vi.fn(async (name) => {
        order.push(`history:${name}`);
      }),
      closeSession: vi.fn(async (sessionId, userId) => {
        order.push(`close:${sessionId}:${userId}`);
      }),
    });
    vi.mocked(deps.fileSystem.rm).mockImplementation(async (path) => {
      order.push(`directory:${path}`);
    });
    const service = new ClaudeUsageCredentialService(deps);

    await service.capture(captureInput);

    expect(order).toEqual([
      `credential:${SCRATCH}`,
      `directory:${SCRATCH}`,
      "history:rdv-session-1",
      "close:session-1:user-1",
    ]);
    expect(deps.fileSystem.rm).toHaveBeenCalledWith(SCRATCH, {
      recursive: true,
      force: true,
    });
  });

  it("continues through every cleanup step after each individual failure", async () => {
    const order: string[] = [];
    const deps = makeDependencies({
      harvester: {
        harvest: vi.fn(async () => credential),
        delete: vi.fn(async () => {
          order.push("credential");
          throw new Error("delete failed");
        }),
      },
      clearHistory: vi.fn(async () => {
        order.push("history");
        throw new Error("clear failed");
      }),
      closeSession: vi.fn(async () => {
        order.push("close");
        throw new Error("close failed");
      }),
    });
    vi.mocked(deps.fileSystem.rm).mockImplementation(async () => {
      order.push("directory");
      throw new Error("rm failed");
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toMatchObject({
      account,
    });
    expect(order).toEqual(["credential", "directory", "history", "close"]);
  });

  it("revalidates immediately before deletion and skips credential/rm after a symlink rebound", async () => {
    const deps = makeDependencies();
    let directoryInspections = 0;
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) => {
      if (path === ROOT) return realDirectoryEntry();
      if (path.endsWith("/.credentials.json")) {
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      }
      directoryInspections += 1;
      return directoryInspections <= 2
        ? realDirectoryEntry()
        : symlinkEntry();
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.capture(captureInput)).resolves.toMatchObject({
      account,
    });
    expect(deps.harvester.harvest).toHaveBeenCalledWith(SCRATCH);
    expect(deps.storeCredential).toHaveBeenCalledOnce();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
    expect(deps.clearHistory).toHaveBeenCalled();
    expect(deps.closeSession).toHaveBeenCalled();
  });
});

describe("recursive deletion guard", () => {
  it.each([
    [ROOT, false],
    ["../escape", false],
    [`${DATA_DIR}/sibling`, false],
    [`${ROOT}-shared-prefix/session`, false],
    [`${ROOT}/../sibling`, false],
    [`${ROOT}/session-1`, true],
    [`${ROOT}/nested/session-2`, true],
  ] as const)("classifies %s as safe=%s", (candidate, safe) => {
    expect(isStrictlyWithinUsageScratchRoot(ROOT, candidate)).toBe(safe);
  });

  it("refuses unsafe removal targets before invoking the filesystem", async () => {
    const deps = makeDependencies();
    const service = new ClaudeUsageCredentialService(deps);

    for (const path of [ROOT, `${ROOT}-evil/child`, `${ROOT}/../escape`]) {
      await expect(service.removeScratchDirectory(path)).rejects.toThrow(
        /scratch root/i
      );
    }
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it("refuses recursive removal through a linked scratch root", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
      path === ROOT ? symlinkEntry() : realDirectoryEntry()
    );
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) =>
      path === ROOT
        ? "/external/claude-oauth"
        : "/external/claude-oauth/session-1"
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.removeScratchDirectory(SCRATCH)).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });
});

describe("orphan cleanup", () => {
  it("rejects a linked scratch root before orphan enumeration or deletion", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
      path === ROOT ? symlinkEntry() : realDirectoryEntry()
    );
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) =>
      path === ROOT
        ? "/external/claude-oauth"
        : "/external/claude-oauth/old"
    );
    vi.mocked(deps.fileSystem.readdir).mockResolvedValue([
      { name: "old", isDirectory: () => true },
    ]);
    vi.mocked(deps.fileSystem.stat).mockResolvedValue({
      mtimeMs: NOW.getTime() - 25 * 60 * 60 * 1000,
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.cleanupOrphans()).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.fileSystem.readdir).not.toHaveBeenCalled();
    expect(deps.fileSystem.stat).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it("revalidates the root after orphan enumeration before child effects", async () => {
    let rootRebound = false;
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
      path === ROOT && rootRebound ? symlinkEntry() : realDirectoryEntry()
    );
    vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) => {
      if (!rootRebound) return path;
      if (path === ROOT) return "/external/claude-oauth";
      return "/external/claude-oauth/old";
    });
    vi.mocked(deps.fileSystem.readdir).mockImplementation(async () => {
      rootRebound = true;
      return [{ name: "old", isDirectory: () => true }];
    });
    vi.mocked(deps.fileSystem.stat).mockResolvedValue({
      mtimeMs: NOW.getTime() - 25 * 60 * 60 * 1000,
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.cleanupOrphans()).rejects.toThrow(
      /scratch root.*real directory/i
    );
    expect(deps.fileSystem.readdir).toHaveBeenCalledWith(ROOT);
    expect(deps.fileSystem.stat).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
    expect(deps.fileSystem.rm).not.toHaveBeenCalled();
  });

  it("retains young children, ignores non-directories, and deletes old direct children credential-first", async () => {
    const order: string[] = [];
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.readdir).mockResolvedValue([
      { name: "young", isDirectory: () => true },
      { name: "old", isDirectory: () => true },
      { name: "credential.txt", isDirectory: () => false },
    ]);
    vi.mocked(deps.fileSystem.stat).mockImplementation(async (path) => ({
      mtimeMs:
        path === `${ROOT}/old`
          ? NOW.getTime() - 25 * 60 * 60 * 1000
          : NOW.getTime() - 23 * 60 * 60 * 1000,
    }));
    vi.mocked(deps.harvester.delete).mockImplementation(async (path) => {
      order.push(`credential:${path}`);
      return "deleted";
    });
    vi.mocked(deps.fileSystem.rm).mockImplementation(async (path) => {
      order.push(`directory:${path}`);
    });
    const service = new ClaudeUsageCredentialService(deps);

    await service.cleanupOrphans();

    expect(deps.fileSystem.stat).toHaveBeenCalledWith(`${ROOT}/young`);
    expect(deps.fileSystem.stat).toHaveBeenCalledWith(`${ROOT}/old`);
    expect(deps.fileSystem.stat).not.toHaveBeenCalledWith(
      `${ROOT}/credential.txt`
    );
    expect(order).toEqual([
      `credential:${ROOT}/old`,
      `directory:${ROOT}/old`,
    ]);
    expect(logMocks.info).toHaveBeenCalledWith(
      "Removed orphaned Claude usage credential scratch directory",
      { scratchDir: `${ROOT}/old` }
    );
  });

  it.each(["symlink", "canonical-outside"] as const)(
    "does not delete an old direct child that resolves as %s",
    async (unsafeKind) => {
      const deps = makeDependencies();
      vi.mocked(deps.fileSystem.readdir).mockResolvedValue([
        { name: "unsafe", isDirectory: () => true },
      ]);
      vi.mocked(deps.fileSystem.stat).mockResolvedValue({
        mtimeMs: NOW.getTime() - 25 * 60 * 60 * 1000,
      });
      if (unsafeKind === "symlink") {
        vi.mocked(deps.fileSystem.lstat).mockImplementation(async (path) =>
          path === ROOT ? realDirectoryEntry() : symlinkEntry()
        );
      } else {
        vi.mocked(deps.fileSystem.realpath).mockImplementation(async (path) =>
          path === ROOT ? ROOT : "/outside/unsafe"
        );
      }
      const service = new ClaudeUsageCredentialService(deps);

      await expect(service.cleanupOrphans()).resolves.toBeUndefined();
      expect(deps.harvester.delete).not.toHaveBeenCalled();
      expect(deps.fileSystem.rm).not.toHaveBeenCalled();
      expect(logMocks.info).not.toHaveBeenCalled();
    }
  );

  it("continues across credential deletion, rm, and stat failures", async () => {
    const order: string[] = [];
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.readdir).mockResolvedValue([
      { name: "stat-fails", isDirectory: () => true },
      { name: "delete-fails", isDirectory: () => true },
      { name: "rm-fails", isDirectory: () => true },
      { name: "last", isDirectory: () => true },
    ]);
    vi.mocked(deps.fileSystem.stat).mockImplementation(async (path) => {
      if (path.endsWith("stat-fails")) throw new Error("stat failed");
      return { mtimeMs: NOW.getTime() - 25 * 60 * 60 * 1000 };
    });
    vi.mocked(deps.harvester.delete).mockImplementation(async (path) => {
      order.push(`credential:${path}`);
      if (path.endsWith("delete-fails")) throw new Error("delete failed");
      return "deleted";
    });
    vi.mocked(deps.fileSystem.rm).mockImplementation(async (path) => {
      order.push(`directory:${path}`);
      if (path.endsWith("rm-fails")) throw new Error("rm failed");
    });
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.cleanupOrphans()).resolves.toBeUndefined();
    expect(order).toEqual([
      `credential:${ROOT}/delete-fails`,
      `directory:${ROOT}/delete-fails`,
      `credential:${ROOT}/rm-fails`,
      `directory:${ROOT}/rm-fails`,
      `credential:${ROOT}/last`,
      `directory:${ROOT}/last`,
    ]);
  });

  it("treats an absent scratch root as an empty orphan set", async () => {
    const deps = makeDependencies();
    vi.mocked(deps.fileSystem.lstat).mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );
    const service = new ClaudeUsageCredentialService(deps);

    await expect(service.cleanupOrphans()).resolves.toBeUndefined();
    expect(deps.fileSystem.readdir).not.toHaveBeenCalled();
    expect(deps.harvester.delete).not.toHaveBeenCalled();
  });
});
