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
 * When `override` is provided (e.g. folder-resolved `jclaude` wrapper), it
 * replaces `provider.command` as the base. If the override already contains
 * spaces it's treated as a complete command and returned as-is, avoiding
 * double-appending flags when callers pre-composed flag strings.
 */
export function buildAgentCommand(
  provider: AgentProviderConfig,
  flags: string[] = [],
  allowDangerous = false,
  override?: string
): string {
  if (override && override.includes(" ")) return override;

  const baseCommand = override || provider.command;
  const safeFlags = allowDangerous
    ? flags
    : flags.filter((f) => !provider.dangerousFlags?.includes(f));

  const allFlags = [...provider.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";

  return `${baseCommand}${flagsStr}`;
}
