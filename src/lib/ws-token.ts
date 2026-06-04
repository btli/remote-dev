/**
 * WebSocket Token Utilities
 *
 * Provides token generation and validation for secure WebSocket connections.
 * Extracted into a separate module to avoid circular dependencies between
 * Next.js API routes and the terminal server.
 *
 * Two token KINDS share this module, each HMAC-signed with `AUTH_SECRET` and a
 * 5-minute TTL, but they are NOT interchangeable:
 *
 *  - **session** tokens authenticate the terminal-session WebSocket (`/ws`).
 *    Legacy wire format `base64(sessionId:userId:timestamp:hmac)` (4 fields, no
 *    explicit kind marker). Minted by {@link generateWsToken}, verified by
 *    {@link validateWsToken}.
 *
 *  - **proxy** tokens authenticate the in-pod port-proxy WebSocket bridge
 *    (`<basePath>/proxy/<port>/…`). Wire format
 *    `base64(proxy:userId:port:timestamp:hmac)` (5 fields, leading literal
 *    `proxy` kind marker, with the target `port` BOUND into the signature).
 *    Minted by {@link generateProxyWsToken}, verified by
 *    {@link validateProxyWsToken}.
 *
 * Cross-acceptance is impossible by construction (different field counts AND a
 * distinct leading kind marker), so a leaked session token cannot open a proxy
 * bridge and vice-versa — and a proxy token is additionally bound to ONE port.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "@/lib/logger";

const log = createLogger("WsToken");

/** Token lifetime. Both kinds expire this long after issuance. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Leading marker that identifies a {@link generateProxyWsToken} token. Session
 * tokens never begin with this literal because their first field is a UUID
 * `sessionId`, so the marker (plus the differing field count) keeps the two
 * kinds mutually unforgeable.
 */
const PROXY_KIND = "proxy";

/**
 * Get AUTH_SECRET with production guard.
 * Throws an error if AUTH_SECRET is not set in production.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production");
    }
    log.warn("AUTH_SECRET not set - using development secret (not safe for production)");
    return "development-secret";
  }
  return secret;
}

/** Constant-time compare of two hex HMAC strings (length-safe). */
function hmacEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on length mismatch; guard so a wrong-length HMAC
  // returns false instead of throwing (still constant-time for equal lengths).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Generate a WebSocket authentication token for a terminal SESSION.
 * This should be called by the Next.js server and passed to the client.
 *
 * Token format: base64(sessionId:userId:timestamp:hmac)
 * Tokens expire after 5 minutes.
 */
export function generateWsToken(sessionId: string, userId: string): string {
  const secret = getAuthSecret();
  const timestamp = Date.now();
  const data = `${sessionId}:${userId}:${timestamp}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(`${data}:${hmac}`).toString("base64");
}

/**
 * Validate a terminal-SESSION WebSocket authentication token.
 * Tokens expire after 5 minutes.
 *
 * Rejects PROXY tokens: those carry the leading `proxy` kind marker (and a
 * different field count), so a proxy-scoped token can never authenticate the
 * terminal-session socket.
 *
 * @returns Parsed token data if valid, null if invalid or expired
 */
export function validateWsToken(
  token: string
): { sessionId: string; userId: string } | null {
  try {
    const secret = getAuthSecret();
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 4) return null;

    const [sessionId, userId, timestampStr, providedHmac] = parts;

    // Defense-in-depth: refuse anything shaped like a proxy token (the field
    // count already differs, but reject the kind marker explicitly too).
    if (sessionId === PROXY_KIND) return null;

    const timestamp = parseInt(timestampStr, 10);

    // Check token expiry (5 minutes)
    if (Date.now() - timestamp > TOKEN_TTL_MS) return null;

    // Verify HMAC
    const data = `${sessionId}:${userId}:${timestampStr}`;
    const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

    // Use timing-safe comparison
    if (!hmacEquals(providedHmac, expectedHmac)) {
      return null;
    }

    return { sessionId, userId };
  } catch {
    return null;
  }
}

/**
 * Generate a port-PROXY WebSocket authentication token, BOUND to a single port.
 *
 * Token format: base64(proxy:userId:port:timestamp:hmac). The `port` is part of
 * the signed payload, so the token only authorizes the port it was minted for.
 * Tokens expire after 5 minutes.
 *
 * @param userId - The owner the token is issued to.
 * @param port - The proxy target port this token authorizes (and nothing else).
 */
export function generateProxyWsToken(userId: string, port: number): string {
  const secret = getAuthSecret();
  const timestamp = Date.now();
  const data = `${PROXY_KIND}:${userId}:${port}:${timestamp}`;
  const hmac = createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(`${data}:${hmac}`).toString("base64");
}

/**
 * Validate a port-PROXY WebSocket token AND confirm it is bound to `expectedPort`.
 *
 * Rejects:
 *  - SESSION tokens (no `proxy` kind marker / wrong field count),
 *  - tokens bound to a DIFFERENT port than `expectedPort`,
 *  - expired tokens (older than 5 minutes),
 *  - tokens with a bad/forged HMAC.
 *
 * @param token - The base64 proxy token from the WS `?token=` query param.
 * @param expectedPort - The port the bridge is about to connect to; the token's
 *   bound port MUST equal this.
 * @returns `{ userId, port }` if valid AND bound to `expectedPort`, else null.
 */
export function validateProxyWsToken(
  token: string,
  expectedPort: number
): { userId: string; port: number } | null {
  try {
    const secret = getAuthSecret();
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 5) return null;

    const [kind, userId, portStr, timestampStr, providedHmac] = parts;

    // Must be a proxy-kind token.
    if (kind !== PROXY_KIND) return null;

    // Strict numeric parse — match the HTTP layer's `/^\d+$/` and avoid the
    // `Number("")===0` / `Number(" 80 ")===80` footguns before comparing.
    if (!/^\d+$/.test(portStr)) return null;
    const port = Number(portStr);
    if (!Number.isInteger(port)) return null;

    // The token is bound to exactly one port; reject mismatches.
    if (port !== expectedPort) return null;

    const timestamp = parseInt(timestampStr, 10);
    if (!Number.isFinite(timestamp)) return null;

    // Check token expiry (5 minutes).
    if (Date.now() - timestamp > TOKEN_TTL_MS) return null;

    // Verify HMAC over the full signed payload (kind + user + port + ts).
    const data = `${kind}:${userId}:${portStr}:${timestampStr}`;
    const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

    if (!hmacEquals(providedHmac, expectedHmac)) {
      return null;
    }

    return { userId, port };
  } catch {
    return null;
  }
}
