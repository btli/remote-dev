/**
 * ApiKeyService - Manages API keys for programmatic access
 *
 * API keys allow agents and automation tools to interact with the Remote Dev API
 * without needing to go through the browser-based auth flow.
 */
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ApiKeyServiceError } from "@/lib/errors";

// Re-export for API routes
export { ApiKeyServiceError };

// Key prefix for identification
const KEY_PREFIX = "rdv_";

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyResult {
  id: string;
  name: string;
  key: string; // Full key - only shown once
  keyPrefix: string;
  createdAt: Date;
}

/**
 * Hash an API key using SHA-256
 * We use SHA-256 instead of bcrypt because:
 * 1. API keys are cryptographically random (high entropy)
 * 2. SHA-256 is faster, reducing auth latency
 * 3. No rainbow table risk with random keys
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a secure random API key
 * Format: rdv_<32 random bytes as base64url>
 */
function generateKey(): string {
  const randomPart = randomBytes(32).toString("base64url");
  return `${KEY_PREFIX}${randomPart}`;
}

/**
 * Extract the prefix from a full key for storage/lookup
 */
function extractPrefix(key: string): string {
  // Return first 12 chars (rdv_ + 8 random chars)
  return key.substring(0, 12);
}

/**
 * Create a new API key for a user
 * Returns the full key - this is the only time it will be visible
 */
export async function createApiKey(
  userId: string,
  name: string,
  expiresAt?: Date
): Promise<CreateApiKeyResult> {
  // Validate name
  if (!name || name.trim().length === 0) {
    throw new ApiKeyServiceError("API key name is required", "NAME_REQUIRED");
  }

  if (name.length > 100) {
    throw new ApiKeyServiceError(
      "API key name must be 100 characters or less",
      "NAME_TOO_LONG"
    );
  }

  // Generate the key
  const key = generateKey();
  const keyPrefix = extractPrefix(key);
  const keyHash = hashKey(key);

  // Insert into database
  const [created] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: name.trim(),
      keyPrefix,
      keyHash,
      expiresAt: expiresAt ?? null,
    })
    .returning();

  return {
    id: created.id,
    name: created.name,
    key, // Full key - only returned once!
    keyPrefix: created.keyPrefix,
    createdAt: new Date(created.createdAt),
  };
}

/**
 * Validate an API key and return the associated user ID
 * Uses constant-time comparison to prevent timing attacks
 */
export async function validateApiKey(
  key: string
): Promise<{ userId: string; keyId: string } | null> {
  // Quick format check
  if (!key || !key.startsWith(KEY_PREFIX)) {
    return null;
  }

  const keyPrefix = extractPrefix(key);
  const keyHash = hashKey(key);

  // Look up by prefix first (indexed for speed)
  const candidates = await db.query.apiKeys.findMany({
    where: eq(apiKeys.keyPrefix, keyPrefix),
  });

  // Check each candidate with constant-time comparison
  for (const candidate of candidates) {
    const candidateHashBuffer = Buffer.from(candidate.keyHash, "hex");
    const providedHashBuffer = Buffer.from(keyHash, "hex");

    if (
      candidateHashBuffer.length === providedHashBuffer.length &&
      timingSafeEqual(candidateHashBuffer, providedHashBuffer)
    ) {
      // Check expiration
      if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) {
        return null; // Key expired
      }

      return {
        userId: candidate.userId,
        keyId: candidate.id,
      };
    }
  }

  return null;
}

/**
 * Update last used timestamp for an API key
 * Called asynchronously after successful validation
 */
export async function touchApiKey(keyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyId));
}

/**
 * List all API keys for a user (without the actual key values)
 */
export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, userId),
    orderBy: (keys, { desc }) => [desc(keys.createdAt)],
  });

  return keys.map((key) => ({
    id: key.id,
    userId: key.userId,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
    expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
    createdAt: new Date(key.createdAt),
  }));
}

/**
 * Get a single API key by ID (with ownership check)
 */
export async function getApiKey(
  keyId: string,
  userId: string
): Promise<ApiKey | null> {
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)),
  });

  if (!key) {
    return null;
  }

  return {
    id: key.id,
    userId: key.userId,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
    expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
    createdAt: new Date(key.createdAt),
  };
}

/**
 * Delete an API key (with ownership check)
 */
export async function deleteApiKey(
  keyId: string,
  userId: string
): Promise<void> {
  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  if (result.length === 0) {
    throw new ApiKeyServiceError("API key not found", "KEY_NOT_FOUND");
  }
}

/**
 * Count API keys for a user (for limiting)
 */
export async function countApiKeys(userId: string): Promise<number> {
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, userId),
    columns: { id: true },
  });
  return keys.length;
}
