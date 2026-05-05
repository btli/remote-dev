"use client";

/**
 * BottomTabBar — primary mobile navigation surface.
 *
 * Phase 1 of the mobile redesign. Renders four equal tabs (Sessions /
 * Notifications / Channels / Profile), 56pt tall, with a 1px hairline top
 * border on a solid `bg-card`. Hierarchy is by weight (500 active vs 400
 * inactive) and color (foreground vs muted-foreground), not by accent color —
 * see DESIGN.md "Weight-Over-Size Rule" and "Achromatic-Default Rule".
 *
 * The bar auto-hides on scroll-down past ~80px and re-shows on scroll-up.
 * Easing follows the iOS-style ease-out-quart curve at 240ms; users with
 * `prefers-reduced-motion: reduce` get an instant transition.
 *
 * `forceHidden` is the API hook for Phase 3: when the single-session terminal
 * route wants the bar to disappear entirely (only revealed by a swipe-up from
 * the bottom edge), it sets this to true.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, List, MessageCircle, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/useMobile";

export type MobileTab = "sessions" | "notifications" | "channels" | "profile";

export interface BottomTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  /** Element whose vertical scroll drives auto-hide. Falls back to window. */
  scrollContainer?: HTMLElement | null;
  /** Force the bar hidden (Phase 3 single-session route). Defaults to false. */
  forceHidden?: boolean;
  /** Optional unread badges per tab. */
  badges?: Partial<Record<MobileTab, number>>;
  className?: string;
}

interface TabDef {
  id: MobileTab;
  label: string;
  Icon: LucideIcon;
}

// Order is the IA: most-frequent-first, profile last.
const TABS: readonly TabDef[] = [
  { id: "sessions", label: "Sessions", Icon: List },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "channels", label: "Channels", Icon: MessageCircle },
  { id: "profile", label: "Profile", Icon: User },
] as const;

// Threshold below which we never hide the bar; avoids flicker at the very top.
const HIDE_AFTER_PX = 80;
// ease-out-quart per iOS interaction guidelines.
const TAB_BAR_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const TAB_BAR_DURATION_MS = 240;

export function BottomTabBar({
  activeTab,
  onTabChange,
  scrollContainer,
  forceHidden = false,
  badges,
  className,
}: BottomTabBarProps) {
  const [autoHidden, setAutoHidden] = useState(false);
  const lastScrollY = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  // Auto-hide-on-scroll-down. Reads scroll from the supplied container, or
  // falls back to window when none is given. Direction wins over velocity:
  // any upward delta re-shows, any downward delta past HIDE_AFTER_PX hides.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target: HTMLElement | Window = scrollContainer ?? window;

    const readScrollY = (): number => {
      if (target === window) return window.scrollY;
      return (target as HTMLElement).scrollTop;
    };

    lastScrollY.current = readScrollY();

    const handleScroll = () => {
      const y = readScrollY();
      const delta = y - lastScrollY.current;
      // Ignore tiny noise.
      if (Math.abs(delta) < 4) return;
      if (delta > 0 && y > HIDE_AFTER_PX) {
        setAutoHidden(true);
      } else if (delta < 0) {
        setAutoHidden(false);
      }
      lastScrollY.current = y;
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, [scrollContainer]);

  const hidden = forceHidden || autoHidden;

  const handleTabPress = useCallback(
    (tab: MobileTab) => {
      onTabChange(tab);
    },
    [onTabChange]
  );

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      data-testid="mobile-bottom-tab-bar"
      data-state={hidden ? "hidden" : "visible"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40",
        "border-t border-border bg-card",
        "pb-safe-bottom",
        // No backdrop-blur, no glass; flat per DESIGN.md "Flat-By-Default Rule".
        hidden ? "translate-y-full" : "translate-y-0",
        "will-change-transform",
        className
      )}
      style={{
        transitionProperty: "transform",
        transitionDuration: reducedMotion ? "0ms" : `${TAB_BAR_DURATION_MS}ms`,
        transitionTimingFunction: reducedMotion ? "linear" : TAB_BAR_EASING,
      }}
    >
      {/* role="tablist" on the <ul> so the role="tab" buttons satisfy
          aria-required-parent (Lighthouse a11y). The <li> wrappers exist for
          layout only and are marked presentation so they don't break the
          tab/tablist hierarchy. */}
      <ul role="tablist" className="flex h-14 items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const active = id === activeTab;
          const badge = badges?.[id] ?? 0;
          return (
            <li key={id} role="presentation" className="flex-1">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                aria-label={
                  badge > 0
                    ? `${label}, ${badge > 99 ? "99+" : badge} unread`
                    : label
                }
                data-tab={id}
                onClick={() => handleTabPress(id)}
                // 44pt minimum target; the parent <li> stretches to 56pt so
                // the actual hit area is 56pt tall by full-width-divided-by-4.
                className={cn(
                  "relative flex h-full w-full min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5",
                  "text-[11px] tracking-[0.01em]",
                  "transition-colors",
                  // Hierarchy by weight + color, not accent. Achromatic-default.
                  active
                    ? "font-medium text-foreground"
                    : "font-normal text-muted-foreground",
                  // Active rows get a tactile press; ghost-style on hover for
                  // pointer fallback (rare on mobile, common on dev tooling).
                  "hover:text-foreground active:bg-accent/40",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={active ? 2 : 1.75}
                />
                <span>{label}</span>
                {badge > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-[calc(50%-22px)] top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium leading-none text-background"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Hook that listens for swipe-up gestures starting from the bottom edge of the
 * viewport. When triggered, it calls `onReveal` so the host can flip
 * `forceHidden` back to false. Phase 1 ships the API; Phase 3 wires it up
 * inside the single-session route. Respects `prefers-reduced-motion` only in
 * the sense that the gesture itself is unaffected — the reveal animation that
 * follows is owned by the bar.
 */
export function useSwipeUpFromBottomEdge(
  onReveal: () => void,
  options?: { edgeThresholdPx?: number; verticalThresholdPx?: number; enabled?: boolean }
) {
  const enabled = options?.enabled ?? true;
  const edge = options?.edgeThresholdPx ?? 24;
  const vertical = options?.verticalThresholdPx ?? 32;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let startY: number | null = null;
    let startedNearEdge = false;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startY = t.clientY;
      startedNearEdge = window.innerHeight - t.clientY <= edge;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startedNearEdge || startY === null) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = startY - t.clientY;
      if (dy >= vertical) {
        onReveal();
        startedNearEdge = false;
        startY = null;
      }
    };

    const onTouchEnd = () => {
      startedNearEdge = false;
      startY = null;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, edge, vertical, onReveal]);
}
