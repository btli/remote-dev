/**
 * Shared utilities for agent-related terminal plugins.
 */

import type { AgentProviderType, AgentProviderConfig } from "@/types/session";
import { AGENT_PROVIDERS } from "@/types/session";

/** Whether a CLI token enables one of the provider's dangerous options. */
export function isDangerousAgentFlag(
  provider: AgentProviderConfig,
  flag: string,
): boolean {
  return Boolean(
    provider.dangerousFlags?.some((dangerous) => {
      if (flag === dangerous || flag.startsWith(`${dangerous}=`)) return true;
      if (!/^-[^-]$/.test(dangerous)) return false;
      // Attached value (`-ftrue`) — dangerous short option comes first.
      if (flag.startsWith(dangerous)) return true;
      // Cursor's boolean short options may be bundled (`-pf`). Restrict bundle
      // recognition to its known boolean switches so value-bearing options
      // such as `-Hfoo` and `-wfeature` are not false positives.
      return (
        provider.id === "cursor" &&
        dangerous === "-f" &&
        /^-[pvhf]+$/.test(flag) &&
        flag.includes("f")
      );
    }),
  );
}

/** POSIX-shell quote one argv token. */
export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
 * The base command is `provider.command`. Trusted launch paths may supply an
 * already-resolved executable path after verifying a generic command name;
 * that path is shell-quoted as one token. There is no user-configurable
 * string-level override — callers that need a wrapper script (e.g. `jclaude`)
 * should define a shell alias instead. A previous mechanism that let a
 * folder-level `startupCommand` override `provider.command` was removed
 * because it silently shadowed the explicitly chosen provider.
 */
export function buildAgentCommand(
  provider: AgentProviderConfig,
  flags: string[] = [],
  allowDangerous = false,
  executableOverride?: string,
): string {
  const safeFlags = allowDangerous
    ? flags
    : flags.filter((flag) => !isDangerousAgentFlag(provider, flag));

  const allFlags = [...provider.defaultFlags, ...safeFlags];
  const flagsStr = allFlags.length > 0 ? ` ${allFlags.join(" ")}` : "";
  const executable = executableOverride
    ? quoteShellArg(executableOverride)
    : provider.command;

  return `${executable}${flagsStr}`;
}
