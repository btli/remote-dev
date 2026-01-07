/**
 * OAuth State Parameter Security
 *
 * Provides HMAC-signed state parameters for OAuth flows to prevent CSRF attacks.
 * State parameters contain a payload and signature that must validate on callback.
 */

import { createHmac, timingSafeEqual } from "crypto";

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get the secret key for signing OAuth state.
 * Falls back to a development-only secret if AUTH_SECRET is not set.
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production");
    }
    console.warn("AUTH_SECRET not set - using development secret for OAuth state");
    return "development-oauth-state-secret";
  }
  return secret;
}

/**
 * State payload structure
 */
export interface OAuthStatePayload {
  userId: string;
  action: string;
  /** Timestamp when state was created */
  iat: number;
}

/**
 * Create a signed OAuth state parameter.
 *
 * The state includes:
 * - The payload data (userId, action)
 * - Creation timestamp for expiry checking
 * - HMAC signature to prevent tampering
 *
 * @param userId - The user ID to include in state
 * @param action - The OAuth action (e.g., "link")
 * @returns Base64-encoded signed state string
 */
export function createSignedState(userId: string, action: string): string {
  const payload: OAuthStatePayload = {
    userId,
    action,
    iat: Date.now(),
  };

  const payloadStr = JSON.stringify(payload);
  const signature = createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("hex");

  // Combine payload and signature
  const state = {
    payload: payloadStr,
    sig: signature,
  };

  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/**
 * Result of validating OAuth state
 */
export type ValidateStateResult =
  | { valid: true; payload: OAuthStatePayload }
  | { valid: false; error: string };

/**
 * Validate a signed OAuth state parameter.
 *
 * Checks:
 * 1. State can be decoded and parsed
 * 2. Signature matches (using timing-safe comparison)
 * 3. State has not expired
 *
 * @param state - Base64-encoded state string from OAuth callback
 * @returns Validation result with payload or error
 */
export function validateSignedState(state: string): ValidateStateResult {
  try {
    // Decode the state
    const decoded = Buffer.from(state, "base64url").toString("utf-8");
    const { payload: payloadStr, sig } = JSON.parse(decoded);

    if (!payloadStr || !sig) {
      return { valid: false, error: "malformed_state" };
    }

    // Verify signature using timing-safe comparison
    const expectedSig = createHmac("sha256", getSecret())
      .update(payloadStr)
      .digest("hex");

    const sigBuffer = Buffer.from(sig, "hex");
    const expectedBuffer = Buffer.from(expectedSig, "hex");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return { valid: false, error: "invalid_signature" };
    }

    // Parse and validate payload
    const payload: OAuthStatePayload = JSON.parse(payloadStr);

    if (!payload.userId || !payload.action || !payload.iat) {
      return { valid: false, error: "incomplete_payload" };
    }

    // Check expiry
    const age = Date.now() - payload.iat;
    if (age > STATE_EXPIRY_MS) {
      return { valid: false, error: "state_expired" };
    }

    if (age < 0) {
      // Clock skew protection - state from the future
      return { valid: false, error: "invalid_timestamp" };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "invalid_state" };
  }
}
