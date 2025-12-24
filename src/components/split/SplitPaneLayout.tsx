"use client";

import { useCallback, useMemo } from "react";
import type { SplitGroupWithSessions } from "@/types/split";
import type { TerminalSession } from "@/types/session";
import { ResizeHandle } from "./ResizeHandle";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

// Minimum pane size in pixels
const MIN_PANE_SIZE = 100;

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

interface SplitPaneLayoutProps {
  splitGroup: SplitGroupWithSessions;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onResize: (layout: Array<{ sessionId: string; size: number }>) => void;
  onSessionExit: (sessionId: string) => void;
  resolvePreferences: (folderId: string | null) => {
    theme?: string;
    fontSize?: number;
    fontFamily?: string;
  };
  getEnvironmentForFolder: (folderId: string | null) => Record<string, string> | null;
  sessionFolders: Record<string, string>;
  wsUrl: string;
}

export function SplitPaneLayout({
  splitGroup,
  sessions,
  activeSessionId,
  onSessionClick,
  onResize,
  onSessionExit,
  resolvePreferences,
  getEnvironmentForFolder,
  sessionFolders,
  wsUrl,
}: SplitPaneLayoutProps) {
  const isHorizontal = splitGroup.direction === "horizontal";

  // Get full session data for each pane
  const panes = useMemo(() => {
    return splitGroup.sessions
      .sort((a, b) => a.splitOrder - b.splitOrder)
      .map((splitSession) => {
        const session = sessions.find((s) => s.id === splitSession.sessionId);
        return {
          ...splitSession,
          session,
        };
      })
      .filter((pane) => pane.session); // Only render panes with valid sessions
  }, [splitGroup.sessions, sessions]);

  // Handle resize between panes
  const handleResize = useCallback(
    (paneIndex: number, delta: number, containerSize: number) => {
      if (containerSize <= 0) return;

      // Convert pixel delta to percentage
      const deltaPercent = delta / containerSize;

      // Calculate new sizes
      const newLayout = panes.map((pane, index) => {
        let newSize = pane.splitSize;

        if (index === paneIndex) {
          // Pane before the handle - grows/shrinks with delta
          newSize = Math.max(MIN_PANE_SIZE / containerSize, pane.splitSize + deltaPercent);
        } else if (index === paneIndex + 1) {
          // Pane after the handle - inverse of delta
          newSize = Math.max(MIN_PANE_SIZE / containerSize, pane.splitSize - deltaPercent);
        }

        return {
          sessionId: pane.sessionId,
          size: newSize,
        };
      });

      // Normalize sizes to sum to 1
      const total = newLayout.reduce((sum, l) => sum + l.size, 0);
      const normalized = newLayout.map((l) => ({
        ...l,
        size: l.size / total,
      }));

      onResize(normalized);
    },
    [panes, onResize]
  );

  const handleResizeEnd = useCallback(() => {
    // Layout is already saved via onResize during drag
    // This callback can be used for analytics or final cleanup
  }, []);

  if (panes.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex h-full w-full",
        isHorizontal ? "flex-col" : "flex-row"
      )}
    >
      {panes.map((pane, index) => {
        if (!pane.session) return null;
        const folderId = sessionFolders[pane.session.id] || null;
        const prefs = resolvePreferences(folderId);
        const isActive = pane.sessionId === activeSessionId;

        return (
          <div key={pane.sessionId} className="contents">
            {/* Pane container */}
            <div
              onClick={() => onSessionClick(pane.sessionId)}
              style={{
                [isHorizontal ? "height" : "width"]: `${pane.splitSize * 100}%`,
              }}
              className={cn(
                "relative overflow-hidden flex-shrink-0",
                isHorizontal ? "w-full" : "h-full",
                // Highlight active pane with subtle border
                isActive
                  ? "ring-1 ring-violet-500/50 ring-inset"
                  : "ring-1 ring-white/5 ring-inset"
              )}
            >
              <TerminalWithKeyboard
                sessionId={pane.session.id}
                tmuxSessionName={pane.session.tmuxSessionName}
                theme={prefs.theme}
                fontSize={prefs.fontSize}
                fontFamily={prefs.fontFamily}
                wsUrl={wsUrl}
                isActive={isActive}
                environmentVars={getEnvironmentForFolder(folderId)}
                onSessionExit={() => onSessionExit(pane.session!.id)}
              />
            </div>

            {/* Resize handle between panes (not after last pane) */}
            {index < panes.length - 1 && (
              <ResizeHandleWithContainer
                direction={splitGroup.direction}
                paneIndex={index}
                isHorizontal={isHorizontal}
                onResize={handleResize}
                onResizeEnd={handleResizeEnd}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Wrapper to get container size for resize calculations
interface ResizeHandleWithContainerProps {
  direction: "horizontal" | "vertical";
  paneIndex: number;
  isHorizontal: boolean;
  onResize: (paneIndex: number, delta: number, containerSize: number) => void;
  onResizeEnd: () => void;
}

function ResizeHandleWithContainer({
  direction,
  paneIndex,
  isHorizontal,
  onResize,
  onResizeEnd,
}: ResizeHandleWithContainerProps) {
  const handleResize = useCallback(
    (delta: number) => {
      // Get container size from parent element
      const container = document.querySelector('[class*="flex h-full w-full"]');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const containerSize = isHorizontal ? rect.height : rect.width;
      onResize(paneIndex, delta, containerSize);
    },
    [paneIndex, isHorizontal, onResize]
  );

  return (
    <ResizeHandle
      direction={direction}
      onResize={handleResize}
      onResizeEnd={onResizeEnd}
    />
  );
}
