// @vitest-environment node
/**
 * Tests for ClaudeAccountService — the Claude-account CRUD + identity +
 * credential path introduced by [remote-dev-n4x4.6 / n4x4.7 / n4x4.8].
 *
 * The `claude` CLI is ALWAYS injected as a fake runner: no test invokes the
 * real binary and no test makes a network call. The DB is a small in-memory
 * fake over the handful of drizzle calls the service makes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** In-memory `claude_account` rows, keyed by id. */
type Row = Record<string, unknown>;
const rows = new Map<string, Row>();
/** Every `project_profile_link` update the service performs. */
const linkUpdates: Array<Record<string, unknown>> = [];

/**
 * A drizzle-shaped fake. `where(...)` clauses are opaque predicate objects our
 * fake `eq`/`and` build, so the fake can evaluate them against a row.
 */
type Pred = (row: Row) => boolean;

vi.mock("drizzle-orm", () => ({
  eq: (col: string, value: unknown): Pred => (row) => row[col] === value,
  and:
    (...preds: Pred[]): Pred =>
    (row) => preds.every((p) => p(row)),
}));

vi.mock("@/db/schema", () => ({
  // Columns are modelled as their property NAME so the fake `eq` can index the
  // row object directly.
  claudeAccounts: {
    id: "id",
    userId: "userId",
    profileId: "profileId",
    emailAddress: "emailAddress",
    tokenFingerprint: "tokenFingerprint",
  },
  projectProfileLinks: { accountId: "accountId" },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: {
        findFirst: async ({ where }: { where: Pred }) =>
          [...rows.values()].find((r) => where(r)),
        findMany: async ({ where }: { where?: Pred }) =>
          [...rows.values()].filter((r) => (where ? where(r) : true)),
      },
    },
    insert: () => ({
      values: async (vals: Row) => {
        rows.set(vals.id as string, {
          createdAt: new Date(0),
          updatedAt: new Date(0),
          alias: null,
          profileId: null,
          emailAddress: null,
          organizationId: null,
          organizationName: null,
          rateLimitTier: null,
          authMethod: null,
          authHealthy: false,
          lastVerifiedAt: null,
          oauthTokenEncrypted: null,
          apiKeyPrefix: null,
          ...vals,
        });
      },
    }),
    update: (table: Record<string, string>) => ({
      set: (vals: Row) => ({
        where: async (pred: Pred) => {
          if (table.accountId && !table.id) {
            linkUpdates.push(vals);
            return;
          }
          for (const row of rows.values()) {
            if (pred(row)) Object.assign(row, vals);
          }
        },
      }),
    }),
    delete: () => ({
      where: async (pred: Pred) => {
        for (const [id, row] of [...rows.entries()]) {
          if (pred(row)) rows.delete(id);
        }
      },
    }),
  },
}));

import {
  parseAuthStatus,
  extractSetupToken,
  looksLikeOAuthToken,
  probeIdentity,
  saveAccountToken,
  verifyAccount,
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
  resolveAccountEnv,
  tokenFingerprint,
  AccountNotFoundError,
  describeAccountEnvFailure,
  findAccountIdForProfile,
  UNKNOWN_IDENTITY,
  CLAUDE_OAUTH_TOKEN_ENV,
  type ClaudeCliRunner,
} from "./claude-account-service";
import { decrypt } from "@/lib/encryption";

const USER = "user-1";
const TOKEN = "sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_TOKEN = "sk-ant-oat01-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

/** A runner that returns fixed stdout and records the env it was given. */
function runnerWith(
  stdout: string,
  seen?: Array<Record<string, string>>
): ClaudeCliRunner {
  return async (_args, env) => {
    seen?.push(env);
    return { stdout, stderr: "", exitCode: 0 };
  };
}

const LOGGED_IN_JSON = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "person@example.com",
  orgId: "org-123",
  orgName: "Example Org",
  subscriptionType: "max",
});

beforeEach(() => {
  rows.clear();
  linkUpdates.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// Identity parsing  [remote-dev-n4x4.8]
// ─────────────────────────────────────────────────────────────────────────────

describe("parseAuthStatus", () => {
  it("reads every display field from a logged-in payload", () => {
    expect(parseAuthStatus(LOGGED_IN_JSON)).toEqual({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "person@example.com",
      orgId: "org-123",
      orgName: "Example Org",
      subscriptionType: "max",
    });
  });

  it("reads a logged-out payload without inventing fields", () => {
    const identity = parseAuthStatus(
      '{"loggedIn": false, "authMethod": "none"}'
    );
    expect(identity.loggedIn).toBe(false);
    expect(identity.authMethod).toBe("none");
    expect(identity.email).toBeNull();
    expect(identity.subscriptionType).toBeNull();
  });

  it("treats authMethod as an OPEN set (stores unknown values verbatim)", () => {
    expect(
      parseAuthStatus('{"loggedIn": true, "authMethod": "oauth_token"}')
        .authMethod
    ).toBe("oauth_token");
    expect(
      parseAuthStatus('{"loggedIn": true, "authMethod": "future_method"}')
        .authMethod
    ).toBe("future_method");
  });

  it("tolerates banner/warning noise around the JSON object", () => {
    const raw = `warning: something\n${LOGGED_IN_JSON}\nBye!\n`;
    expect(parseAuthStatus(raw).email).toBe("person@example.com");
  });

  it.each([
    ["empty output", ""],
    ["non-JSON", "command not found: claude"],
    ["truncated JSON", '{"loggedIn": tr'],
    ["a JSON array", "[1,2,3]"],
    ["a JSON string", '"nope"'],
    ["JSON null", "null"],
  ])("returns the unknown identity for %s", (_label, raw) => {
    expect(parseAuthStatus(raw)).toEqual(UNKNOWN_IDENTITY);
  });

  it("drops fields of the wrong type rather than coercing them", () => {
    const identity = parseAuthStatus(
      '{"loggedIn": "yes", "email": 42, "orgName": {"name": "x"}}'
    );
    // `loggedIn` is only true for a real boolean true.
    expect(identity.loggedIn).toBe(false);
    expect(identity.email).toBeNull();
    expect(identity.orgName).toBeNull();
  });
});

describe("probeIdentity", () => {
  it("runs `claude auth status --json` with the token in the env", async () => {
    const seen: Array<Record<string, string>> = [];
    const runner: ClaudeCliRunner = async (args, env) => {
      seen.push(env);
      expect(args).toEqual(["auth", "status", "--json"]);
      return { stdout: LOGGED_IN_JSON, stderr: "", exitCode: 0 };
    };
    const identity = await probeIdentity(TOKEN, runner);
    expect(identity.loggedIn).toBe(true);
    expect(seen[0][CLAUDE_OAUTH_TOKEN_ENV]).toBe(TOKEN);
  });

  it("parses the payload even when the CLI exits non-zero", async () => {
    const runner: ClaudeCliRunner = async () => ({
      stdout: '{"loggedIn": false, "authMethod": "none"}',
      stderr: "",
      exitCode: 1,
    });
    expect((await probeIdentity(TOKEN, runner)).loggedIn).toBe(false);
  });

  it("never throws when the runner blows up", async () => {
    const runner: ClaudeCliRunner = async () => {
      throw new Error("ENOENT: claude not found");
    };
    expect(await probeIdentity(TOKEN, runner)).toEqual(UNKNOWN_IDENTITY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setup-token capture  [remote-dev-n4x4.7]
// ─────────────────────────────────────────────────────────────────────────────

describe("extractSetupToken", () => {
  it("finds the token printed in scrollback", () => {
    const text = `$ claude setup-token\nOpening browser…\n\n  ${TOKEN}\n\n$ `;
    expect(extractSetupToken(text)).toBe(TOKEN);
  });

  it("returns the LAST token when setup-token ran more than once", () => {
    expect(extractSetupToken(`${TOKEN}\n...\n${OTHER_TOKEN}\n`)).toBe(
      OTHER_TOKEN
    );
  });

  it("returns null while the sign-in is still in progress", () => {
    expect(
      extractSetupToken("$ claude setup-token\nWaiting for browser…\n")
    ).toBeNull();
    expect(extractSetupToken("")).toBeNull();
  });

  it("does not mistake an API key for an OAuth token", () => {
    expect(extractSetupToken("sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });
});

describe("looksLikeOAuthToken", () => {
  it.each([
    [TOKEN, true],
    [`  ${TOKEN}  `, true],
    ["sk-ant-oat99-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", true],
    ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz", false],
    ["https://claude.ai/oauth", false],
    ["", false],
    ["sk-ant-oat01-short", false],
  ])("%s → %s", (value, expected) => {
    expect(looksLikeOAuthToken(value)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Account CRUD + token encryption at rest
// ─────────────────────────────────────────────────────────────────────────────

describe("saveAccountToken", () => {
  it("creates an account and stores the token ENCRYPTED (round-trips)", async () => {
    const { account, updated } = await saveAccountToken(
      { userId: USER, token: TOKEN, alias: "Personal Max" },
      runnerWith(LOGGED_IN_JSON)
    );

    expect(updated).toBe(false);
    expect(account.alias).toBe("Personal Max");
    expect(account.emailAddress).toBe("person@example.com");
    expect(account.organizationId).toBe("org-123");
    expect(account.organizationName).toBe("Example Org");
    expect(account.rateLimitTier).toBe("max");
    expect(account.authMethod).toBe("claude.ai");
    expect(account.authHealthy).toBe(true);
    expect(account.hasToken).toBe(true);

    const stored = rows.get(account.id)!.oauthTokenEncrypted as string;
    // Ciphertext, not the plaintext token…
    expect(stored).not.toContain(TOKEN);
    // …that decrypts back to exactly the token.
    expect(decrypt(stored)).toBe(TOKEN);
  });

  it("never exposes the token in the API projection", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(JSON.stringify(account)).not.toContain(TOKEN);
    expect(Object.keys(account)).not.toContain("oauthTokenEncrypted");
  });

  it("UPDATES in place when the probed email is already known", async () => {
    const first = await saveAccountToken(
      { userId: USER, token: TOKEN, alias: "Personal" },
      runnerWith(LOGGED_IN_JSON)
    );
    const second = await saveAccountToken(
      { userId: USER, token: OTHER_TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    expect(second.updated).toBe(true);
    expect(second.account.id).toBe(first.account.id);
    expect(rows.size).toBe(1);
    // The alias survives a re-add that doesn't supply one…
    expect(second.account.alias).toBe("Personal");
    // …and the newer token replaced the old one.
    expect(decrypt(rows.get(first.account.id)!.oauthTokenEncrypted as string)).toBe(
      OTHER_TOKEN
    );
  });

  it("creates a separate account for a different email", async () => {
    await saveAccountToken({ userId: USER, token: TOKEN }, runnerWith(LOGGED_IN_JSON));
    await saveAccountToken(
      { userId: USER, token: OTHER_TOKEN },
      runnerWith('{"loggedIn": true, "email": "work@example.com"}')
    );
    expect(rows.size).toBe(2);
  });

  it("still stores the token when identity cannot be probed (marked unhealthy)", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith("claude: command not found")
    );
    expect(account.hasToken).toBe(true);
    expect(account.authHealthy).toBe(false);
    expect(account.emailAddress).toBeNull();
  });

  it("dedupes on the TOKEN FINGERPRINT when the identity probe learns nothing", async () => {
    // Offline / no CLI: no email, so the email dedupe cannot fire. Without a
    // fingerprint fallback every retry would insert another row.
    const offline = runnerWith("claude: command not found");

    const first = await saveAccountToken({ userId: USER, token: TOKEN }, offline);
    const second = await saveAccountToken({ userId: USER, token: TOKEN }, offline);
    const third = await saveAccountToken({ userId: USER, token: TOKEN }, offline);

    expect(first.updated).toBe(false);
    expect(second.updated).toBe(true);
    expect(third.updated).toBe(true);
    expect(second.account.id).toBe(first.account.id);
    expect(rows.size).toBe(1);
  });

  it("still creates a separate account for a DIFFERENT unknown-identity token", async () => {
    const offline = runnerWith("");
    await saveAccountToken({ userId: USER, token: TOKEN }, offline);
    await saveAccountToken({ userId: USER, token: OTHER_TOKEN }, offline);
    expect(rows.size).toBe(2);
  });

  it("does not let one user's fingerprint match another user's account", async () => {
    const offline = runnerWith("");
    await saveAccountToken({ userId: USER, token: TOKEN }, offline);
    await saveAccountToken({ userId: "other-user", token: TOKEN }, offline);
    expect(rows.size).toBe(2);
  });

  it("throws AccountNotFoundError for an unowned accountId instead of creating one", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    await expect(
      saveAccountToken(
        { userId: "someone-else", token: OTHER_TOKEN, accountId: account.id },
        runnerWith(LOGGED_IN_JSON)
      )
    ).rejects.toBeInstanceOf(AccountNotFoundError);

    await expect(
      saveAccountToken(
        { userId: USER, token: OTHER_TOKEN, accountId: "no-such-account" },
        runnerWith(LOGGED_IN_JSON)
      )
    ).rejects.toBeInstanceOf(AccountNotFoundError);

    // The caller asked to UPDATE, so nothing new may appear.
    expect(rows.size).toBe(1);
  });

  it("rejects an empty token", async () => {
    await expect(
      saveAccountToken({ userId: USER, token: "   " }, runnerWith(LOGGED_IN_JSON))
    ).rejects.toThrow(/token is required/i);
  });
});

describe("verifyAccount", () => {
  it("re-probes with the stored token and refreshes the display fields", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith('{"loggedIn": true, "email": "person@example.com"}')
    );

    const seen: Array<Record<string, string>> = [];
    const result = await verifyAccount(
      account.id,
      USER,
      runnerWith(LOGGED_IN_JSON, seen)
    );

    // The probe ran under the account's own token — NOT a credential file.
    expect(seen[0][CLAUDE_OAUTH_TOKEN_ENV]).toBe(TOKEN);
    expect(result!.identity.loggedIn).toBe(true);
    expect(result!.account.rateLimitTier).toBe("max");
    expect(result!.account.organizationName).toBe("Example Org");
    expect(result!.account.lastVerifiedAt).not.toBeNull();
  });

  it("keeps the last-known fields when a probe comes back blank (offline)", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    const result = await verifyAccount(account.id, USER, runnerWith(""));

    expect(result!.account.authHealthy).toBe(false);
    // Display fields survive so the row doesn't blank out on a transient failure.
    expect(result!.account.emailAddress).toBe("person@example.com");
    expect(result!.account.rateLimitTier).toBe("max");
  });

  it("marks a token-less account unhealthy without running the CLI", async () => {
    rows.set("acct-notoken", {
      id: "acct-notoken",
      userId: USER,
      accountKind: "subscription",
      authHealthy: true,
      oauthTokenEncrypted: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const runner = vi.fn();
    const result = await verifyAccount(
      "acct-notoken",
      USER,
      runner as unknown as ClaudeCliRunner
    );
    expect(runner).not.toHaveBeenCalled();
    expect(result!.account.authHealthy).toBe(false);
  });

  it("returns null for another user's account", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(await verifyAccount(account.id, "someone-else", runnerWith(""))).toBeNull();
  });
});

describe("list / get / update / delete", () => {
  it("lists only the caller's accounts, token-free", async () => {
    await saveAccountToken({ userId: USER, token: TOKEN }, runnerWith(LOGGED_IN_JSON));
    await saveAccountToken(
      { userId: "other-user", token: OTHER_TOKEN },
      runnerWith('{"loggedIn": true, "email": "other@example.com"}')
    );

    const mine = await listAccounts(USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].hasToken).toBe(true);
    expect(JSON.stringify(mine)).not.toContain(TOKEN);
  });

  it("does not leak another user's account through getAccount", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(await getAccount(account.id, "someone-else")).toBeNull();
    expect(await getAccount(account.id, USER)).not.toBeNull();
  });

  it("renames an account and refuses a foreign one", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect((await updateAccount(account.id, USER, { alias: "Work" }))!.alias).toBe(
      "Work"
    );
    expect(await updateAccount(account.id, "someone-else", { alias: "x" })).toBeNull();
  });

  it("deletes an account and clears project links that pinned it", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    expect(await deleteAccount(account.id, USER)).toBe(true);
    expect(rows.size).toBe(0);
    expect(linkUpdates).toEqual([{ accountId: null }]);
  });

  it("refuses to delete another user's account", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(await deleteAccount(account.id, "someone-else")).toBe(false);
    expect(rows.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session env injection  [remote-dev-n4x4.6]
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAccountEnv — the single ownership-scoped resolution", () => {
  it("injects CLAUDE_CODE_OAUTH_TOKEN for the account", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    const resolved = await resolveAccountEnv(account.id, USER);

    expect(resolved).toEqual({
      ok: true,
      accountId: account.id,
      env: { [CLAUDE_OAUTH_TOKEN_ENV]: TOKEN },
    });
    // Crucially it does NOT set CLAUDE_CONFIG_DIR: the shared config dir is
    // what makes skills / CLAUDE.md / MCP servers visible to every account,
    // and an explicit value would re-namespace the macOS Keychain.
    expect(Object.keys((resolved as { env: Record<string, string> }).env)).toEqual([
      CLAUDE_OAUTH_TOKEN_ENV,
    ]);
  });

  it("reports not_found for a missing OR foreign account (indistinguishable)", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    expect(await resolveAccountEnv("nope", USER)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await resolveAccountEnv(account.id, "someone-else")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports no_token for an account that has never been credentialed", async () => {
    rows.set("acct-notoken", {
      id: "acct-notoken",
      userId: USER,
      accountKind: "subscription",
      authHealthy: false,
      oauthTokenEncrypted: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect(await resolveAccountEnv("acct-notoken", USER)).toEqual({
      ok: false,
      reason: "no_token",
    });
  });

  it("reports decrypt_failed (never throws) when the ciphertext is unreadable", async () => {
    rows.set("acct-corrupt", {
      id: "acct-corrupt",
      userId: USER,
      accountKind: "subscription",
      authHealthy: true,
      oauthTokenEncrypted: "not-actually-ciphertext",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect(await resolveAccountEnv("acct-corrupt", USER)).toEqual({
      ok: false,
      reason: "decrypt_failed",
    });
  });

  it("describes every failure reason without leaking whose account it is", () => {
    for (const reason of ["not_found", "no_token", "decrypt_failed"] as const) {
      const message = describeAccountEnvFailure(reason);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain(USER);
    }
  });
});

describe("findAccountIdForProfile", () => {
  it("bridges a pinned profile to its origin account, scoped to the owner", async () => {
    rows.set("acct-origin", {
      id: "acct-origin",
      userId: USER,
      profileId: "prof-1",
      accountKind: "subscription",
      authHealthy: true,
      oauthTokenEncrypted: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    expect(await findAccountIdForProfile("prof-1", USER)).toBe("acct-origin");
    expect(await findAccountIdForProfile("prof-1", "someone-else")).toBeNull();
    expect(await findAccountIdForProfile("prof-unknown", USER)).toBeNull();
  });
});

describe("tokenFingerprint", () => {
  it("is stable, non-reversible, and never contains the token", () => {
    const fp = tokenFingerprint(TOKEN);

    expect(fp).toBe(tokenFingerprint(TOKEN));
    expect(fp).toBe(tokenFingerprint(`  ${TOKEN}  `)); // trimmed
    expect(fp).not.toBe(tokenFingerprint(OTHER_TOKEN));
    expect(fp).not.toContain(TOKEN);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is never exposed through the account API projection", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(Object.keys(account)).not.toContain("tokenFingerprint");
    expect(JSON.stringify(account)).not.toContain(tokenFingerprint(TOKEN));
  });
});
