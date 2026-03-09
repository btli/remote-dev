"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";

interface OrchestratorViewProps {
  session: TerminalSession;
  onNavigateToSession?: (sessionId: string) => void;
  children: React.ReactNode; // The parent terminal component
}

interface ChildSession {
  id: string;
  name: string;
  status: string;
  agentProvider: string | null;
  agentActivityStatus: string | null;
  agentExitState: string | null;
  createdAt: string;
}

export function OrchestratorView({
  session,
  onNavigateToSession,
  children,
}: OrchestratorViewProps) {
  const [childSessions, setChildSessions] = useState<ChildSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [spawning, setSpawning] = useState(false);

  const fetchChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/children`);
      if (res.ok) {
        const data = await res.json();
        setChildSessions(data.children ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch children:", err);
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  // Fetch children on mount and poll every 5s when visible
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchChildren();
    if (!isVisible) return;
    const interval = setInterval(fetchChildren, 5000);
    return () => clearInterval(interval);
  }, [fetchChildren, isVisible]);

  const handleSpawnChild = async () => {
    setSpawning(true);
    try {
      await fetch(`/api/sessions/${session.id}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Worker ${childSessions.length + 1}`,
          agentProvider: session.agentProvider ?? "claude",
        }),
      });
      await fetchChildren();
    } catch (err) {
      console.error("Failed to spawn child:", err);
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Parent terminal - takes most of the space */}
      <div className="min-w-0 flex-1 h-full">{children}</div>

      {/* Child sessions panel */}
      <div className="w-64 border-l border-border/50 flex flex-col bg-background/50">
        <div className="flex items-center justify-between p-2 border-b border-border/30">
          <span className="text-xs font-medium text-muted-foreground">
            Child Agents
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={fetchChildren}
            >
              <RefreshCw
                className={cn("w-3 h-3", loading && "animate-spin")}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleSpawnChild}
              disabled={spawning}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
          {childSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 text-center py-4">
              No child agents yet
            </p>
          ) : (
            childSessions.map((child) => (
              <button
                key={child.id}
                className="w-full text-left p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                onClick={() => onNavigateToSession?.(child.id)}
              >
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      child.agentActivityStatus === "running" &&
                        "bg-green-400",
                      child.agentActivityStatus === "waiting" &&
                        "bg-yellow-400 animate-pulse",
                      child.agentActivityStatus === "error" && "bg-red-400",
                      child.agentExitState === "exited" && "bg-gray-400",
                      !child.agentActivityStatus &&
                        child.status === "active" &&
                        "bg-blue-400"
                    )}
                  />
                  <span className="text-xs font-medium truncate">
                    {child.name}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
                  {child.agentProvider ?? "agent"} &middot;{" "}
                  {child.agentActivityStatus ?? child.status}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
