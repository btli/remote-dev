/**
 * WebSocket Token Utilities
 *
 * Provides token generation and validation for secure WebSocket connections.
 * Extracted into a separate module to avoid circular dependencies between
 * Next.js API routes and the terminal server.
 */

import { createHmac, timingSafeEqual } from "crypto";

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
    console.warn(
      "AUTH_SECRET not set - using development secret (not safe for production)"
    );
    return "development-secret";
  }
  return secret;
}

/**
 * Generate a WebSocket authentication token for a session.
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
 * Validate a WebSocket authentication token.
 * Tokens expire after 5 minutes.
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
    const timestamp = parseInt(timestampStr, 10);

    // Check token expiry (5 minutes)
    if (Date.now() - timestamp > 5 * 60 * 1000) return null;

    // Verify HMAC
    const data = `${sessionId}:${userId}:${timestampStr}`;
    const expectedHmac = createHmac("sha256", secret).update(data).digest("hex");

    // Use timing-safe comparison
    if (!timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return null;
    }

    return { sessionId, userId };
  } catch {
    return null;
  }
}
