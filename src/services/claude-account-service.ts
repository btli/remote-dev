/**
 * ClaudeAccountService — first-class Claude accounts, decoupled from profiles.
 * [remote-dev-n4x4.6 / n4x4.7 / n4x4.8]
 *
 * An account is one Claude subscription (or API key). It is NOT a config dir:
 * every session shares the user's real Claude config (skills, CLAUDE.md, MCP
 * servers, settings, agents) and picks its identity by having
 * `CLAUDE_CODE_OAUTH_TOKEN` injected into its process env. That env var selects
 * the account per-process independently of `CLAUDE_CONFIG_DIR`, which is what
 * makes N accounts + one shared config dir work with true parallelism — no
 * credential swapping, no locking, no restarts.
 *
 * Identity is read by running `claude auth status --json` UNDER the account's
 * env. Credential FILES are never parsed: on macOS the CLI stores credentials
 * in the Keychain under a service name derived from `CLAUDE_CONFIG_DIR`, so
 * `<configDir>/.claude/.credentials.json` simply does not exist and the old
 * file-reading sync could never succeed. [remote-dev-n4x4.8]
 *
 * The CLI probe alone cannot judge token LIVENESS (it reports `loggedIn: true`
 * for a dead env token), so save/verify also run a concurrent network validity
 * probe ({@link probeTokenValidity}) — and its verdict wins for `authHealthy`
 * whenever it has one; the CLI answer decides only when the network probe is
 * indeterminate. [remote-dev-307w]
 *
 * SECURITY
 *   - The OAuth token is encrypted at rest (AES-256-GCM via `@/lib/encryption`,
 *     the same helper `profile_secrets_config` uses).
 *   - The token is NEVER logged, NEVER returned by any API projection, and
 *     never written to disk by this module.
 *   - Every read/write is scoped by `userId`; a foreign account id resolves to
 *     null rather than leaking.
 */

import { db } from "@/db";
import { claudeAccounts, projectProfileLinks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { encrypt, decrypt } from "@/lib/encryption";
import {
  probeTokenValidity,
  type TokenValidity,
  type TokenValidityProbe,
} from "@/infrastructure/external/anthropic-token-validity";
import { createLogger } from "@/lib/logger";
import type {
  ClaudeAccountKind,
  ClaudeAccountSummary,
} from "@/types/claude-limits";

const log = createLogger("ClaudeAccountService");

/**
 * The command the "Add account" flow runs in a live terminal session. It prints
 * a long-lived OAuth token after the user completes the browser sign-in.
 */
export const CLAUDE_SETUP_TOKEN_COMMAND = "claude setup-token";

// Current CLI exposes `claude auth login`, which enters auth directly and
// avoids general interactive onboarding; the usage route still pre-seeds
// `.claude.json` defensively before invoking this command.
export const CLAUDE_USAGE_OAUTH_LOGIN_COMMAND = "claude auth login";

/** The env var that selects the account for a `claude` process. */
export const CLAUDE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * `typeMetadata` marker stamped on the session `POST /api/claude-accounts/
 * setup-session` creates. `POST /api/claude-accounts/capture` refuses to read a
 * token out of any session lacking it, so the capture endpoint cannot be aimed
 * at an unrelated terminal. [remote-dev-n4x4.7]
 */
export const CLAUDE_SETUP_SESSION_MARKER = "rdvClaudeSetupSession";

/**
 * Provenance marker for the isolated claude.ai login session used only to
 * capture a `user:profile`-scoped usage credential. Keeping this distinct from
 * {@link CLAUDE_SETUP_SESSION_MARKER} prevents either capture endpoint from
 * reading credentials produced by the other flow.
 */
export const CLAUDE_USAGE_SETUP_SESSION_MARKER =
  "rdvClaudeUsageSetupSession";

// ─────────────────────────────────────────────────────────────────────────────
// Identity (`claude auth status --json`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The identity fields `claude auth status --json` reports. `authMethod` is an
 * OPEN set — observed values are "none" | "claude.ai" | "oauth_token", but the
 * CLI may add more, so it is stored verbatim and never validated against an
 * enum.
 */
export interface ClaudeIdentity {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgId: string | null;
  orgName: string | null;
  subscriptionType: string | null;
}

/** The "we learned nothing" identity. */
export const UNKNOWN_IDENTITY: ClaudeIdentity = {
  loggedIn: false,
  authMethod: null,
  apiProvider: null,
  email: null,
  orgId: null,
  orgName: null,
  subscriptionType: null,
};

/**
 * Parse `claude auth status --json` output into a {@link ClaudeIdentity}.
 *
 * Tolerant by design — the CLI is an external dependency we do not control:
 *   - non-JSON, empty, or truncated output → {@link UNKNOWN_IDENTITY}
 *   - a JSON value that isn't an object (array, string, null) → UNKNOWN
 *   - unexpected field types are dropped to null rather than coerced
 *   - leading/trailing noise (banners, warnings) is tolerated by extracting the
 *     outermost JSON object before parsing
 * Never throws.
 */
export function parseAuthStatus(raw: string): ClaudeIdentity {
  const json = extractJsonObject(raw);
  if (!json) return { ...UNKNOWN_IDENTITY };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ...UNKNOWN_IDENTITY };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...UNKNOWN_IDENTITY };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    loggedIn: obj.loggedIn === true,
    authMethod: str(obj.authMethod),
    apiProvider: str(obj.apiProvider),
    email: str(obj.email),
    orgId: str(obj.orgId),
    orgName: str(obj.orgName),
    subscriptionType: str(obj.subscriptionType),
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Slice out the outermost `{...}` so banner/warning lines around the JSON don't
 * defeat the parse. Returns null when there is no balanced object at all.
 */
function extractJsonObject(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// setup-token capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `claude setup-token` prints a long-lived OAuth token of the form
 * `sk-ant-oat<NN>-<base64url>`. Matched loosely on the version digits so a
 * future `oat02` still captures.
 */
const SETUP_TOKEN_PATTERN = /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/g;

/**
 * Extract the OAuth token printed by `claude setup-token` from terminal text.
 * Returns the LAST match (a session may have been run more than once) or null.
 * Pure — the caller supplies the scrollback.
 */
export function extractSetupToken(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const matches = text.match(SETUP_TOKEN_PATTERN);
  if (!matches?.length) return null;
  return matches[matches.length - 1];
}

/**
 * Whether a string is plausibly a Claude OAuth token. Used to reject obvious
 * paste mistakes (an API key, a URL, an empty string) before we spend a CLI
 * round-trip on it. Deliberately permissive on PATTERN — the identity + network
 * probes are the real validation. Length is a separate check:
 * {@link isLikelyTruncatedToken}.
 */
export function looksLikeOAuthToken(token: string): boolean {
  return /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

/**
 * Real setup-tokens are ~108 characters. The `claude setup-token` TUI clips its
 * output at the pane width, and tmux `capture-pane -J` can only rejoin breaks
 * tmux itself wrapped — not ones the TUI authored — so an ~80-col setup pane
 * yields a 79-char fragment that still matches {@link SETUP_TOKEN_PATTERN}.
 * Verified live 2026-08-03: all three of a user's stored tokens were exactly
 * 79 chars and Anthropic 401'd every one. Anything under this floor is treated
 * as clipped rather than stored. [remote-dev-307w]
 */
export const MIN_SETUP_TOKEN_LENGTH = 100;

/**
 * Whether a pattern-matching token is too short to be a whole one — i.e. it was
 * almost certainly clipped by a terminal (capture path) or a partial copy
 * (paste path). Both API routes reject these with `TOKEN_TRUNCATED` instead of
 * letting {@link saveAccountToken} store a credential that can never work.
 */
export function isLikelyTruncatedToken(token: string): boolean {
  return token.trim().length < MIN_SETUP_TOKEN_LENGTH;
}

/**
 * Human-readable diagnosis for a `TOKEN_TRUNCATED` rejection. Shared by the
 * capture and paste routes so both paths give the same explanation.
 */
export const TRUNCATED_TOKEN_MESSAGE =
  "That token looks truncated — a full setup-token is at least 100 characters (typically ~108). " +
  "The terminal likely clipped it: widen the terminal and re-run `claude setup-token`, " +
  "or copy the full token from where you ran it and use the paste flow.";

/**
 * Human-readable diagnosis when Anthropic 401's a stored token. Surfaced by the
 * capture/paste/verify routes alongside the machine-readable `tokenValid: false`.
 */
export const INVALID_TOKEN_MESSAGE =
  "Anthropic rejected this token as invalid — it may be truncated or revoked. " +
  "Re-run `claude setup-token` and add the full token again.";

// ─────────────────────────────────────────────────────────────────────────────
// CLI seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the `claude` CLI. Injected so tests never invoke the real binary and
 * never touch the network.
 */
export type ClaudeCliRunner = (
  args: string[],
  env: Record<string, string>
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * The production runner: `claude <args>` with the caller's env layered over the
 * server env. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are blanked so a
 * stray server-side API key cannot pre-empt the account's OAuth token (auth
 * precedence puts the API key ahead of subscription credentials).
 */
export const defaultCliRunner: ClaudeCliRunner = async (args, env) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout, stderr } = await run("claude", args, {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ...env,
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/**
 * Probe the identity of an OAuth token by running `claude auth status --json`
 * with that token in the env. Best-effort: a missing binary, a timeout, or
 * unparseable output all resolve to {@link UNKNOWN_IDENTITY} rather than
 * throwing. The token never reaches a log line.
 */
export async function probeIdentity(
  token: string,
  runner: ClaudeCliRunner = defaultCliRunner
): Promise<ClaudeIdentity> {
  try {
    const { stdout, stderr, exitCode } = await runner(
      ["auth", "status", "--json"],
      { [CLAUDE_OAUTH_TOKEN_ENV]: token }
    );
    // The CLI exits non-zero for "not logged in" but still prints JSON, so
    // parse the output regardless and let `loggedIn` decide.
    const identity = parseAuthStatus(stdout || stderr);
    log.debug("Probed Claude identity", {
      exitCode,
      loggedIn: identity.loggedIn,
      authMethod: identity.authMethod ?? "unknown",
      hasEmail: identity.email !== null,
    });
    return identity;
  } catch (error) {
    log.warn("Claude identity probe failed", { error: String(error) });
    return { ...UNKNOWN_IDENTITY };
  }
}

/**
 * Probe identity from an isolated Claude config directory.
 *
 * Unlike {@link probeIdentity}, this deliberately supplies no token in the
 * environment: Claude Code must resolve only the credential associated with
 * the literal scratch `CLAUDE_CONFIG_DIR`. All ambient auth variables are
 * blanked so a server credential cannot shadow that scratch identity. The
 * probe is best-effort and shares {@link parseAuthStatus}'s tolerant parser.
 */
export async function probeScratchIdentity(
  scratchDir: string,
  runner: ClaudeCliRunner = defaultCliRunner
): Promise<ClaudeIdentity> {
  try {
    const { stdout, stderr, exitCode } = await runner(
      ["auth", "status", "--json"],
      {
        CLAUDE_CONFIG_DIR: scratchDir,
        [CLAUDE_OAUTH_TOKEN_ENV]: "",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
      }
    );
    const identity = parseAuthStatus(stdout || stderr);
    log.debug("Probed scratch Claude identity", {
      exitCode,
      loggedIn: identity.loggedIn,
      authMethod: identity.authMethod ?? "unknown",
      hasEmail: identity.email !== null,
    });
    return identity;
  } catch (error) {
    log.warn("Scratch Claude identity probe failed", {
      error: String(error),
    });
    return { ...UNKNOWN_IDENTITY };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A stable, non-reversible fingerprint of a token: `sha256(token)` truncated to
 * 128 bits, hex. Used ONLY to recognize "this is the same credential I already
 * stored" when the identity probe could not supply an email (offline, CLI
 * missing) — without it, every retry of a failing probe inserts another row.
 *
 * Safe to persist and compare: a SHA-256 preimage of a 100+ bit random token is
 * not recoverable, and the fingerprint is never returned by the API.
 */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex").slice(0, 32);
}

/**
 * Token-free projection of an account, safe to return over the API.
 * Same shape as the client wire type — kept as an alias so service callers and
 * UI types cannot drift.
 */
export type ClaudeAccountView = ClaudeAccountSummary;

type AccountRow = typeof claudeAccounts.$inferSelect;

/** Project a DB row into the token-free API view. */
export function toAccountView(row: AccountRow): ClaudeAccountView {
  return {
    id: row.id,
    alias: row.alias ?? null,
    accountKind: row.accountKind as ClaudeAccountKind,
    emailAddress: row.emailAddress ?? null,
    organizationId: row.organizationId ?? null,
    organizationName: row.organizationName ?? null,
    rateLimitTier: row.rateLimitTier ?? null,
    authMethod: row.authMethod ?? null,
    authHealthy: row.authHealthy,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.getTime() : null,
    hasToken: !!row.oauthTokenEncrypted,
    usageCredential: row.usageOauthRefreshEncrypted !== null,
    profileId: row.profileId ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** All of a user's accounts, newest-updated first. Never includes tokens. */
export async function listAccounts(
  userId: string
): Promise<ClaudeAccountView[]> {
  const rows = await db.query.claudeAccounts.findMany({
    where: eq(claudeAccounts.userId, userId),
  });
  rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return rows.map(toAccountView);
}

/** One account the user owns, or null (a foreign id is indistinguishable). */
export async function getAccount(
  accountId: string,
  userId: string
): Promise<ClaudeAccountView | null> {
  const row = await findOwnedRow(accountId, userId);
  return row ? toAccountView(row) : null;
}

/**
 * Predicate matching an account BY ID AND OWNER. Every mutation uses it so the
 * ownership check is inseparable from the write — a pre-read alone leaves a
 * TOCTOU window.
 */
function ownedBy(accountId: string, userId: string) {
  return and(
    eq(claudeAccounts.id, accountId),
    eq(claudeAccounts.userId, userId)
  );
}

async function findOwnedRow(
  accountId: string,
  userId: string
): Promise<AccountRow | null> {
  const row = await db.query.claudeAccounts.findFirst({
    where: ownedBy(accountId, userId),
  });
  return row ?? null;
}

export interface SaveAccountTokenInput {
  userId: string;
  /** The long-lived `claude setup-token` OAuth token (plaintext, in-memory). */
  token: string;
  /** Optional user-facing label. */
  alias?: string | null;
  /** Update this specific account instead of matching on identity. */
  accountId?: string | null;
}

export interface SaveAccountTokenResult {
  account: ClaudeAccountView;
  identity: ClaudeIdentity;
  /** True when an existing account was updated rather than a new one created. */
  updated: boolean;
  /**
   * Remote validity of the stored token [remote-dev-307w]: `false` when
   * Anthropic 401'd it (the machine-readable "token invalid" signal API routes
   * surface, paired with {@link INVALID_TOKEN_MESSAGE}); `true` when Anthropic
   * accepted it; `null` when the network probe was indeterminate (offline /
   * timeout) and only the CLI probe's answer is known.
   */
  tokenValid: boolean | null;
}

/** Project a probe outcome into the API-facing tri-state. */
function toTokenValid(validity: TokenValidity): boolean | null {
  if (validity === "invalid") return false;
  if (validity === "valid") return true;
  return null;
}

/**
 * Store an OAuth token as an account, creating or updating in place.
 *
 * Dedupe rule: an explicit `accountId` wins; otherwise a probed email that
 * already belongs to one of the user's accounts UPDATES that account rather
 * than creating a duplicate (contract: "re-adding a known email updates in
 * place"). When identity could not be probed (offline, no CLI) the token is
 * still stored — with `authHealthy: false` — so the user isn't blocked; a later
 * {@link verifyAccount} fills the display fields in.
 *
 * Health rule [remote-dev-307w]: the CLI identity probe does not network-check
 * the token (it says `loggedIn: true` for a dead one), so a second, remote
 * probe ({@link probeTokenValidity}) runs too and its verdict WINS whenever it
 * has one: an Anthropic 401 forces `authHealthy: false` and
 * `tokenValid: false` — but the token is STILL stored (the user may be
 * mid-diagnosis and the row keeps its identity fields) — while an Anthropic
 * accept marks the account healthy even if the CLI probe failed. Only an
 * indeterminate probe (offline) defers to the CLI's answer. The save itself
 * never fails on the network.
 *
 * @throws Error when the token is empty.
 */
export async function saveAccountToken(
  input: SaveAccountTokenInput,
  runner: ClaudeCliRunner = defaultCliRunner,
  now: Date = new Date(),
  validityProbe: TokenValidityProbe = probeTokenValidity
): Promise<SaveAccountTokenResult> {
  const token = input.token.trim();
  if (!token) {
    throw new Error("Token is required");
  }

  // Independent probes (CLI identity vs. network validity) — run concurrently
  // so the worst case is max(30s CLI, 10s network), not their sum.
  const [identity, validity] = await Promise.all([
    probeIdentity(token, runner),
    validityProbe(token),
  ]);
  const fingerprint = tokenFingerprint(token);

  // Dedupe, in priority order:
  //   1. an explicit accountId — the caller said WHICH account to update;
  //   2. the probed email — "re-adding a known email updates in place";
  //   3. the token fingerprint — the identity probe told us nothing (offline,
  //      no CLI), so fall back to "same credential ⇒ same account" instead of
  //      inserting a fresh row on every retry.
  let existing: AccountRow | null = null;
  if (input.accountId) {
    existing = await findOwnedRow(input.accountId, input.userId);
    if (!existing) {
      // The caller asked to update a specific account and it isn't theirs (or
      // doesn't exist). Silently creating a NEW one would be a surprising,
      // duplicate-producing answer to "update X" — fail instead.
      throw new AccountNotFoundError(input.accountId);
    }
  } else if (identity.email) {
    existing = await findRowByEmail(input.userId, identity.email);
  } else {
    existing = await findRowByFingerprint(input.userId, fingerprint);
  }

  const tokenValid = toTokenValid(validity);
  const columns = {
    alias: input.alias ?? existing?.alias ?? null,
    ...identityDisplayColumns(identity, existing),
    // Network verdict first, CLI as the fallback: Anthropic accepting or
    // rejecting the Bearer token is ground truth for credential liveness,
    // while the CLI probe can fail for environmental reasons (missing binary,
    // crash, --json shape change) that say nothing about the token. So a
    // confirmed-valid token is healthy even when the CLI probe failed, a
    // confirmed-invalid one is unhealthy even when the CLI claims loggedIn,
    // and only an indeterminate probe (offline) defers to the CLI's answer.
    authHealthy: tokenValid ?? identity.loggedIn,
    lastVerifiedAt: now,
    oauthTokenEncrypted: encrypt(token),
    tokenFingerprint: fingerprint,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(claudeAccounts)
      .set(columns)
      // userId in the predicate, not just the pre-read: the ownership check and
      // the write must not be separable (TOCTOU).
      .where(ownedBy(existing.id, input.userId));
    const row = await findOwnedRow(existing.id, input.userId);
    log.info("Updated Claude account from token", {
      accountId: existing.id,
      loggedIn: identity.loggedIn,
      hasEmail: identity.email !== null,
      tokenValid,
    });
    return {
      account: toAccountView(row as AccountRow),
      identity,
      updated: true,
      tokenValid,
    };
  }

  const id = crypto.randomUUID();
  await db.insert(claudeAccounts).values({
    id,
    userId: input.userId,
    accountKind: "subscription",
    ...columns,
  });
  const row = await findOwnedRow(id, input.userId);
  log.info("Created Claude account from token", {
    accountId: id,
    loggedIn: identity.loggedIn,
    hasEmail: identity.email !== null,
    tokenValid,
  });
  return {
    account: toAccountView(row as AccountRow),
    identity,
    updated: false,
    tokenValid,
  };
}

/** Thrown when a caller names an account that is not theirs (or absent). */
export class AccountNotFoundError extends Error {
  constructor(accountId: string) {
    super("Claude account not found");
    this.name = "AccountNotFoundError";
    this.accountId = accountId;
  }
  readonly accountId: string;
}

async function findRowByFingerprint(
  userId: string,
  fingerprint: string
): Promise<AccountRow | null> {
  const row = await db.query.claudeAccounts.findFirst({
    where: and(
      eq(claudeAccounts.userId, userId),
      eq(claudeAccounts.tokenFingerprint, fingerprint)
    ),
  });
  return row ?? null;
}

async function findRowByEmail(
  userId: string,
  email: string
): Promise<AccountRow | null> {
  const row = await db.query.claudeAccounts.findFirst({
    where: and(
      eq(claudeAccounts.userId, userId),
      eq(claudeAccounts.emailAddress, email)
    ),
  });
  return row ?? null;
}

/** What a {@link verifyAccount} re-probe learned. */
export interface VerifyAccountResult {
  account: ClaudeAccountView;
  identity: ClaudeIdentity;
  /** Same tri-state as {@link SaveAccountTokenResult.tokenValid}. */
  tokenValid: boolean | null;
}

/**
 * Re-probe an account's identity with its stored token and refresh the display
 * fields. This is the replacement for the dead file-reading "Sync" button
 * [remote-dev-n4x4.8]. Returns null when the account isn't the user's.
 *
 * An account with no stored token is marked unhealthy (there is nothing to
 * probe with) rather than left showing a stale "logged in". Like
 * {@link saveAccountToken}, health takes the remote validity probe's verdict
 * when it has one (a 401'd token is unhealthy even though the CLI claims
 * `loggedIn: true`; a network-confirmed token is healthy even when the CLI
 * probe failed) and defers to the CLI only when the network probe is
 * indeterminate. [remote-dev-307w]
 */
export async function verifyAccount(
  accountId: string,
  userId: string,
  runner: ClaudeCliRunner = defaultCliRunner,
  now: Date = new Date(),
  validityProbe: TokenValidityProbe = probeTokenValidity
): Promise<VerifyAccountResult | null> {
  const row = await findOwnedRow(accountId, userId);
  if (!row) return null;

  if (!row.oauthTokenEncrypted) {
    return markAccountUnhealthy(accountId, userId, now);
  }

  const token = decryptToken(row.oauthTokenEncrypted, accountId);
  if (!token) {
    return markAccountUnhealthy(accountId, userId, now);
  }

  // Independent probes, run concurrently (same seam as saveAccountToken).
  const [identity, validity] = await Promise.all([
    probeIdentity(token, runner),
    validityProbe(token),
  ]);
  const tokenValid = toTokenValid(validity);
  await db
    .update(claudeAccounts)
    .set({
      // Keep the last-known display fields when a probe comes back blank
      // (offline / CLI missing) instead of wiping a working account's UI.
      ...identityDisplayColumns(identity, row),
      // Network verdict first, CLI as fallback — see saveAccountToken: the
      // network answer is ground truth for credential liveness; the CLI probe
      // can fail environmentally without saying anything about the token.
      authHealthy: tokenValid ?? identity.loggedIn,
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .where(ownedBy(accountId, userId));

  const refreshed = await findOwnedRow(accountId, userId);
  return { account: toAccountView(refreshed as AccountRow), identity, tokenValid };
}

/**
 * Map a probed identity onto the display columns of `claude_account`, keeping
 * any previously-known values when the probe returns blanks.
 */
function identityDisplayColumns(
  identity: ClaudeIdentity,
  fallback: AccountRow | null | undefined
) {
  return {
    emailAddress: identity.email ?? fallback?.emailAddress ?? null,
    organizationId: identity.orgId ?? fallback?.organizationId ?? null,
    organizationName: identity.orgName ?? fallback?.organizationName ?? null,
    rateLimitTier:
      identity.subscriptionType ?? fallback?.rateLimitTier ?? null,
    authMethod: identity.authMethod ?? fallback?.authMethod ?? null,
  };
}

/** Mark an account unhealthy and return the UNKNOWN identity projection. */
async function markAccountUnhealthy(
  accountId: string,
  userId: string,
  now: Date
): Promise<VerifyAccountResult> {
  await db
    .update(claudeAccounts)
    .set({ authHealthy: false, lastVerifiedAt: now, updatedAt: now })
    .where(ownedBy(accountId, userId));
  const refreshed = await findOwnedRow(accountId, userId);
  return {
    account: toAccountView(refreshed as AccountRow),
    identity: { ...UNKNOWN_IDENTITY },
    // No token was probed, so remote validity is unknown by construction.
    tokenValid: null,
  };
}

/** Rename / relabel an account. Returns null when it isn't the user's. */
export async function updateAccount(
  accountId: string,
  userId: string,
  patch: { alias?: string | null; accountKind?: ClaudeAccountKind },
  now: Date = new Date()
): Promise<ClaudeAccountView | null> {
  const row = await findOwnedRow(accountId, userId);
  if (!row) return null;
  await db
    .update(claudeAccounts)
    .set({
      ...(patch.alias !== undefined ? { alias: patch.alias } : {}),
      ...(patch.accountKind ? { accountKind: patch.accountKind } : {}),
      updatedAt: now,
    })
    .where(ownedBy(accountId, userId));
  const refreshed = await findOwnedRow(accountId, userId);
  return refreshed ? toAccountView(refreshed) : null;
}

/**
 * Delete an account (cascading its usage-limit state + pool memberships via
 * their FKs) and clear any project link that pinned it. `project_profile_link`
 * carries no DB-level FK on purpose (push idempotency), so that set-null is
 * enforced here. Returns false when the account isn't the user's.
 */
export async function deleteAccount(
  accountId: string,
  userId: string
): Promise<boolean> {
  const row = await findOwnedRow(accountId, userId);
  if (!row) return false;
  await db
    .update(projectProfileLinks)
    .set({ accountId: null })
    .where(eq(projectProfileLinks.accountId, accountId));
  await db.delete(claudeAccounts).where(ownedBy(accountId, userId));
  log.info("Deleted Claude account", { accountId });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage OAuth credential boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimal decrypted credential refresh needs. Keeping this type here makes
 * the account service the sole owner of persistence and encryption details;
 * infrastructure callers never import Drizzle or receive session credentials.
 */
export interface OwnedUsageCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Complete credential captured from Claude Code's isolated login. The open
 * scope set and provider display strings are stored without narrowing them to
 * enums so future Claude Code additions remain usable.
 */
export interface InitialUsageCredential {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds, matching Claude Code's credential payload. */
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

/**
 * Attach the first usage credential to one existing, owner-scoped account.
 *
 * This operation never inserts a row and includes both account id and user id
 * in the mutation predicate. The session credential and its health columns
 * are intentionally absent from the SET clause: usage polling and session
 * authentication are independent credential classes. A fresh token-free view
 * is returned after the write; an absent/foreign account resolves to null.
 */
export async function storeInitialUsageCredential(
  accountId: string,
  userId: string,
  credential: InitialUsageCredential,
  identity: ClaudeIdentity,
  now: Date = new Date()
): Promise<ClaudeAccountView | null> {
  const existing = await findOwnedRow(accountId, userId);
  if (!existing) return null;

  const identityColumns = identityDisplayColumns(identity, existing);
  const credentialTier =
    nonBlank(credential.rateLimitTier) ??
    nonBlank(credential.subscriptionType);

  await db
    .update(claudeAccounts)
    .set({
      usageOauthAccessEncrypted: encrypt(credential.accessToken),
      usageOauthRefreshEncrypted: encrypt(credential.refreshToken),
      usageOauthExpiresAt: new Date(credential.expiresAt),
      usageOauthScopes: JSON.stringify(credential.scopes),
      ...identityColumns,
      rateLimitTier: credentialTier ?? identityColumns.rateLimitTier,
      updatedAt: now,
    })
    .where(ownedBy(accountId, userId));

  const refreshed = await findOwnedRow(accountId, userId);
  return refreshed ? toAccountView(refreshed) : null;
}

function nonBlank(value: string | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Read a complete usage credential by account id AND owner. Foreign, missing,
 * partial, invalid-expiry, and undecryptable rows all collapse to null. This
 * intentionally never falls back to `oauthTokenEncrypted`: setup-tokens lack
 * the `user:profile` scope required by the usage endpoint.
 */
export async function readOwnedUsageCredential(
  accountId: string,
  userId: string
): Promise<OwnedUsageCredential | null> {
  const row = await db.query.claudeAccounts.findFirst({
    where: ownedBy(accountId, userId),
    columns: {
      usageOauthAccessEncrypted: true,
      usageOauthRefreshEncrypted: true,
      usageOauthExpiresAt: true,
    },
  });
  if (
    !row?.usageOauthAccessEncrypted ||
    !row.usageOauthRefreshEncrypted ||
    !(row.usageOauthExpiresAt instanceof Date) ||
    !Number.isFinite(row.usageOauthExpiresAt.getTime())
  ) {
    return null;
  }

  const accessToken = decryptUsageToken(
    row.usageOauthAccessEncrypted,
    accountId,
    "access"
  );
  if (accessToken === null) {
    await quarantineUsageCredential(accountId, userId);
    return null;
  }
  const refreshToken = decryptUsageToken(
    row.usageOauthRefreshEncrypted,
    accountId,
    "refresh"
  );
  if (refreshToken === null) {
    await quarantineUsageCredential(accountId, userId);
    return null;
  }
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: row.usageOauthExpiresAt };
}

export interface RefreshedUsageCredential {
  accessToken: string;
  expiresAt: Date;
  /** Omitted when Anthropic did not rotate the current refresh token. */
  refreshToken?: string;
}

/**
 * Store a successful OAuth refresh under one ownership-scoped mutation.
 * Omitting `refreshToken` deliberately omits that column from the SET clause,
 * preserving its existing encrypted value byte-for-byte.
 */
export async function storeRefreshedUsageCredential(
  accountId: string,
  userId: string,
  credential: RefreshedUsageCredential
): Promise<void> {
  await db
    .update(claudeAccounts)
    .set({
      usageOauthAccessEncrypted: encrypt(credential.accessToken),
      usageOauthExpiresAt: credential.expiresAt,
      ...(credential.refreshToken !== undefined
        ? { usageOauthRefreshEncrypted: encrypt(credential.refreshToken) }
        : {}),
    })
    .where(ownedBy(accountId, userId));
}

/**
 * Quarantine a rejected usage refresh token by nulling ONLY the four usage
 * columns. Session health and `oauthTokenEncrypted` are a separate credential
 * class and must remain untouched.
 */
export async function quarantineUsageCredential(
  accountId: string,
  userId: string
): Promise<void> {
  await db
    .update(claudeAccounts)
    .set({
      usageOauthAccessEncrypted: null,
      usageOauthRefreshEncrypted: null,
      usageOauthExpiresAt: null,
      usageOauthScopes: null,
    })
    .where(ownedBy(accountId, userId));
}

/** Decrypt a usage token without ever placing token material in a log line. */
function decryptUsageToken(
  encrypted: string,
  accountId: string,
  credentialPart: "access" | "refresh"
): string | null {
  try {
    return decrypt(encrypted);
  } catch (error) {
    log.error("Failed to decrypt stored Claude usage OAuth credential", {
      accountId,
      credentialPart,
      error: String(error),
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session env injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why an account could not supply a session credential.
 *  - `not_found`    — no such account, OR it belongs to another user. The two
 *                     are deliberately indistinguishable so nothing leaks.
 *  - `no_token`     — the account exists but has no stored OAuth token yet
 *                     (e.g. migrated from a pre-n4x4.6 profile; the user has
 *                     not run "Add account" for it).
 *  - `decrypt_failed` — a token is stored but could not be decrypted, e.g.
 *                     `AUTH_SECRET` was rotated.
 */
export type AccountEnvFailure = "not_found" | "no_token" | "decrypt_failed";

/** The single ownership-scoped resolution of an account into session env. */
export type AccountEnvResolution =
  | { ok: true; accountId: string; env: Record<string, string> }
  | { ok: false; reason: AccountEnvFailure };

/** Human-readable reason, safe to return in an API error body. */
export function describeAccountEnvFailure(reason: AccountEnvFailure): string {
  switch (reason) {
    case "not_found":
      return "Claude account not found";
    case "no_token":
      return "That Claude account has no stored credential yet — add it again from Settings → Claude Accounts";
    case "decrypt_failed":
      return "That Claude account's stored credential could not be decrypted — re-add the account";
  }
}

/**
 * Resolve an account into the env fragment a session must run with to act as
 * it: `{ CLAUDE_CODE_OAUTH_TOKEN: <token> }`.
 *
 * This is the ONE ownership-scoped operation callers should use: it checks
 * ownership, presence of a token, and decryptability together, and reports
 * exactly which of those failed. Callers must NOT record the account id on a
 * session unless this returns `ok: true` — otherwise the session launches on
 * whatever ambient credential the shared config dir resolves to while usage
 * limits get attributed to an account it never actually used.
 *
 * Callers must treat `env` as a secret: merge it into the PTY env and never log
 * or echo it.
 */
export async function resolveAccountEnv(
  accountId: string,
  userId: string
): Promise<AccountEnvResolution> {
  const row = await findOwnedRow(accountId, userId);
  if (!row) {
    log.debug("Claude account not resolvable for user", { accountId });
    return { ok: false, reason: "not_found" };
  }
  if (!row.oauthTokenEncrypted) {
    log.debug("Claude account has no stored token", { accountId });
    return { ok: false, reason: "no_token" };
  }
  const token = decryptToken(row.oauthTokenEncrypted, accountId);
  if (!token) return { ok: false, reason: "decrypt_failed" };
  return { ok: true, accountId, env: { [CLAUDE_OAUTH_TOKEN_ENV]: token } };
}

/**
 * Resolve the account for an explicitly-pinned PROFILE, for sessions that
 * bypass pool selection. Uses the retained `profile_id` origin breadcrumb;
 * returns null when the profile has no account.
 */
export async function findAccountIdForProfile(
  profileId: string,
  userId: string
): Promise<string | null> {
  const row = await db.query.claudeAccounts.findFirst({
    where: and(
      eq(claudeAccounts.profileId, profileId),
      eq(claudeAccounts.userId, userId)
    ),
    columns: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Decrypt a stored token, returning null (and logging, WITHOUT the ciphertext)
 * when the value can't be decrypted — e.g. `AUTH_SECRET` rotated. A corrupt
 * token must degrade to "no account env", never crash a session launch.
 */
function decryptToken(encrypted: string, accountId: string): string | null {
  try {
    return decrypt(encrypted);
  } catch (error) {
    log.error("Failed to decrypt stored Claude OAuth token", {
      accountId,
      error: String(error),
    });
    return null;
  }
}
