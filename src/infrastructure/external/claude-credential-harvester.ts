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
import { readFile as nodeReadFile, unlink as nodeUnlink } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const DEFAULT_CREDENTIAL_SERVICE = "Claude Code-credentials";

/** Derive Claude Code's Keychain service for a default or custom config dir. */
export function deriveClaudeCredentialServiceName(
  configDir?: string
): string {
  if (configDir === undefined) return DEFAULT_CREDENTIAL_SERVICE;
  const suffix = createHash("sha256")
    .update(configDir)
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

export type CredentialFileReader = (
  path: string,
  encoding: "utf8"
) => Promise<string>;

export type CredentialFileDeleter = (path: string) => Promise<void>;

export interface CredentialHarvesterDependencies {
  platform: NodeJS.Platform | string;
  username: string;
  execFile: CredentialExecFile;
  readFile: CredentialFileReader;
  deleteFile: CredentialFileDeleter;
}

const runExecFile = promisify(nodeExecFile);

const defaultExecFile: CredentialExecFile = async (executable, args) => {
  const result = await runExecFile(executable, args, { encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr };
};

const defaultReadFile: CredentialFileReader = (path, encoding) =>
  nodeReadFile(path, encoding);

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
      readFile: dependencies.readFile ?? defaultReadFile,
      deleteFile: dependencies.deleteFile ?? defaultDeleteFile,
    };
  }

  /** Return a usable credential, or null while login is absent/incomplete. */
  async harvest(configDir?: string): Promise<ClaudeUsageOAuthCredential | null> {
    let raw: string;
    try {
      if (this.dependencies.platform === "darwin") {
        const service = deriveClaudeCredentialServiceName(configDir);
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
        raw = await this.dependencies.readFile(
          this.credentialFilePath(configDir),
          "utf8"
        );
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
  async delete(configDir?: string): Promise<"deleted" | "absent"> {
    try {
      if (this.dependencies.platform === "darwin") {
        await this.dependencies.execFile("security", [
          "delete-generic-password",
          "-s",
          deriveClaudeCredentialServiceName(configDir),
          "-a",
          this.dependencies.username,
        ]);
      } else if (this.dependencies.platform === "linux") {
        await this.dependencies.deleteFile(this.credentialFilePath(configDir));
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

  private credentialFilePath(configDir?: string): string {
    if (configDir === undefined) {
      throw new CredentialHarvesterError(
        "CONFIG_DIR_REQUIRED",
        "A Claude config directory is required for file credentials"
      );
    }
    return join(configDir, ".credentials.json");
  }

  private unsupportedPlatform(): CredentialHarvesterError {
    return new CredentialHarvesterError(
      "UNSUPPORTED_PLATFORM",
      `Claude usage credential harvesting is unsupported on ${this.dependencies.platform}`
    );
  }
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
