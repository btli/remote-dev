"use client";

/**
 * DesktopApp — desktop composition extracted from `app/page.tsx` so it can
 * be code-split out of the mobile critical path via `next/dynamic`.
 *
 * Owns the desktop chrome (`Header`) and the heavy `SessionManager`
 * subtree (xterm, codemirror, modals, sidebars). Below the Tailwind
 * `md` breakpoint this entire bundle is never downloaded — see
 * {@link MobileViewportSwitch}.
 */

import type { MouseEventHandler } from "react";

import { Header } from "@/components/header/Header";
import { SessionManager } from "@/components/session/SessionManager";

export interface DesktopAppProps {
  isGitHubConnected: boolean;
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
  userEmail,
  onSignOut,
}: DesktopAppProps) {
  return (
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
  );
}
