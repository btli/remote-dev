"use client";

/**
 * ChannelSidebar — Right sidebar for channel-based chat view.
 *
 * Mirrors TaskSidebar's localStorage/resize patterns.
 * Shows channel groups with collapsible sections, unread indicators,
 * and a "Peers" section at the bottom.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import {
  Hash,
  Plus,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  Bot,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// --- Sidebar state persistence ---

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("channel-sidebar-collapsed") === "true";
}

function getStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = localStorage.getItem("channel-sidebar-width");
  return stored
    ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored, 10)))
    : DEFAULT_WIDTH;
}

function setStoredCollapsed(val: boolean) {
  localStorage.setItem("channel-sidebar-collapsed", String(val));
  window.dispatchEvent(new CustomEvent("channel-sidebar-collapsed-change"));
}

function setStoredWidth(val: number) {
  localStorage.setItem("channel-sidebar-width", String(val));
  window.dispatchEvent(new CustomEvent("channel-sidebar-width-change"));
}

// --- Props ---

interface ChannelSidebarProps {
  onCreateChannel: () => void;
}

// --- Main Component ---

export function ChannelSidebar({ onCreateChannel }: ChannelSidebarProps) {
  const { groups, activeChannelId, setActiveChannelId, totalUnreadCount } =
    useChannelContext();
  const { peers } = usePeerChatContext();

  // Sidebar state — lazy-initialize from localStorage
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [width, setWidth] = useState(getStoredWidth);

  // Group expand state: track which group IDs are collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );
  const [peersExpanded, setPeersExpanded] = useState(true);

  // Listen for collapse state changes (cross-tab sync)
  useEffect(() => {
    const onCollapsedChange = () => setCollapsed(getStoredCollapsed());
    const onWidthChange = () => setWidth(getStoredWidth());
    const onToggle = () => {
      const next = !getStoredCollapsed();
      setStoredCollapsed(next);
      setCollapsed(next);
    };

    window.addEventListener("channel-sidebar-collapsed-change", onCollapsedChange);
    window.addEventListener("channel-sidebar-width-change", onWidthChange);
    window.addEventListener("channel-sidebar-toggle", onToggle);

    return () => {
      window.removeEventListener(
        "channel-sidebar-collapsed-change",
        onCollapsedChange
      );
      window.removeEventListener("channel-sidebar-width-change", onWidthChange);
      window.removeEventListener("channel-sidebar-toggle", onToggle);
    };
  }, []);

  // Resize handle
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidthRef = useRef(width);
  useEffect(() => {
    latestWidthRef.current = width;
  }, [width]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: width };

      const handleMouseMove = (e: MouseEvent) => {
        if (!resizeRef.current) return;
        // Dragging left = increasing width (sidebar is on the right)
        const delta = resizeRef.current.startX - e.clientX;
        const newWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, resizeRef.current.startWidth + delta)
        );
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        setStoredWidth(latestWidthRef.current);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [width]
  );

  // Toggle collapse
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setStoredCollapsed(next);
    setCollapsed(next);
  }, [collapsed]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Collapsed state — icon strip
  if (collapsed) {
    return (
      <div className="w-12 shrink-0 h-full flex flex-col items-center py-2 border-l border-border bg-card/30">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              className={cn(
                "relative p-2 rounded-md transition-colors",
                "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              <MessageSquare className="w-4 h-4" />
              {totalUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {totalUnreadCount > 9 ? "9+" : totalUnreadCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Channels {totalUnreadCount > 0 ? `(${totalUnreadCount} unread)` : ""}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 h-full flex flex-col bg-card/50 backdrop-blur-md border-l border-border relative"
      style={{ width }}
    >
      {/* Resize handle (left edge) */}
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <MessageSquare className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">
          Channels
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreateChannel}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">New channel</TooltipContent>
        </Tooltip>
        <button
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {groups.length === 0 ? (
            <div className="flex items-center justify-center px-4 py-8">
              <p className="text-xs text-muted-foreground text-center">
                No channels yet. Click + to create one.
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const isGroupCollapsed = collapsedGroups.has(group.id);
              return (
                <div key={group.id}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isGroupCollapsed ? (
                      <ChevronRight className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    <span className="flex-1 text-left">{group.name}</span>
                  </button>

                  {/* Channels in group */}
                  {!isGroupCollapsed && (
                    <div className="space-y-0.5 px-1 mb-1">
                      {group.channels.map((channel) => {
                        const isActive = channel.id === activeChannelId;
                        const hasUnread = channel.unreadCount > 0;
                        return (
                          <button
                            key={channel.id}
                            onClick={() => setActiveChannelId(channel.id)}
                            className={cn(
                              "flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-left transition-colors",
                              isActive
                                ? "bg-primary/10 text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                            )}
                          >
                            <Hash
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground"
                              )}
                            />
                            <span
                              className={cn(
                                "text-xs flex-1 truncate",
                                hasUnread && !isActive && "font-semibold text-foreground"
                              )}
                            >
                              {channel.displayName || channel.name}
                            </span>
                            {/* Unread dot */}
                            {hasUnread && !isActive && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Separator */}
          <div className="border-t border-border my-1" />

          {/* Peers section */}
          <div>
            <button
              onClick={() => setPeersExpanded((v) => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {peersExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span className="flex-1 text-left">Peers</span>
              {peers.length > 0 && (
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {peers.length}
                </span>
              )}
            </button>

            {peersExpanded && (
              <div className="space-y-0.5 px-1 mb-1">
                {peers.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-3 py-1">
                    No agents connected
                  </p>
                ) : (
                  peers.map((peer) => (
                    <div
                      key={peer.sessionId}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground"
                    >
                      <Bot className="w-3.5 h-3.5 shrink-0 text-primary/60" />
                      <span className="text-xs truncate">{peer.name}</span>
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
