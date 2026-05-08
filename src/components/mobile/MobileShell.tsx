"use client";

/**
 * MobileShell — top-level wrapper for the mobile composition.
 *
 * Phase 1 of the mobile redesign. Above 768px (Tailwind `md`) the shell drops
 * its mobile chrome (tab bar + safe-area insets) but still renders a
 * bounded-height container so children that rely on `h-full` continue to
 * fill the viewport — this matters on UA-mobile foldables (e.g. Pixel Fold)
 * that cross 768px when unfolded. Below 768px it provides the three regions
 * every mobile screen needs:
 *
 *  1. A top safe-area inset (notch / status bar).
 *  2. A scrollable content region.
 *  3. A bottom 56pt {@link BottomTabBar}.
 *
 * Phase 1 does not wire navigation: the host tells the shell which tab is
 * active and listens for `onTabChange`. Real screens land in later phases.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useIsMobileViewport, useVisualViewportHeight } from "@/hooks/useMobile";

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
  // Android Chrome on foldables over-reports `100dvh` post-unfold (the gesture
  // bar's area is included), so the terminal's flex-1 slot extends below the
  // actually-visible area and its bottom rows render under the input bar.
  // `visualViewport.height` reflects the truly visible region, so we apply it
  // as an inline height when available.
  const vvHeight = useVisualViewportHeight();
  // We use a state-callback ref rather than `useRef` because the scroll
  // element reference must propagate to <BottomTabBar>'s `useEffect` so it
  // can bind a `scroll` listener to the real container. A plain ref is
  // null on the first render and never triggers a re-render when it
  // mounts, so the bar would silently fall back to `window` listeners —
  // and the shell's actual scroller is `100dvh`, leaving `window.scrollY`
  // pinned at 0 forever.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // Memo'd so the swipe-up hook doesn't re-bind every render.
  const handleReveal = useCallback(() => {
    onRequestRevealTabBar?.();
  }, [onRequestRevealTabBar]);

  // Phase 1 wires the hook only on mobile; the bar API exposes it for Phase 3.
  useSwipeUpFromBottomEdge(handleReveal, {
    enabled: isMobile && forceHidden,
  });

  if (!isMobile) {
    // Above 768px we drop the tab bar + safe-area chrome, but keep a bounded-
    // height wrapper. MobileApp is the only mount path (UA-mobile only), and
    // its children (e.g. MobileSessionView) rely on `h-full` to fill an
    // ancestor — without this, an unfolded foldable that crosses 768px
    // collapses the terminal viewport to 0px.
    return (
      <div
        className={cn(
          "flex h-[100dvh] flex-col bg-background text-foreground",
          className
        )}
        style={vvHeight !== null ? { height: `${vvHeight}px` } : undefined}
      >
        {children}
      </div>
    );
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
        ref={setScrollEl}
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
        scrollContainer={scrollEl}
        forceHidden={forceHidden}
        badges={badges}
      />
    </div>
  );
}
