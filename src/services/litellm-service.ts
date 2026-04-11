/**
 * LiteLLM Service
 *
 * Functional service for managing the LiteLLM AI API proxy.
 * Handles configuration CRUD, model management, process control delegation,
 * and YAML config generation for the running LiteLLM instance.
 */

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants } from "node:fs";
import { db } from "@/db";
import { litellmConfig, litellmModels } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/encryption";
import { createLogger } from "@/lib/logger";
import { litellmProcessManager } from "./litellm-process-manager";
import type {
  LiteLLMConfig,
  LiteLLMModel,
  LiteLLMInstallStatus,
  LiteLLMStatus,
  UpdateLiteLLMConfigInput,
  AddLiteLLMModelInput,
} from "@/types/litellm";

const log = createLogger("LiteLLMService");
const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 4000;

// Cache version to avoid forking `--version` on every poll
let cachedVersion: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Installation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if litellm is installed and get version/path info.
 */
export async function checkInstallation(): Promise<LiteLLMInstallStatus> {
  const binaryPath = litellmProcessManager.getBinaryPath();
  if (!binaryPath) {
    return { installed: false, error: "litellm binary not found" };
  }

  // For local path, verify it exists
  if (binaryPath !== "litellm") {
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
      error: "Could not determine litellm version",
    };
  }

  return {
    installed: true,
    version,
    path: binaryPath,
  };
}

/**
 * Get the installed litellm version.
 */
export async function getVersion(
  binaryPath?: string
): Promise<string | null> {
  const bin = binaryPath ?? litellmProcessManager.getBinaryPath();
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
 * Get the litellm configuration for a user.
 */
export async function getConfig(
  userId: string
): Promise<LiteLLMConfig | null> {
  const row = await db.query.litellmConfig.findFirst({
    where: eq(litellmConfig.userId, userId),
  });
  return row ? mapConfigRow(row) : null;
}

/**
 * Create or update the litellm configuration for a user.
 */
export async function upsertConfig(
  userId: string,
  input: UpdateLiteLLMConfigInput
): Promise<LiteLLMConfig> {
  const existing = await db.query.litellmConfig.findFirst({
    where: eq(litellmConfig.userId, userId),
  });

  const now = new Date();

  if (existing) {
    await db
      .update(litellmConfig)
      .set({
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.autoStart !== undefined
          ? { autoStart: input.autoStart }
          : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        updatedAt: now,
      })
      .where(eq(litellmConfig.id, existing.id));

    const updated = await db.query.litellmConfig.findFirst({
      where: eq(litellmConfig.id, existing.id),
    });

    if (!updated) throw new Error(`Config not found after update: ${existing.id}`);
    log.info("Updated litellm config", { userId, changes: input });
    return mapConfigRow(updated);
  }

  const id = crypto.randomUUID();
  await db.insert(litellmConfig).values({
    id,
    userId,
    enabled: input.enabled ?? false,
    autoStart: input.autoStart ?? false,
    port: input.port ?? DEFAULT_PORT,
    createdAt: now,
    updatedAt: now,
  });

  const created = await db.query.litellmConfig.findFirst({
    where: eq(litellmConfig.id, id),
  });

  if (!created) throw new Error(`Config not found after insert: ${id}`);
  log.info("Created litellm config", { userId, id });
  return mapConfigRow(created);
}

/**
 * Find any user config with both enabled and autoStart set to true.
 * Used during server startup to auto-start the litellm proxy.
 */
export async function getAutoStartConfig(): Promise<LiteLLMConfig | null> {
  const row = await db.query.litellmConfig.findFirst({
    where: and(
      eq(litellmConfig.enabled, true),
      eq(litellmConfig.autoStart, true)
    ),
  });
  return row ? mapConfigRow(row) : null;
}

/**
 * Ensure a master key exists for the user's LiteLLM config.
 * Generates a 32-byte hex key if one doesn't exist, encrypts it, and stores it.
 * Returns the decrypted (plaintext) master key.
 */
export async function ensureMasterKey(userId: string): Promise<string> {
  const existing = await db.query.litellmConfig.findFirst({
    where: eq(litellmConfig.userId, userId),
  });

  // If config exists and has a master key, decrypt and return it
  if (existing?.masterKey) {
    return decrypt(existing.masterKey);
  }

  // Generate a new 32-byte hex master key
  const plainKey = crypto.randomBytes(32).toString("hex");
  const encryptedKey = encrypt(plainKey);
  const now = new Date();

  if (existing) {
    // Config exists but no master key — update it
    await db
      .update(litellmConfig)
      .set({ masterKey: encryptedKey, updatedAt: now })
      .where(eq(litellmConfig.id, existing.id));

    log.info("Generated master key for existing litellm config", { userId });
  } else {
    // No config at all — create one with the master key
    const id = crypto.randomUUID();
    await db.insert(litellmConfig).values({
      id,
      userId,
      enabled: false,
      autoStart: false,
      port: DEFAULT_PORT,
      masterKey: encryptedKey,
      createdAt: now,
      updatedAt: now,
    });

    log.info("Created litellm config with master key", { userId, id });
  }

  return plainKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all models for a user.
 */
export async function listModels(userId: string): Promise<LiteLLMModel[]> {
  const rows = await db.query.litellmModels.findMany({
    where: eq(litellmModels.userId, userId),
  });
  return rows.map(mapModelRow);
}

/**
 * Add a model configuration for the LiteLLM proxy.
 * Encrypts the API key for database storage.
 * If the proxy is running, triggers a regenerate-and-restart.
 */
export async function addModel(
  userId: string,
  input: AddLiteLLMModelInput
): Promise<LiteLLMModel> {
  const priority = input.priority ?? 0;
  const apiBase = input.apiBase?.trim() || null;
  const keyPrefix = input.apiKey ? input.apiKey.slice(0, 12) : null;
  const encryptedApiKey = input.apiKey ? encrypt(input.apiKey) : null;
  const extraHeaders = input.extraHeaders?.trim() || null;
  const now = new Date();
  const id = crypto.randomUUID();

  // If this model is set as default, clear default on all other models first
  if (input.isDefault) {
    await db
      .update(litellmModels)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(litellmModels.userId, userId));
  }

  await db.insert(litellmModels).values({
    id,
    userId,
    modelName: input.modelName,
    provider: input.provider,
    litellmModel: input.litellmModel,
    apiBase,
    encryptedApiKey,
    keyPrefix,
    extraHeaders,
    priority,
    paused: false,
    isDefault: input.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
  });

  log.info("Added litellm model", {
    userId,
    modelName: input.modelName,
    provider: input.provider,
    litellmModel: input.litellmModel,
    priority,
    apiBase,
  });

  const row = await db.query.litellmModels.findFirst({
    where: eq(litellmModels.id, id),
  });

  // If proxy is running, regenerate config and restart
  const status = litellmProcessManager.getStatus();
  if (status.running) {
    await regenerateAndRestart(userId);
  }

  return mapModelRow(row!);
}

/**
 * Update an existing model configuration.
 * If the proxy is running, triggers a regenerate-and-restart.
 */
export async function updateModel(
  userId: string,
  modelId: string,
  input: Partial<AddLiteLLMModelInput>
): Promise<LiteLLMModel> {
  const existing = await db.query.litellmModels.findFirst({
    where: and(
      eq(litellmModels.id, modelId),
      eq(litellmModels.userId, userId)
    ),
  });

  if (!existing) {
    throw new Error(`Model not found: ${modelId}`);
  }

  const now = new Date();
  const updates: Record<string, unknown> = { updatedAt: now };

  if (input.modelName !== undefined) updates.modelName = input.modelName;
  if (input.provider !== undefined) updates.provider = input.provider;
  if (input.litellmModel !== undefined) updates.litellmModel = input.litellmModel;
  if (input.apiBase !== undefined) updates.apiBase = input.apiBase?.trim() || null;
  if (input.extraHeaders !== undefined) updates.extraHeaders = input.extraHeaders?.trim() || null;
  if (input.priority !== undefined) updates.priority = input.priority;

  if (input.apiKey !== undefined) {
    updates.encryptedApiKey = input.apiKey ? encrypt(input.apiKey) : null;
    updates.keyPrefix = input.apiKey ? input.apiKey.slice(0, 12) : null;
  }

  if (input.isDefault) {
    // Clear default on all other models first
    await db
      .update(litellmModels)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(litellmModels.userId, userId));
    updates.isDefault = true;
  } else if (input.isDefault === false) {
    updates.isDefault = false;
  }

  await db
    .update(litellmModels)
    .set(updates)
    .where(eq(litellmModels.id, modelId));

  log.info("Updated litellm model", { userId, modelId, changes: Object.keys(updates) });

  const updated = await db.query.litellmModels.findFirst({
    where: eq(litellmModels.id, modelId),
  });

  // If proxy is running, regenerate config and restart
  const status = litellmProcessManager.getStatus();
  if (status.running) {
    await regenerateAndRestart(userId);
  }

  return mapModelRow(updated!);
}

/**
 * Remove a model configuration.
 * If the proxy is running, triggers a regenerate-and-restart.
 */
export async function removeModel(
  userId: string,
  modelId: string
): Promise<boolean> {
  const existing = await db.query.litellmModels.findFirst({
    where: and(
      eq(litellmModels.id, modelId),
      eq(litellmModels.userId, userId)
    ),
  });

  if (!existing) {
    return false;
  }

  await db.delete(litellmModels).where(eq(litellmModels.id, modelId));
  log.info("Removed litellm model", { userId, modelId, modelName: existing.modelName });

  // If proxy is running, regenerate config and restart
  const status = litellmProcessManager.getStatus();
  if (status.running) {
    await regenerateAndRestart(userId);
  }

  return true;
}

/**
 * Toggle the paused state of a model.
 * If the proxy is running, triggers a regenerate-and-restart.
 */
export async function toggleModelPause(
  userId: string,
  modelId: string
): Promise<LiteLLMModel> {
  const existing = await db.query.litellmModels.findFirst({
    where: and(
      eq(litellmModels.id, modelId),
      eq(litellmModels.userId, userId)
    ),
  });

  if (!existing) {
    throw new Error(`Model not found: ${modelId}`);
  }

  const newPaused = !existing.paused;
  const now = new Date();

  await db
    .update(litellmModels)
    .set({
      paused: newPaused,
      updatedAt: now,
    })
    .where(eq(litellmModels.id, modelId));

  log.info("Toggled litellm model pause", {
    userId,
    modelId,
    paused: newPaused,
  });

  // If proxy is running, regenerate config and restart
  const status = litellmProcessManager.getStatus();
  if (status.running) {
    await regenerateAndRestart(userId);
  }

  return mapModelRow({ ...existing, paused: newPaused, updatedAt: now });
}

/**
 * Set a model as the default for a user.
 * Clears isDefault on all other models, then sets it on the target.
 * If the proxy is running, triggers a regenerate-and-restart.
 */
export async function setDefaultModel(
  userId: string,
  modelId: string
): Promise<void> {
  const existing = await db.query.litellmModels.findFirst({
    where: and(
      eq(litellmModels.id, modelId),
      eq(litellmModels.userId, userId)
    ),
  });

  if (!existing) {
    throw new Error(`Model not found: ${modelId}`);
  }

  const now = new Date();

  // Clear default on all models for this user
  await db
    .update(litellmModels)
    .set({ isDefault: false, updatedAt: now })
    .where(eq(litellmModels.userId, userId));

  // Set default on the target model
  await db
    .update(litellmModels)
    .set({ isDefault: true, updatedAt: now })
    .where(eq(litellmModels.id, modelId));

  log.info("Set default litellm model", { userId, modelId, modelName: existing.modelName });

  // If proxy is running, regenerate config and restart
  const status = litellmProcessManager.getStatus();
  if (status.running) {
    await regenerateAndRestart(userId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process Control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the litellm proxy for a user.
 * Reads all non-paused models, generates YAML config, and starts the process.
 */
export async function start(userId: string): Promise<LiteLLMStatus> {
  const config = await getConfig(userId);
  const port = config?.port ?? DEFAULT_PORT;
  const masterKey = await ensureMasterKey(userId);

  // Build model entries for YAML
  const models = await buildYamlModels(userId);
  const webhookSecret = process.env.LITELLM_WEBHOOK_SECRET;
  const nextPort = parseInt(process.env.PORT || "6001", 10);

  log.info("Starting litellm proxy", { userId, port, modelCount: models.length });
  await litellmProcessManager.start({ port, models, masterKey, webhookSecret, nextPort });

  return getStatus();
}

/**
 * Stop the litellm proxy.
 */
export async function stop(): Promise<void> {
  log.info("Stopping litellm proxy");
  await litellmProcessManager.stop();
}

/**
 * Restart the litellm proxy for a user.
 */
export async function restart(userId: string): Promise<LiteLLMStatus> {
  const config = await getConfig(userId);
  const port = config?.port ?? DEFAULT_PORT;
  const masterKey = await ensureMasterKey(userId);

  // Build model entries for YAML
  const models = await buildYamlModels(userId);
  const webhookSecret = process.env.LITELLM_WEBHOOK_SECRET;
  const nextPort = parseInt(process.env.PORT || "6001", 10);

  log.info("Restarting litellm proxy", { userId, port, modelCount: models.length });
  await litellmProcessManager.restart({ port, models, masterKey, webhookSecret, nextPort });

  return getStatus();
}

/**
 * Get the current status of the litellm proxy.
 * Enriches the process manager status with installation info.
 */
export async function getStatus(): Promise<LiteLLMStatus> {
  const processStatus = litellmProcessManager.getStatus();

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
// Session Env Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the active default model's master key for session environment injection.
 * Used when the proxy is running — the master key is what gets injected as
 * ANTHROPIC_API_KEY so Claude Code authenticates against the LiteLLM proxy.
 * Returns null if no non-paused default model exists.
 */
export async function getActiveDefaultModel(
  userId: string
): Promise<{ masterKey: string } | null> {
  const rows = await db.query.litellmModels.findMany({
    where: eq(litellmModels.userId, userId),
  });

  const defaultModel = rows.find((r) => !r.paused && r.isDefault);
  if (!defaultModel) return null;

  const masterKey = await ensureMasterKey(userId);
  return { masterKey };
}

/**
 * Get the active direct-endpoint model for a user.
 * Used as a fallback when the proxy is NOT running — returns the first
 * non-paused model with a custom apiBase (not the default Anthropic URL).
 */
export async function getActiveDirectModel(
  userId: string
): Promise<{ apiBase: string; encryptedKey: string } | null> {
  const rows = await db.query.litellmModels.findMany({
    where: eq(litellmModels.userId, userId),
    orderBy: (t, { asc }) => [asc(t.priority)],
  });

  // Any non-paused model with a custom apiBase is a direct-endpoint model
  const directModel = rows.find(
    (r) => !r.paused && r.apiBase && r.encryptedApiKey
  );

  if (!directModel || !directModel.apiBase || !directModel.encryptedApiKey) {
    return null;
  }

  return {
    apiBase: directModel.apiBase,
    encryptedKey: directModel.encryptedApiKey,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regenerate the LiteLLM YAML config from the database and restart the proxy.
 * Called after model add/remove/update operations when the proxy is running.
 */
export async function regenerateAndRestart(userId: string): Promise<void> {
  const config = await getConfig(userId);
  const port = config?.port ?? DEFAULT_PORT;
  const masterKey = await ensureMasterKey(userId);

  const models = await buildYamlModels(userId);
  const webhookSecret = process.env.LITELLM_WEBHOOK_SECRET;
  const nextPort = parseInt(process.env.PORT || "6001", 10);

  log.info("Regenerating litellm config and restarting", {
    userId,
    port,
    modelCount: models.length,
  });

  await litellmProcessManager.restart({ port, models, masterKey, webhookSecret, nextPort });
}

/**
 * Build YAML model entries from all non-paused models for a user.
 * Decrypts API keys for inclusion in the generated config.yaml.
 */
async function buildYamlModels(
  userId: string
): Promise<YamlModelEntry[]> {
  const rows = await db.query.litellmModels.findMany({
    where: and(
      eq(litellmModels.userId, userId),
      eq(litellmModels.paused, false)
    ),
  });

  return rows.map((row) => {
    const entry: YamlModelEntry = {
      modelName: row.modelName,
      litellmModel: row.litellmModel,
      provider: row.provider,
      apiBase: row.apiBase ?? undefined,
      apiKey: row.encryptedApiKey ? decrypt(row.encryptedApiKey) : undefined,
      extraHeaders: row.extraHeaders ? JSON.parse(row.extraHeaders) : undefined,
      priority: row.priority,
    };
    return entry;
  });
}

/**
 * Entry shape for YAML model_list generation.
 * Passed to the process manager for config.yaml writing.
 */
export interface YamlModelEntry {
  modelName: string;
  litellmModel: string;
  provider: string;
  apiBase?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  priority: number;
}

/**
 * Map a database row to a LiteLLMConfig type.
 */
function mapConfigRow(row: {
  id: string;
  userId: string;
  enabled: boolean;
  autoStart: boolean;
  port: number;
  masterKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LiteLLMConfig {
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
 * Map a database row to a LiteLLMModel type.
 * Excludes the encrypted API key value for security.
 */
function mapModelRow(row: {
  id: string;
  userId: string;
  modelName: string;
  provider: string;
  litellmModel: string;
  apiBase: string | null;
  encryptedApiKey: string | null;
  keyPrefix: string | null;
  extraHeaders: string | null;
  priority: number;
  paused: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): LiteLLMModel {
  return {
    id: row.id,
    userId: row.userId,
    modelName: row.modelName,
    provider: row.provider,
    litellmModel: row.litellmModel,
    apiBase: row.apiBase ?? null,
    keyPrefix: row.keyPrefix ?? null,
    extraHeaders: row.extraHeaders ?? null,
    priority: row.priority,
    paused: row.paused,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
