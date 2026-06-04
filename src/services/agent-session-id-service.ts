/**
 * Durably records a provider's native session id into the session's
 * `typeMetadata.agentSessionId` map. This is the foundation of resume — it
 * survives a terminal-server restart (unlike the legacy in-memory
 * `claudeSessionMap` in terminal.ts) so a relaunch can pass `--resume <id>`.
 *
 * `updateSession`'s typeMetadataPatch does a SHALLOW top-level merge, so we
 * read-modify-write the whole `agentSessionId` map to preserve other providers'
 * ids on the same session.
 */

import { updateSession, getSession } from "@/services/session-service";
import type { AgentProviderType } from "@/types/session";
import type { AgentSessionIdMap } from "@/types/agent-resume";
import { createLogger } from "@/lib/logger";

const log = createLogger("AgentSessionId");

/** Durably record a provider's native session id into typeMetadata.agentSessionId. */
export async function persistAgentSessionId(
  sessionId: string,
  userId: string,
  provider: AgentProviderType,
  nativeId: string,
): Promise<void> {
  if (!nativeId || provider === "none") return;

  const existing = await getSession(sessionId, userId);
  if (!existing) {
    log.warn("Cannot persist agent session id; session not found", { sessionId, provider });
    return;
  }

  const map = (existing.typeMetadata?.agentSessionId as AgentSessionIdMap | undefined) ?? {};
  if (map[provider] === nativeId) return; // idempotent — already recorded

  await updateSession(sessionId, userId, {
    typeMetadataPatch: { agentSessionId: { ...map, [provider]: nativeId } },
  });
  log.info("Captured native agent session id", { sessionId, provider });
}
