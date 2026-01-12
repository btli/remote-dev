"use client";

/**
 * MemoryStatusButton - Header button for accessing the Memory Browser.
 *
 * Shows memory count and provides access to the hierarchical memory system.
 */

import { useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { MemoryBrowser } from "@/components/memory/MemoryBrowser";
import { useSessionMemory } from "@/hooks/useSessionMemory";
import { useSessionContext } from "@/contexts/SessionContext";

export function MemoryStatusButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { sessions, activeSessionId } = useSessionContext();

  // Get the active session and its folder directly from session data
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeFolderId = activeSession?.folderId ?? null;

  const { counts, loading } = useSessionMemory({
    sessionId: activeSessionId,
    folderId: activeFolderId,
    autoFetch: true,
    pollInterval: 60000, // Check every minute
    limit: 0, // Just need counts, not entries
  });

  const hasMemories = counts.total > 0;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(true)}
              className="relative h-8 px-2 text-muted-foreground hover:text-foreground"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              {hasMemories && !loading && (
                <Badge
                  variant="secondary"
                  className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]"
                >
                  {counts.total > 99 ? "99+" : counts.total}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <p className="font-medium">Memory Browser</p>
              {hasMemories ? (
                <p className="text-muted-foreground">
                  {counts.short_term} short / {counts.working} working /{" "}
                  {counts.long_term} long
                </p>
              ) : (
                <p className="text-muted-foreground">No memories stored</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <MemoryBrowser open={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
