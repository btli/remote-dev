/**
 * Ccflare Service
 *
 * Functional service for managing the better-ccflare Anthropic API proxy.
 * Handles configuration CRUD, API key management, process control delegation,
 * and stats proxying from the running ccflare instance.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import { db } from "@/db";
import { ccflareConfig, ccflareApiKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@/lib/encryption";
import { createLogger } from "@/lib/logger";
import { ccflareProcessManager } from "./ccflare-process-manager";
import type {
  CcflareConfig,
  CcflareApiKey,
  CcflareInstallStatus,
  CcflareStatus,
  CcflareStats,
  UpdateCcflareConfigInput,
  AddCcflareKeyInput,
} from "@/types/ccflare";
import { ANTHROPIC_DEFAULT_BASE_URL } from "@/types/ccflare";

const log = createLogger("CcflareService");
const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const STATS_FETCH_TIMEOUT_MS = 3000;

// Cache version to avoid forking `--version` on every poll
let cachedVersion: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Installation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if better-ccflare is installed and get version/path info.
 */
export async function checkInstallation(): Promise<CcflareInstallStatus> {
  const binaryPath = ccflareProcessManager.getBinaryPath();
  if (!binaryPath) {
    return { installed: false, error: "better-ccflare binary not found" };
  }

  // For local path, verify it exists
  if (binaryPath !== "better-ccflare") {
    try {
      accessSync(binaryPath, constants.X_OK);
    } catch {
      return {
        installed: false,
        error: `Binary not executable: ${binaryPath}`,
      };
    }
  }

  const version = await getVersion(binaryPath);
  if (!version) {
    return {
      installed: false,
      error: "Could not determine better-ccflare version",
    };
  }

  return {
    installed: true,
    version,
    path: binaryPath,
  };
}

/**
 * Get the installed better-ccflare version.
 */
export async function getVersion(
  binaryPath?: string
): Promise<string | null> {
  const bin = binaryPath ?? ccflareProcessManager.getBinaryPath();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      timeout: 5000,
    });
    const trimmed = stdout.trim();
    // Extract semver-like pattern
    const match = trimmed.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i);
    return match ? match[1] : trimmed.split("\n")[0].slice(0, 50);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the ccflare configuration for a user.
 */
export async function getConfig(
  userId: string
): Promise<CcflareConfig | null> {
  const row = await db.query.ccflareConfig.findFirst({
    where: eq(ccflareConfig.userId, userId),
  });
  return row ? mapConfigRow(row) : null;
}

/**
 * Create or update the ccflare configuration for a user.
 */
export async function upsertConfig(
  userId: string,
  input: UpdateCcflareConfigInput
): Promise<CcflareConfig> {
  const existing = await db.query.ccflareConfig.findFirst({
    where: eq(ccflareConfig.userId, userId),
  });

  const now = new Date();

  if (existing) {
    await db
      .update(ccflareConfig)
      .set({
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.autoStart !== undefined
          ? { autoStart: input.autoStart }
          : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        updatedAt: now,
      })
      .where(eq(ccflareConfig.id, existing.id));

    const updated = await db.query.ccflareConfig.findFirst({
      where: eq(ccflareConfig.id, existing.id),
    });

    log.info("Updated ccflare config", { userId, changes: input });
    return mapConfigRow(updated!);
  }

  const id = crypto.randomUUID();
  await db.insert(ccflareConfig).values({
    id,
    userId,
    enabled: input.enabled ?? false,
    autoStart: input.autoStart ?? false,
    port: input.port ?? DEFAULT_PORT,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.ccflareConfig.findFirst({
    where: eq(ccflareConfig.id, id),
  });

  log.info("Created ccflare config", { userId, id });
  return mapConfigRow(created!);
}

/**
 * Find any user config with both enabled and autoStart set to true.
 * Used during server startup to auto-start the ccflare proxy.
 */
export async function getAutoStartConfig(): Promise<CcflareConfig | null> {
  const row = await db.query.ccflareConfig.findFirst({
    where: and(
      eq(ccflareConfig.enabled, true),
      eq(ccflareConfig.autoStart, true)
    ),
  });
  return row ? mapConfigRow(row) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Key Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add an API key for the ccflare proxy.
 * Encrypts the key for database storage and registers it with the ccflare binary.
 */
export async function addApiKey(
  userId: string,
  input: AddCcflareKeyInput
): Promise<CcflareApiKey> {
  const priority = input.priority ?? 0;
  const baseUrl = input.baseUrl?.trim() || null;
  const keyPrefix = input.key.slice(0, 12);
  const encryptedKey = encrypt(input.key);
  const now = new Date();
  const id = crypto.randomUUID();

  await db.insert(ccflareApiKeys).values({
    id,
    userId,
    name: input.name,
    encryptedKey,
    keyPrefix,
    baseUrl,
    priority,
    paused: false,
    createdAt: now,
    updatedAt: now,
  });

  log.info("Added ccflare API key", { userId, name: input.name, priority, baseUrl });

  // Only register Anthropic keys with the ccflare binary (proxy-eligible)
  if (isProxyEligible(baseUrl)) {
    await registerKeyWithCcflare(input.name, input.key, priority);
  } else {
    log.info("Skipping ccflare binary registration for direct-endpoint key", { name: input.name, baseUrl });
  }

  const row = await db.query.ccflareApiKeys.findFirst({
    where: eq(ccflareApiKeys.id, id),
  });

  return mapApiKeyRow(row!);
}

/**
 * Check if a key's baseUrl makes it eligible for the ccflare proxy.
 * Keys with null baseUrl or the default Anthropic URL go through the proxy.
 */
function isProxyEligible(baseUrl: string | null): boolean {
  return !baseUrl || baseUrl === ANTHROPIC_DEFAULT_BASE_URL;
}

/**
 * Remove an API key.
 */
export async function removeApiKey(
  userId: string,
  keyId: string
): Promise<boolean> {
  const existing = await db.query.ccflareApiKeys.findFirst({
    where: and(
      eq(ccflareApiKeys.id, keyId),
      eq(ccflareApiKeys.userId, userId)
    ),
  });

  if (!existing) {
    return false;
  }

  await db.delete(ccflareApiKeys).where(eq(ccflareApiKeys.id, keyId));
  log.info("Removed ccflare API key", { userId, keyId, name: existing.name });
  return true;
}

/**
 * List all API keys for a user.
 * Keys are returned without the decrypted value for security.
 */
export async function listApiKeys(
  userId: string
): Promise<CcflareApiKey[]> {
  const rows = await db.query.ccflareApiKeys.findMany({
    where: eq(ccflareApiKeys.userId, userId),
  });
  return rows.map(mapApiKeyRow);
}

/**
 * Toggle the paused state of an API key.
 */
export async function toggleApiKeyPause(
  userId: string,
  keyId: string
): Promise<CcflareApiKey> {
  const existing = await db.query.ccflareApiKeys.findFirst({
    where: and(
      eq(ccflareApiKeys.id, keyId),
      eq(ccflareApiKeys.userId, userId)
    ),
  });

  if (!existing) {
    throw new Error(`API key not found: ${keyId}`);
  }

  const newPaused = !existing.paused;
  const now = new Date();

  await db
    .update(ccflareApiKeys)
    .set({
      paused: newPaused,
      updatedAt: now,
    })
    .where(eq(ccflareApiKeys.id, keyId));

  log.info("Toggled ccflare API key pause", {
    userId,
    keyId,
    paused: newPaused,
  });

  return mapApiKeyRow({ ...existing, paused: newPaused, updatedAt: now });
}

// ─────────────────────────────────────────────────────────────────────────────
// Process Control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the ccflare proxy for a user.
 * Reads the user's config for port settings.
 */
export async function start(userId: string): Promise<CcflareStatus> {
  const config = await getConfig(userId);
  const port = config?.port ?? DEFAULT_PORT;

  log.info("Starting ccflare proxy", { userId, port });
  await ccflareProcessManager.start({ port });

  return getStatus();
}

/**
 * Stop the ccflare proxy.
 */
export async function stop(): Promise<void> {
  log.info("Stopping ccflare proxy");
  await ccflareProcessManager.stop();
}

/**
 * Restart the ccflare proxy for a user.
 */
export async function restart(userId: string): Promise<CcflareStatus> {
  const config = await getConfig(userId);
  const port = config?.port ?? DEFAULT_PORT;

  log.info("Restarting ccflare proxy", { userId, port });
  await ccflareProcessManager.restart({ port });

  return getStatus();
}

/**
 * Get the current status of the ccflare proxy.
 * Enriches the process manager status with installation info.
 */
export async function getStatus(): Promise<CcflareStatus> {
  const processStatus = ccflareProcessManager.getStatus();

  // Enrich with cached version (avoid forking --version on every call)
  if (processStatus.installed && processStatus.version === null) {
    if (cachedVersion === null) {
      const install = await checkInstallation();
      if (install.installed) {
        cachedVersion = install.version;
      }
    }
    return { ...processStatus, version: cachedVersion };
  }

  return processStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats (proxied from running ccflare HTTP API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch usage stats from the running ccflare instance.
 * Returns null if ccflare is not running or the stats endpoint errors.
 */
export async function getStats(): Promise<CcflareStats | null> {
  const port = ccflareProcessManager.getPort();
  if (!port || !ccflareProcessManager.isRunning()) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      STATS_FETCH_TIMEOUT_MS
    );

    const response = await fetch(
      `http://${DEFAULT_HOST}:${port}/api/stats`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      log.debug("Stats endpoint returned non-OK", {
        status: response.status,
      });
      return null;
    }

    const data = await response.json();

    return {
      totalRequests: data.totalRequests ?? 0,
      successRate: data.successRate ?? 0,
      totalTokens: data.totalTokens ?? 0,
      totalCost: data.totalCost ?? 0,
      activeAccounts: data.activeAccounts ?? 0,
    };
  } catch (err) {
    log.debug("Failed to fetch ccflare stats", { error: String(err) });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register an API key with the ccflare binary's internal database.
 * This calls the CLI to persist the key so ccflare can use it on next start.
 */
async function registerKeyWithCcflare(
  name: string,
  apiKey: string,
  priority: number
): Promise<void> {
  const binaryPath = ccflareProcessManager.getBinaryPath();
  if (!binaryPath) {
    log.warn(
      "Cannot register key with ccflare — binary not found"
    );
    return;
  }

  const dbPath = ccflareProcessManager.getDatabasePath();

  try {
    // Pass API key via env to avoid exposure in process listing
    await execFileAsync(
      binaryPath,
      [
        "--add-account",
        name,
        "--mode",
        "claude-api",
        "--priority",
        String(priority),
      ],
      {
        env: {
          ...process.env,
          BETTER_CCFLARE_DB_PATH: dbPath,
          ANTHROPIC_API_KEY: apiKey,
        } as NodeJS.ProcessEnv,
        timeout: 10000,
      }
    );

    log.info("Registered API key with ccflare", { name, priority });
  } catch (err) {
    log.error("Failed to register API key with ccflare", {
      error: String(err),
      name,
    });
  }
}

/**
 * Map a database row to a CcflareConfig type.
 */
function mapConfigRow(row: {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  createdAt: Date;
  updatedAt: Date;
}): CcflareConfig {
  return {
    id: row.id,
    userId: row.userId,
    enabled: row.enabled,
    autoStart: row.autoStart,
    port: row.port,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a database row to a CcflareApiKey type.
 * Excludes the encrypted key value for security.
 */
function mapApiKeyRow(row: {
  id: string;
  userId: string;
  name: string;
  encryptedKey: string;
  keyPrefix: string | null;
  baseUrl: string | null;
  priority: number;
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CcflareApiKey {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    keyPrefix: row.keyPrefix ?? null,
    baseUrl: row.baseUrl ?? null,
    priority: row.priority,
    paused: row.paused,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get the top-priority active direct-endpoint key for a user.
 * Lower priority number = higher precedence (0 is used first).
 * Returns null if no non-proxy keys are configured.
 * Used by session env resolution to auto-inject a direct endpoint when the proxy is not running.
 */
export async function getActiveDirectKey(
  userId: string
): Promise<{ baseUrl: string; encryptedKey: string } | null> {
  const rows = await db.query.ccflareApiKeys.findMany({
    where: eq(ccflareApiKeys.userId, userId),
    orderBy: (t, { asc }) => [asc(t.priority)],
  });

  const directKey = rows.find(
    (r) => !r.paused && r.baseUrl && r.baseUrl !== ANTHROPIC_DEFAULT_BASE_URL
  );

  if (!directKey || !directKey.baseUrl) return null;

  return { baseUrl: directKey.baseUrl, encryptedKey: directKey.encryptedKey };
}
