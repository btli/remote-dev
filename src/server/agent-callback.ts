import type { AgentExitState } from "@/types/terminal-type";
import type { NotificationSeverity, NotificationType } from "@/types/notification";
import type { AgentProviderType } from "@/types/session";

export function parseAgentGeneration(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseAgentDeliveryId(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 96) return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

export function expectedAgentApiKeyName(sessionId: string): string {
  return `agent-session-${sessionId}`;
}

export function authorizeAgentCallback(input: {
  sessionId: string;
  sessionUserId: string;
  validatedKey: { userId: string; name: string } | null;
}): boolean {
  return Boolean(
    input.validatedKey &&
      input.validatedKey.userId === input.sessionUserId &&
      input.validatedKey.name === expectedAgentApiKeyName(input.sessionId),
  );
}

export type ExitDeliveryDisposition = "apply" | "enrich" | "retry" | "ignore";

/** A retry may be the first request that survives far enough to reach clients. */
export function shouldBroadcastExitDelivery(disposition: ExitDeliveryDisposition): boolean {
  return disposition !== "ignore";
}

export function classifyExitDelivery(input: {
  currentGeneration: number;
  suppliedGeneration: number;
  exitState: AgentExitState | null;
  exitCode?: number | null;
  activityStatus?: string | null;
}): ExitDeliveryDisposition {
  if (input.suppliedGeneration !== input.currentGeneration) return "ignore";
  // The replacement process is launched while its generation remains in the
  // restarting state. Its immediate exit is authoritative; a killed previous
  // process has the older generation and was rejected above.
  if (input.exitState === "closed") return "ignore";
  if (input.exitState === "exited") {
    // A generic liveness fallback has no exact exit code and records idle. A
    // delayed pane callback is authoritative evidence, not an HTTP retry: let
    // it enrich the durable state and existing generation-level notification.
    if (input.exitCode === null && input.activityStatus === "idle") return "enrich";
    return "retry";
  }
  return "apply";
}

export function agentExitDeliveryId(sessionId: string, generation: number): string {
  return `pane-exit:${sessionId}:${generation}`;
}

export function agentStatusDeliveryId(
  sessionId: string,
  generation: number,
  deliveryId: string,
  _status?: string,
): string {
  // A hook wrapper can retry through a lower-fidelity fallback after the
  // authoritative rdv request committed but its response was lost. Identity
  // therefore excludes status: the first accepted semantic classification for
  // this invocation remains authoritative across every transport retry.
  return `agent-status:${sessionId}:${generation}:${deliveryId}`;
}

export interface AgentStatusNotification {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  bodySuffix: string;
  result?: string;
}

/** Map only human-relevant status transitions to durable notification records. */
export function agentStatusNotification(
  status: string,
  provider?: AgentProviderType | null,
): AgentStatusNotification | null {
  switch (status) {
    case "waiting":
      return {
        type: "agent_waiting",
        severity: "actionable",
        title: "Agent waiting for input",
        bodySuffix: "needs attention",
      };
    case "error":
      return {
        type: "agent_error",
        severity: "error",
        title: "Agent encountered an error",
        bodySuffix: "encountered an error",
        result: "failed",
      };
    case "idle":
      // Claude's clean Stop was intentionally silent before Codex lifecycle
      // support. Preserve that working behavior while Codex gets the durable
      // passive completion record required by its contract.
      if (provider !== "codex") return null;
      return {
        type: "agent_complete",
        severity: "passive",
        title: "Agent turn completed",
        bodySuffix: "completed its turn",
        result: "success",
      };
    default:
      return null;
  }
}
