/**
 * SDK Configuration
 *
 * Default configuration and configuration utilities for the Remote Dev SDK.
 */

import type { SDKConfig, CreateSDKOptions } from "../types";

/** Default memory configuration */
export const DEFAULT_MEMORY_CONFIG: SDKConfig["memory"] = {
  shortTermTtl: 3600, // 1 hour
  maxWorkingEntries: 100,
  consolidationInterval: 300, // 5 minutes
};

/** Default meta-agent configuration */
export const DEFAULT_META_AGENT_CONFIG: SDKConfig["metaAgent"] = {
  maxIterations: 3,
  targetScore: 0.9,
  autoOptimize: false,
};

/** Default orchestrator configuration */
export const DEFAULT_ORCHESTRATOR_CONFIG: SDKConfig["orchestrator"] = {
  monitoringInterval: 30, // 30 seconds
  stallThreshold: 300, // 5 minutes
  autoIntervention: false,
};

/** Default SDK configuration */
export const DEFAULT_SDK_CONFIG: Omit<SDKConfig, "userId"> = {
  databasePath: "sqlite.db",
  apiBaseUrl: "http://localhost:6001",
  memory: DEFAULT_MEMORY_CONFIG,
  metaAgent: DEFAULT_META_AGENT_CONFIG,
  orchestrator: DEFAULT_ORCHESTRATOR_CONFIG,
};

/**
 * Create a full SDK configuration from options.
 */
export function createConfig(options: CreateSDKOptions): SDKConfig {
  return {
    databasePath: options.databasePath ?? DEFAULT_SDK_CONFIG.databasePath,
    apiBaseUrl: options.apiBaseUrl ?? DEFAULT_SDK_CONFIG.apiBaseUrl,
    userId: options.userId,
    folderId: options.folderId,
    projectPath: options.projectPath,
    memory: {
      ...DEFAULT_MEMORY_CONFIG,
      ...options.memory,
    },
    metaAgent: {
      ...DEFAULT_META_AGENT_CONFIG,
      ...options.metaAgent,
    },
    orchestrator: {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      ...options.orchestrator,
    },
  };
}

/**
 * Validate SDK configuration.
 */
export function validateConfig(config: SDKConfig): void {
  if (!config.userId) {
    throw new Error("SDK configuration requires a userId");
  }

  if (!config.databasePath) {
    throw new Error("SDK configuration requires a databasePath");
  }

  if (!config.apiBaseUrl) {
    throw new Error("SDK configuration requires an apiBaseUrl");
  }

  // Validate memory config
  if (config.memory.shortTermTtl <= 0) {
    throw new Error("shortTermTtl must be positive");
  }

  if (config.memory.maxWorkingEntries <= 0) {
    throw new Error("maxWorkingEntries must be positive");
  }

  if (config.memory.consolidationInterval <= 0) {
    throw new Error("consolidationInterval must be positive");
  }

  // Validate meta-agent config
  if (config.metaAgent.maxIterations <= 0) {
    throw new Error("maxIterations must be positive");
  }

  if (config.metaAgent.targetScore < 0 || config.metaAgent.targetScore > 1) {
    throw new Error("targetScore must be between 0 and 1");
  }

  // Validate orchestrator config
  if (config.orchestrator.monitoringInterval <= 0) {
    throw new Error("monitoringInterval must be positive");
  }

  if (config.orchestrator.stallThreshold <= 0) {
    throw new Error("stallThreshold must be positive");
  }
}
