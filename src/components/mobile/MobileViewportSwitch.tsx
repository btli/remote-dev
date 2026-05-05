"use client";

/**
 * MobileViewportSwitch — Phase 2 mobile redesign.
 *
 * Renders the mobile composition (`MobileApp`) below the Tailwind `md`
 * breakpoint (768px) and the desktop `children` (typically `SessionManager`)
 * at and above it.
 *
 * Hydration: `useIsMobileViewport()` is implemented with
 * `useSyncExternalStore`, which lets the server render desktop while the
 * client's first render returns the real viewport value — React 19 treats
 * this controlled mismatch as expected and does NOT emit a hydration warning
 * for either branch of this switch. On a real phone the user sees the mobile
 * composition on the very first paint with no flash of desktop layout.
 */

import type { ReactNode } from "react";

import { useIsMobileViewport } from "@/hooks/useMobile";

import { MobileApp, type MobileAuthUser } from "./MobileApp";

export interface MobileViewportSwitchProps {
  isGitHubConnected: boolean;
  /**
   * Server-resolved authenticated user (handles both NextAuth and CF
   * Access). Forwarded to {@link MobileApp} as the source of truth for
   * mobile auth gating.
   */
  initialUser: MobileAuthUser | null;
  /** The desktop composition. Rendered at >=768px. */
  children: ReactNode;
}

export function MobileViewportSwitch({
  isGitHubConnected,
  initialUser,
  children,
}: MobileViewportSwitchProps) {
  const isMobile = useIsMobileViewport();

  if (isMobile) {
    return (
      <MobileApp
        isGitHubConnected={isGitHubConnected}
        initialUser={initialUser}
      />
    );
  }

  return <>{children}</>;
}
