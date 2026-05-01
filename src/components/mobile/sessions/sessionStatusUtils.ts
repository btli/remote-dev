"use client";

import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";

/**
 * Phase 2 mobile session status utilities. Computes the leading state pip,
 * subtitle text, and whether the row should pulse the attention-blue halo.
 *
 * The visual vocabulary is intentionally narrow:
 *   - "needs attention" → pip is `--color-signal-attention-solid`, halo on
 *   - "running" → pip is `bg-emerald-500` (the only green in chrome; signal,
 *     not decoration)
 *   - "idle" → pip is `bg-foreground/40`, the default achromatic state
 *   - "error" → pip is `bg-destructive`
 *   - "suspended" → pip is `bg-muted-foreground/40`
 *
 * Per DESIGN.md, color carries signal — not decoration — and never appears
 * alone (always paired with weight or text on the row).
 */

export type SessionPipState =
  | "attention"
  | "running"
  | "idle"
  | "error"
  | "suspended";

export interface SessionPresentation {
  pip: SessionPipState;
  /** True when we should pulse the attention halo. Reduced motion handled by the consumer. */
  needsAttention: boolean;
  /** Subtitle text describing current status / last activity. */
  subtitle: string;
  /** When true, render subtitle in mono (mid-execution detail). */
  subtitleMono: boolean;
}

const RUNNING_STATUSES: ReadonlySet<AgentActivityStatus> = new Set([
  "running",
  "compacting",
]);

export function getSessionPresentation(
  session: TerminalSession,
  activity: AgentActivityStatus
): SessionPresentation {
  // Suspended is its own resting state.
  if (session.status === "suspended") {
    return {
      pip: "suspended",
      needsAttention: false,
      subtitle: `suspended · ${formatRelativeTime(session.lastActivityAt)}`,
      subtitleMono: false,
    };
  }

  // Error agents (non-zero exit, agentExitState === "exited") get the
  // destructive pip; they're not running and they're not waiting.
  if (
    session.terminalType === "agent" &&
    session.agentExitState === "exited" &&
    session.agentExitCode != null &&
    session.agentExitCode !== 0
  ) {
    return {
      pip: "error",
      needsAttention: false,
      subtitle: `exited (${session.agentExitCode}) · ${formatRelativeTime(session.lastActivityAt)}`,
      subtitleMono: true,
    };
  }

  if (activity === "error") {
    return {
      pip: "error",
      needsAttention: false,
      subtitle: `error · ${formatRelativeTime(session.lastActivityAt)}`,
      subtitleMono: false,
    };
  }

  if (activity === "waiting") {
    return {
      pip: "attention",
      needsAttention: true,
      subtitle: `waiting · ${formatRelativeTime(session.lastActivityAt)}`,
      subtitleMono: false,
    };
  }

  if (RUNNING_STATUSES.has(activity)) {
    return {
      pip: "running",
      needsAttention: false,
      subtitle:
        activity === "compacting"
          ? `compacting · ${formatRelativeTime(session.lastActivityAt)}`
          : `running · ${formatRelativeTime(session.lastActivityAt)}`,
      subtitleMono: true,
    };
  }

  return {
    pip: "idle",
    needsAttention: false,
    subtitle: `idle · ${formatRelativeTime(session.lastActivityAt)}`,
    subtitleMono: false,
  };
}

/**
 * Lightweight relative time for session subtitles. Avoids pulling in
 * date-fns. Returns "just now", "3m ago", "2h ago", "5d ago", or an
 * absolute date for older items.
 */
export function formatRelativeTime(date: Date | string | number): string {
  const ts = typeof date === "object" ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  if (delta < 30 * SECOND) return "just now";
  if (delta < MINUTE) return `${Math.round(delta / SECOND)}s ago`;
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function pipClassName(state: SessionPipState): string {
  switch (state) {
    case "attention":
      return "bg-[var(--color-signal-attention-solid)]";
    case "running":
      return "bg-emerald-500";
    case "error":
      return "bg-destructive";
    case "suspended":
      return "bg-muted-foreground/40";
    case "idle":
    default:
      return "bg-foreground/40";
  }
}
