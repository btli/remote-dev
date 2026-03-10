/**
 * Local API Key Management
 *
 * Creates and maintains a file-based API key at ~/.remote-dev/rdv/.local-key
 * so the rdv CLI can authenticate without RDV_API_KEY being set explicitly.
 * The key file is written with mode 0600 (owner-only read/write).
 *
 * Security model: This key grants full API access as the first authorized user.
 * It is readable by any process running as the current OS user. This is
 * acceptable because Remote Dev is a local development tool and the key file
 * has the same trust boundary as the user's shell history and SSH keys.
 * The key is NOT suitable for multi-user or shared-host deployments.
 */

import { existsSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { getRdvDir } from "./paths";
import { db } from "@/db";
import { apiKeys, authorizedUsers, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createApiKey, validateApiKey } from "@/services/api-key-service";

const KEY_FILENAME = ".local-key";
const KEY_NAME = "rdv-local-access";

function getKeyFilePath(): string {
  return join(getRdvDir(), KEY_FILENAME);
}

/**
 * Ensure a valid local API key exists on disk.
 *
 * 1. If the key file exists and the key validates, do nothing.
 * 2. Otherwise, find the first authorized user, create a new API key,
 *    and write it to disk with restrictive permissions.
 * 3. If no authorized users exist yet, skip silently.
 */
export async function ensureLocalApiKey(): Promise<void> {
  const keyFile = getKeyFilePath();

  // Check if existing key is still valid
  if (existsSync(keyFile)) {
    const existing = readFileSync(keyFile, "utf-8").trim();
    if (existing) {
      const result = await validateApiKey(existing);
      if (result) return; // Key is valid, nothing to do
    }
  }

  // Find first authorized user with a corresponding user record
  const authorized = await db.query.authorizedUsers.findFirst({
    orderBy: (au, { asc }) => [asc(au.createdAt)],
  });
  if (!authorized) {
    console.log("Local API key: skipped (no authorized users seeded yet — run db:seed first)");
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, authorized.email),
  });
  if (!user) {
    console.log(`Local API key: skipped (${authorized.email} hasn't logged in yet)`);
    return;
  }

  // Delete any stale local-access keys before creating a new one
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.name, KEY_NAME)));

  // Create a new API key and write to disk
  const { key } = await createApiKey(user.id, KEY_NAME);
  writeFileSync(keyFile, key + "\n", { mode: 0o600 });
  chmodSync(keyFile, 0o600); // Ensure permissions even if umask interfered
  console.log(`Local API key written to ${keyFile}`);
}
