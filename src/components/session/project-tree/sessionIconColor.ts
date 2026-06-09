import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";

// Re-export the canonical attention type (single source of truth lives in
// session-metadata) under the name SessionRow consumers use, so callers don't
// have to thread two identical "error | actionable | null" unions.
export type { SessionAttention as SessionAttentionLevel } from "@/types/session-metadata";
import type { SessionAttention } from "@/types/session-metadata";

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
      return "text-green-600 dark:text-green-500 agent-breathing";
    case "subagent":
      return "text-violet-600 dark:text-violet-500 agent-breathing";
    case "waiting":
      return "text-yellow-600 dark:text-yellow-500 agent-breathing";
    case "compacting":
      return "text-blue-600 dark:text-blue-500 agent-breathing";
    case "idle":
    case "ended":
      return "text-muted-foreground";
    case "error":
      return "text-red-600 dark:text-red-500";
    default:
      return isActive ? "text-primary" : "text-muted-foreground";
  }
}

/**
 * Needs-attention glow halo classes for a session's status icon. Kept separate
 * from getSessionIconColor (which owns the text color reflecting LIVE status)
 * so an idle/running icon can still glow when a notification needs attention.
 * Replaces the old separate ● attention dot. Error outranks actionable.
 *
 * Returns ONLY the glow class (no animation): the gentle pulse for live
 * `waiting` already comes from getSessionIconColor's `agent-breathing`, while a
 * notification-only / idle attention shows a calm static halo — matching the
 * old static dot rather than introducing a new pulsing element.
 */
export function getAttentionGlowClass(
  status: AgentActivityStatus | string | null,
  unreadSeverity: SessionAttention = null,
): string {
  if (status === "error" || unreadSeverity === "error") return "agent-glow-error";
  if (status === "waiting" || unreadSeverity === "actionable")
    return "agent-glow-attention";
  return "";
}
