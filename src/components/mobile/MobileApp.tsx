"use client";

/**
 * MobileApp — Phase 2 mobile redesign.
 *
 * Top-level mobile composition rendered inside `MobileShell` when the
 * viewport is below 768px. Owns the active-tab state, dispatches tab
 * content, and shows simple "Coming in Phase N" placeholders for tabs
 * that ship later.
 *
 * Phase 2 only fills the Sessions tab. Notifications / Channels / Profile
 * are placeholder slots so the tab bar remains usable while later phases
 * land.
 */

import { useState } from "react";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { NotificationsTab } from "./notifications/NotificationsTab";

export interface MobileAppProps {
  isGitHubConnected: boolean;
}

const PLACEHOLDER_COPY: Record<Exclude<MobileTab, "sessions" | "notifications">, { title: string; phase: string }> = {
  channels: { title: "Channels", phase: "Phase 5" },
  profile: { title: "Profile", phase: "Phase 6" },
};

export function MobileApp({ isGitHubConnected }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("sessions");

  let content;
  if (activeTab === "sessions") {
    content = <SessionsTab isGitHubConnected={isGitHubConnected} />;
  } else if (activeTab === "notifications") {
    content = <NotificationsTab onSwitchTab={setActiveTab} />;
  } else {
    content = (
      <EmptyTabPlaceholder
        title={PLACEHOLDER_COPY[activeTab].title}
        phase={PLACEHOLDER_COPY[activeTab].phase}
      />
    );
  }

  return (
    <MobileShell activeTab={activeTab} onTabChange={setActiveTab}>
      {content}
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
