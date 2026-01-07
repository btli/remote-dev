/**
 * AgentConfigService - Manages AI agent configuration files
 *
 * Handles CRUD operations for CLAUDE.md, AGENTS.md, GEMINI.md files
 * stored per folder with inheritance support (global → folder-specific).
 */

import { db } from "@/db";
import { agentConfigs } from "@/db/schema";
import { eq, and, isNull, asc } from "drizzle-orm";
import type {
  AgentConfig,
  AgentProvider,
  AgentConfigType,
  UpsertAgentConfigInput,
} from "@/types/agent";

/**
 * Get all configs for a user (global and folder-specific)
 */
export async function getConfigs(userId: string): Promise<AgentConfig[]> {
  const configs = await db.query.agentConfigs.findMany({
    where: eq(agentConfigs.userId, userId),
    orderBy: [asc(agentConfigs.createdAt)],
  });

  return configs.map(mapDbToConfig);
}

/**
 * Get all configs for a specific folder
 */
export async function getFolderConfigs(
  folderId: string,
  userId: string
): Promise<AgentConfig[]> {
  const configs = await db.query.agentConfigs.findMany({
    where: and(
      eq(agentConfigs.userId, userId),
      eq(agentConfigs.folderId, folderId)
    ),
  });

  return configs.map(mapDbToConfig);
}

/**
 * Get global configs (no folder association)
 */
export async function getGlobalConfigs(userId: string): Promise<AgentConfig[]> {
  const configs = await db.query.agentConfigs.findMany({
    where: and(eq(agentConfigs.userId, userId), isNull(agentConfigs.folderId)),
  });

  return configs.map(mapDbToConfig);
}

/**
 * Get a specific config by provider and type
 */
export async function getConfig(
  userId: string,
  provider: AgentProvider,
  configType: AgentConfigType,
  folderId?: string
): Promise<AgentConfig | null> {
  const config = await db.query.agentConfigs.findFirst({
    where: and(
      eq(agentConfigs.userId, userId),
      eq(agentConfigs.provider, provider),
      eq(agentConfigs.configType, configType),
      folderId ? eq(agentConfigs.folderId, folderId) : isNull(agentConfigs.folderId)
    ),
  });

  return config ? mapDbToConfig(config) : null;
}

/**
 * Get resolved config content with inheritance
 * Merges global config with folder-specific overrides
 */
export async function getResolvedConfig(
  userId: string,
  provider: AgentProvider,
  configType: AgentConfigType,
  folderId?: string
): Promise<string> {
  // Get global config
  const globalConfig = await getConfig(userId, provider, configType);
  const globalContent = globalConfig?.content ?? "";

  if (!folderId) {
    return globalContent;
  }

  // Get folder-specific config
  const folderConfig = await getConfig(userId, provider, configType, folderId);
  const folderContent = folderConfig?.content ?? "";

  // If folder has content, it overrides (or can be merged based on strategy)
  // For now, folder content takes precedence if it exists
  return folderContent || globalContent;
}

/**
 * Get all configs for a folder with inheritance chain
 * Returns configs from global → parent folders → current folder
 */
export async function getConfigsWithInheritance(
  userId: string,
  folderId: string
): Promise<{
  global: AgentConfig[];
  folder: AgentConfig[];
  resolved: Map<string, string>; // key: "provider:configType", value: content
}> {
  // Get global configs
  const global = await getGlobalConfigs(userId);

  // Get folder-specific configs
  const folder = await getFolderConfigs(folderId, userId);

  // Build resolved map
  const resolved = new Map<string, string>();

  // Add global configs first
  for (const config of global) {
    const key = `${config.provider}:${config.configType}`;
    resolved.set(key, config.content);
  }

  // Override with folder configs
  for (const config of folder) {
    const key = `${config.provider}:${config.configType}`;
    resolved.set(key, config.content);
  }

  return { global, folder, resolved };
}

/**
 * Create or update a config (upsert)
 */
export async function upsertConfig(
  userId: string,
  input: UpsertAgentConfigInput
): Promise<AgentConfig> {
  const now = new Date();

  // Check for existing config
  const existing = await getConfig(
    userId,
    input.provider,
    input.configType,
    input.folderId
  );

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(agentConfigs)
      .set({
        content: input.content,
        updatedAt: now,
      })
      .where(eq(agentConfigs.id, existing.id))
      .returning();

    return mapDbToConfig(updated);
  }

  // Create new
  const [created] = await db
    .insert(agentConfigs)
    .values({
      userId,
      folderId: input.folderId ?? null,
      provider: input.provider,
      configType: input.configType,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return mapDbToConfig(created);
}

/**
 * Delete a config
 */
export async function deleteConfig(
  configId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(agentConfigs)
    .where(and(eq(agentConfigs.id, configId), eq(agentConfigs.userId, userId)));

  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Delete all configs for a folder
 */
export async function deleteFolderConfigs(
  folderId: string,
  userId: string
): Promise<number> {
  const result = await db
    .delete(agentConfigs)
    .where(
      and(eq(agentConfigs.folderId, folderId), eq(agentConfigs.userId, userId))
    );

  return result.rowsAffected ?? 0;
}

/**
 * Copy configs from one folder to another
 */
export async function copyFolderConfigs(
  sourceFolderId: string,
  targetFolderId: string,
  userId: string
): Promise<AgentConfig[]> {
  const sourceConfigs = await getFolderConfigs(sourceFolderId, userId);
  const now = new Date();

  const created: AgentConfig[] = [];
  for (const config of sourceConfigs) {
    const [newConfig] = await db
      .insert(agentConfigs)
      .values({
        userId,
        folderId: targetFolderId,
        provider: config.provider,
        configType: config.configType,
        content: config.content,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          agentConfigs.userId,
          agentConfigs.folderId,
          agentConfigs.provider,
          agentConfigs.configType,
        ],
        set: {
          content: config.content,
          updatedAt: now,
        },
      })
      .returning();

    created.push(mapDbToConfig(newConfig));
  }

  return created;
}

/**
 * Get config file type for a provider
 */
export function getConfigTypeForProvider(
  provider: Exclude<AgentProvider, "all">
): AgentConfigType {
  const mapping: Record<
    Exclude<AgentProvider, "all">,
    AgentConfigType
  > = {
    claude: "CLAUDE.md",
    codex: "AGENTS.md",
    gemini: "GEMINI.md",
    opencode: "OPENCODE.md",
  };
  return mapping[provider];
}

/**
 * Map database record to AgentConfig type
 */
function mapDbToConfig(
  record: typeof agentConfigs.$inferSelect
): AgentConfig {
  return {
    id: record.id,
    userId: record.userId,
    folderId: record.folderId ?? undefined,
    provider: record.provider as AgentProvider,
    configType: record.configType as AgentConfigType,
    content: record.content,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

// Re-export error class from centralized location for backwards compatibility
export { AgentConfigServiceError } from "@/lib/errors";
