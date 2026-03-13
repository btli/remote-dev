"use client";

import { useSessionContext } from "@/contexts/SessionContext";

interface SessionProgressBarProps {
  sessionId: string;
}

export function SessionProgressBar({ sessionId }: SessionProgressBarProps) {
  const { sessionProgress } = useSessionContext();
  const progress = sessionProgress[sessionId];

  if (!progress) return null;

  return (
    <div className="w-full mt-0.5">
      <div className="relative h-[2px] bg-border rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress.value * 100))}%` }}
        />
      </div>
      {progress.label && (
        <span className="text-[8px] text-muted-foreground truncate block">{progress.label}</span>
      )}
    </div>
  );
}
