/**
 * ClaudeUsageCredentialService - isolated claude.ai login orchestration.
 *
 * The usage endpoint requires a short-lived OAuth access token carrying the
 * exact `user:profile` scope. That is a different credential class from the
 * long-lived `claude setup-token` injected into agent sessions, so this module
 * captures the former under a private scratch `CLAUDE_CONFIG_DIR` and never
 * reads, refreshes, or deletes Claude Code's default credential service.
 *
 * All external effects are narrow dependencies: filesystem, credential
 * harvester, usage fetch, identity probe, account store, usage-state write,
 * tmux, session lifecycle, and clock. Tests replace every one, so no test can
 * touch a real Keychain, credential file, Claude CLI, network, or tmux server.
 *
 * SECURITY
 *   - Scratch directories and their onboarding seed are 0700/0600.
 *   - Harvest/delete always receive a validated path strictly below the usage
 *     scratch root. An undefined/default config dir is never passed.
 *   - Tokens are handed only to the injected validation/store boundaries and
 *     never appear in logs, errors, or return values.
 *   - Cleanup begins only after the owner-scoped credential write succeeds.
 */

import {
  mkdir as nodeMkdir,
  lstat as nodeLstat,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rm as nodeRm,
  stat as nodeStat,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { TrackUsageLimitInput } from "@/application/use-cases/profile/TrackUsageLimitUseCase";
import {
  fetchClaudeUsage,
  type ClaudeUsageFetchResult,
  type ClaudeUsageSnapshot,
} from "@/infrastructure/external/anthropic-usage-adapter";
import {
  ClaudeCredentialHarvester,
  type ClaudeUsageOAuthCredential,
} from "@/infrastructure/external/claude-credential-harvester";
import { usageSnapshotToLimitDetectionResult } from "@/infrastructure/usage-limit/UsageEndpointPoller";
import { createLogger } from "@/lib/logger";
import { getDataDir } from "@/lib/paths";
import {
  CLAUDE_USAGE_OAUTH_LOGIN_COMMAND,
  probeScratchIdentity,
  storeInitialUsageCredential,
  type ClaudeAccountView,
  type ClaudeIdentity,
  type InitialUsageCredential,
} from "./claude-account-service";

const log = createLogger("ClaudeUsageCredentialService");

/** Dedicated root whose descendants are the only credential paths we touch. */
export const USAGE_OAUTH_SCRATCH_DIRECTORY = "claude-oauth";

/** Abandoned login sessions older than this are removed on server startup. */
export const USAGE_OAUTH_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type UsageCredentialCaptureErrorCode =
  | "CREDENTIALS_NOT_READY"
  | "MISSING_SCOPE"
  | "ACCOUNT_MISMATCH";

/** Expected user-actionable capture failures; no credential material inside. */
export class UsageCredentialCaptureError extends Error {
  readonly name = "UsageCredentialCaptureError";

  constructor(
    readonly code: UsageCredentialCaptureErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface UsageScratchDirEntry {
  name: string;
  isDirectory(): boolean;
}

/** Minimal async filesystem surface used by preparation and orphan cleanup. */
export interface UsageCredentialFileSystem {
  mkdir(
    path: string,
    options: { recursive: boolean; mode: number }
  ): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; mode: number }
  ): Promise<void>;
  rm(
    path: string,
    options: { recursive: true; force: true }
  ): Promise<void>;
  readdir(path: string): Promise<UsageScratchDirEntry[]>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  lstat(path: string): Promise<{
    dev: number;
    ino: number;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>;
  realpath(path: string): Promise<string>;
}

export interface UsageCredentialHarvester {
  harvest(scratchDir: string): Promise<ClaudeUsageOAuthCredential | null>;
  delete(scratchDir: string): Promise<unknown>;
}

export type UsageFetch = (
  accessToken: string,
  kind: "subscription"
) => Promise<ClaudeUsageFetchResult>;

export type ScratchIdentityProbe = (
  scratchDir: string
) => Promise<ClaudeIdentity>;

export type InitialCredentialStore = (
  accountId: string,
  userId: string,
  credential: InitialUsageCredential,
  identity: ClaudeIdentity,
  now: Date
) => Promise<ClaudeAccountView | null>;

export type UsageSnapshotTracker = (
  input: TrackUsageLimitInput
) => Promise<{ wrote: boolean }>;

export interface UsageCredentialServiceDependencies {
  getDataDir(): string;
  platform: NodeJS.Platform | string;
  now(): Date;
  fileSystem: UsageCredentialFileSystem;
  harvester: UsageCredentialHarvester;
  fetchUsage: UsageFetch;
  probeIdentity: ScratchIdentityProbe;
  storeCredential: InitialCredentialStore;
  trackUsage: UsageSnapshotTracker;
  clearHistory(tmuxSessionName: string): Promise<void>;
  closeSession(sessionId: string, userId: string): Promise<void>;
}

export interface PreparedUsageScratch {
  scratchDir: string;
  command: string;
}

/** Authority checked by the route before this service receives it. */
export interface UsageCredentialCaptureInput {
  userId: string;
  accountId: string;
  targetEmail: string | null;
  sessionId: string;
  tmuxSessionName: string;
  scratchDir: string;
}

export interface UsageCredentialCaptureResult {
  /** Null when the owner-scoped account disappeared before the store. */
  account: ClaudeAccountView | null;
  /** True only when the validation snapshot was successfully persisted. */
  usageValidated: boolean;
}

interface ScratchRootProof {
  canonicalPath: string;
  dev: number;
  ino: number;
}

const defaultFileSystem: UsageCredentialFileSystem = {
  mkdir: async (path, options) => {
    await nodeMkdir(path, options);
  },
  writeFile: async (path, data, options) => {
    await nodeWriteFile(path, data, options);
  },
  rm: async (path, options) => {
    await nodeRm(path, options);
  },
  readdir: async (path) => nodeReaddir(path, { withFileTypes: true }),
  stat: async (path) => nodeStat(path),
  lstat: async (path) => nodeLstat(path),
  realpath: async (path) => nodeRealpath(path),
};

const defaultTrackUsage: UsageSnapshotTracker = async (input) => {
  const { trackUsageLimitUseCase } = await import(
    "@/infrastructure/container"
  );
  const result = await trackUsageLimitUseCase.execute(input);
  return { wrote: result.wrote };
};

const defaultDependencies: UsageCredentialServiceDependencies = {
  getDataDir,
  platform: process.platform,
  now: () => new Date(),
  fileSystem: defaultFileSystem,
  harvester: new ClaudeCredentialHarvester(),
  fetchUsage: (accessToken, kind) => fetchClaudeUsage(accessToken, kind),
  probeIdentity: (scratchDir) => probeScratchIdentity(scratchDir),
  storeCredential: storeInitialUsageCredential,
  trackUsage: defaultTrackUsage,
  clearHistory: async (tmuxSessionName) => {
    const tmuxService = await import("./tmux-service");
    await tmuxService.clearHistory(tmuxSessionName);
  },
  closeSession: async (sessionId, userId) => {
    const sessionService = await import("./session-service");
    await sessionService.closeSession(sessionId, userId);
  },
};

/** POSIX single-quote one literal shell word, including embedded `'`. */
function quotePosixShellWord(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Build the exact command typed into the shell session. Auth vars are blanked
 * explicitly because an ambient server credential would otherwise override
 * the scratch login and risk reading/writing the wrong Claude identity.
 */
export function buildUsageLoginCommand(scratchDir: string): string {
  return [
    `CLAUDE_CONFIG_DIR=${quotePosixShellWord(scratchDir)}`,
    "CLAUDE_CODE_OAUTH_TOKEN=''",
    "ANTHROPIC_API_KEY=''",
    "ANTHROPIC_AUTH_TOKEN=''",
    CLAUDE_USAGE_OAUTH_LOGIN_COMMAND,
  ].join(" ");
}

/**
 * Resolve both paths and require a nonempty relative descendant. This rejects
 * the root itself, relative escapes, absolute escapes, and siblings sharing a
 * string prefix such as `claude-oauth-backup`.
 */
export function isStrictlyWithinUsageScratchRoot(
  root: string,
  candidate: string
): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(child)
  );
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

function normalizedEmail(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLocaleLowerCase("en-US") : null;
}

/** Orchestrates preparation, safe capture, persistence, and teardown. */
export class ClaudeUsageCredentialService {
  private readonly dependencies: UsageCredentialServiceDependencies;

  constructor(dependencies: Partial<UsageCredentialServiceDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  get scratchRoot(): string {
    return resolve(
      this.dependencies.getDataDir(),
      USAGE_OAUTH_SCRATCH_DIRECTORY
    );
  }

  /** Create the isolated private config directory and onboarding seed. */
  async prepareScratch(sessionId: string): Promise<PreparedUsageScratch> {
    const scratchDir = join(this.scratchRoot, sessionId);
    this.assertSafeScratchPath(scratchDir);

    // Recursive creation also supports a first-run data directory. An existing
    // final-component symlink can make mkdir report success, so no child or file
    // effect is allowed until the lstat/realpath/inode proof immediately below.
    try {
      await this.dependencies.fileSystem.mkdir(this.scratchRoot, {
        recursive: true,
        mode: 0o700,
      });
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const rootProof = await this.assertExistingSafeScratchRoot();

    await this.dependencies.fileSystem.mkdir(scratchDir, {
      recursive: false,
      mode: 0o700,
    });
    // Session creation is another pathname window. Re-prove both the root and
    // child before writing the onboarding seed through the literal path.
    await this.assertExistingSafeScratchDirectory(scratchDir, rootProof);
    await this.dependencies.fileSystem.writeFile(
      join(scratchDir, ".claude.json"),
      JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }),
      { encoding: "utf8", mode: 0o600 }
    );

    return { scratchDir, command: buildUsageLoginCommand(scratchDir) };
  }

  /**
   * Capture from trusted session metadata, validate, store, record the already
   * fetched snapshot, then destroy every scratch copy best-effort.
   */
  async capture(
    input: UsageCredentialCaptureInput
  ): Promise<UsageCredentialCaptureResult> {
    this.assertExactCaptureScratchPath(input);
    let rootProof = await this.assertExistingSafeScratchDirectory(
      input.scratchDir
    );
    rootProof = await this.assertSafeCredentialFile(
      input.scratchDir,
      false,
      rootProof
    );

    const credential = await this.dependencies.harvester.harvest(
      input.scratchDir
    );
    if (!credential) {
      throw new UsageCredentialCaptureError(
        "CREDENTIALS_NOT_READY",
        "Claude usage credentials are not ready"
      );
    }
    if (this.dependencies.platform === "linux") {
      rootProof = await this.assertSafeCredentialFile(
        input.scratchDir,
        true,
        rootProof
      );
    }
    if (!credential.scopes.includes("user:profile")) {
      throw new UsageCredentialCaptureError(
        "MISSING_SCOPE",
        "Claude usage credentials do not include user:profile"
      );
    }

    const validation = await this.dependencies.fetchUsage(
      credential.accessToken,
      "subscription"
    );
    if (validation.outcome === "forbidden") {
      throw new UsageCredentialCaptureError(
        "MISSING_SCOPE",
        "Anthropic rejected the credential's usage scope"
      );
    }
    if (
      validation.outcome === "rate-limited" ||
      validation.outcome === "no-data"
    ) {
      log.warn("Usage credential validation was indeterminate", {
        accountId: input.accountId,
        outcome: validation.outcome,
      });
    }

    // The usage fetch is an awaited network window during which the literal
    // directory could be rebound. Revalidate provenance + canonical location
    // immediately before the identity probe performs its next credential
    // access under CLAUDE_CONFIG_DIR.
    this.assertExactCaptureScratchPath(input);
    rootProof = await this.assertExistingSafeScratchDirectory(
      input.scratchDir,
      rootProof
    );
    rootProof = await this.assertSafeCredentialFile(
      input.scratchDir,
      this.dependencies.platform === "linux",
      rootProof
    );
    const identity = await this.dependencies.probeIdentity(input.scratchDir);
    const targetEmail = normalizedEmail(input.targetEmail);
    const scratchEmail = normalizedEmail(identity.email);
    if (targetEmail && scratchEmail && targetEmail !== scratchEmail) {
      throw new UsageCredentialCaptureError(
        "ACCOUNT_MISMATCH",
        "The scratch login belongs to a different Claude account"
      );
    }

    const stored = await this.dependencies.storeCredential(
      input.accountId,
      input.userId,
      credential,
      identity,
      this.dependencies.now()
    );
    if (!stored) {
      await this.cleanupSuccessfulCapture(input, rootProof);
      return { account: null, usageValidated: false };
    }

    const usageValidated =
      validation.outcome === "snapshot"
        ? await this.recordValidationSnapshot(
            input,
            validation.snapshot
          )
        : false;

    await this.cleanupSuccessfulCapture(input, rootProof);
    return { account: stored, usageValidated };
  }

  /** Filesystem removal boundary shared by successful and orphan cleanup. */
  async removeScratchDirectory(scratchDir: string): Promise<void> {
    await this.removeScratchDirectoryUnderRoot(scratchDir);
  }

  private async removeScratchDirectoryUnderRoot(
    scratchDir: string,
    expectedRoot?: ScratchRootProof
  ): Promise<void> {
    await this.assertExistingSafeScratchDirectory(scratchDir, expectedRoot);
    await this.dependencies.fileSystem.rm(scratchDir, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Remove only direct child directories older than 24 hours. Credential
   * deletion always receives the exact child path before recursive removal;
   * each failure is isolated so later children are still processed.
   */
  async cleanupOrphans(
    maxAgeMs: number = USAGE_OAUTH_ORPHAN_MAX_AGE_MS
  ): Promise<void> {
    let rootProof: ScratchRootProof;
    try {
      rootProof = await this.assertExistingSafeScratchRoot();
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }

    let children: UsageScratchDirEntry[];
    try {
      children = await this.dependencies.fileSystem.readdir(this.scratchRoot);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }
    // Enumeration is an awaited pathname window. Do not inspect anything it
    // returned unless the literal root still proves the same safe identity.
    rootProof = await this.assertExistingSafeScratchRoot(rootProof);

    for (const child of children) {
      if (!child.isDirectory()) continue;
      const childPath = join(this.scratchRoot, child.name);
      if (!isStrictlyWithinUsageScratchRoot(this.scratchRoot, childPath)) {
        log.error("Refused unsafe usage scratch orphan path", {
          childName: child.name,
        });
        continue;
      }

      let mtimeMs: number;
      try {
        rootProof = await this.assertExistingSafeScratchRoot(rootProof);
        ({ mtimeMs } = await this.dependencies.fileSystem.stat(childPath));
      } catch (error) {
        log.error("Could not inspect usage scratch orphan", {
          scratchDir: childPath,
          error: String(error),
        });
        continue;
      }
      if (this.dependencies.now().getTime() - mtimeMs <= maxAgeMs) continue;

      try {
        // Re-resolve immediately before credential deletion. Keep childPath
        // literal for the harvester because Claude Code's Keychain suffix is
        // derived from that exact string, not its canonical target.
        rootProof = await this.assertExistingSafeScratchDirectory(
          childPath,
          rootProof
        );
      } catch (error) {
        log.error("Refused unsafe orphaned usage scratch directory", {
          scratchDir: childPath,
          error: String(error),
        });
        continue;
      }
      try {
        await this.dependencies.harvester.delete(childPath);
      } catch (error) {
        log.error("Could not delete orphaned scratch credential", {
          scratchDir: childPath,
          error: String(error),
        });
      }
      try {
        await this.removeScratchDirectoryUnderRoot(childPath, rootProof);
        log.info(
          "Removed orphaned Claude usage credential scratch directory",
          { scratchDir: childPath }
        );
      } catch (error) {
        log.error("Could not remove orphaned usage scratch directory", {
          scratchDir: childPath,
          error: String(error),
        });
      }
    }
  }

  private assertSafeScratchPath(scratchDir: string): void {
    if (!isStrictlyWithinUsageScratchRoot(this.scratchRoot, scratchDir)) {
      throw new Error("Usage credential path is not beneath the scratch root");
    }
  }

  private assertExactCaptureScratchPath(
    input: UsageCredentialCaptureInput
  ): void {
    const expected = join(this.scratchRoot, input.sessionId);
    if (input.scratchDir !== expected) {
      throw new Error(
        "Usage credential metadata does not name the exact scratch directory for this session"
      );
    }
    this.assertSafeScratchPath(input.scratchDir);
  }

  /**
   * Reject symlinks and ancestor-symlink escapes. The literal path remains the
   * credential identity, while canonical paths are used only to prove that the
   * existing directory still resides beneath the canonical scratch root.
   */
  private async assertExistingSafeScratchDirectory(
    scratchDir: string,
    expectedRoot?: ScratchRootProof
  ): Promise<ScratchRootProof> {
    this.assertSafeScratchPath(scratchDir);
    const rootBefore = await this.assertExistingSafeScratchRoot(expectedRoot);

    const info = await this.dependencies.fileSystem.lstat(scratchDir);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Usage credential scratch path is not a real directory");
    }

    const canonicalScratch = await this.dependencies.fileSystem.realpath(
      scratchDir
    );
    // The child realpath call is another opportunity to swap an ancestor.
    // Re-prove the root before trusting the canonical child result.
    const rootAfter = await this.assertExistingSafeScratchRoot(rootBefore);
    if (
      !isStrictlyWithinUsageScratchRoot(
        rootAfter.canonicalPath,
        canonicalScratch
      )
    ) {
      throw new Error(
        "Usage credential directory is outside the canonical scratch root"
      );
    }
    return rootAfter;
  }

  /**
   * Prove the literal root's final component instead of trusting a root/child
   * pair that can both canonicalize through the same final symlink. Trusted
   * ancestor symlinks are allowed; the stable canonical path is returned for
   * child containment. The second lstat catches replacement during realpath.
   */
  private async assertExistingSafeScratchRoot(
    expected?: ScratchRootProof
  ): Promise<ScratchRootProof> {
    const before = await this.dependencies.fileSystem.lstat(this.scratchRoot);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error(
        "Usage credential scratch root is not a real directory"
      );
    }

    const canonicalRoot = await this.dependencies.fileSystem.realpath(
      this.scratchRoot
    );
    const after = await this.dependencies.fileSystem.lstat(this.scratchRoot);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new Error(
        "Usage credential scratch root changed during validation"
      );
    }

    const proof = {
      canonicalPath: canonicalRoot,
      dev: after.dev,
      ino: after.ino,
    };
    if (
      expected &&
      (proof.canonicalPath !== expected.canonicalPath ||
        proof.dev !== expected.dev ||
        proof.ino !== expected.ino)
    ) {
      throw new Error(
        "Usage credential scratch root changed between validation boundaries"
      );
    }
    return proof;
  }

  /**
   * Reject a linked or non-regular credential before either reader can follow
   * it. macOS normally has no file here, while a successful Linux harvest must
   * leave the exact regular file in place for the later identity probe.
   */
  private async assertSafeCredentialFile(
    scratchDir: string,
    required: boolean,
    expectedRoot?: ScratchRootProof
  ): Promise<ScratchRootProof> {
    const rootBefore = await this.assertExistingSafeScratchRoot(expectedRoot);
    const credentialPath = join(scratchDir, ".credentials.json");
    let info: Awaited<ReturnType<UsageCredentialFileSystem["lstat"]>>;
    try {
      info = await this.dependencies.fileSystem.lstat(credentialPath);
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        const rootAfter = await this.assertExistingSafeScratchRoot(rootBefore);
        if (required) {
          throw new Error(
            "Linux credential file is missing after a successful harvest"
          );
        }
        return rootAfter;
      }
      throw error;
    }

    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(
        "Claude usage credential file is not a regular non-symlink file"
      );
    }
    return this.assertExistingSafeScratchRoot(rootBefore);
  }

  private async recordValidationSnapshot(
    input: UsageCredentialCaptureInput,
    snapshot: ClaudeUsageSnapshot
  ): Promise<boolean> {
    try {
      const normalized = usageSnapshotToLimitDetectionResult(
        input.accountId,
        snapshot
      );
      const result = await this.dependencies.trackUsage({
        accountId: input.accountId,
        userId: input.userId,
        source: normalized.source,
        isLimited: normalized.isLimited,
        resetAt5h: normalized.resetAt5h,
        resetAt7d: normalized.resetAt7d,
        window5hPct: normalized.window5hPct,
        window7dPct: normalized.window7dPct,
        windows: normalized.windows,
        observedAt: this.dependencies.now(),
      });
      return result.wrote;
    } catch (error) {
      log.warn("Could not record validated Claude usage snapshot", {
        accountId: input.accountId,
        error: String(error),
      });
      return false;
    }
  }

  private async cleanupSuccessfulCapture(
    input: UsageCredentialCaptureInput,
    expectedRoot: ScratchRootProof
  ): Promise<void> {
    try {
      this.assertExactCaptureScratchPath(input);
      // Revalidate immediately before deleting the exact derived credential;
      // the directory may have been rebound after the initial capture check.
      await this.assertExistingSafeScratchDirectory(
        input.scratchDir,
        expectedRoot
      );
      await this.dependencies.harvester.delete(input.scratchDir);
    } catch (error) {
      log.error("Could not delete captured scratch credential", {
        sessionId: input.sessionId,
        error: String(error),
      });
    }
    try {
      await this.removeScratchDirectoryUnderRoot(
        input.scratchDir,
        expectedRoot
      );
    } catch (error) {
      log.error("Could not remove captured usage scratch directory", {
        sessionId: input.sessionId,
        error: String(error),
      });
    }
    try {
      await this.dependencies.clearHistory(input.tmuxSessionName);
    } catch (error) {
      log.error("Could not clear usage setup-session scrollback", {
        sessionId: input.sessionId,
        error: String(error),
      });
    }
    try {
      await this.dependencies.closeSession(input.sessionId, input.userId);
    } catch (error) {
      log.error("Could not close usage setup session", {
        sessionId: input.sessionId,
        error: String(error),
      });
    }
  }
}

const defaultService = new ClaudeUsageCredentialService();

/** Default preparation boundary used by the setup route. */
export function prepareUsageCredentialScratch(
  sessionId: string
): Promise<PreparedUsageScratch> {
  return defaultService.prepareScratch(sessionId);
}

/** Default capture boundary used by the capture route. */
export function captureUsageCredential(
  input: UsageCredentialCaptureInput
): Promise<UsageCredentialCaptureResult> {
  return defaultService.capture(input);
}

/** One-shot startup cleanup; intentionally no interval in this module. */
export function cleanupOrphanedUsageCredentials(): Promise<void> {
  return defaultService.cleanupOrphans();
}
