"use client";

/**
 * MobileApp — mobile composition root.
 *
 * Top-level mobile composition rendered inside `MobileShell` when the
 * viewport is below 768px. Owns the active-tab state, dispatches tab
 * content, and shows simple "Coming in Phase N" placeholders for tabs
 * that ship later.
 *
 * Phases 2 + 5 are wired: Sessions tab and Channels tab. Notifications and
 * Profile remain placeholders for later phases.
 */

import { useCallback, useState } from "react";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { ChannelsTab } from "./channels/ChannelsTab";
import { useChannelContextOptional } from "@/contexts/ChannelContext";

export interface MobileAppProps {
  isGitHubConnected: boolean;
}

const PLACEHOLDER_COPY: Record<
  Exclude<MobileTab, "sessions" | "channels">,
  { title: string; phase: string }
> = {
  notifications: { title: "Notifications", phase: "Phase 4" },
  profile: { title: "Profile", phase: "Phase 6" },
};

export function MobileApp({ isGitHubConnected }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("sessions");

  // Pull the channels unread count for the bottom-tab badge. The provider
  // is optional so the tab works even when channels haven't loaded yet.
  const channels = useChannelContextOptional();
  const channelsBadge = channels?.totalUnreadCount ?? 0;

  // While a thread takeover is open inside the Channels tab the bottom tab
  // bar would otherwise paint over the reply composer (both render at z-40
  // before the takeover bumped to z-50). Force the bar hidden so the modal
  // stack reads top-to-bottom: takeover > channel view > shell. We also
  // dismiss the thread on tab change so it doesn't get stranded behind a
  // sibling tab.
  const openThreadId = channels?.openThreadId ?? null;
  const closeThread = channels?.closeThread;
  const tabBarForceHidden = activeTab === "channels" && openThreadId != null;

  const handleTabChange = useCallback(
    (tab: MobileTab) => {
      if (tab !== activeTab && openThreadId && closeThread) {
        closeThread();
      }
      setActiveTab(tab);
    },
    [activeTab, openThreadId, closeThread]
  );

  return (
    <MobileShell
      activeTab={activeTab}
      onTabChange={handleTabChange}
      forceHidden={tabBarForceHidden}
      badges={channelsBadge > 0 ? { channels: channelsBadge } : undefined}
    >
      {activeTab === "sessions" ? (
        <SessionsTab isGitHubConnected={isGitHubConnected} />
      ) : activeTab === "channels" ? (
        <ChannelsTab />
      ) : (
        <EmptyTabPlaceholder
          title={PLACEHOLDER_COPY[activeTab].title}
          phase={PLACEHOLDER_COPY[activeTab].phase}
        />
      )}
    </MobileShell>
  );
}

function EmptyTabPlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div
      data-testid={`mobile-tab-placeholder-${title.toLowerCase()}`}
      className="flex h-full flex-col items-center justify-center gap-1 px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">Coming in {phase}.</p>
    </div>
  );
}
