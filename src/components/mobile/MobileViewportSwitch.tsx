"use client";

/**
 * MobileViewportSwitch — Phase 2 mobile redesign + Phase 7 code-split.
 *
 * Renders the mobile composition (`MobileApp`) below the Tailwind `md`
 * breakpoint (768px) and the desktop composition (`DesktopApp`) at and
 * above it.
 *
 * **Code-split (Phase 7, gj45):** Both branches are loaded via
 * `next/dynamic`, so a mobile viewport never downloads the desktop
 * `SessionManager` dependency graph (xterm, codemirror, sidebars,
 * modals) and a desktop viewport never downloads the mobile shell.
 * This shaved ~340 KB of unused JS off the mobile `/` initial bundle
 * (see `docs/reports/2026-05-07-lighthouse-mobile-gj45/`).
 *
 * SSR strategy:
 *
 *   1. The server-rendered parent (`app/page.tsx`) does a UA sniff
 *      (`detectMobileUA`) and forwards an `initialIsMobile` hint.
 *   2. We pick the SSR branch from that hint: mobile UAs SSR the
 *      mobile composition, every other UA SSRs the desktop
 *      composition.
 *   3. Each branch is `ssr: true`, so the chosen branch is part of
 *      the server-rendered HTML — first paint already shows real
 *      content.
 *   4. The non-chosen branch's chunk is never downloaded for that
 *      request because the dynamic import is gated behind a runtime
 *      `if`. Result: mobile users only download the mobile chunk;
 *      desktop users only download the desktop chunk.
 *
 * No `loading` placeholder: passing one made Next.js stream the
 * boundary and the `SessionManager` flex children rendered late,
 * causing a measurable CLS regression (0 → 0.16) on desktop.
 * Omitting `loading` lets Next.js render the dynamic component
 * inline during SSR with no Suspense placeholder, preserving the
 * baseline desktop CLS of 0.
 *
 * Client correction: after hydration, `useIsMobileViewport()` (a
 * `useSyncExternalStore`-backed hook) overrides the SSR hint with the
 * real viewport value. This handles UA sniff misses (e.g. iPad in
 * desktop Safari mode, Cloudflare Access proxies stripping UA) and
 * window resizes.
 */

import type { ComponentType } from "react";

import dynamic from "next/dynamic";

import { useIsMobileViewport } from "@/hooks/useMobile";

import type { MobileAuthUser } from "./MobileApp";

const DesktopApp = dynamic(() => import("../desktop/DesktopApp"), {
  ssr: true,
}) as ComponentType<{
  isGitHubConnected: boolean;
  userEmail: string;
  onSignOut: () => void;
}>;

const MobileApp = dynamic(
  () => import("./MobileApp").then((m) => ({ default: m.MobileApp })),
  {
    ssr: true,
  }
) as ComponentType<{
  isGitHubConnected: boolean;
  initialUser: MobileAuthUser | null;
}>;

export interface MobileViewportSwitchProps {
  isGitHubConnected: boolean;
  /**
   * Server-resolved UA-based hint: `true` when the request came from a
   * mobile UA. Drives both the SSR branch pick and the client's first
   * render before `useSyncExternalStore` resolves the real viewport.
   */
  initialIsMobile: boolean;
  /**
   * Server-resolved authenticated user (handles both NextAuth and CF
   * Access). Forwarded to {@link MobileApp} as the source of truth for
   * mobile auth gating.
   */
  initialUser: MobileAuthUser | null;
  /** User email for the desktop header. */
  userEmail: string;
  /**
   * Server-action sign-out handler. Defined inline in the parent server
   * component (`app/page.tsx`) and passed through unchanged so that
   * Next.js serializes it correctly across the dynamic import boundary.
   */
  onSignOut: () => void;
}

export function MobileViewportSwitch({
  initialIsMobile,
  isGitHubConnected,
  initialUser,
  userEmail,
  onSignOut,
}: MobileViewportSwitchProps) {
  const isMobileFromHook = useIsMobileViewport();
  const isMobile = isMobileFromHook || initialIsMobile;

  if (isMobile) {
    return (
      <MobileApp
        isGitHubConnected={isGitHubConnected}
        initialUser={initialUser}
      />
    );
  }

  return (
    <DesktopApp
      isGitHubConnected={isGitHubConnected}
      userEmail={userEmail}
      onSignOut={onSignOut}
    />
  );
}
