"use client";

/**
 * MobileSessionRow — a single session row in the Phase 2 Sessions tab.
 *
 * One line title (500 weight when active or attention-needed, 400 otherwise),
 * one line subtitle (status + last-activity, muted-fg, mono when mid-execution),
 * leading 6×6 state pip. The active session shows a leading line-segment
 * indicator on the left edge (NOT a colored side-stripe — see DESIGN.md
 * "No Side-Stripe Rule").
 *
 * Interactions:
 *   - Tap: select the session.
 *   - Long-press: open action sheet via `onLongPress`.
 *   - Swipe-left (active sessions): two-stage. Past `SUSPEND_THRESHOLD` →
 *     `onSwipeSuspend`; past `CLOSE_THRESHOLD` → `onSwipeClose`. The
 *     behind-layer label switches between "Suspend" and "Close" with a
 *     destructive tone in stage 1 to match iOS Mail.
 *   - Swipe-left (suspended sessions): single-stage → `onSwipeClose`
 *     (suspend isn't a meaningful action on an already-suspended row).
 *   - Closed/trashed sessions: no swipe, no long-press.
 *
 * Reduced motion: the attention halo is suppressed; the pip remains static.
 */

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus } from "@/types/terminal-type";
import { usePrefersReducedMotion } from "@/hooks/useMobile";

import {
  getSessionPresentation,
  pipClassName,
} from "./sessionStatusUtils";
import { useLongPress, useSwipeAction } from "./useSwipeAction";

// Two-stage swipe thresholds. Stage 0 (Suspend) lines up with the canonical
// 72px single-threshold used elsewhere in the mobile UI; stage 1 (Close)
// requires a deeper commit so a casual swipe doesn't accidentally destroy
// state. 180px is far enough that the user has to pass through Suspend
// territory first — matches iOS Mail's two-stage behavior visually.
const SUSPEND_THRESHOLD = 72;
const CLOSE_THRESHOLD = 180;

export interface MobileSessionRowProps {
  session: TerminalSession;
  activity: AgentActivityStatus;
  active: boolean;
  density?: "comfortable" | "dense";
  onTap: (sessionId: string) => void;
  onLongPress: (sessionId: string) => void;
  onSwipeSuspend: (sessionId: string) => void;
  onSwipeClose: (sessionId: string) => void;
  /** When false, swipe and long-press are disabled (e.g. closed/trashed sessions). */
  enableGestures?: boolean;
}

export function MobileSessionRow({
  session,
  activity,
  active,
  density = "comfortable",
  onTap,
  onLongPress,
  onSwipeSuspend,
  onSwipeClose,
  enableGestures = true,
}: MobileSessionRowProps) {
  const reducedMotion = usePrefersReducedMotion();

  const presentation = useMemo(
    () => getSessionPresentation(session, activity),
    [session, activity]
  );

  // Active rows: two-stage swipe (Suspend → Close).
  // Suspended rows: single-stage swipe (Close only — Suspend is N/A).
  // Closed/trashed: no swipe (gesturesEnabled gate).
  const swipeEnabled = enableGestures && (
    session.status === "active" || session.status === "suspended"
  );
  const swipe = useSwipeAction({
    direction: "left",
    enabled: swipeEnabled,
    stages: session.status === "active"
      ? [
          { threshold: SUSPEND_THRESHOLD, onCommit: () => onSwipeSuspend(session.id) },
          { threshold: CLOSE_THRESHOLD, onCommit: () => onSwipeClose(session.id) },
        ]
      : [
          { threshold: SUSPEND_THRESHOLD, onCommit: () => onSwipeClose(session.id) },
        ],
  });

  const longPress = useLongPress({
    enabled: enableGestures,
    onLongPress: () => onLongPress(session.id),
  });

  // Title weight: active row OR attention-needed row uses 500. Otherwise 400.
  const titleWeight =
    active || presentation.needsAttention ? "font-medium" : "font-normal";

  const rowMinHeight = density === "dense" ? "min-h-[48px]" : "min-h-[56px]";

  // Status announcement for screen readers. The pip carries state visually;
  // SR users read this prefix so colour-only signal isn't the only channel.
  // Idle returns null so the default-state row announces just the session
  // name — avoids verbose "idle" repetition on every row in long lists.
  const statusAnnouncement = ((): string | null => {
    switch (presentation.pip) {
      case "attention":
        return "waiting for input";
      case "running":
        return "running";
      case "error":
        return "error";
      case "suspended":
        return "suspended";
      case "idle":
      default:
        return null;
    }
  })();

  // Behind-layer label/tone for the swipe affordance. Active rows show
  // "Close" (destructive) once stage 1 is crossed, otherwise "Suspend".
  // Suspended rows always say "Close" and turn destructive at stage 0.
  let swipeAffordance: { label: string; destructive: boolean };
  if (session.status === "suspended") {
    swipeAffordance = { label: "Close", destructive: swipe.stageIndex >= 0 };
  } else if (swipe.stageIndex >= 1) {
    swipeAffordance = { label: "Close", destructive: true };
  } else {
    swipeAffordance = { label: "Suspend", destructive: false };
  }

  return (
    <div
      className={cn(
        "relative w-full",
        // The "swipe affordance" sits behind the row content. When the user
        // swipes left, the content slides left and reveals this label.
        "overflow-hidden"
      )}
    >
      {/* Behind layer: swipe affordance label. The label and tone switch
          mid-drag to telegraph which action will commit on release.
          - Active rows: stage 0 = Suspend (muted), stage 1 = Close (destructive).
          - Suspended rows: single-stage Close — destructive once the user has
            crossed the threshold, matching the active-row visual tell. */}
      {swipeEnabled ? (
        <div
          aria-hidden="true"
          data-testid="mobile-session-swipe-affordance"
          data-stage={swipe.stageIndex}
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4",
            "text-xs font-medium",
            swipeAffordance.destructive ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {swipeAffordance.label}
        </div>
      ) : null}

      {/* Row content. Swipe and long-press both want touch handlers — compose
          them rather than letting the spread order silently nuke one set.
          Pointer/mouse handlers come from longPress only; swipe owns touch. */}
      <div
        data-testid="mobile-session-row"
        data-session-id={session.id}
        data-active={active ? "true" : "false"}
        data-pip={presentation.pip}
        onTouchStart={(e) => {
          swipe.bind.onTouchStart(e);
          longPress.bind.onTouchStart(e);
        }}
        onTouchMove={swipe.bind.onTouchMove}
        onTouchEnd={() => {
          swipe.bind.onTouchEnd();
          // Cancel the long-press timer explicitly. Previously this routed
          // through `bind.onMouseUp` (which also calls `cancel()`); using
          // the explicit method makes the intent obvious and decouples
          // touch lifecycle from the mouse-event aliases.
          longPress.cancel();
        }}
        onTouchCancel={() => {
          swipe.bind.onTouchCancel();
          longPress.cancel();
        }}
        onPointerDown={longPress.bind.onPointerDown}
        onPointerMove={longPress.bind.onPointerMove}
        onPointerUp={longPress.bind.onPointerUp}
        onPointerCancel={longPress.bind.onPointerCancel}
        onPointerLeave={longPress.bind.onPointerLeave}
        onMouseDown={longPress.bind.onMouseDown}
        onMouseUp={longPress.bind.onMouseUp}
        onMouseLeave={longPress.bind.onMouseLeave}
        role="button"
        tabIndex={0}
        aria-label={
          statusAnnouncement
            ? `Open session ${session.name}, ${statusAnnouncement}`
            : `Open session ${session.name}`
        }
        aria-current={active ? "true" : undefined}
        onClick={() => onTap(session.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap(session.id);
          }
        }}
        className={cn(
          "relative flex w-full items-center gap-3 bg-card",
          "px-4",
          rowMinHeight,
          // 44pt touch target — guaranteed by min-h-[48|56] + flex items-center.
          "border-b border-border/60",
          "transition-colors",
          active && "bg-accent/40",
          "hover:bg-accent/30 active:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        )}
        style={{
          transform: swipe.offset !== 0 ? `translateX(${swipe.offset}px)` : undefined,
          transitionProperty: swipe.offset === 0 ? "transform, background-color" : "background-color",
          transitionDuration: swipe.offset === 0 && !reducedMotion ? "180ms" : "0ms",
        }}
      >
        {/* Active indicator: a 2px-tall, 12px-wide leading line segment.
           Not a colored side-stripe (DESIGN.md No-Side-Stripe Rule); a
           pure-foreground line-segment that reads as "this row is current"
           without introducing chroma. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-r-sm",
            active ? "bg-foreground" : "bg-transparent"
          )}
        />

        {/* Leading state pip */}
        <span
          aria-hidden="true"
          data-testid="mobile-session-pip"
          className={cn(
            "relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
            pipClassName(presentation.pip)
          )}
        >
          {presentation.needsAttention && !reducedMotion ? (
            <span
              aria-hidden="true"
              data-testid="mobile-session-pip-halo"
              // Reuse the canonical halo keyframes. The pip is small (6px),
              // so the halo's box-shadow rings read clearly without
              // overpowering the row.
              className="absolute inset-0 rounded-full notification-ring"
            />
          ) : null}
        </span>

        {/* Title + subtitle stack */}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm leading-tight text-foreground", titleWeight)}>
            {session.name}
          </div>
          <div
            className={cn(
              "truncate text-xs leading-tight text-muted-foreground",
              presentation.subtitleMono && "font-mono"
            )}
          >
            {presentation.subtitle}
          </div>
        </div>

        {/* Pinned marker (subtle) */}
        {session.pinned ? (
          <span
            aria-label="Pinned"
            className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            pin
          </span>
        ) : null}
      </div>
    </div>
  );
}
