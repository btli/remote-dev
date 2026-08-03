import * as os from "node:os";

import * as AgentProfileService from "@/services/agent-profile-service";
import { codexHooksEnabled } from "@/services/agent-hooks/codex-adapter";
import type { AgentProvider } from "@/types/agent";

const HOOK_PROVIDERS = new Set<AgentProvider>(["claude", "codex"]);

/**
 * Repair provider hooks immediately before an agent process is launched.
 * Creation, HTTP restart, WS restart, and cold relaunch all pass through this
 * boundary, so a removed or drifted hook file cannot silently survive until a
 * later session resume.
 */
export async function prepareAgentLaunch(env: Readonly<Record<string, string>>): Promise<void> {
  const provider = env.RDV_AGENT_PROVIDER as AgentProvider | undefined;
  if (!provider || !HOOK_PROVIDERS.has(provider)) return;

  // Claude reads the server account's normal ~/.claude configuration. Codex
  // honors an explicit CODEX_HOME from the exact environment being launched.
  const configRoot = provider === "claude"
    ? process.env.HOME ?? os.homedir()
    : env.HOME ?? process.env.HOME ?? os.homedir();
  await AgentProfileService.installAgentHooks(configRoot, provider, { ...env });
  // The global flag is an availability rollback: installation removes only
  // RDV-owned Codex groups, then launch continues without lifecycle hooks.
  if (provider === "codex" && !codexHooksEnabled()) return;
  const validation = await AgentProfileService.validateAgentHooks(
    configRoot,
    provider,
    env.RDV_SESSION_ID ?? "",
    { ...env },
  );
  // A new Codex process cannot prove load/trust until its first real callback;
  // that honest "unknown" is allowed. Missing structure or an unreachable
  // authenticated callback boundary is not.
  if (validation.configured === false || validation.reachable === false) {
    throw new Error(validation.error ?? "Agent lifecycle hooks failed validation");
  }
}
