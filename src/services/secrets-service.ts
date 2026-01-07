/**
 * Secrets Service
 *
 * Orchestration layer for secrets management.
 * Handles database operations, provider delegation, and secrets fetching.
 */

import { db } from "@/db";
import { folderSecretsConfig, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createSecretsProvider, isProviderSupported } from "./secrets";
import { SecretsServiceError } from "@/lib/errors";
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

/**
 * Get secrets configuration for a specific folder
 */
export async function getFolderSecretsConfig(
  folderId: string,
  userId: string
): Promise<FolderSecretsConfig | null> {
  const config = await db.query.folderSecretsConfig.findFirst({
    where: and(
      eq(folderSecretsConfig.folderId, folderId),
      eq(folderSecretsConfig.userId, userId)
    ),
  });

  return config ? mapDbSecretsConfig(config) : null;
}

/**
 * Get all secrets configurations for a user
 */
export async function getAllFolderSecretsConfigs(
  userId: string
): Promise<FolderSecretsConfig[]> {
  const configs = await db.query.folderSecretsConfig.findMany({
    where: eq(folderSecretsConfig.userId, userId),
  });

  return configs.map(mapDbSecretsConfig);
}

/**
 * Get secrets configurations with folder names (for UI)
 */
export async function getAllFolderSecretsConfigsWithFolders(
  userId: string
): Promise<(FolderSecretsConfig & { folderName: string })[]> {
  const configs = await db.query.folderSecretsConfig.findMany({
    where: eq(folderSecretsConfig.userId, userId),
  });

  // Get folder names
  const folderIds = configs.map((c) => c.folderId);
  if (folderIds.length === 0) {
    return [];
  }

  const folders = await db.query.sessionFolders.findMany({
    where: eq(sessionFolders.userId, userId),
  });

  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  return configs.map((config) => ({
    ...mapDbSecretsConfig(config),
    folderName: folderMap.get(config.folderId) || "Unknown Folder",
  }));
}

/**
 * Create or update folder secrets configuration
 */
export async function updateFolderSecretsConfig(
  folderId: string,
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
  const existing = await getFolderSecretsConfig(folderId, userId);

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(folderSecretsConfig)
      .set({
        provider: input.provider,
        providerConfig: encryptedConfig,
        enabled: input.enabled ?? true,
        updatedAt: now,
      })
      .where(
        and(
          eq(folderSecretsConfig.folderId, folderId),
          eq(folderSecretsConfig.userId, userId)
        )
      )
      .returning();

    return mapDbSecretsConfig(updated);
  }

  // Create new
  const [created] = await db
    .insert(folderSecretsConfig)
    .values({
      folderId,
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
  folderId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(folderSecretsConfig)
    .where(
      and(
        eq(folderSecretsConfig.folderId, folderId),
        eq(folderSecretsConfig.userId, userId)
      )
    );

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Toggle enabled state for folder secrets
 */
export async function toggleFolderSecretsEnabled(
  folderId: string,
  userId: string,
  enabled: boolean
): Promise<FolderSecretsConfig | null> {
  const existing = await getFolderSecretsConfig(folderId, userId);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(folderSecretsConfig)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(folderSecretsConfig.folderId, folderId),
        eq(folderSecretsConfig.userId, userId)
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
 * Fetch secrets for a folder
 * Returns null if no secrets config or disabled
 */
export async function fetchSecretsForFolder(
  folderId: string,
  userId: string
): Promise<FetchSecretsResult | null> {
  const config = await getFolderSecretsConfig(folderId, userId);

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
      .update(folderSecretsConfig)
      .set({ lastFetchedAt: fetchedAt })
      .where(
        and(
          eq(folderSecretsConfig.folderId, folderId),
          eq(folderSecretsConfig.userId, userId)
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
  folderId: string,
  userId: string
): Promise<boolean> {
  const config = await getFolderSecretsConfig(folderId, userId);
  return config !== null && config.enabled;
}

/**
 * Map database record to TypeScript type.
 * Decrypts provider config (handles both encrypted and legacy plaintext).
 */
function mapDbSecretsConfig(
  dbRecord: typeof folderSecretsConfig.$inferSelect
): FolderSecretsConfig {
  // Decrypt provider config - handles both encrypted and legacy plaintext
  const decryptedConfig = decryptSafe(dbRecord.providerConfig);
  let providerConfig: Record<string, string>;
  
  try {
    providerConfig = JSON.parse(decryptedConfig ?? "{}");
  } catch {
    // If JSON parsing fails after decryption, config may be corrupted
    console.error("Failed to parse provider config for folder:", dbRecord.folderId);
    providerConfig = {};
  }

  return {
    id: dbRecord.id,
    folderId: dbRecord.folderId,
    userId: dbRecord.userId,
    provider: dbRecord.provider as SecretsProviderType,
    providerConfig,
    enabled: dbRecord.enabled ?? true,
    lastFetchedAt: dbRecord.lastFetchedAt ? new Date(dbRecord.lastFetchedAt) : null,
    createdAt: new Date(dbRecord.createdAt),
    updatedAt: new Date(dbRecord.updatedAt),
  };
}
