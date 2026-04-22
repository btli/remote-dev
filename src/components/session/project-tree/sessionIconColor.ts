import type { TerminalSession } from "@/types/session";

/**
 * Whether a session type has agent-like behavior (activity status tracking, exit states).
 */
export function hasAgentBehavior(session: TerminalSession): boolean {
  return session.terminalType === "agent" || session.terminalType === "loop";
}

/**
 * Resolve sidebar icon color class for a session based on agent activity status.
 * Agent sessions get color-coded by their real-time activity; non-agent sessions
 * use simple active/inactive styling.
 */
export function getSessionIconColor(
  session: TerminalSession,
  isActive: boolean,
  getAgentActivityStatus: (sessionId: string) => string
): string {
  if (!hasAgentBehavior(session)) {
    return isActive ? "text-primary" : "text-muted-foreground";
  }

  const status = getAgentActivityStatus(session.id);
  switch (status) {
    case "running":
      return "text-green-500 agent-breathing";
    case "waiting":
      return "text-yellow-500 agent-breathing";
    case "compacting":
      return "text-blue-500 agent-breathing";
    case "idle":
    case "ended":
      return "text-muted-foreground";
    case "error":
      return "text-red-500";
    default:
      return isActive ? "text-primary" : "text-muted-foreground";
  }
}
