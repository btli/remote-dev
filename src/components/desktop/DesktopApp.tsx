"use client";

/**
 * DesktopApp — desktop composition extracted from `app/page.tsx` so it can
 * be code-split out of the mobile critical path via `next/dynamic`.
 *
 * Owns the desktop chrome (`Header`) and the heavy `SessionManager`
 * subtree (xterm, codemirror, modals, sidebars). Below the Tailwind
 * `md` breakpoint this entire bundle is never downloaded — see
 * {@link MobileViewportSwitch}.
 *
 * **Provider scope (c9aq):** Desktop-only context providers
 * (Template/Recording/Trash/Schedule/Secrets/LiteLLM/Profile/
 * GitHubAccount/GitHubStats/GitHubIssues/Port/SessionMCP/Beads) are
 * mounted inside this component via {@link DesktopProviders}, so their
 * module graphs + mount-time `useEffect` side effects (WebSocket
 * connects, polls) are gated behind the dynamic import boundary and
 * never ship to mobile. Mobile-core providers (Preferences, ProjectTree,
 * Session, Channel, Notification, PeerChat) wrap both branches in
 * `app/page.tsx`.
 */

import type { MouseEventHandler } from "react";

import { Header } from "@/components/header/Header";
import { SessionManager } from "@/components/session/SessionManager";

import { DesktopProviders } from "./DesktopProviders";

export interface DesktopAppProps {
  isGitHubConnected: boolean;
  /** Whether the user has any linked GitHub account metadata; threaded
   * to {@link GitHubAccountProvider} so it has the same SSR-bootstrap
   * value it had before the provider split. */
  initialHasGitHubAccounts: boolean;
  userEmail: string;
  /**
   * Server-action passed in from the server-rendered parent so the
   * sign-out form action serializes correctly across the dynamic
   * import boundary.
   */
  onSignOut: MouseEventHandler<HTMLButtonElement> | (() => void);
}

export default function DesktopApp({
  isGitHubConnected,
  initialHasGitHubAccounts,
  userEmail,
  onSignOut,
}: DesktopAppProps) {
  return (
    <DesktopProviders
      isGitHubConnected={isGitHubConnected}
      initialHasGitHubAccounts={initialHasGitHubAccounts}
    >
      <div className="flex h-screen flex-col bg-background">
        {/* Header - hidden on mobile, shown in sidebar instead */}
        <Header
          isGitHubConnected={isGitHubConnected}
          userEmail={userEmail}
          onSignOut={onSignOut as () => void}
        />
        {/* Main content */}
        <SessionManager isGitHubConnected={isGitHubConnected} />
      </div>
    </DesktopProviders>
  );
}
