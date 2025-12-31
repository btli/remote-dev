/**
 * Agent Profile Configuration Service
 *
 * Manages JSON configurations for AI coding agents (Claude Code, Gemini CLI, OpenCode, Codex).
 * Configurations are stored per-profile and can be exported/imported.
 *
 * This is separate from agent-config-service.ts which handles markdown configs (CLAUDE.md).
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { agentProfileJsonConfigs } from "@/db/schema";
import type { AgentProvider } from "@/types/agent";
import type {
  AgentJsonConfig,
  AgentProfileJsonConfig,
  ClaudeCodeConfig,
  GeminiCLIConfig,
  OpenCodeConfig,
  CodexCLIConfig,
} from "@/types/agent-config";

export type AgentConfigType = Exclude<AgentProvider, "all">;

type ConfigTypeMap = {
  claude: ClaudeCodeConfig;
  gemini: GeminiCLIConfig;
  opencode: OpenCodeConfig;
  codex: CodexCLIConfig;
};

export class AgentProfileConfigService {
  /**
   * Get all configurations for a profile.
   */
  async getProfileConfigs(profileId: string): Promise<AgentProfileJsonConfig[]> {
    const rows = await db
      .select()
      .from(agentProfileJsonConfigs)
      .where(eq(agentProfileJsonConfigs.profileId, profileId));

    return rows.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      userId: row.userId,
      agentType: row.agentType as AgentConfigType,
      configJson: JSON.parse(row.configJson) as AgentJsonConfig,
      isValid: row.isValid,
      validationErrors: row.validationErrors
        ? JSON.parse(row.validationErrors)
        : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Get configuration for a specific agent type in a profile.
   */
  async getConfig<T extends AgentConfigType>(
    profileId: string,
    agentType: T
  ): Promise<ConfigTypeMap[T] | null> {
    const [row] = await db
      .select()
      .from(agentProfileJsonConfigs)
      .where(
        and(
          eq(agentProfileJsonConfigs.profileId, profileId),
          eq(agentProfileJsonConfigs.agentType, agentType)
        )
      );

    if (!row) return null;

    return JSON.parse(row.configJson) as ConfigTypeMap[T];
  }

  /**
   * Get configuration with metadata.
   */
  async getConfigWithMetadata(
    profileId: string,
    agentType: AgentConfigType
  ): Promise<AgentProfileJsonConfig | null> {
    const [row] = await db
      .select()
      .from(agentProfileJsonConfigs)
      .where(
        and(
          eq(agentProfileJsonConfigs.profileId, profileId),
          eq(agentProfileJsonConfigs.agentType, agentType)
        )
      );

    if (!row) return null;

    return {
      id: row.id,
      profileId: row.profileId,
      userId: row.userId,
      agentType: row.agentType as AgentConfigType,
      configJson: JSON.parse(row.configJson) as AgentJsonConfig,
      isValid: row.isValid,
      validationErrors: row.validationErrors
        ? JSON.parse(row.validationErrors)
        : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Create or update a configuration.
   */
  async upsertConfig(
    userId: string,
    profileId: string,
    agentType: AgentConfigType,
    configJson: AgentJsonConfig
  ): Promise<AgentProfileJsonConfig> {
    // Validate the config
    const validation = this.validateConfig(agentType, configJson);

    const [existing] = await db
      .select()
      .from(agentProfileJsonConfigs)
      .where(
        and(
          eq(agentProfileJsonConfigs.profileId, profileId),
          eq(agentProfileJsonConfigs.agentType, agentType)
        )
      );

    const now = new Date();

    if (existing) {
      // Update existing
      const [updated] = await db
        .update(agentProfileJsonConfigs)
        .set({
          configJson: JSON.stringify(configJson),
          isValid: validation.isValid,
          validationErrors: validation.errors.length > 0
            ? JSON.stringify(validation.errors)
            : null,
          updatedAt: now,
        })
        .where(eq(agentProfileJsonConfigs.id, existing.id))
        .returning();

      return {
        id: updated.id,
        profileId: updated.profileId,
        userId: updated.userId,
        agentType: updated.agentType as AgentConfigType,
        configJson,
        isValid: updated.isValid,
        validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }

    // Create new
    const [created] = await db
      .insert(agentProfileJsonConfigs)
      .values({
        profileId,
        userId,
        agentType,
        configJson: JSON.stringify(configJson),
        isValid: validation.isValid,
        validationErrors: validation.errors.length > 0
          ? JSON.stringify(validation.errors)
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      id: created.id,
      profileId: created.profileId,
      userId: created.userId,
      agentType: created.agentType as AgentConfigType,
      configJson,
      isValid: created.isValid,
      validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Update specific fields in a configuration (merge).
   */
  async updateConfigPartial<T extends AgentConfigType>(
    profileId: string,
    agentType: T,
    updates: Partial<ConfigTypeMap[T]>
  ): Promise<AgentProfileJsonConfig | null> {
    const existing = await this.getConfigWithMetadata(profileId, agentType);
    if (!existing) return null;

    // Deep merge the updates
    const merged = this.deepMerge(
      existing.configJson as Record<string, unknown>,
      updates as Record<string, unknown>
    );

    // Get userId from existing
    return this.upsertConfig(
      existing.userId,
      profileId,
      agentType,
      merged as AgentJsonConfig
    );
  }

  /**
   * Delete a configuration.
   */
  async deleteConfig(profileId: string, agentType: AgentConfigType): Promise<boolean> {
    const result = await db
      .delete(agentProfileJsonConfigs)
      .where(
        and(
          eq(agentProfileJsonConfigs.profileId, profileId),
          eq(agentProfileJsonConfigs.agentType, agentType)
        )
      );

    return result.rowsAffected > 0;
  }

  /**
   * Delete all configurations for a profile.
   */
  async deleteAllProfileConfigs(profileId: string): Promise<number> {
    const result = await db
      .delete(agentProfileJsonConfigs)
      .where(eq(agentProfileJsonConfigs.profileId, profileId));

    return result.rowsAffected;
  }

  /**
   * Initialize default configurations for all agent types in a profile.
   */
  async initializeDefaultConfigs(
    userId: string,
    profileId: string
  ): Promise<AgentProfileJsonConfig[]> {
    const { getDefaultConfig } = await import("@/types/agent-config");

    const agentTypes: AgentConfigType[] = ["claude", "gemini", "opencode", "codex"];
    const results: AgentProfileJsonConfig[] = [];

    for (const agentType of agentTypes) {
      const defaultConfig = getDefaultConfig(agentType);
      const config = await this.upsertConfig(userId, profileId, agentType, defaultConfig);
      results.push(config);
    }

    return results;
  }

  /**
   * Export all configurations for a profile as JSON.
   */
  async exportProfileConfigs(profileId: string): Promise<Record<AgentConfigType, AgentJsonConfig>> {
    const configs = await this.getProfileConfigs(profileId);

    const result = {} as Record<AgentConfigType, AgentJsonConfig>;
    for (const config of configs) {
      result[config.agentType] = config.configJson;
    }

    return result;
  }

  /**
   * Import configurations from JSON export.
   */
  async importProfileConfigs(
    userId: string,
    profileId: string,
    configs: Record<AgentConfigType, AgentJsonConfig>
  ): Promise<AgentProfileJsonConfig[]> {
    const results: AgentProfileJsonConfig[] = [];

    for (const [agentType, configJson] of Object.entries(configs)) {
      const config = await this.upsertConfig(
        userId,
        profileId,
        agentType as AgentConfigType,
        configJson
      );
      results.push(config);
    }

    return results;
  }

  /**
   * Validate a configuration object.
   */
  validateConfig(
    agentType: AgentConfigType,
    config: AgentJsonConfig
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic type validation
    if (typeof config !== "object" || config === null) {
      errors.push("Configuration must be an object");
      return { isValid: false, errors };
    }

    // Agent-specific validation
    switch (agentType) {
      case "claude":
        this.validateClaudeConfig(config as ClaudeCodeConfig, errors);
        break;
      case "gemini":
        this.validateGeminiConfig(config as GeminiCLIConfig, errors);
        break;
      case "opencode":
        this.validateOpenCodeConfig(config as OpenCodeConfig, errors);
        break;
      case "codex":
        this.validateCodexConfig(config as CodexCLIConfig, errors);
        break;
    }

    return { isValid: errors.length === 0, errors };
  }

  private validateClaudeConfig(config: ClaudeCodeConfig, errors: string[]): void {
    if (config.cleanupPeriodDays !== undefined) {
      if (typeof config.cleanupPeriodDays !== "number" || config.cleanupPeriodDays < 1 || config.cleanupPeriodDays > 90) {
        errors.push("cleanupPeriodDays must be a number between 1 and 90");
      }
    }

    if (config.permissions?.defaultMode !== undefined) {
      const validModes = ["acceptEdits", "askOnEdit", "readOnly"];
      if (!validModes.includes(config.permissions.defaultMode)) {
        errors.push(`permissions.defaultMode must be one of: ${validModes.join(", ")}`);
      }
    }

    if (config.sandbox?.network?.httpProxyPort !== undefined) {
      if (typeof config.sandbox.network.httpProxyPort !== "number" ||
          config.sandbox.network.httpProxyPort < 1024 ||
          config.sandbox.network.httpProxyPort > 65535) {
        errors.push("sandbox.network.httpProxyPort must be a valid port number (1024-65535)");
      }
    }

    if (config.statusLine?.type !== undefined) {
      const validTypes = ["disabled", "command"];
      if (!validTypes.includes(config.statusLine.type)) {
        errors.push(`statusLine.type must be one of: ${validTypes.join(", ")}`);
      }
    }
  }

  private validateGeminiConfig(config: GeminiCLIConfig, errors: string[]): void {
    if (config.sessionRetention?.maxAge !== undefined) {
      if (typeof config.sessionRetention.maxAge !== "number" || config.sessionRetention.maxAge < 1) {
        errors.push("sessionRetention.maxAge must be a positive number");
      }
    }

    if (config.sessionRetention?.maxCount !== undefined) {
      if (typeof config.sessionRetention.maxCount !== "number" || config.sessionRetention.maxCount < 1) {
        errors.push("sessionRetention.maxCount must be a positive number");
      }
    }

    if (config.model?.maxSessionTurns !== undefined) {
      if (typeof config.model.maxSessionTurns !== "number" || config.model.maxSessionTurns < 1) {
        errors.push("model.maxSessionTurns must be a positive number");
      }
    }

    if (config.tools?.sandbox?.mode !== undefined) {
      const validModes = ["strict", "permissive"];
      if (!validModes.includes(config.tools.sandbox.mode)) {
        errors.push(`tools.sandbox.mode must be one of: ${validModes.join(", ")}`);
      }
    }
  }

  private validateOpenCodeConfig(config: OpenCodeConfig, errors: string[]): void {
    if (config.interface?.diffStyle !== undefined) {
      const validStyles = ["unified", "split"];
      if (!validStyles.includes(config.interface.diffStyle)) {
        errors.push(`interface.diffStyle must be one of: ${validStyles.join(", ")}`);
      }
    }

    if (config.tools?.permissionMode !== undefined) {
      const validModes = ["ask", "auto", "deny"];
      if (!validModes.includes(config.tools.permissionMode)) {
        errors.push(`tools.permissionMode must be one of: ${validModes.join(", ")}`);
      }
    }

    if (config.server?.previewPort !== undefined) {
      if (typeof config.server.previewPort !== "number" ||
          config.server.previewPort < 1024 ||
          config.server.previewPort > 65535) {
        errors.push("server.previewPort must be a valid port number (1024-65535)");
      }
    }
  }

  private validateCodexConfig(config: CodexCLIConfig, errors: string[]): void {
    if (config.model?.reasoningEffort !== undefined) {
      const validEfforts = ["low", "medium", "high"];
      if (!validEfforts.includes(config.model.reasoningEffort)) {
        errors.push(`model.reasoningEffort must be one of: ${validEfforts.join(", ")}`);
      }
    }

    if (config.model?.verbosity !== undefined) {
      const validLevels = ["quiet", "normal", "verbose"];
      if (!validLevels.includes(config.model.verbosity)) {
        errors.push(`model.verbosity must be one of: ${validLevels.join(", ")}`);
      }
    }

    if (config.execution?.approvalPolicy !== undefined) {
      const validPolicies = ["suggest", "auto-edit", "full-auto"];
      if (!validPolicies.includes(config.execution.approvalPolicy)) {
        errors.push(`execution.approvalPolicy must be one of: ${validPolicies.join(", ")}`);
      }
    }

    if (config.execution?.sandboxMode !== undefined) {
      const validModes = ["docker", "none", "seatbelt"];
      if (!validModes.includes(config.execution.sandboxMode)) {
        errors.push(`execution.sandboxMode must be one of: ${validModes.join(", ")}`);
      }
    }

    if (config.observability?.logLevel !== undefined) {
      const validLevels = ["debug", "info", "warn", "error"];
      if (!validLevels.includes(config.observability.logLevel)) {
        errors.push(`observability.logLevel must be one of: ${validLevels.join(", ")}`);
      }
    }
  }

  /**
   * Deep merge two objects.
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue !== null &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue;
      }
    }

    return result;
  }
}

// Singleton instance
export const agentProfileConfigService = new AgentProfileConfigService();
