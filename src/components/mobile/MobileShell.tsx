"use client";

/**
 * MobileShell — top-level wrapper for the mobile composition.
 *
 * Phase 1 of the mobile redesign. Above 768px (Tailwind `md`) the shell is a
 * pass-through: it returns its children unchanged so desktop renders exactly
 * the same as before. Below 768px it provides the three regions every mobile
 * screen needs:
 *
 *  1. A top safe-area inset (notch / status bar).
 *  2. A scrollable content region.
 *  3. A bottom 56pt {@link BottomTabBar}.
 *
 * Phase 1 does not wire navigation: the host tells the shell which tab is
 * active and listens for `onTabChange`. Real screens land in later phases.
 */

import { useCallback, useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useIsMobileViewport } from "@/hooks/useMobile";

import {
  BottomTabBar,
  useSwipeUpFromBottomEdge,
  type BottomTabBarProps,
  type MobileTab,
} from "./BottomTabBar";

export interface MobileShellProps {
  children: ReactNode;
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  /** Pass-through to the bar; Phase 3 sets this true on the terminal route. */
  forceHidden?: boolean;
  /** Fired when a swipe-up from the bottom edge requests the bar back. */
  onRequestRevealTabBar?: () => void;
  /** Pass-through tab badges. */
  badges?: BottomTabBarProps["badges"];
  className?: string;
  /** Optional content inset; defaults to enough room for the 56pt bar. */
  bottomInsetClassName?: string;
}

// Roughly the BottomTabBar height (56px) plus the safe-area-inset-bottom slot.
// We use padding rather than margin so scroll positions don't fight the bar.
const DEFAULT_BOTTOM_INSET = "pb-[calc(56px+env(safe-area-inset-bottom))]";

export function MobileShell({
  children,
  activeTab,
  onTabChange,
  forceHidden = false,
  onRequestRevealTabBar,
  badges,
  className,
  bottomInsetClassName,
}: MobileShellProps) {
  const isMobile = useIsMobileViewport();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Memo'd so the swipe-up hook doesn't re-bind every render.
  const handleReveal = useCallback(() => {
    onRequestRevealTabBar?.();
  }, [onRequestRevealTabBar]);

  // Phase 1 wires the hook only on mobile; the bar API exposes it for Phase 3.
  useSwipeUpFromBottomEdge(handleReveal, {
    enabled: isMobile && forceHidden,
  });

  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid="mobile-shell"
      className={cn(
        "relative flex h-[100dvh] flex-col bg-background text-foreground",
        className
      )}
    >
      {/* Top safe-area inset; the host page renders its own header inside `children`. */}
      <div className="pt-safe-top" aria-hidden="true" />

      <div
        ref={scrollRef}
        data-testid="mobile-shell-scroll"
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain",
          bottomInsetClassName ?? DEFAULT_BOTTOM_INSET
        )}
      >
        {children}
      </div>

      <BottomTabBar
        activeTab={activeTab}
        onTabChange={onTabChange}
        scrollContainer={scrollRef.current}
        forceHidden={forceHidden}
        badges={badges}
      />
    </div>
  );
}
