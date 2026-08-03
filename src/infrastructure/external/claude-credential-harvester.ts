/**
 * ClaudeCredentialHarvester — the operating-system boundary for the OAuth
 * credential set written by Claude Code under a dedicated config directory.
 *
 * Custom config directories do not use Claude Code's default Keychain item:
 * its service suffix is the first eight hex characters of SHA-256 over the
 * literal `CLAUDE_CONFIG_DIR` string. The literal-path rule is load-bearing —
 * callers must pass the same path they gave the CLI, without canonicalizing it.
 */

import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { open as nodeOpen, unlink as nodeUnlink } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const DEFAULT_CREDENTIAL_SERVICE = "Claude Code-credentials";

/** Derive Claude Code's Keychain service for one explicit custom config dir. */
export function deriveClaudeCredentialServiceName(configDir: string): string {
  const requiredConfigDir = requireConfigDir(configDir);
  const suffix = createHash("sha256")
    .update(requiredConfigDir)
    .digest("hex")
    .slice(0, 8);
  return `${DEFAULT_CREDENTIAL_SERVICE}-${suffix}`;
}

/** The validated subset of Claude Code's `claudeAiOauth` credential payload. */
export interface ClaudeUsageOAuthCredential {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds, as written by Claude Code. */
  expiresAt: number;
  /** Open-set scopes, preserved verbatim and in source order. */
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

export type CredentialHarvesterErrorCode =
  | "CONFIG_DIR_REQUIRED"
  | "UNSUPPORTED_PLATFORM"
  | "READ_FAILED"
  | "DELETE_FAILED";

/**
 * A route-safe classification of environmental harvest failures. Absence and
 * not-yet-complete login are represented by `null`, not by this error.
 */
export class CredentialHarvesterError extends Error {
  readonly name = "CredentialHarvesterError";

  constructor(
    readonly code: CredentialHarvesterErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

export type CredentialExecFile = (
  executable: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

export interface CredentialFileHandle {
  stat(): Promise<{ isFile(): boolean }>;
  readFile(options: { encoding: "utf8" }): Promise<string>;
  close(): Promise<void>;
}

export type CredentialFileOpener = (
  path: string,
  flags: number
) => Promise<CredentialFileHandle>;

export type CredentialFileDeleter = (path: string) => Promise<void>;

export interface CredentialHarvesterDependencies {
  platform: NodeJS.Platform | string;
  username: string;
  execFile: CredentialExecFile;
  openFile: CredentialFileOpener;
  deleteFile: CredentialFileDeleter;
}

const runExecFile = promisify(nodeExecFile);

const defaultExecFile: CredentialExecFile = async (executable, args) => {
  const result = await runExecFile(executable, args, { encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr };
};

const defaultOpenFile: CredentialFileOpener = async (path, flags) => {
  const handle = await nodeOpen(path, flags);
  return {
    stat: () => handle.stat(),
    readFile: (options) => handle.readFile(options),
    close: () => handle.close(),
  };
};

const defaultDeleteFile: CredentialFileDeleter = (path) => nodeUnlink(path);

/**
 * Harvest and remove Claude Code credentials without exposing OS details to
 * routes. Every side effect is injectable so unit tests never touch a real
 * Keychain, credential file, or shell.
 */
export class CredentialHarvester {
  private readonly dependencies: CredentialHarvesterDependencies;

  constructor(
    dependencies: Partial<CredentialHarvesterDependencies> = {}
  ) {
    this.dependencies = {
      platform: dependencies.platform ?? process.platform,
      username: dependencies.username ?? userInfo().username,
      execFile: dependencies.execFile ?? defaultExecFile,
      openFile: dependencies.openFile ?? defaultOpenFile,
      deleteFile: dependencies.deleteFile ?? defaultDeleteFile,
    };
  }

  /** Return a usable credential, or null while login is absent/incomplete. */
  async harvest(configDir: string): Promise<ClaudeUsageOAuthCredential | null> {
    const requiredConfigDir = requireConfigDir(configDir);
    let raw: string;
    try {
      if (this.dependencies.platform === "darwin") {
        const service = deriveClaudeCredentialServiceName(requiredConfigDir);
        const result = await this.dependencies.execFile("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          this.dependencies.username,
          "-w",
        ]);
        raw = result.stdout;
      } else if (this.dependencies.platform === "linux") {
        raw = await this.readLinuxCredential(requiredConfigDir);
      } else {
        throw this.unsupportedPlatform();
      }
    } catch (error) {
      if (error instanceof CredentialHarvesterError) throw error;
      if (isAbsentCredential(error)) return null;
      throw new CredentialHarvesterError(
        "READ_FAILED",
        "Claude usage credential could not be read",
        { cause: error }
      );
    }

    return parseClaudeUsageCredential(raw);
  }

  /**
   * Best-effort targeted deletion. Missing items are reported as `absent`;
   * unexpected failures are surfaced so callers can log them loudly.
   */
  async delete(configDir: string): Promise<"deleted" | "absent"> {
    const requiredConfigDir = requireConfigDir(configDir);
    try {
      if (this.dependencies.platform === "darwin") {
        await this.dependencies.execFile("security", [
          "delete-generic-password",
          "-s",
          deriveClaudeCredentialServiceName(requiredConfigDir),
          "-a",
          this.dependencies.username,
        ]);
      } else if (this.dependencies.platform === "linux") {
        await this.dependencies.deleteFile(
          this.credentialFilePath(requiredConfigDir)
        );
      } else {
        throw this.unsupportedPlatform();
      }
      return "deleted";
    } catch (error) {
      if (error instanceof CredentialHarvesterError) throw error;
      if (isAbsentCredential(error)) return "absent";
      throw new CredentialHarvesterError(
        "DELETE_FAILED",
        "Claude usage credential could not be deleted",
        { cause: error }
      );
    }
  }

  private credentialFilePath(configDir: string): string {
    return join(configDir, ".credentials.json");
  }

  /**
   * Open the Linux credential without following a final-component symlink,
   * prove the opened inode is a regular file, and read through that same file
   * descriptor. This avoids the lstat-then-read race that would otherwise let
   * `.credentials.json` be rebound to a default/outside credential.
   */
  private async readLinuxCredential(configDir: string): Promise<string> {
    const handle = await this.dependencies.openFile(
      this.credentialFilePath(configDir),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new CredentialHarvesterError(
          "READ_FAILED",
          "Claude usage credential path is not a regular file"
        );
      }
      return await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  }

  private unsupportedPlatform(): CredentialHarvesterError {
    return new CredentialHarvesterError(
      "UNSUPPORTED_PLATFORM",
      `Claude usage credential harvesting is unsupported on ${this.dependencies.platform}`
    );
  }
}

/** Refuse the default Claude Code credential service on every platform. */
function requireConfigDir(configDir: string | undefined): string {
  if (typeof configDir !== "string" || configDir.trim().length === 0) {
    throw new CredentialHarvesterError(
      "CONFIG_DIR_REQUIRED",
      "A Claude config directory is required for usage credentials"
    );
  }
  return configDir;
}

/** Descriptive compatibility name for callers that prefer provider context. */
export { CredentialHarvester as ClaudeCredentialHarvester };

/** Parse external JSON defensively; partial/in-progress writes are not ready. */
function parseClaudeUsageCredential(
  raw: string
): ClaudeUsageOAuthCredential | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.claudeAiOauth)) return null;

  const oauth = parsed.claudeAiOauth;
  if (!isNonBlankString(oauth.accessToken)) return null;
  if (!isNonBlankString(oauth.refreshToken)) return null;
  if (typeof oauth.expiresAt !== "number" || !Number.isFinite(oauth.expiresAt)) {
    return null;
  }
  if (
    !Array.isArray(oauth.scopes) ||
    !oauth.scopes.every((scope): scope is string => typeof scope === "string")
  ) {
    return null;
  }

  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    scopes: [...oauth.scopes],
    subscriptionType:
      typeof oauth.subscriptionType === "string"
        ? oauth.subscriptionType
        : null,
    rateLimitTier:
      typeof oauth.rateLimitTier === "string" ? oauth.rateLimitTier : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbsentCredential(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === 44 || code === "44";
}
