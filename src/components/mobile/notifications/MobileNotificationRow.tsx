"use client";

/**
 * MobileNotificationRow — Phase 4 mobile redesign.
 *
 * Renders a single notification with:
 *
 *   - A leading 12px (6px-radius) dot in `--color-signal-attention-solid`
 *     when unread; transparent (but space-reserving) when read. Replaces
 *     the desktop `border-l-2` colored stripe — see DESIGN.md "No
 *     Side-Stripe Rule".
 *   - The pulsing `notification-ring` halo on the dot when the notification
 *     is `agent_waiting` (the canonical "agent needs you" signal). The halo
 *     is suppressed when the user prefers reduced motion.
 *   - Title (font-medium when unread, font-normal when read), optional body,
 *     and metadata line (sessionName + relative time).
 *   - Inline expansion: tapping the row toggles a body-text expansion
 *     (clamped → full) when there's more text than fits the truncate.
 *     There is no push navigation — the user stays on the tab.
 *   - Long-press fires `onLongPress` for the consumer's ActionSheet.
 *   - Swipe left → delete; swipe right → toggle read. The hook defers to
 *     {@link useNotificationSwipe} which handles vertical-bias / threshold.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { cn, formatRelativeTime } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/useMobile";
import type { NotificationEvent } from "@/types/notification";

import { useLongPress } from "../sessions/useSwipeAction";

import { useNotificationSwipe } from "./useNotificationSwipe";

export interface MobileNotificationRowProps {
  notification: NotificationEvent;
  onTap: (notification: NotificationEvent) => void;
  onLongPress: (notification: NotificationEvent) => void;
  onDelete: (notification: NotificationEvent) => void;
  onToggleRead: (notification: NotificationEvent) => void;
  /** When false, gestures are disabled (e.g. while a fade-out animation runs). */
  enableGestures?: boolean;
}

export function MobileNotificationRow({
  notification,
  onTap,
  onLongPress,
  onDelete,
  onToggleRead,
  enableGestures = true,
}: MobileNotificationRowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const isUnread = !notification.readAt;

  // [y5ch.8] Severity — not a hardcoded type check — drives the visual signal.
  // actionable + error both carry the "needs attention" semantic; the pulsing
  // halo animates on those when unread. Passive rows stay quiet.
  const isActionable =
    notification.severity === "actionable" || notification.severity === "error";
  const showHalo = isActionable && isUnread;
  const count = notification.count ?? 1;

  // Right-swipe = "mark unread". The server has no mark-unread endpoint, so
  // letting users swipe a read row right would commit a no-op gesture (and
  // surface a confusing "local-only state" toast). Instead we disable the
  // right-swipe entirely on read rows — the behind-layer hint is hidden too,
  // so the gesture isn't advertised. Left-swipe (delete) is always enabled.
  const enableRightSwipe = isUnread;

  const swipe = useNotificationSwipe({
    enabled: enableGestures,
    enableRightSwipe,
    onDelete: () => onDelete(notification),
    onToggleRead: () => onToggleRead(notification),
  });

  // Long-press needs to suppress the synthetic click that fires on touch
  // release. Without this guard, lifting the finger after a 600ms hold
  // triggers `handleClick`, which on an unread row marks it read or toggles
  // body expansion — both of which can yank the action sheet's target row
  // out from under the user (especially in the Unread filter).
  //
  // We also time-bound the suppression: if the post-long-press synthetic
  // click is intercepted by the ActionSheet's overlay (so it never reaches
  // this row), the flag would otherwise stay true forever and swallow the
  // next legitimate tap. 350ms covers the typical synthetic-click delay
  // window after touchend; any genuine tap arriving after that resets the
  // flag itself in `handleClick`.
  const longPressFiredRef = useRef(false);
  const longPressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const armLongPressReset = () => {
    if (longPressResetTimerRef.current) {
      clearTimeout(longPressResetTimerRef.current);
    }
    longPressResetTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = false;
      longPressResetTimerRef.current = null;
    }, 350);
  };
  // Clean up any pending reset timer on unmount so a row that long-pressed
  // and unmounted (e.g. tab switch) doesn't fire setTimeout into a torn-down
  // component.
  useEffect(() => {
    return () => {
      if (longPressResetTimerRef.current) {
        clearTimeout(longPressResetTimerRef.current);
        longPressResetTimerRef.current = null;
      }
    };
  }, []);
  const longPress = useLongPress({
    enabled: enableGestures,
    onLongPress: () => {
      longPressFiredRef.current = true;
      armLongPressReset();
      onLongPress(notification);
    },
  });

  const relativeTime = useMemo(() => {
    const iso =
      notification.createdAt instanceof Date
        ? notification.createdAt.toISOString()
        : new Date(notification.createdAt as unknown as string).toISOString();
    return formatRelativeTime(iso);
  }, [notification.createdAt]);

  // Heuristic: only allow expansion when there's body text to expand into.
  // Without a body the row collapses to the title + metadata, and tapping
  // simply triggers the row's primary action (jump to session).
  const hasExpandableBody = Boolean(notification.body);

  const handleClick = () => {
    // Swallow the click that fires synthetically right after a long-press
    // fires (touchend → click on touch devices, mouseup → click on desktop
    // test runners). The next genuine tap clears the flag and runs.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      if (longPressResetTimerRef.current) {
        clearTimeout(longPressResetTimerRef.current);
        longPressResetTimerRef.current = null;
      }
      return;
    }
    if (hasExpandableBody) {
      // Inline expansion only — never pushes a new screen.
      setExpanded((e) => !e);
    }
    onTap(notification);
  };

  return (
    <div
      className={cn(
        "relative w-full",
        // Behind-layer affordances peek through when content slides.
        "overflow-hidden"
      )}
    >
      {/* Behind layer (right): swipe-left = delete hint */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4",
          "text-xs font-medium text-destructive"
        )}
      >
        Delete
      </div>
      {/* Behind layer (left): swipe-right = toggle-read hint. Only rendered
          when right-swipe is actually wired up (unread rows) so we don't
          advertise a gesture that no-ops. */}
      {enableRightSwipe ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4",
            "text-xs font-medium text-muted-foreground"
          )}
        >
          Mark read
        </div>
      ) : null}

      <div
        data-testid="mobile-notification-row"
        data-notification-id={notification.id}
        data-unread={isUnread ? "true" : "false"}
        data-type={notification.type}
        role="button"
        tabIndex={0}
        aria-label={`Notification: ${notification.title}`}
        aria-expanded={hasExpandableBody ? expanded : undefined}
        onTouchStart={(e) => {
          swipe.bind.onTouchStart(e);
          longPress.bind.onTouchStart(e);
        }}
        onTouchMove={swipe.bind.onTouchMove}
        onTouchEnd={() => {
          swipe.bind.onTouchEnd();
          // Cancel the long-press timer explicitly rather than aliasing
          // through `bind.onMouseUp` — clearer intent and decouples touch
          // lifecycle from mouse-event handler names.
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
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          "relative flex w-full items-start gap-3 bg-card",
          "px-4 py-3 min-h-[56px]",
          "border-b border-border/60",
          "transition-colors",
          isUnread ? "bg-card" : "bg-card/60",
          "hover:bg-accent/30 active:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        )}
        style={{
          transform: swipe.offset !== 0 ? `translateX(${swipe.offset}px)` : undefined,
          transitionProperty:
            swipe.offset === 0 ? "transform, background-color" : "background-color",
          transitionDuration:
            swipe.offset === 0 && !reducedMotion ? "180ms" : "0ms",
        }}
      >
        {/* Leading dot: 12px outer (h-3 w-3 = 0.75rem), 6px radius via
            `rounded-full`. We render the dot in both states so the title
            alignment stays stable; only the fill flips. The halo is a
            sibling absolutely-positioned ring sized to the dot. */}
        <span
          aria-hidden="true"
          data-testid="mobile-notification-dot"
          className={cn(
            "relative mt-1 inline-flex h-3 w-3 shrink-0 rounded-full",
            isUnread
              ? "bg-[var(--color-signal-attention-solid)]"
              : "bg-transparent"
          )}
        >
          {showHalo && !reducedMotion ? (
            <span
              aria-hidden="true"
              data-testid="mobile-notification-halo"
              className="absolute inset-0 rounded-full notification-ring"
            />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm leading-tight text-foreground",
              isUnread ? "font-medium" : "font-normal",
              !expanded && "truncate"
            )}
          >
            {notification.title}
            {/* [y5ch.8] coalesced-count badge: N collapsed lifecycle pings. */}
            {count > 1 ? (
              <span
                data-testid="mobile-notification-count"
                className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground"
              >
                ×{count}
              </span>
            ) : null}
          </p>
          {notification.body ? (
            <p
              data-testid="mobile-notification-body"
              data-expanded={expanded ? "true" : "false"}
              className={cn(
                "mt-0.5 text-xs leading-snug text-muted-foreground",
                expanded ? "whitespace-pre-wrap" : "truncate"
              )}
            >
              {notification.body}
            </p>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {notification.sessionName ? (
              <>
                <span>{notification.sessionName}</span>
                <span className="sr-only">,</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{relativeTime}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
