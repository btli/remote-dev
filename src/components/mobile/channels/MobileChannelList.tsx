"use client";

/**
 * MobileChannelList — Phase 5 mobile redesign.
 *
 * Renders the {@link useChannelContext} groups as a scrolling list of section
 * headers with channel rows underneath. Each row shows the channel name, the
 * (optional) topic, and a right-aligned unread badge when `unreadCount > 0`.
 *
 * Selecting a row sets it as the active channel via context AND fires
 * `onOpen(channelId)` so the parent can route to the channel view.
 *
 * The unread badge is achromatic (foreground / background tokens). Per
 * DESIGN.md "One Voice Rule", color enters chrome only as signal — and
 * unread-count is a *quantity*, not a state-attention signal.
 */

import { useCallback } from "react";
import { Hash, Lock, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useChannelContext } from "@/contexts/ChannelContext";
import type { Channel } from "@/types/channels";

export interface MobileChannelListProps {
  /** Called after the row's tap selects the channel. */
  onOpen: (channelId: string) => void;
  /** Stable id for the active project (for empty-state copy). May be null. */
  projectName?: string | null;
}

export function MobileChannelList({ onOpen, projectName }: MobileChannelListProps) {
  const { groups, activeChannelId, setActiveChannelId, loading } = useChannelContext();

  const handleSelect = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      onOpen(channelId);
    },
    [setActiveChannelId, onOpen]
  );

  const totalChannels = groups.reduce((n, g) => n + g.channels.length, 0);

  if (loading && totalChannels === 0) {
    return <ChannelListSkeleton />;
  }

  if (totalChannels === 0) {
    return (
      <div
        data-testid="mobile-channels-empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center"
      >
        <MessageCircle aria-hidden="true" className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          No channels{projectName ? ` in ${projectName}` : ""} yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Channels appear here when agents in this project start a conversation.
        </p>
      </div>
    );
  }

  return (
    <ul
      role="list"
      data-testid="mobile-channel-list"
      className="flex flex-col"
    >
      {groups.map((group) => (
        <li key={group.id}>
          <h3
            className={cn(
              "sticky top-0 z-10 border-b border-border bg-card",
              "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            )}
          >
            {group.name}
          </h3>
          <ul role="list" className="flex flex-col">
            {group.channels.map((channel) => (
              <li key={channel.id}>
                <ChannelRow
                  channel={channel}
                  active={channel.id === activeChannelId}
                  onSelect={handleSelect}
                />
              </li>
            ))}
            {group.channels.length === 0 ? (
              <li className="px-4 py-3 text-xs text-muted-foreground">
                No channels in this group.
              </li>
            ) : null}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ChannelRow({
  channel,
  active,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = channel.type === "dm" ? Lock : Hash;
  const display = channel.displayName || channel.name;

  return (
    <button
      type="button"
      onClick={() => onSelect(channel.id)}
      aria-current={active ? "page" : undefined}
      data-testid="mobile-channel-row"
      data-channel-id={channel.id}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/60 px-4 text-left",
        "min-h-[56px] py-2 transition-colors",
        // Selection treatment: tint, no side-stripe (DESIGN.md "No Side-Stripe").
        active ? "bg-accent/40" : "bg-card",
        "hover:bg-accent/30 active:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-sm",
            // Weight contrast for unread (Weight-Over-Size Rule).
            channel.unreadCount > 0 ? "font-semibold text-foreground" : "font-normal text-foreground"
          )}
        >
          {display}
        </span>
        {channel.topic ? (
          <span className="truncate text-xs text-muted-foreground">
            {channel.topic}
          </span>
        ) : null}
      </div>
      {channel.unreadCount > 0 ? (
        <span
          aria-label={`${channel.unreadCount} unread`}
          data-testid="mobile-channel-row-unread"
          className={cn(
            "ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full",
            "bg-foreground px-1.5 text-[11px] font-medium leading-none text-background"
          )}
        >
          {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
        </span>
      ) : null}
    </button>
  );
}

function ChannelListSkeleton() {
  const rows = [0, 1, 2, 3, 4];
  return (
    <ul
      role="list"
      aria-busy="true"
      data-testid="mobile-channel-list-skeleton"
      className="animate-pulse"
    >
      {rows.map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-border/60 px-4 py-3 min-h-[56px]"
        >
          <span className="inline-flex h-3.5 w-3.5 shrink-0 rounded-full bg-muted-foreground/20" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/2 rounded bg-muted-foreground/15" />
            <div className="h-2.5 w-1/3 rounded bg-muted-foreground/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}
