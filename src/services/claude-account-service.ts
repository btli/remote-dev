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
import { createLogger } from "@/lib/logger";
import type { ClaudeAccountKind } from "@/types/claude-limits";

const log = createLogger("ClaudeAccountService");

/**
 * The command the "Add account" flow runs in a live terminal session. It prints
 * a long-lived OAuth token after the user completes the browser sign-in.
 */
export const CLAUDE_SETUP_TOKEN_COMMAND = "claude setup-token";

/** The env var that selects the account for a `claude` process. */
export const CLAUDE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

/**
 * `typeMetadata` marker stamped on the session `POST /api/claude-accounts/
 * setup-session` creates. `POST /api/claude-accounts/capture` refuses to read a
 * token out of any session lacking it, so the capture endpoint cannot be aimed
 * at an unrelated terminal. [remote-dev-n4x4.7]
 */
export const CLAUDE_SETUP_SESSION_MARKER = "rdvClaudeSetupSession";

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
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

/**
 * Whether a string is plausibly a Claude OAuth token. Used to reject obvious
 * paste mistakes (an API key, a URL, an empty string) before we spend a CLI
 * round-trip on it. Deliberately permissive — the identity probe is the real
 * validation.
 */
export function looksLikeOAuthToken(token: string): boolean {
  return /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

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

/** The token-free projection of an account, safe to return over the API. */
export interface ClaudeAccountView {
  id: string;
  alias: string | null;
  accountKind: ClaudeAccountKind;
  emailAddress: string | null;
  organizationId: string | null;
  organizationName: string | null;
  rateLimitTier: string | null;
  authMethod: string | null;
  authHealthy: boolean;
  lastVerifiedAt: number | null;
  /** True when an encrypted OAuth token is stored (the token itself never is). */
  hasToken: boolean;
  /** Legacy origin profile, when this account was migrated from one. */
  profileId: string | null;
  createdAt: number;
  updatedAt: number;
}

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
    where: and(
      eq(claudeAccounts.id, accountId),
      eq(claudeAccounts.userId, userId)
    ),
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
 * @throws Error when the token is empty.
 */
export async function saveAccountToken(
  input: SaveAccountTokenInput,
  runner: ClaudeCliRunner = defaultCliRunner,
  now: Date = new Date()
): Promise<SaveAccountTokenResult> {
  const token = input.token.trim();
  if (!token) {
    throw new Error("Token is required");
  }

  const identity = await probeIdentity(token, runner);
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

  const columns = {
    alias: input.alias ?? existing?.alias ?? null,
    emailAddress: identity.email ?? existing?.emailAddress ?? null,
    organizationId: identity.orgId ?? existing?.organizationId ?? null,
    organizationName: identity.orgName ?? existing?.organizationName ?? null,
    rateLimitTier:
      identity.subscriptionType ?? existing?.rateLimitTier ?? null,
    authMethod: identity.authMethod ?? existing?.authMethod ?? null,
    authHealthy: identity.loggedIn,
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
      .where(
        and(
          eq(claudeAccounts.id, existing.id),
          eq(claudeAccounts.userId, input.userId)
        )
      );
    const row = await findOwnedRow(existing.id, input.userId);
    log.info("Updated Claude account from token", {
      accountId: existing.id,
      loggedIn: identity.loggedIn,
      hasEmail: identity.email !== null,
    });
    return {
      account: toAccountView(row as AccountRow),
      identity,
      updated: true,
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
  });
  return { account: toAccountView(row as AccountRow), identity, updated: false };
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

/**
 * Re-probe an account's identity with its stored token and refresh the display
 * fields. This is the replacement for the dead file-reading "Sync" button
 * [remote-dev-n4x4.8]. Returns null when the account isn't the user's.
 *
 * An account with no stored token is marked unhealthy (there is nothing to
 * probe with) rather than left showing a stale "logged in".
 */
export async function verifyAccount(
  accountId: string,
  userId: string,
  runner: ClaudeCliRunner = defaultCliRunner,
  now: Date = new Date()
): Promise<{ account: ClaudeAccountView; identity: ClaudeIdentity } | null> {
  const row = await findOwnedRow(accountId, userId);
  if (!row) return null;

  if (!row.oauthTokenEncrypted) {
    await db
      .update(claudeAccounts)
      .set({ authHealthy: false, lastVerifiedAt: now, updatedAt: now })
      .where(ownedBy(accountId, userId));
    const refreshed = await findOwnedRow(accountId, userId);
    return {
      account: toAccountView(refreshed as AccountRow),
      identity: { ...UNKNOWN_IDENTITY },
    };
  }

  const token = decryptToken(row.oauthTokenEncrypted, accountId);
  if (!token) {
    await db
      .update(claudeAccounts)
      .set({ authHealthy: false, lastVerifiedAt: now, updatedAt: now })
      .where(ownedBy(accountId, userId));
    const refreshed = await findOwnedRow(accountId, userId);
    return {
      account: toAccountView(refreshed as AccountRow),
      identity: { ...UNKNOWN_IDENTITY },
    };
  }

  const identity = await probeIdentity(token, runner);
  await db
    .update(claudeAccounts)
    .set({
      // Keep the last-known display fields when a probe comes back blank
      // (offline / CLI missing) instead of wiping a working account's UI.
      emailAddress: identity.email ?? row.emailAddress ?? null,
      organizationId: identity.orgId ?? row.organizationId ?? null,
      organizationName: identity.orgName ?? row.organizationName ?? null,
      rateLimitTier: identity.subscriptionType ?? row.rateLimitTier ?? null,
      authMethod: identity.authMethod ?? row.authMethod ?? null,
      authHealthy: identity.loggedIn,
      lastVerifiedAt: now,
      updatedAt: now,
    })
    .where(ownedBy(accountId, userId));

  const refreshed = await findOwnedRow(accountId, userId);
  return { account: toAccountView(refreshed as AccountRow), identity };
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
