/**
 * Field-level encryption for sensitive data at rest.
 *
 * Uses AES-256-GCM authenticated encryption with a key derived from AUTH_SECRET.
 * Each encryption generates a unique IV for semantic security.
 *
 * Format: base64(iv:authTag:ciphertext)
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
// Key length is 256 bits (32 bytes) for AES-256

/**
 * Derive a 256-bit encryption key from AUTH_SECRET.
 * Uses SHA-256 to normalize any length secret to exactly 32 bytes.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production for encryption");
    }
    console.warn("AUTH_SECRET not set - using development key for encryption");
    return createHash("sha256").update("development-encryption-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a string value for database storage.
 *
 * @param plaintext - The value to encrypt
 * @returns Base64-encoded encrypted string (iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypt a previously encrypted value from database.
 *
 * @param encrypted - Base64-encoded encrypted string
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (tampered data, wrong key, etc.)
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encrypted, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted data: too short");
  }

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check if a value appears to be encrypted (base64-encoded with correct length).
 * This is a heuristic for migrating existing plaintext data.
 *
 * @param value - The value to check
 * @returns true if the value appears to be encrypted
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64");
    // Check minimum length: IV + AuthTag + at least 1 byte of ciphertext
    if (decoded.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      return false;
    }
    // Additional heuristic: base64 encoding of our format won't contain
    // common token prefixes like "ghp_", "gho_", "pss_", etc.
    if (
      value.startsWith("ghp_") ||
      value.startsWith("gho_") ||
      value.startsWith("pss_") ||
      value.startsWith("Bearer ")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely decrypt a value that might be plaintext (for migration).
 * If decryption fails, returns the original value assuming it's plaintext.
 *
 * @param value - The value to decrypt (might be plaintext or encrypted)
 * @returns Decrypted value or original if decryption fails
 */
export function decryptSafe(value: string | null): string | null {
  if (!value) return null;

  // If it doesn't look encrypted, return as-is (plaintext)
  if (!isEncrypted(value)) {
    return value;
  }

  try {
    return decrypt(value);
  } catch {
    // Decryption failed - likely plaintext or corrupted
    // Return original value for backwards compatibility
    return value;
  }
}

/**
 * Encrypt a value only if it's not already encrypted.
 * Used during migration to avoid double-encryption.
 *
 * @param value - The value to encrypt
 * @returns Encrypted value
 */
export function encryptIfNeeded(value: string | null): string | null {
  if (!value) return null;

  // If already encrypted, return as-is
  if (isEncrypted(value)) {
    return value;
  }

  return encrypt(value);
}
