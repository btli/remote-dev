import { useEffect, useMemo, useRef } from "react";
import type { AgentActivityStatus } from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import { useNotificationPermission, sendBrowserNotification } from "./useNotificationPermission";

const STATUS_MESSAGES: Partial<
  Record<AgentActivityStatus, { title: (name: string) => string; body: string }>
> = {
  waiting: {
    title: (n) => `${n} — Waiting for input`,
    body: "Agent needs your attention",
  },
  idle: {
    title: (n) => `${n} — Task complete`,
    body: "Agent has finished working",
  },
  error: {
    title: (n) => `${n} — Error occurred`,
    body: "Agent encountered an error",
  },
  compacting: {
    title: (n) => `${n} — Compacting context`,
    body: "Agent is compacting its context window",
  },
  ended: {
    title: (n) => `${n} — Session ended`,
    body: "Agent session has ended",
  },
};

interface UseAgentNotificationsOptions {
  enabled: boolean | undefined;
  agentActivityStatuses: Record<string, AgentActivityStatus>;
  sessions: TerminalSession[];
  setActiveSession: (id: string | null) => void;
}

export function useAgentNotifications({
  enabled,
  agentActivityStatuses,
  sessions,
  setActiveSession,
}: UseAgentNotificationsOptions): void {
  const { permissionState, requestPermission } = useNotificationPermission();
  const previousStatusesRef = useRef<Record<string, AgentActivityStatus>>({});
  const hasRequestedPermissionRef = useRef(false);

  // Request notification permission if notifications are enabled but browser hasn't been asked yet
  useEffect(() => {
    if (enabled === true && permissionState === "default" && !hasRequestedPermissionRef.current) {
      hasRequestedPermissionRef.current = true;
      requestPermission();
    }
  }, [enabled, permissionState, requestPermission]);

  const agentSessionMap = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const s of sessions) {
      if (s.terminalType === "agent") {
        map.set(s.id, { name: s.name });
      }
    }
    return map;
  }, [sessions]);

  useEffect(() => {
    if (!enabled || permissionState !== "granted") {
      previousStatusesRef.current = agentActivityStatuses;
      return;
    }

    for (const [sessionId, status] of Object.entries(agentActivityStatuses)) {
      if (previousStatusesRef.current[sessionId] === status) continue;

      const message = STATUS_MESSAGES[status];
      if (!message) continue;

      const session = agentSessionMap.get(sessionId);
      if (!session) continue;

      if (document.hasFocus()) continue;

      sendBrowserNotification({
        title: message.title(session.name),
        body: message.body,
        tag: `agent-status-${sessionId}`,
        onClick: () => setActiveSession(sessionId),
      });
    }

    previousStatusesRef.current = agentActivityStatuses;
  }, [agentActivityStatuses, agentSessionMap, enabled, permissionState, setActiveSession]);
}
