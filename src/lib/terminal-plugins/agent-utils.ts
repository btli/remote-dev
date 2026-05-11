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
 *
 * The base command is always `provider.command`. There is no string-level
 * override — callers that need a wrapper script (e.g. `jclaude` for HOME
 * isolation) should define a shell alias instead. A previous mechanism that
 * let a folder-level `startupCommand` override `provider.command` was
 * removed because it silently shadowed the explicitly chosen provider
 * (e.g., "Pick Agent ▸ Codex" would run `claude` when the folder had
 * `startupCommand: "claude"` saved).
 */
export function buildAgentCommand(
  provider: AgentProviderConfig,
  flags: string[] = [],
  allowDangerous = false,
): string {
  const safeFlags = allowDangerous
    ? flags
    : flags.filter((f) => !provider.dangerousFlags?.includes(f));

  const allFlags = [...provider.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${provider.command}${flagsStr}`;
}
