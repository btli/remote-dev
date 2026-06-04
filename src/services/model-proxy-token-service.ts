/**
 * Model-proxy token service.
 *
 * Issues / validates / revokes the scoped, revocable, per-session tokens
 * (`mp_…`) that authenticate callers of the model-key proxy. Modeled on
 * `api-key-service.ts`: tokens are hashed at rest (SHA-256) and compared with
 * `timingSafeEqual` on equal-length buffers (no early length return path).
 *
 * SECURITY: the full token is returned exactly once (at issuance). Only the
 * prefix is ever surfaced afterwards; the hash never leaves the DB. No token is
 * ever logged.
 */
import { db } from "@/db";
import { modelProxyTokens } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Prefix on every model-proxy token (cf. `rdv_` for API keys). */
export const PROXY_TOKEN_PREFIX = "mp_";

/** "mp_" + 8 chars — the indexed lookup prefix stored alongside the hash. */
const PREFIX_LEN = PROXY_TOKEN_PREFIX.length + 8;

/** The authenticated caller behind a model-proxy token. */
export interface ProxyPrincipal {
  userId: string;
  sessionId: string | null;
  instanceSlug: string | null;
  tokenId: string;
}

/** Metadata-only view of a token (never includes the hash or full token). */
export interface ProxyTokenInfo {
  id: string;
  userId: string;
  sessionId: string | null;
  instanceSlug: string | null;
  tokenPrefix: string;
  providerScope: string[];
  revokedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function extractPrefix(token: string): string {
  return token.substring(0, PREFIX_LEN);
}

function parseScope(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Mint a new proxy token. The full token is returned ONCE; only its prefix +
 * hash are persisted.
 */
export async function issueProxyToken(opts: {
  userId: string;
  sessionId?: string | null;
  instanceSlug?: string | null;
  providerScope?: string[];
  ttlMs?: number;
}): Promise<{ token: string; id: string }> {
  const token = `${PROXY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(modelProxyTokens)
    .values({
      userId: opts.userId,
      sessionId: opts.sessionId ?? null,
      instanceSlug: opts.instanceSlug ?? null,
      tokenPrefix: extractPrefix(token),
      tokenHash: hashToken(token),
      providerScope: JSON.stringify(opts.providerScope ?? ["anthropic"]),
      expiresAt: opts.ttlMs !== undefined ? new Date(Date.now() + opts.ttlMs) : null,
    })
    .returning();
  return { token, id: row.id };
}

/**
 * Validate the request's token header against the required provider.
 * Returns the principal, or `null` if the token is absent / malformed /
 * expired / revoked / out-of-scope / tampered.
 *
 * The token is read from `Authorization: Bearer <mp_…>` or the
 * `x-rdv-proxy-token` header (Claude Code sends its `ANTHROPIC_API_KEY` — our
 * token — as the `x-api-key`/Bearer header to the proxy base URL; we also
 * accept the explicit `x-rdv-proxy-token`).
 */
export async function authenticateProxyToken(
  request: Request,
  provider: string,
): Promise<ProxyPrincipal | null> {
  const header = request.headers.get("authorization");
  const raw = header?.startsWith("Bearer ")
    ? header.slice(7)
    : request.headers.get("x-rdv-proxy-token") ??
      request.headers.get("x-api-key") ??
      "";
  if (!raw.startsWith(PROXY_TOKEN_PREFIX)) return null;

  const candidates = await db.query.modelProxyTokens.findMany({
    where: eq(modelProxyTokens.tokenPrefix, extractPrefix(raw)),
  });
  const provided = Buffer.from(hashToken(raw), "hex");

  for (const c of candidates) {
    const stored = Buffer.from(c.tokenHash, "hex");
    // Constant-time compare; skip on length mismatch (no early-return leak).
    if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
      continue;
    }
    if (c.revokedAt) return null;
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return null;
    const scope = parseScope(c.providerScope);
    if (!scope.includes(provider)) return null; // scope enforcement

    // Fire-and-forget last-used bump; never block (or fail) auth on it.
    void db
      .update(modelProxyTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(modelProxyTokens.id, c.id))
      .catch(() => {});

    return {
      userId: c.userId,
      sessionId: c.sessionId,
      instanceSlug: c.instanceSlug,
      tokenId: c.id,
    };
  }
  return null;
}

/** Revoke one token (with ownership check). Returns true if a row was revoked. */
export async function revokeProxyToken(id: string, userId: string): Promise<boolean> {
  const r = await db
    .update(modelProxyTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(modelProxyTokens.id, id), eq(modelProxyTokens.userId, userId)))
    .returning({ id: modelProxyTokens.id });
  return r.length > 0;
}

/** Revoke every token bound to a session (called on session close/suspend). */
export async function revokeTokensForSession(sessionId: string): Promise<void> {
  await db
    .update(modelProxyTokens)
    .set({ revokedAt: new Date() })
    .where(eq(modelProxyTokens.sessionId, sessionId));
}

/**
 * List a user's tokens — metadata ONLY (prefix, never the hash or full token).
 */
export async function listProxyTokens(userId: string): Promise<ProxyTokenInfo[]> {
  const rows = await db.query.modelProxyTokens.findMany({
    where: eq(modelProxyTokens.userId, userId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    sessionId: r.sessionId,
    instanceSlug: r.instanceSlug,
    tokenPrefix: r.tokenPrefix,
    providerScope: parseScope(r.providerScope),
    revokedAt: r.revokedAt ? new Date(r.revokedAt) : null,
    expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : null,
    createdAt: new Date(r.createdAt),
  }));
}
