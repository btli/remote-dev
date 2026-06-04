// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// Like port-claims-service.test.ts, this service's behavior IS the SQL (prefix
// lookup, timing-safe hash compare, expiry/revocation/scope gates). So we mock
// `@/db` with a REAL in-memory libsql database wired to the real drizzle schema.
// FK targets aren't enforced (libsql leaves foreign_keys off), so we only create
// the `model_proxy_token` table itself.
let client: Client;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("@/db", () => ({
  get db() {
    return testDb;
  },
}));

const CREATE_TABLE = `
  CREATE TABLE model_proxy_token (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT,
    instance_slug TEXT,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    provider_scope TEXT NOT NULL DEFAULT '["anthropic"]',
    revoked_at INTEGER,
    expires_at INTEGER,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  );
`;

async function resetDb(): Promise<void> {
  client = createClient({ url: ":memory:" });
  testDb = drizzle(client, { schema });
  await client.execute(CREATE_TABLE);
}

// Import after the mock is registered so the service binds to our testDb.
import {
  issueProxyToken,
  authenticateProxyToken,
  revokeProxyToken,
  revokeTokensForSession,
  listProxyTokens,
  PROXY_TOKEN_PREFIX,
} from "./model-proxy-token-service";

const USER = "user-1";
const SESSION = "session-1";

function reqWith(token: string): Request {
  return new Request("http://localhost/api/model-proxy/anthropic/v1/messages", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("ModelProxyTokenService", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues a prefixed token and validates it for the scoped provider", async () => {
    const { token, id } = await issueProxyToken({
      userId: USER,
      sessionId: SESSION,
      instanceSlug: "alpha",
      providerScope: ["anthropic"],
    });
    expect(token.startsWith(PROXY_TOKEN_PREFIX)).toBe(true);
    expect(id).toBeTruthy();

    const principal = await authenticateProxyToken(reqWith(token), "anthropic");
    expect(principal).not.toBeNull();
    expect(principal?.userId).toBe(USER);
    expect(principal?.sessionId).toBe(SESSION);
    expect(principal?.instanceSlug).toBe("alpha");
    expect(principal?.tokenId).toBe(id);
  });

  it("accepts the token via the x-rdv-proxy-token header too", async () => {
    const { token } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    const req = new Request("http://localhost/api/model-proxy/anthropic/v1/messages", {
      method: "POST",
      headers: { "x-rdv-proxy-token": token },
    });
    const principal = await authenticateProxyToken(req, "anthropic");
    expect(principal?.userId).toBe(USER);
  });

  it("rejects a token whose scope does not include the requested provider", async () => {
    const { token } = await issueProxyToken({
      userId: USER,
      sessionId: SESSION,
      providerScope: ["anthropic"],
    });
    expect(await authenticateProxyToken(reqWith(token), "openai")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { token } = await issueProxyToken({
      userId: USER,
      sessionId: SESSION,
      ttlMs: -1000, // already expired
    });
    expect(await authenticateProxyToken(reqWith(token), "anthropic")).toBeNull();
  });

  it("rejects a revoked token (by id)", async () => {
    const { token, id } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    expect(await revokeProxyToken(id, USER)).toBe(true);
    expect(await authenticateProxyToken(reqWith(token), "anthropic")).toBeNull();
  });

  it("does not revoke another user's token", async () => {
    const { id } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    expect(await revokeProxyToken(id, "someone-else")).toBe(false);
  });

  it("revokeTokensForSession revokes every token for the session", async () => {
    const a = await issueProxyToken({ userId: USER, sessionId: SESSION });
    const b = await issueProxyToken({ userId: USER, sessionId: SESSION });
    await revokeTokensForSession(SESSION);
    expect(await authenticateProxyToken(reqWith(a.token), "anthropic")).toBeNull();
    expect(await authenticateProxyToken(reqWith(b.token), "anthropic")).toBeNull();
  });

  it("resume re-mint flow: the predecessor token is invalid, only the successor is valid", async () => {
    // Mirrors session-service resumeSession: revoke the session's existing
    // tokens, THEN mint a fresh one — so tokens never accumulate valid across
    // suspend/resume cycles.
    const first = await issueProxyToken({ userId: USER, sessionId: SESSION });
    expect(await authenticateProxyToken(reqWith(first.token), "anthropic")).not.toBeNull();

    await revokeTokensForSession(SESSION);
    const second = await issueProxyToken({ userId: USER, sessionId: SESSION });

    // The predecessor is dead; only the successor authenticates.
    expect(await authenticateProxyToken(reqWith(first.token), "anthropic")).toBeNull();
    const principal = await authenticateProxyToken(reqWith(second.token), "anthropic");
    expect(principal?.tokenId).toBe(second.id);
  });

  it("rejects a tampered token (timing-safe hash mismatch)", async () => {
    const { token } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    // Flip the last char of the secret part — same prefix, different hash.
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await authenticateProxyToken(reqWith(tampered), "anthropic")).toBeNull();
  });

  it("rejects a header that is not an mp_ token", async () => {
    expect(await authenticateProxyToken(reqWith("rdv_not_a_proxy_token"), "anthropic")).toBeNull();
    const noHeader = new Request("http://localhost/x", { method: "POST" });
    expect(await authenticateProxyToken(noHeader, "anthropic")).toBeNull();
  });

  it("updates lastUsedAt on successful validation", async () => {
    const { token, id } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    await authenticateProxyToken(reqWith(token), "anthropic");
    // Allow the fire-and-forget update to flush.
    await new Promise((r) => setTimeout(r, 10));
    const row = await testDb.query.modelProxyTokens.findFirst({
      where: (t, { eq }) => eq(t.id, id),
    });
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it("listProxyTokens returns metadata only — never the hash or full token", async () => {
    const { token } = await issueProxyToken({ userId: USER, sessionId: SESSION });
    const list = await listProxyTokens(USER);
    expect(list).toHaveLength(1);
    const entry = list[0] as unknown as Record<string, unknown>;
    // The public prefix (mp_xxxxxxxx) is intentionally surfaced (like an API
    // key prefix); the HASH and the FULL secret token must never be.
    expect(entry.tokenPrefix).toBeTruthy();
    expect(entry).not.toHaveProperty("tokenHash");
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(token); // the full secret is never leaked
    // The token's secret body (everything after the public prefix) is absent.
    expect(serialized).not.toContain(token.slice(PROXY_TOKEN_PREFIX.length + 8));
  });
});
