"use client";

/**
 * MobileViewportSwitch — Phase 2 mobile redesign.
 *
 * Renders the mobile composition (`MobileApp`) below the Tailwind `md`
 * breakpoint (768px) and the desktop `children` (typically `SessionManager`)
 * at and above it.
 *
 * IMPORTANT: First render is forced to desktop on both server and client to
 * keep markup hashes aligned with `useIsMobileViewport()`'s SSR-safe default.
 * The first `useEffect` flip happens within a single frame, so the visible
 * behavior on a real phone is unchanged.
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
