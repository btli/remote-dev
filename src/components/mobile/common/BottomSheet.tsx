"use client";

/**
 * BottomSheet — primitive slide-up panel for the mobile redesign.
 *
 * Phase 2 of the mobile redesign. A solid (not glassy) sheet pinned to the
 * bottom of the viewport with a 1px hairline top border on `bg-card`,
 * rounded-t-xl. Slide-up motion uses the iOS-style ease-out-quart curve
 * (`cubic-bezier(0.32, 0.72, 0, 1)`) at 240ms — matching the BottomTabBar
 * vocabulary established in Phase 1. Reduced motion = instant.
 *
 * NO `backdrop-filter`. The overlay is a flat `bg-black/50`, per DESIGN.md
 * "Glass-Earns-Its-Place Rule". A small grabber pip on top is a tactile
 * affordance, not decoration. ESC and overlay click both close.
 *
 * The sheet is portaled into `document.body` (when on the client) so it
 * isn't constrained by parent overflow / transform contexts.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/useMobile";

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional title rendered above the body. */
  title?: ReactNode;
  /** Optional pinned footer. Stays anchored to the sheet bottom. */
  footer?: ReactNode;
  /** Body content (scrollable). */
  children: ReactNode;
  /**
   * `default` keeps the sheet at most 75dvh tall (project tree, action sheet).
   * `tall` uses 92dvh — for content as substantial as the new-session wizard.
   */
  size?: "default" | "tall";
  /** Add to the outer panel (testing hooks, custom padding overrides, etc.). */
  className?: string;
  /** Aria label fallback when no `title` is provided. */
  ariaLabel?: string;
}

const SHEET_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHEET_DURATION_MS = 240;

export function BottomSheet({
  open,
  onOpenChange,
  title,
  footer,
  children,
  size = "default",
  className,
  ariaLabel,
}: BottomSheetProps) {
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Only render the portal on the client to avoid SSR/CSR mismatches.
  const isClient = typeof document !== "undefined";

  // ESC key support.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Suppress lint: setEntered/setMounted are inside an effect (mount cycle).
  // The pattern is the canonical "two-phase enter/exit transition" — we
  // genuinely need the next-frame flip to drive the CSS transition.

  const onOverlayClick = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Two-phase mount so the slide-up enter and slide-down exit animations
  // both play. `mounted` tracks DOM presence; `entered` tracks whether
  // the panel has flipped from translate-y-full → 0. We only render the
  // portal while the sheet is in DOM; tests that query for the panel see
  // it absent before any open and after a close completes.
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- two-phase mount/transition state machine
      setMounted(true);
      // Next frame: flip to entered=true so the transition runs.
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    if (!mounted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- two-phase mount/transition state machine
    setEntered(false);
    if (reducedMotion) {
      setMounted(false);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), SHEET_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted, reducedMotion]);

  if (!isClient) return null;
  if (!mounted) return null;

  const heightCap = size === "tall" ? "max-h-[92dvh]" : "max-h-[75dvh]";

  // Render-and-animate strategy: when `open` flips to true the panel mounts
  // already at translate-y-full, then in the next frame transitions to 0.
  // When closed we keep the wrapper mounted briefly so the exit transition
  // can play. Simplest correct version: always-mounted with `aria-hidden`
  // when closed, transition runs in either direction.

  return createPortal(
    <div
      // The wrapper stretches the full viewport so the overlay covers
      // everything; `pointer-events-none` when closed lets the page below
      // remain interactive. We set `inert` for accessibility.
      data-state={entered ? "open" : "closed"}
      className={cn(
        "fixed inset-0 z-50 flex flex-col justify-end",
        entered ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={entered ? undefined : true}
    >
      {/* Overlay */}
      <button
        type="button"
        aria-label="Close sheet"
        tabIndex={entered ? 0 : -1}
        onClick={onOverlayClick}
        className={cn(
          "absolute inset-0 bg-black/50",
          // No backdrop-blur, intentionally flat — DESIGN.md.
          entered ? "opacity-100" : "opacity-0"
        )}
        style={{
          transitionProperty: "opacity",
          transitionDuration: reducedMotion ? "0ms" : `${SHEET_DURATION_MS}ms`,
          transitionTimingFunction: reducedMotion ? "linear" : SHEET_EASING,
        }}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        data-testid="mobile-bottom-sheet"
        className={cn(
          "relative z-10 flex flex-col",
          "rounded-t-xl border-t border-border bg-card text-card-foreground",
          "pb-safe-bottom",
          "shadow-lg",
          heightCap,
          // No backdrop-filter on the panel itself either.
          entered ? "translate-y-0" : "translate-y-full",
          "will-change-transform",
          className
        )}
        style={{
          transitionProperty: "transform",
          transitionDuration: reducedMotion ? "0ms" : `${SHEET_DURATION_MS}ms`,
          transitionTimingFunction: reducedMotion ? "linear" : SHEET_EASING,
        }}
      >
        {/* Grabber pip */}
        <div className="flex items-center justify-center pt-2 pb-1">
          <div
            aria-hidden="true"
            className="h-1 w-9 rounded-full bg-muted-foreground/40"
          />
        </div>
        {title ? (
          <div className="px-4 pb-2 pt-1">
            <h2
              id={titleId}
              className="text-base font-medium leading-tight text-foreground"
            >
              {title}
            </h2>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-border px-3 py-2">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
