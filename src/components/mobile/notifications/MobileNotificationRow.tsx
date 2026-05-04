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

import { useMemo, useState } from "react";

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

  // The halo only animates on session-waiting rows. Other notification
  // types are unread-only and don't carry the "needs attention" semantic.
  const showHalo = notification.type === "agent_waiting" && isUnread;

  const swipe = useNotificationSwipe({
    enabled: enableGestures,
    onDelete: () => onDelete(notification),
    onToggleRead: () => onToggleRead(notification),
  });

  const longPress = useLongPress({
    enabled: enableGestures,
    onLongPress: () => onLongPress(notification),
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
      {/* Behind layer (left): swipe-right = toggle-read hint */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4",
          "text-xs font-medium text-muted-foreground"
        )}
      >
        {isUnread ? "Mark read" : "Mark unread"}
      </div>

      <div
        data-testid="mobile-notification-row"
        data-notification-id={notification.id}
        data-unread={isUnread ? "true" : "false"}
        data-type={notification.type}
        role="button"
        tabIndex={0}
        aria-label={`Notification: ${notification.title}`}
        onTouchStart={(e) => {
          swipe.bind.onTouchStart(e);
          longPress.bind.onTouchStart(e);
        }}
        onTouchMove={swipe.bind.onTouchMove}
        onTouchEnd={() => {
          swipe.bind.onTouchEnd();
          longPress.bind.onMouseUp();
        }}
        onTouchCancel={() => {
          swipe.bind.onTouchCancel();
          longPress.bind.onMouseUp();
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
          <div className="mt-1 flex items-center gap-2">
            {notification.sessionName ? (
              <span className="text-[10px] text-muted-foreground/60">
                {notification.sessionName}
              </span>
            ) : null}
            <span className="text-[10px] text-muted-foreground/40">
              {relativeTime}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
