/**
 * Shared utilities for agent-related terminal plugins.
 */

import type { AgentProviderType, AgentProviderConfig } from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";

/**
 * Get agent provider config by ID
 */
export function getProviderConfig(
  providerId: AgentProviderType
): AgentProviderConfig | undefined {
  return AGENT_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * Build the agent command string.
 * Filters dangerous flags unless explicitly allowed.
 */
export function buildAgentCommand(
  provider: AgentProviderConfig,
  flags: string[] = [],
  allowDangerous = false
): string {
  const safeFlags = allowDangerous
    ? flags
    : flags.filter((f) => !provider.dangerousFlags?.includes(f));

  const allFlags = [...provider.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${provider.command}${flagsStr}`;
}
