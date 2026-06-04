import { useCallback } from "react";
import { useSessionContext } from "@/contexts/SessionContext";

/**
 * [n6uc.5] Pure: the next id in `ordered` (after `activeId`, wrapping) that is in
 * the `attention` set, or null if none qualify. Starting one position AFTER the
 * active id (and wrapping a full lap) means repeated calls cycle through every
 * attention-needing session, including re-selecting the only one if it is the
 * active row.
 */
export function nextAttentionId(
  ordered: string[],
  attention: Set<string>,
  activeId: string | null,
): string | null {
  if (attention.size === 0) return null;
  const start = activeId ? ordered.indexOf(activeId) : -1;
  for (let i = 1; i <= ordered.length; i++) {
    const candidate = ordered[(start + i + ordered.length) % ordered.length];
    if (attention.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Hook exposing `jumpNext()` — focus the next agent needing attention and scroll
 * its row into view. "Attention" = a derived metadata signal (error/actionable)
 * OR a live agent status of waiting/error.
 */
export function useJumpToAttention() {
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    sessionMetadata,
    agentActivityStatuses,
  } = useSessionContext();

  const jumpNext = useCallback((): string | null => {
    const ordered = sessions.map((s) => s.id);
    const attention = new Set<string>();
    for (const s of sessions) {
      const meta = sessionMetadata[s.id];
      const status = agentActivityStatuses[s.id];
      if (meta?.attention || status === "waiting" || status === "error") {
        attention.add(s.id);
      }
    }
    const target = nextAttentionId(ordered, attention, activeSessionId);
    if (target) {
      setActiveSession(target);
      // Rows carry data-session-id (SessionRow). Scroll after the active change
      // paints so the row exists/expands in the DOM.
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-session-id="${target}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    }
    return target;
  }, [
    sessions,
    activeSessionId,
    setActiveSession,
    sessionMetadata,
    agentActivityStatuses,
  ]);

  return { jumpNext };
}
