/**
 * Secrets Service
 *
 * Orchestration layer for secrets management.
 * Handles database operations, provider delegation, and secrets fetching.
 */

import { db } from "@/db";
import { projectSecretsConfig, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createSecretsProvider, isProviderSupported } from "./secrets";
import { SecretsServiceError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("Secrets");
import { encrypt, decryptSafe } from "@/lib/encryption";
import type {
  FolderSecretsConfig,
  UpdateFolderSecretsConfigInput,
  SecretsValidationResult,
  FetchSecretsResult,
  SecretsProviderType,
} from "@/types/secrets";

// Re-export for convenience
export { SecretsServiceError };

type ProjectSecretsRow = typeof projectSecretsConfig.$inferSelect;

/**
 * Get secrets configuration for a specific project (legacy "folder" identifier).
 */
export async function getFolderSecretsConfig(
  projectId: string,
  userId: string
): Promise<FolderSecretsConfig | null> {
  const config = await db.query.projectSecretsConfig.findFirst({
    where: and(
      eq(projectSecretsConfig.projectId, projectId),
      eq(projectSecretsConfig.userId, userId)
    ),
  });

  return config ? mapDbSecretsConfig(config) : null;
}

/**
 * Phase 3+ helper retained for compatibility. Both ids now resolve to the
 * same project_secrets_config row.
 */
export async function getConfigByProjectOrFolder(
  projectId: string | null,
  folderId: string | null,
  userId: string
): Promise<FolderSecretsConfig | null> {
  const id = projectId ?? folderId;
  if (!id) return null;
  return getFolderSecretsConfig(id, userId);
}

/**
 * Get all secrets configurations for a user
 */
export async function getAllFolderSecretsConfigs(
  userId: string
): Promise<FolderSecretsConfig[]> {
  const configs = await db.query.projectSecretsConfig.findMany({
    where: eq(projectSecretsConfig.userId, userId),
  });

  return configs.map(mapDbSecretsConfig);
}

/**
 * Get secrets configurations with folder (project) names (for UI)
 */
export async function getAllFolderSecretsConfigsWithFolders(
  userId: string
): Promise<(FolderSecretsConfig & { folderName: string })[]> {
  const configs = await db.query.projectSecretsConfig.findMany({
    where: eq(projectSecretsConfig.userId, userId),
  });

  const projectIds = configs.map((c) => c.projectId);
  if (projectIds.length === 0) {
    return [];
  }

  const projectRows = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
  });

  const nameMap = new Map(projectRows.map((p) => [p.id, p.name]));

  return configs.map((config) => ({
    ...mapDbSecretsConfig(config),
    folderName: nameMap.get(config.projectId) || "Unknown Project",
  }));
}

/**
 * Create or update folder (project) secrets configuration
 */
export async function updateFolderSecretsConfig(
  projectId: string,
  userId: string,
  input: UpdateFolderSecretsConfigInput
): Promise<FolderSecretsConfig> {
  // Validate provider is supported
  if (!isProviderSupported(input.provider)) {
    throw new SecretsServiceError(
      `Provider '${input.provider}' is not yet supported`,
      "PROVIDER_NOT_SUPPORTED",
      input.provider
    );
  }

  // Validate provider config before saving
  const validation = await validateProviderConfig(input.provider, input.config);
  if (!validation.valid) {
    throw new SecretsServiceError(
      validation.error || "Invalid provider configuration",
      "INVALID_CONFIG",
      input.provider
    );
  }

  // Encrypt provider config before storage (contains service tokens)
  const configJson = JSON.stringify(input.config);
  const encryptedConfig = encrypt(configJson);
  const now = new Date();

  // Check for existing config
  const existing = await getFolderSecretsConfig(projectId, userId);

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(projectSecretsConfig)
      .set({
        provider: input.provider,
        providerConfig: encryptedConfig,
        enabled: input.enabled ?? true,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectSecretsConfig.projectId, projectId),
          eq(projectSecretsConfig.userId, userId)
        )
      )
      .returning();

    return mapDbSecretsConfig(updated);
  }

  // Create new
  const [created] = await db
    .insert(projectSecretsConfig)
    .values({
      id: crypto.randomUUID(),
      projectId,
      userId,
      provider: input.provider,
      providerConfig: encryptedConfig,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbSecretsConfig(created);
}

/**
 * Delete folder secrets configuration
 */
export async function deleteFolderSecretsConfig(
  projectId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(projectSecretsConfig)
    .where(
      and(
        eq(projectSecretsConfig.projectId, projectId),
        eq(projectSecretsConfig.userId, userId)
      )
    );

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Toggle enabled state for folder secrets
 */
export async function toggleFolderSecretsEnabled(
  projectId: string,
  userId: string,
  enabled: boolean
): Promise<FolderSecretsConfig | null> {
  const existing = await getFolderSecretsConfig(projectId, userId);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(projectSecretsConfig)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectSecretsConfig.projectId, projectId),
        eq(projectSecretsConfig.userId, userId)
      )
    )
    .returning();

  return mapDbSecretsConfig(updated);
}

/**
 * Validate provider configuration without saving
 */
export async function validateProviderConfig(
  provider: string,
  config: Record<string, string>
): Promise<SecretsValidationResult> {
  if (!isProviderSupported(provider)) {
    return {
      valid: false,
      error: `Provider '${provider}' is not yet supported`,
    };
  }

  try {
    const providerClient = createSecretsProvider({ provider, config });
    return await providerClient.validate();
  } catch (error) {
    const err = error as Error;
    return {
      valid: false,
      error: err.message,
    };
  }
}

/**
 * Fetch secrets for a folder (project)
 * Returns null if no secrets config or disabled
 */
export async function fetchSecretsForFolder(
  projectId: string,
  userId: string
): Promise<FetchSecretsResult | null> {
  const config = await getFolderSecretsConfig(projectId, userId);

  if (!config || !config.enabled) {
    return null;
  }

  try {
    const provider = createSecretsProvider({
      provider: config.provider,
      config: config.providerConfig,
    });

    const secrets = await provider.fetchSecrets();
    const fetchedAt = new Date();

    // Update last fetched timestamp
    await db
      .update(projectSecretsConfig)
      .set({ lastFetchedAt: fetchedAt })
      .where(
        and(
          eq(projectSecretsConfig.projectId, projectId),
          eq(projectSecretsConfig.userId, userId)
        )
      );

    // Convert to environment variables object
    const secretsMap = secrets.reduce(
      (acc, { key, value }) => {
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>
    );

    return {
      secrets: secretsMap,
      fetchedAt,
      provider: config.provider as SecretsProviderType,
    };
  } catch (error) {
    const err = error as Error;
    throw new SecretsServiceError(
      `Failed to fetch secrets: ${err.message}`,
      "FETCH_FAILED",
      config.provider
    );
  }
}

/**
 * Check if a folder has secrets configured
 */
export async function hasFolderSecretsConfig(
  projectId: string,
  userId: string
): Promise<boolean> {
  const config = await getFolderSecretsConfig(projectId, userId);
  return config !== null && config.enabled;
}

/**
 * Map database record to TypeScript type.
 * Decrypts provider config (handles both encrypted and legacy plaintext).
 */
function mapDbSecretsConfig(dbRecord: ProjectSecretsRow): FolderSecretsConfig {
  // providerConfig is stored as JSON (mode: "json") — it can be either a string
  // (legacy encrypted blob) or an object. Normalize both cases.
  const raw = dbRecord.providerConfig as unknown;
  let providerConfig: Record<string, string>;

  if (typeof raw === "string") {
    const decrypted = decryptSafe(raw);
    try {
      providerConfig = JSON.parse(decrypted ?? "{}");
    } catch {
      log.error("Failed to parse provider config for project", {
        projectId: dbRecord.projectId,
      });
      providerConfig = {};
    }
  } else if (raw && typeof raw === "object") {
    providerConfig = raw as Record<string, string>;
  } else {
    providerConfig = {};
  }

  return {
    id: dbRecord.id,
    folderId: dbRecord.projectId,
    userId: dbRecord.userId,
    provider: dbRecord.provider as SecretsProviderType,
    providerConfig,
    enabled: dbRecord.enabled ?? true,
    lastFetchedAt: dbRecord.lastFetchedAt
      ? new Date(dbRecord.lastFetchedAt)
      : null,
    createdAt: new Date(dbRecord.createdAt),
    updatedAt: new Date(dbRecord.updatedAt),
  };
}
