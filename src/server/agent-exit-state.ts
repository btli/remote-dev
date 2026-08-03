import type { AgentActivityStatus } from "@/types/terminal-type";

export function parseAgentExitCode(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseAgentExitSignal(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]*$/i.test(value)) return null;
  return value.toLowerCase();
}

export function agentExitTransition(
  exitCode: number | null,
  signal: string | null,
): { status: AgentActivityStatus; failed: boolean } {
  if (exitCode === null && signal === null) {
    throw new Error("Missing exit code and signal");
  }
  const failed = signal !== null || exitCode !== 0;
  return { status: failed ? "error" : "ended", failed };
}

export function agentExitStateUpdate(
  exitCode: number | null,
  signal: string | null,
  statusAt: number,
  activityOrder = statusAt * 1_000,
) {
  const { status } = agentExitTransition(exitCode, signal);
  const exitedAt = new Date(statusAt);
  return {
    agentExitState: "exited" as const,
    agentExitCode: exitCode,
    agentExitedAt: exitedAt,
    agentExitNotificationAt: null,
    agentActivityStatus: status,
    agentActivityStatusAt: statusAt,
    agentActivityOrder: activityOrder,
    updatedAt: exitedAt,
  };
}
