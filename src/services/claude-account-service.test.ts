// @vitest-environment node
/**
 * Tests for ClaudeAccountService — the Claude-account CRUD + identity +
 * credential path introduced by [remote-dev-n4x4.6 / n4x4.7 / n4x4.8].
 *
 * The `claude` CLI is ALWAYS injected as a fake runner and the remote validity
 * probe [remote-dev-307w] is module-mocked (default: "valid"): no test invokes
 * the real binary and no test makes a network call. The DB is a small
 * in-memory fake over the handful of drizzle calls the service makes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The remote validity probe [remote-dev-307w]. Mocked at module level so
 * `saveAccountToken` / `verifyAccount` callers that don't inject one never
 * reach the network; individual tests flip it to "invalid"/"indeterminate".
 */
const validityProbeMock = vi.hoisted(() =>
  vi.fn<(token: string) => Promise<"valid" | "invalid" | "indeterminate">>()
);
vi.mock("@/infrastructure/external/anthropic-token-validity", () => ({
  probeTokenValidity: validityProbeMock,
}));

/** In-memory `claude_account` rows, keyed by id. */
type Row = Record<string, unknown>;
const rows = new Map<string, Row>();
/** Every `project_profile_link` update the service performs. */
const linkUpdates: Array<Record<string, unknown>> = [];
/** Optional interleaving after a usage-credential SELECT snapshot. */
let afterUsageCredentialRead: (() => void | Promise<void>) | null = null;

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
    usageOauthAccessEncrypted: "usageOauthAccessEncrypted",
    usageOauthRefreshEncrypted: "usageOauthRefreshEncrypted",
  },
  projectProfileLinks: { accountId: "accountId" },
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      claudeAccounts: {
        findFirst: async ({
          where,
          columns,
        }: {
          where: Pred;
          columns?: Record<string, boolean>;
        }) => {
          const row = [...rows.values()].find((candidate) => where(candidate));
          if (!row) return undefined;
          const selected = columns
            ? Object.fromEntries(
                Object.keys(columns).map((column) => [column, row[column]])
              )
            : row;
          if (columns?.usageOauthAccessEncrypted) {
            await afterUsageCredentialRead?.();
          }
          return selected;
        },
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
          usageOauthAccessEncrypted: null,
          usageOauthRefreshEncrypted: null,
          usageOauthExpiresAt: null,
          usageOauthScopes: null,
          apiKeyPrefix: null,
          ...vals,
        });
      },
    }),
    update: (table: Record<string, string>) => ({
      set: (vals: Row) => ({
        where: (pred: Pred) => {
          const apply = (): Row[] => {
            if (table.accountId && !table.id) {
              linkUpdates.push(vals);
              return [];
            }
            const affected: Row[] = [];
            for (const row of rows.values()) {
              if (!pred(row)) continue;
              Object.assign(row, vals);
              affected.push(row);
            }
            return affected;
          };
          return {
            returning: async () => apply(),
            then: (
              onFulfilled: (value: undefined) => unknown,
              onRejected: (reason: unknown) => unknown
            ) =>
              Promise.resolve()
                .then(() => {
                  apply();
                  return undefined;
                })
                .then(onFulfilled, onRejected),
          };
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
  isLikelyTruncatedToken,
  MIN_SETUP_TOKEN_LENGTH,
  probeIdentity,
  probeScratchIdentity,
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
  readOwnedUsageCredential,
  storeRefreshedUsageCredential,
  quarantineUsageCredential,
  storeInitialUsageCredential,
  UNKNOWN_IDENTITY,
  CLAUDE_OAUTH_TOKEN_ENV,
  CLAUDE_USAGE_SETUP_SESSION_MARKER,
  toAccountView,
  type ClaudeCliRunner,
} from "./claude-account-service";
import { decrypt, encrypt } from "@/lib/encryption";

const USER = "user-1";
// Full-length (108-char) tokens matching what `claude setup-token` really
// prints; shorter fragments are the TRUNCATED case [remote-dev-307w].
const TOKEN = `sk-ant-oat01-${"A".repeat(95)}`;
const OTHER_TOKEN = `sk-ant-oat01-${"B".repeat(95)}`;
/** What an ~80-col pane leaves of a real token (observed live: 79 chars). */
const CLIPPED_TOKEN = TOKEN.slice(0, 79);

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
  afterUsageCredentialRead = null;
  validityProbeMock.mockReset();
  validityProbeMock.mockResolvedValue("valid");
});

// ─────────────────────────────────────────────────────────────────────────────
// Token-free account view
// ─────────────────────────────────────────────────────────────────────────────

describe("toAccountView", () => {
  const baseRow = {
    id: "acct-view",
    userId: USER,
    profileId: null,
    alias: "Personal",
    accountKind: "subscription",
    emailAddress: "person@example.com",
    organizationId: "org-123",
    organizationName: "Example Org",
    rateLimitTier: "max",
    authMethod: "claude.ai",
    authHealthy: true,
    lastVerifiedAt: new Date(1_000),
    oauthTokenEncrypted: "encrypted-session-token",
    usageOauthAccessEncrypted: "encrypted-usage-access-token",
    usageOauthRefreshEncrypted: "encrypted-usage-refresh-token",
    usageOauthExpiresAt: new Date(2_000),
    usageOauthScopes: '["user:profile"]',
    tokenFingerprint: "fingerprint",
    apiKeyPrefix: null,
    createdAt: new Date(0),
    updatedAt: new Date(3_000),
  };

  it("reports a stored usage refresh credential without projecting usage tokens", () => {
    const account = toAccountView(baseRow as Parameters<typeof toAccountView>[0]);

    expect(account.usageCredential).toBe(true);
    expect(account).not.toHaveProperty("usageOauthAccessEncrypted");
    expect(account).not.toHaveProperty("usageOauthRefreshEncrypted");
  });

  it("reports no usage credential when the encrypted refresh token is absent", () => {
    const account = toAccountView({
      ...baseRow,
      usageOauthRefreshEncrypted: null,
    } as Parameters<typeof toAccountView>[0]);

    expect(account.usageCredential).toBe(false);
  });

  it("reports a usage credential when a non-null refresh value is empty", () => {
    const account = toAccountView({
      ...baseRow,
      usageOauthRefreshEncrypted: "",
    } as Parameters<typeof toAccountView>[0]);

    expect(account.usageCredential).toBe(true);
  });
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

describe("probeScratchIdentity", () => {
  it("runs the shared auth-status parser under only the scratch credential context", async () => {
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: ClaudeCliRunner = async (args, env) => {
      calls.push({ args, env });
      return { stdout: LOGGED_IN_JSON, stderr: "", exitCode: 0 };
    };

    await expect(
      probeScratchIdentity("/tmp/rdv-oauth/session-1", runner)
    ).resolves.toMatchObject({ email: "person@example.com", loggedIn: true });
    expect(calls).toEqual([
      {
        args: ["auth", "status", "--json"],
        env: {
          CLAUDE_CONFIG_DIR: "/tmp/rdv-oauth/session-1",
          CLAUDE_CODE_OAUTH_TOKEN: "",
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
        },
      },
    ]);
  });

  it("is best-effort and never invokes a default credential fallback", async () => {
    const runner = vi.fn(async () => {
      throw new Error("CLI unavailable");
    });

    await expect(
      probeScratchIdentity("/tmp/rdv-oauth/session-2", runner)
    ).resolves.toEqual(UNKNOWN_IDENTITY);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("usage setup provenance marker", () => {
  it("pins the metadata key used by both usage routes", () => {
    expect(CLAUDE_USAGE_SETUP_SESSION_MARKER).toBe(
      "rdvClaudeUsageSetupSession"
    );
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

describe("isLikelyTruncatedToken [remote-dev-307w]", () => {
  it("flags the live-observed 79-char pane-clipped fragment", () => {
    // The fragment still matches the token PATTERN — that's exactly the bug —
    // so the length floor is the only thing standing between it and storage.
    expect(looksLikeOAuthToken(CLIPPED_TOKEN)).toBe(true);
    expect(isLikelyTruncatedToken(CLIPPED_TOKEN)).toBe(true);
  });

  it("accepts a full ~108-char token (and tolerates surrounding whitespace)", () => {
    expect(isLikelyTruncatedToken(TOKEN)).toBe(false);
    expect(isLikelyTruncatedToken(`  ${TOKEN}  `)).toBe(false);
  });

  it("draws the line exactly at MIN_SETUP_TOKEN_LENGTH", () => {
    const atFloor = `sk-ant-oat01-${"A".repeat(MIN_SETUP_TOKEN_LENGTH - 13)}`;
    expect(atFloor).toHaveLength(MIN_SETUP_TOKEN_LENGTH);
    expect(isLikelyTruncatedToken(atFloor)).toBe(false);
    expect(isLikelyTruncatedToken(atFloor.slice(0, -1))).toBe(true);
  });

  it("still extracts the clipped fragment (rejection is the routes' job)", () => {
    // extractSetupToken stays a pure pattern extractor; the capture route
    // applies the floor and answers TOKEN_TRUNCATED.
    expect(extractSetupToken(`$ claude setup-token\n${CLIPPED_TOKEN}\n`)).toBe(
      CLIPPED_TOKEN
    );
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

  it("still stores the token when NEITHER probe learns anything (marked unhealthy)", async () => {
    // Fully offline: the CLI probe fails AND the network probe is
    // indeterminate — nothing vouches for the token, so it stores unhealthy.
    validityProbeMock.mockResolvedValue("indeterminate");
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

  // ── Remote validity probe [remote-dev-307w] ────────────────────────────────

  it("marks the account UNHEALTHY when Anthropic 401s the token, even though the CLI says loggedIn", async () => {
    // The exact live failure: `claude auth status --json` reports
    // loggedIn:true (email null) for a dead token — only the network knows.
    validityProbeMock.mockResolvedValue("invalid");

    const { account, tokenValid } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith('{"loggedIn": true, "authMethod": "oauth_token"}')
    );

    expect(tokenValid).toBe(false);
    expect(account.authHealthy).toBe(false);
    // The token is still stored (the row keeps its identity for re-adding).
    expect(account.hasToken).toBe(true);
    expect(validityProbeMock).toHaveBeenCalledWith(TOKEN);
  });

  it("reports tokenValid: true when Anthropic accepts the token", async () => {
    const { account, tokenValid } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(tokenValid).toBe(true);
    expect(account.authHealthy).toBe(true);
  });

  it("keeps the CLI probe's answer when the network probe is indeterminate (offline)", async () => {
    validityProbeMock.mockResolvedValue("indeterminate");

    const { account, tokenValid } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    // Offline never blocks a save and never overrides the CLI's verdict.
    expect(tokenValid).toBeNull();
    expect(account.authHealthy).toBe(true);
    expect(account.hasToken).toBe(true);
  });

  it("marks the account HEALTHY when Anthropic confirms the token, even though the CLI probe failed", async () => {
    // Network verdict is ground truth for credential liveness; a missing
    // binary / CLI crash / --json shape change says nothing about the token.
    const { account, tokenValid } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith("claude: command not found")
    );
    expect(tokenValid).toBe(true);
    expect(account.authHealthy).toBe(true);
  });

  it("stays unhealthy when the CLI probe failed AND the network probe is indeterminate", async () => {
    validityProbeMock.mockResolvedValue("indeterminate");
    const { account, tokenValid } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith("claude: command not found")
    );
    expect(tokenValid).toBeNull();
    expect(account.authHealthy).toBe(false);
  });

  it("runs the CLI and network probes concurrently, not sequentially", async () => {
    // The CLI runner only resolves once the validity probe has STARTED — a
    // sequential await-chain (CLI first) would deadlock and time the test out.
    let validityStarted: () => void;
    const validityGate = new Promise<void>((resolve) => {
      validityStarted = resolve;
    });
    validityProbeMock.mockImplementation(async () => {
      validityStarted();
      return "valid";
    });
    const runner: ClaudeCliRunner = async () => {
      await validityGate;
      return { stdout: LOGGED_IN_JSON, stderr: "", exitCode: 0 };
    };

    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runner
    );
    expect(account.authHealthy).toBe(true);
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

  it("keeps the last-known fields when BOTH probes come back blank (offline)", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    // Fully offline: neither the CLI nor the network vouches for the token.
    validityProbeMock.mockResolvedValue("indeterminate");
    const result = await verifyAccount(account.id, USER, runnerWith(""));

    expect(result!.account.authHealthy).toBe(false);
    // Display fields survive so the row doesn't blank out on a transient failure.
    expect(result!.account.emailAddress).toBe("person@example.com");
    expect(result!.account.rateLimitTier).toBe("max");
  });

  it("marks the account healthy on a network-confirmed token even when the CLI probe fails", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );

    // CLI env broke (binary gone) but Anthropic still accepts the credential.
    const result = await verifyAccount(
      account.id,
      USER,
      runnerWith("claude: command not found")
    );

    expect(result!.tokenValid).toBe(true);
    expect(result!.account.authHealthy).toBe(true);
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

  it("flips a healthy account to unhealthy when Anthropic starts 401ing its token", async () => {
    const { account } = await saveAccountToken(
      { userId: USER, token: TOKEN },
      runnerWith(LOGGED_IN_JSON)
    );
    expect(account.authHealthy).toBe(true);

    // Token revoked (or was truncated all along): the CLI still claims
    // loggedIn, but the remote probe now says invalid. [remote-dev-307w]
    validityProbeMock.mockResolvedValue("invalid");
    const result = await verifyAccount(account.id, USER, runnerWith(LOGGED_IN_JSON));

    expect(result!.tokenValid).toBe(false);
    expect(result!.account.authHealthy).toBe(false);
  });

  it("reports tokenValid: null (not false) for a token-less account", async () => {
    rows.set("acct-notoken", {
      id: "acct-notoken",
      userId: USER,
      accountKind: "subscription",
      authHealthy: true,
      oauthTokenEncrypted: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const result = await verifyAccount("acct-notoken", USER, runnerWith(""));
    expect(result!.tokenValid).toBeNull();
    expect(validityProbeMock).not.toHaveBeenCalled();
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

// ─────────────────────────────────────────────────────────────────────────────
// Usage OAuth credential ownership boundary
// ─────────────────────────────────────────────────────────────────────────────

function seedUsageCredentialRow(overrides: Row = {}): Row {
  const row: Row = {
    id: "acct-usage",
    userId: USER,
    accountKind: "subscription",
    authHealthy: true,
    oauthTokenEncrypted: encrypt(TOKEN),
    usageOauthAccessEncrypted: encrypt("usage-access-old"),
    usageOauthRefreshEncrypted: encrypt("usage-refresh-old"),
    usageOauthExpiresAt: new Date(10_000),
    usageOauthScopes: '["user:profile","future:scope"]',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
  rows.set(row.id as string, row);
  return row;
}

function usageCredentialRevision(row: Row): {
  accessCiphertext: string;
  refreshCiphertext: string;
} {
  return {
    accessCiphertext: row.usageOauthAccessEncrypted as string,
    refreshCiphertext: row.usageOauthRefreshEncrypted as string,
  };
}

describe("readOwnedUsageCredential", () => {
  it("returns only decrypted refresh inputs for an owned, complete credential", async () => {
    const row = seedUsageCredentialRow();
    const revision = usageCredentialRevision(row);

    await expect(readOwnedUsageCredential("acct-usage", USER)).resolves.toEqual({
      accessToken: "usage-access-old",
      refreshToken: "usage-refresh-old",
      expiresAt: new Date(10_000),
      revision,
    });
  });

  it("returns null for missing, foreign, or incomplete credentials", async () => {
    seedUsageCredentialRow();
    expect(await readOwnedUsageCredential("missing", USER)).toBeNull();
    expect(
      await readOwnedUsageCredential("acct-usage", "someone-else")
    ).toBeNull();

    seedUsageCredentialRow({ usageOauthRefreshEncrypted: null });
    expect(await readOwnedUsageCredential("acct-usage", USER)).toBeNull();
  });

  it.each([
    "usageOauthAccessEncrypted",
    "usageOauthRefreshEncrypted",
  ] as const)(
    "quarantines every usage column when %s cannot be decrypted",
    async (malformedColumn) => {
      const row = seedUsageCredentialRow({
        [malformedColumn]: "malformed-ciphertext",
      });
      const sessionCiphertext = row.oauthTokenEncrypted;

      await expect(
        readOwnedUsageCredential("acct-usage", USER)
      ).resolves.toBeNull();
      expect(row).toMatchObject({
        usageOauthAccessEncrypted: null,
        usageOauthRefreshEncrypted: null,
        usageOauthExpiresAt: null,
        usageOauthScopes: null,
        authHealthy: true,
        oauthTokenEncrypted: sessionCiphertext,
      });
      expect(
        toAccountView(row as Parameters<typeof toAccountView>[0])
          .usageCredential
      ).toBe(false);
    }
  );

  it("does not quarantine a replacement installed after an undecryptable SELECT", async () => {
    const row = seedUsageCredentialRow({
      usageOauthAccessEncrypted: "malformed-ciphertext",
    });
    afterUsageCredentialRead = () => {
      row.usageOauthAccessEncrypted = encrypt("replacement-access");
      row.usageOauthRefreshEncrypted = encrypt("replacement-refresh");
      row.usageOauthExpiresAt = new Date(90_000);
      row.usageOauthScopes = '["user:profile"]';
    };

    await expect(
      readOwnedUsageCredential("acct-usage", USER)
    ).resolves.toBeNull();
    expect(decrypt(row.usageOauthAccessEncrypted as string)).toBe(
      "replacement-access"
    );
    expect(decrypt(row.usageOauthRefreshEncrypted as string)).toBe(
      "replacement-refresh"
    );
    expect(row.usageOauthExpiresAt).toEqual(new Date(90_000));
    expect(row.usageOauthScopes).toBe('["user:profile"]');
  });
});

describe("storeInitialUsageCredential", () => {
  it("stores both tokens encrypted plus exact scopes and Date expiry", async () => {
    const row = seedUsageCredentialRow({
      usageOauthAccessEncrypted: null,
      usageOauthRefreshEncrypted: null,
      usageOauthExpiresAt: null,
      usageOauthScopes: null,
    });
    const scopes = ["future:scope", "user:profile", "user:inference"];

    const account = await storeInitialUsageCredential(
      "acct-usage",
      USER,
      {
        accessToken: "captured-access",
        refreshToken: "captured-refresh",
        expiresAt: 1_785_793_317_600,
        scopes,
        subscriptionType: "max",
        rateLimitTier: "default_claude_max",
      },
      {
        ...UNKNOWN_IDENTITY,
        loggedIn: true,
        email: "captured@example.com",
      },
      new Date(50_000)
    );

    expect(row.usageOauthAccessEncrypted).not.toBe("captured-access");
    expect(row.usageOauthRefreshEncrypted).not.toBe("captured-refresh");
    expect(decrypt(row.usageOauthAccessEncrypted as string)).toBe(
      "captured-access"
    );
    expect(decrypt(row.usageOauthRefreshEncrypted as string)).toBe(
      "captured-refresh"
    );
    expect(row.usageOauthExpiresAt).toEqual(new Date(1_785_793_317_600));
    expect(row.usageOauthScopes).toBe(JSON.stringify(scopes));
    expect(account).toMatchObject({
      id: "acct-usage",
      emailAddress: "captured@example.com",
      rateLimitTier: "default_claude_max",
      usageCredential: true,
    });
    expect(account).not.toHaveProperty("usageOauthAccessEncrypted");
  });

  it("prefers nonblank credential tier fields and otherwise preserves identity/fallback display values", async () => {
    const row = seedUsageCredentialRow({
      emailAddress: "known@example.com",
      organizationId: "known-org",
      organizationName: "Known Org",
      rateLimitTier: "known-tier",
      authMethod: "known-auth",
    });
    const credential = {
      accessToken: "captured-access",
      refreshToken: "captured-refresh",
      expiresAt: 1_785_793_317_600,
      scopes: ["user:profile"],
      subscriptionType: "credential-plan",
      rateLimitTier: "   ",
    };

    await storeInitialUsageCredential(
      "acct-usage",
      USER,
      credential,
      {
        ...UNKNOWN_IDENTITY,
        loggedIn: true,
        subscriptionType: "identity-plan",
      }
    );
    expect(row).toMatchObject({
      emailAddress: "known@example.com",
      organizationId: "known-org",
      organizationName: "Known Org",
      authMethod: "known-auth",
      rateLimitTier: "credential-plan",
    });

    await storeInitialUsageCredential(
      "acct-usage",
      USER,
      { ...credential, subscriptionType: "", rateLimitTier: null },
      { ...UNKNOWN_IDENTITY, subscriptionType: "identity-plan" }
    );
    expect(row.rateLimitTier).toBe("identity-plan");
  });

  it("returns null for absent or foreign accounts and never creates a row", async () => {
    const row = seedUsageCredentialRow();
    const before = { ...row };
    const credential = {
      accessToken: "must-not-store",
      refreshToken: "must-not-store",
      expiresAt: 1_785_793_317_600,
      scopes: ["user:profile"],
      subscriptionType: null,
      rateLimitTier: null,
    };

    await expect(
      storeInitialUsageCredential(
        "acct-usage",
        "someone-else",
        credential,
        UNKNOWN_IDENTITY
      )
    ).resolves.toBeNull();
    await expect(
      storeInitialUsageCredential(
        "missing",
        USER,
        credential,
        UNKNOWN_IDENTITY
      )
    ).resolves.toBeNull();
    expect(row).toEqual(before);
    expect(rows.size).toBe(1);
  });

  it("does not alter the setup token or session-health verification fields", async () => {
    const lastVerifiedAt = new Date(1234);
    const row = seedUsageCredentialRow({
      authHealthy: false,
      lastVerifiedAt,
      oauthTokenEncrypted: encrypt(TOKEN),
    });
    const priorSessionToken = row.oauthTokenEncrypted;

    await storeInitialUsageCredential(
      "acct-usage",
      USER,
      {
        accessToken: "captured-access",
        refreshToken: "captured-refresh",
        expiresAt: 1_785_793_317_600,
        scopes: ["user:profile"],
        subscriptionType: null,
        rateLimitTier: null,
      },
      { ...UNKNOWN_IDENTITY, loggedIn: true }
    );

    expect(row.authHealthy).toBe(false);
    expect(row.lastVerifiedAt).toBe(lastVerifiedAt);
    expect(row.oauthTokenEncrypted).toBe(priorSessionToken);
  });
});

describe("storeRefreshedUsageCredential", () => {
  it("encrypts refreshed access and rotated refresh tokens with the new expiry", async () => {
    const row = seedUsageCredentialRow();
    const expiresAt = new Date(90_000);
    const revision = usageCredentialRevision(row);

    await expect(
      storeRefreshedUsageCredential(
        "acct-usage",
        USER,
        {
          accessToken: "usage-access-new",
          refreshToken: "usage-refresh-rotated",
          expiresAt,
        },
        revision
      )
    ).resolves.toBe(true);

    expect(decrypt(row.usageOauthAccessEncrypted as string)).toBe(
      "usage-access-new"
    );
    expect(decrypt(row.usageOauthRefreshEncrypted as string)).toBe(
      "usage-refresh-rotated"
    );
    expect(row.usageOauthExpiresAt).toBe(expiresAt);
  });

  it("preserves the stored refresh token when the server does not rotate it", async () => {
    const row = seedUsageCredentialRow();
    const priorRefreshCiphertext = row.usageOauthRefreshEncrypted;
    const revision = usageCredentialRevision(row);

    await expect(
      storeRefreshedUsageCredential(
        "acct-usage",
        USER,
        {
          accessToken: "usage-access-new",
          expiresAt: new Date(90_000),
        },
        revision
      )
    ).resolves.toBe(true);

    expect(row.usageOauthRefreshEncrypted).toBe(priorRefreshCiphertext);
    expect(decrypt(row.usageOauthRefreshEncrypted as string)).toBe(
      "usage-refresh-old"
    );
  });

  it("includes owner and account id in the mutation predicate", async () => {
    const row = seedUsageCredentialRow();
    const revision = usageCredentialRevision(row);

    await expect(
      storeRefreshedUsageCredential(
        "acct-usage",
        "someone-else",
        {
          accessToken: "must-not-store",
          refreshToken: "must-not-store",
          expiresAt: new Date(90_000),
        },
        revision
      )
    ).resolves.toBe(false);

    expect(decrypt(row.usageOauthAccessEncrypted as string)).toBe(
      "usage-access-old"
    );
  });

  it("does not overwrite a newer access ciphertext sharing the same refresh ciphertext", async () => {
    const row = seedUsageCredentialRow();
    const staleRevision = usageCredentialRevision(row);
    row.usageOauthAccessEncrypted = encrypt("newer-access");

    await expect(
      storeRefreshedUsageCredential(
        "acct-usage",
        USER,
        {
          accessToken: "stale-response-access",
          expiresAt: new Date(90_000),
        },
        staleRevision
      )
    ).resolves.toBe(false);
    expect(decrypt(row.usageOauthAccessEncrypted as string)).toBe(
      "newer-access"
    );
    expect(row.usageOauthRefreshEncrypted).toBe(
      staleRevision.refreshCiphertext
    );
  });
});

describe("quarantineUsageCredential", () => {
  it("nulls only the four usage columns for the owned account", async () => {
    const row = seedUsageCredentialRow();
    const sessionCiphertext = row.oauthTokenEncrypted;
    const revision = usageCredentialRevision(row);

    await expect(
      quarantineUsageCredential("acct-usage", USER, revision)
    ).resolves.toBe(true);

    expect(row).toMatchObject({
      usageOauthAccessEncrypted: null,
      usageOauthRefreshEncrypted: null,
      usageOauthExpiresAt: null,
      usageOauthScopes: null,
      authHealthy: true,
      oauthTokenEncrypted: sessionCiphertext,
    });
  });

  it("does not quarantine a foreign account", async () => {
    const row = seedUsageCredentialRow();
    const priorAccessCiphertext = row.usageOauthAccessEncrypted;
    const revision = usageCredentialRevision(row);

    await expect(
      quarantineUsageCredential("acct-usage", "someone-else", revision)
    ).resolves.toBe(false);

    expect(row.usageOauthAccessEncrypted).toBe(priorAccessCiphertext);
  });
});
