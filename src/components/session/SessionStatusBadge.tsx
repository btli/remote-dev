"use client";

import { useSessionContext } from "@/contexts/SessionContext";

const COLOR_CLASS_MAP: Record<string, string> = {
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  blue: "text-blue-400",
};

interface SessionStatusBadgeProps {
  sessionId: string;
}

export function SessionStatusBadge({ sessionId }: SessionStatusBadgeProps) {
  const { sessionStatusIndicators } = useSessionContext();
  const indicators = sessionStatusIndicators[sessionId];

  if (!indicators || Object.keys(indicators).length === 0) return null;

  const [, indicator] = Object.entries(indicators)[0];
  if (!indicator) return null;

  const colorClass = (indicator.color && COLOR_CLASS_MAP[indicator.color]) || "text-muted-foreground";

  return (
    <span className={`flex items-center gap-0.5 text-[9px] font-medium truncate max-w-[80px] ${colorClass}`}>
      {indicator.value}
    </span>
  );
}
