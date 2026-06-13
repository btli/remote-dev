/**
 * ClaudeLoginService - per-profile, FILE-BASED Claude subscription login. [remote-dev-6nu9]
 *
 * Goal: log a Claude subscription account into a SPECIFIC profile so its OAuth
 * credentials are FILE-BASED (a `.credentials.json` inside the profile's
 * `CLAUDE_CONFIG_DIR`) rather than the macOS Keychain, then capture the
 * account's email / subscription tier and keep the `claude_account` row in sync.
 *
 * Why file-based matters
 * ----------------------
 *   - Linux/Windows: Claude Code already stores `.credentials.json` under
 *     `CLAUDE_CONFIG_DIR` — file-based by default.
 *   - macOS: Claude Code stores credentials in the Keychain UNLESS a
 *     `.credentials.json` already exists at the config path, in which case it
 *     reads/writes that file (the same fallback used for SSH/headless). So the
 *     mechanism that forces file-based creds on macOS is: point
 *     `CLAUDE_CONFIG_DIR` at the profile dir AND ensure the `.credentials.json`
 *     file exists there before login. {@link buildLoginEnv} sets the env;
 *     {@link prepareFileBasedLogin} seeds the file.
 *
 * The OAuth/MFA step itself is interactive (the user's browser): this service
 * does NOT drive a browser. It (1) constructs the right env + command so the
 * `claude` CLI writes creds into the profile dir, (2) lets the caller surface
 * that to the UI / run it in a profile-bound session, and (3) reads the
 * resulting `.credentials.json` + `.claude.json` back to upsert the account.
 *
 * SECURITY: tokens NEVER leave this module and are NEVER logged. Only redacted,
 * token-free projections are returned/serialized. The full creds stay in the
 * profile's file (managed by the CLI); we persist only display fields
 * (email / tier / kind) to `claude_account`.
 */

import { db } from "@/db";
import { claudeAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readFile, writeFile, mkdir, access, constants } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import { ClaudeCredentials } from "@/domain/value-objects/ClaudeCredentials";
import * as AgentProfileService from "@/services/agent-profile-service";
import { isClaudeCapable } from "@/app/api/_lib/serialize-limit-state";
import type { ClaudeAccountKind } from "@/types/claude-limits";

const log = createLogger("ClaudeLogin");

/**
 * The `claude` CLI subcommand that runs the interactive OAuth login. The user
 * launches this in a profile-bound terminal session; with the env from
 * {@link buildLoginEnv} the resulting creds land in the profile dir.
 */
export const CLAUDE_LOGIN_COMMAND = "claude /login";

/** Display + expiry status for a profile's Claude login, safe to return/log. */
export interface ClaudeAuthStatus {
  /** True when a usable `.credentials.json` with an access token was found. */
  loggedIn: boolean;
  /** Where creds live: "file" once a file-based login is detected; else null. */
  credentialMode: "file" | "keychain" | null;
  email: string | null;
  organizationName: string | null;
  /** Subscription tier (e.g. "pro" | "max"), when disclosed. */
  tier: string | null;
  /** Epoch-ms access-token expiry, or null if unknown. */
  expiresAt: number | null;
  /** True when the token is expired (or within the skew window). */
  expired: boolean;
  /**
   * True when the user should re-run login: expired AND no refresh token to
   * refresh server-side. (The CLI refreshes on use when a refresh token is
   * present, so a refreshable expiry is not a re-login.)
   */
  needsRelogin: boolean;
}

/** Outcome of {@link initiateLogin}: what the caller surfaces to the UI. */
export interface ClaudeLoginInitiation {
  /** The command to run in a profile-bound session to complete OAuth. */
  command: string;
  /** Absolute `CLAUDE_CONFIG_DIR` the creds will be written to. */
  configDir: string;
  /** Env the session must run with to force file-based creds. */
  env: Record<string, string>;
  /** Human-readable next steps (the browser/MFA step is the user's). */
  instructions: string[];
}

/**
 * The absolute Claude config dir for a profile: `<profileConfigDir>/.claude`.
 * This is what `CLAUDE_CONFIG_DIR` is set to (matches ProfileIsolation).
 */
export function claudeConfigDirFor(profileConfigDir: string): string {
  return join(profileConfigDir, ".claude");
}

/** Path to the file-based credentials file for a profile. */
export function credentialsPathFor(profileConfigDir: string): string {
  return join(claudeConfigDirFor(profileConfigDir), ".credentials.json");
}

/** Path to the `.claude.json` (carries `oauthAccount`) for a profile. */
export function claudeJsonPathFor(profileConfigDir: string): string {
  return join(claudeConfigDirFor(profileConfigDir), ".claude.json");
}

/**
 * Build the environment that forces the `claude` CLI to use FILE-BASED creds in
 * the profile's config dir. Pure given the dir — unit-testable without fs.
 *
 * `CLAUDE_CONFIG_DIR` points the CLI at the profile's `.claude` dir for BOTH
 * config (`.claude.json`) and creds (`.credentials.json`). We also unset the
 * inherited API-key vars so a stray `ANTHROPIC_API_KEY` in the server env can't
 * pre-empt the subscription OAuth login (auth precedence puts the API key
 * ahead of subscription creds).
 */
export function buildLoginEnv(profileConfigDir: string): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: claudeConfigDirFor(profileConfigDir),
    // Defensive: keep API-key precedence from hijacking the subscription login.
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
  };
}

/**
 * Ensure the profile's `.claude` dir exists and a `.credentials.json` file is
 * present so macOS takes the file-based path. If a credentials file already
 * exists it is left untouched; otherwise an EMPTY placeholder is written (the
 * CLI overwrites it on successful login). Returns the credentials path.
 *
 * The placeholder is a structurally-valid-but-token-less JSON object so a
 * read-back before login parses to "not logged in" (null) rather than throwing.
 */
export async function prepareFileBasedLogin(
  profileConfigDir: string
): Promise<string> {
  const configDir = claudeConfigDirFor(profileConfigDir);
  await mkdir(configDir, { recursive: true });
  const credsPath = credentialsPathFor(profileConfigDir);
  if (!(await fileExists(credsPath))) {
    // Empty object → ClaudeCredentials.parse() returns null (not-logged-in),
    // and the CLI replaces it on a successful login. mode 0600 like the CLI.
    await writeFile(credsPath, "{}\n", { mode: 0o600 });
    log.debug("Seeded placeholder credentials file for file-based login", {
      configDir,
    });
  }
  return credsPath;
}

/**
 * Initiate a file-based login for a profile: verify ownership + claude
 * capability, seed the file-based path, and return the command + env + steps
 * for the caller to surface. Does NOT run the CLI (the OAuth step is the
 * user's). Never returns a token.
 *
 * @throws Error when the profile is missing or not claude-capable.
 */
export async function initiateLogin(
  profileId: string,
  userId: string
): Promise<ClaudeLoginInitiation> {
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) {
    throw new Error("Profile not found");
  }
  if (!isClaudeCapable(profile.provider)) {
    throw new Error("Profile is not Claude-capable");
  }

  const configDir = claudeConfigDirFor(profile.configDir);
  await prepareFileBasedLogin(profile.configDir);

  log.info("Initiated file-based Claude login", { profileId });

  return {
    command: CLAUDE_LOGIN_COMMAND,
    configDir,
    env: buildLoginEnv(profile.configDir),
    instructions: [
      `Open a Claude session for this profile and run: ${CLAUDE_LOGIN_COMMAND}`,
      "Complete the browser sign-in (and MFA) when prompted; paste the code back into the terminal if asked.",
      "Return here and choose Sync to capture the account email and tier.",
    ],
  };
}

/**
 * Read the profile's file-based credentials, or null when none/placeholder.
 * Tolerant of a missing or half-written file (login in progress).
 */
export async function readProfileCredentials(
  profileConfigDir: string
): Promise<ClaudeCredentials | null> {
  const credsPath = credentialsPathFor(profileConfigDir);
  let raw: string;
  try {
    raw = await readFile(credsPath, "utf-8");
  } catch {
    return null; // not logged in yet
  }
  return ClaudeCredentials.parse(raw);
}

/** The `oauthAccount` display fields read from `.claude.json`. */
export interface OauthAccountInfo {
  emailAddress: string | null;
  organizationName: string | null;
}

/**
 * Read `oauthAccount` (email / org) from the profile's `.claude.json`. Returns
 * empty fields when absent/unreadable — display info is best-effort.
 */
export async function readOauthAccount(
  profileConfigDir: string
): Promise<OauthAccountInfo> {
  const path = claudeJsonPathFor(profileConfigDir);
  try {
    const raw = await readFile(path, "utf-8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const oauth = obj.oauthAccount;
    if (oauth && typeof oauth === "object") {
      const o = oauth as Record<string, unknown>;
      return {
        emailAddress:
          typeof o.emailAddress === "string" ? o.emailAddress : null,
        organizationName:
          typeof o.organizationName === "string"
            ? o.organizationName
            : typeof o.organizationName === "object" &&
                o.organizationName !== null
              ? readNestedName(o.organizationName)
              : null,
      };
    }
  } catch {
    // ignore — best-effort
  }
  return { emailAddress: null, organizationName: null };
}

/** Some CLI versions nest org as `{ name }`; read it defensively. */
function readNestedName(obj: object): string | null {
  const name = (obj as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

/**
 * Sync the `claude_account` row from the profile's file-based credentials +
 * `.claude.json`. Upserts email / tier / kind=subscription / credentialMode=file
 * when a usable login is found. Returns the post-sync auth status (token-free).
 *
 * Idempotent: safe to call repeatedly (e.g. after the user completes login).
 * When NO usable credentials exist yet, the row is NOT created — the status
 * comes back `loggedIn:false` so the UI can keep prompting.
 *
 * @throws Error when the profile is missing or not claude-capable.
 */
export async function syncAccountFromCredentials(
  profileId: string,
  userId: string,
  now: Date = new Date()
): Promise<ClaudeAuthStatus> {
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) {
    throw new Error("Profile not found");
  }
  if (!isClaudeCapable(profile.provider)) {
    throw new Error("Profile is not Claude-capable");
  }

  const creds = await readProfileCredentials(profile.configDir);
  if (!creds) {
    log.debug("No file-based credentials to sync", { profileId });
    return {
      loggedIn: false,
      credentialMode: null,
      email: null,
      organizationName: null,
      tier: null,
      expiresAt: null,
      expired: false,
      needsRelogin: false,
    };
  }

  const account = await readOauthAccount(profile.configDir);
  const tier = creds.getSubscriptionType();
  const expiresAt = creds.getExpiresAt();
  const kind: ClaudeAccountKind = "subscription";

  // Upsert the display fields. Never persist the token (it stays in the file).
  await db
    .insert(claudeAccounts)
    .values({
      profileId,
      userId,
      accountKind: kind,
      credentialMode: "file",
      emailAddress: account.emailAddress,
      organizationName: account.organizationName,
      rateLimitTier: tier,
    })
    .onConflictDoUpdate({
      target: claudeAccounts.profileId,
      set: {
        userId,
        accountKind: kind,
        credentialMode: "file",
        emailAddress: account.emailAddress,
        organizationName: account.organizationName,
        rateLimitTier: tier,
        updatedAt: new Date(),
      },
    });

  log.info("Synced Claude account from file-based credentials", {
    profileId,
    // Redacted projection only — no token, no raw email beyond presence.
    hasEmail: account.emailAddress !== null,
    tier: tier ?? "unknown",
    ...creds.redacted(),
  });

  const expired = creds.isExpired(now);
  return {
    loggedIn: true,
    credentialMode: "file",
    email: account.emailAddress,
    organizationName: account.organizationName,
    tier,
    expiresAt: expiresAt ? expiresAt.getTime() : null,
    expired,
    // Re-login only when expired AND not refreshable. The CLI refreshes a token
    // with a refresh token on its next use, so a refreshable expiry is fine.
    needsRelogin: expired && !creds.canRefresh(),
  };
}

/**
 * Current auth status for a profile WITHOUT upserting (read-only). Used by the
 * UI to show "logged in as <email>, expires in …" / "re-login needed".
 *
 * @throws Error when the profile is missing or not claude-capable.
 */
export async function getAuthStatus(
  profileId: string,
  userId: string,
  now: Date = new Date()
): Promise<ClaudeAuthStatus> {
  const profile = await AgentProfileService.getProfile(profileId, userId);
  if (!profile) {
    throw new Error("Profile not found");
  }
  if (!isClaudeCapable(profile.provider)) {
    throw new Error("Profile is not Claude-capable");
  }

  const creds = await readProfileCredentials(profile.configDir);

  // Prefer stored display fields (synced) but fall back to live file reads so a
  // freshly-completed login shows even before a Sync.
  const row = await db.query.claudeAccounts.findFirst({
    where: eq(claudeAccounts.profileId, profileId),
    columns: {
      emailAddress: true,
      organizationName: true,
      rateLimitTier: true,
      credentialMode: true,
    },
  });

  if (!creds) {
    return {
      loggedIn: false,
      credentialMode:
        (row?.credentialMode as "file" | "keychain" | null) ?? null,
      email: row?.emailAddress ?? null,
      organizationName: row?.organizationName ?? null,
      tier: row?.rateLimitTier ?? null,
      expiresAt: null,
      expired: false,
      needsRelogin: false,
    };
  }

  const account = await readOauthAccount(profile.configDir);
  const expiresAt = creds.getExpiresAt();
  const expired = creds.isExpired(now);
  return {
    loggedIn: true,
    credentialMode: "file",
    email: account.emailAddress ?? row?.emailAddress ?? null,
    organizationName:
      account.organizationName ?? row?.organizationName ?? null,
    tier: creds.getSubscriptionType() ?? row?.rateLimitTier ?? null,
    expiresAt: expiresAt ? expiresAt.getTime() : null,
    expired,
    needsRelogin: expired && !creds.canRefresh(),
  };
}

/** Whether a path exists (file or dir). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
