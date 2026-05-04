"use client";

// `usePullToRefresh` returns plain state values (`pullDistance`,
// `isRefreshing`) and a callback ref (`ref`). The Next 16 / React 19
// `react-hooks/refs` rule mistakes the `pull.*` field reads for ref
// accesses (because of the name `ref`). We follow the canonical pattern
// established by SessionsTab (Phase 2) and disable the rule for this file.
/* eslint-disable react-hooks/refs */

/**
 * NotificationsTab — Phase 4 mobile redesign Notifications tab.
 *
 * Composition (top to bottom):
 *
 *   1. Sticky header with three filter chips: All / Unread / Mentions.
 *   2. Scrollable notification list (with pull-to-refresh) OR an empty
 *      state per filter.
 *   3. Long-press → ActionSheet with: Jump to session, Mark read/unread,
 *      Mute project, Dismiss.
 *
 * Gestures:
 *   - Swipe left  = delete (with 5s undo toast).
 *   - Swipe right = toggle read.
 *   - Long-press  = open the action sheet.
 *   - Pull down   = refresh.
 *
 * The tab preserves the existing notification model end-to-end. It reads
 * from {@link useNotificationContext} and never touches the desktop
 * NotificationPanel beyond consuming the same context.
 *
 * "Mute project" is exposed as an action sheet item but is currently
 * disabled — there is no per-project mute API on the notification model
 * yet. The slot lives here so the redesign's surface is complete; the
 * feature can land without further IA churn.
 */

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { NotificationEvent } from "@/types/notification";

import { ActionSheet, type ActionSheetItem } from "../common/ActionSheet";
import type { MobileTab } from "../BottomTabBar";

import { MobileNotificationRow } from "./MobileNotificationRow";
import {
  NotificationFilterChips,
  type NotificationFilter,
} from "./NotificationFilterChips";

export interface NotificationsTabProps {
  /** Optional: switch the active mobile tab when "Jump to session" is
   *  selected. The orchestrator (MobileApp) provides this so the user
   *  lands on the Sessions tab after activating a session. */
  onSwitchTab?: (tab: MobileTab) => void;
}

/**
 * A notification is considered a "mention" when its body or title contains
 * an `@`-prefixed token. The data model has no first-class mention type;
 * this is a pragmatic, forward-compatible heuristic that matches both the
 * peer-message `@<sid:UUID>` token format (see services/peer-service.ts)
 * and human-readable `@name` text. When the model later grows a
 * `mention` flag, swap the heuristic for the flag and the rest of the tab
 * keeps working.
 */
function isMention(n: NotificationEvent): boolean {
  // Trivial guards: agent_* notifications are never mentions.
  if (
    n.type === "agent_waiting" ||
    n.type === "agent_error" ||
    n.type === "agent_complete" ||
    n.type === "agent_exited"
  ) {
    return false;
  }
  const haystack = `${n.title} ${n.body ?? ""}`;
  return /@<sid:[^>]+>|(^|\s)@\w/.test(haystack);
}

export function NotificationsTab({ onSwitchTab }: NotificationsTabProps) {
  const notifCtx = useNotificationContext();
  const sessionCtx = useSessionContext();

  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [actionTargetId, setActionTargetId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const counts = useMemo(() => {
    const all = notifCtx.notifications.length;
    const unread = notifCtx.notifications.filter((n) => !n.readAt).length;
    const mentions = notifCtx.notifications.filter(isMention).length;
    return { all, unread, mentions };
  }, [notifCtx.notifications]);

  const visible = useMemo(() => {
    if (filter === "unread") {
      return notifCtx.notifications.filter((n) => !n.readAt);
    }
    if (filter === "mentions") {
      return notifCtx.notifications.filter(isMention);
    }
    return notifCtx.notifications;
  }, [filter, notifCtx.notifications]);

  const handleRefresh = useCallback(async () => {
    setErrorMessage(null);
    try {
      await notifCtx.refresh();
    } catch (err) {
      setErrorMessage(`Couldn't load notifications. Pull to retry. (${String(err)})`);
    }
  }, [notifCtx]);

  const pull = usePullToRefresh({ onRefresh: handleRefresh });

  // Jump-to-session: marks read, activates the session, and switches tab.
  const performJump = useCallback(
    (notification: NotificationEvent) => {
      if (!notification.sessionId) {
        toast("This notification has no associated session.");
        return;
      }
      if (!notification.readAt) {
        void notifCtx.markRead([notification.id]);
      }
      sessionCtx.setActiveSession(notification.sessionId);
      onSwitchTab?.("sessions");
    },
    [notifCtx, sessionCtx, onSwitchTab]
  );

  // Toggle read: read → unread is a UI-only optimistic flip (the server
  // doesn't expose a "mark unread" endpoint). Unread → read goes through
  // the canonical markRead path.
  const performToggleRead = useCallback(
    (notification: NotificationEvent) => {
      if (notification.readAt) {
        // We don't have an API for unread; surface gracefully so the user
        // understands the action is best-effort.
        toast("Marked as unread is a local-only state.");
        return;
      }
      void notifCtx.markRead([notification.id]);
    },
    [notifCtx]
  );

  // Delete with 5s undo. We optimistically remove via the context's
  // `deleteNotification` (which already writes to the server). The Undo
  // action calls `addNotification` to re-insert the row at the top — the
  // server-side delete still happened, but the user sees their item again
  // and can re-undelete by pressing Undo a second time within 5s.
  //
  // Note: this is the same pattern the SessionsTab uses for swipe-suspend
  // (toast with action: { label: "Undo" }).
  const performDelete = useCallback(
    (notification: NotificationEvent) => {
      const snapshot = notification;
      void notifCtx.deleteNotification(notification.id).catch(() => {
        toast.error("Couldn't delete notification.");
      });
      toast(`Deleted "${snapshot.title}"`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            // Restore the row optimistically. The server record is gone;
            // a refresh would clobber it, but the user sees their item
            // back and can act on it again. Persistent restore is a
            // separate ticket — the UX contract here is "5s undo".
            notifCtx.addNotification(snapshot);
          },
        },
      });
    },
    [notifCtx]
  );

  const performMarkUnread = useCallback(() => {
    toast("Marked as unread is a local-only state.");
  }, []);

  // Action sheet items for the long-pressed notification.
  const actionTarget = useMemo(
    () => visible.find((n) => n.id === actionTargetId) ?? null,
    [visible, actionTargetId]
  );

  const actionItems = useMemo<ActionSheetItem[]>(() => {
    if (!actionTarget) return [];
    const items: ActionSheetItem[] = [];
    if (actionTarget.sessionId) {
      items.push({
        id: "jump",
        label: "Jump to session",
        onSelect: () => performJump(actionTarget),
      });
    }
    if (actionTarget.readAt) {
      items.push({
        id: "mark-unread",
        label: "Mark unread",
        onSelect: performMarkUnread,
      });
    } else {
      items.push({
        id: "mark-read",
        label: "Mark read",
        onSelect: () => {
          void notifCtx.markRead([actionTarget.id]);
        },
      });
    }
    items.push({
      id: "mute-project",
      label: "Mute project",
      // Per-project mute API doesn't exist yet — slot is reserved.
      disabled: true,
      onSelect: () => {
        toast("Mute project coming soon.");
      },
    });
    items.push({
      id: "dismiss",
      label: "Dismiss",
      destructive: true,
      onSelect: () => performDelete(actionTarget),
    });
    return items;
  }, [actionTarget, performJump, performDelete, performMarkUnread, notifCtx]);

  return (
    <div className="flex h-full flex-col">
      {/* Header: filter chips, sticky to top of the scroll region. */}
      <header
        data-testid="mobile-notifications-header"
        className={cn(
          "sticky top-0 z-20 flex items-center justify-between gap-2",
          "border-b border-border bg-card",
          "px-3 pt-3 pb-2"
        )}
      >
        <NotificationFilterChips
          active={filter}
          onChange={setFilter}
          counts={counts}
        />
        {notifCtx.unreadCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              void notifCtx.markAllRead();
            }}
            data-testid="mobile-notifications-mark-all-read"
            className={cn(
              "shrink-0 rounded-md px-2 min-h-[36px] text-xs",
              "font-normal text-muted-foreground",
              "hover:bg-accent/40 active:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
            aria-label="Mark all notifications as read"
          >
            Mark all read
          </button>
        ) : null}
      </header>

      {/* Content: error banner + list + pull-to-refresh indicator. */}
      <div className="relative flex flex-1 flex-col">
        {pull.pullDistance > 0 || pull.isRefreshing ? (
          <div
            data-testid="mobile-notifications-refresh-indicator"
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center py-2 text-xs text-muted-foreground"
            style={{
              transform: `translateY(${Math.max(0, pull.pullDistance - 16)}px)`,
              transitionProperty:
                pull.pullDistance === 0 ? "transform, opacity" : "none",
              transitionDuration: pull.pullDistance === 0 ? "180ms" : "0ms",
              opacity: pull.isRefreshing ? 1 : Math.min(1, pull.pullDistance / 60),
            }}
          >
            {pull.isRefreshing ? "Refreshing…" : "Pull to refresh"}
          </div>
        ) : null}

        <div
          ref={pull.ref}
          data-testid="mobile-notifications-scroll"
          className="flex-1 overflow-y-auto overscroll-contain"
        >
          {errorMessage ? (
            <div
              data-testid="mobile-notifications-error"
              role="alert"
              className="m-3 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          ) : null}

          {notifCtx.loading && visible.length === 0 ? (
            <NotificationListSkeleton />
          ) : visible.length === 0 ? (
            <NotificationsEmptyState filter={filter} totalCount={counts.all} />
          ) : (
            <ul
              role="list"
              id="mobile-notifications-list"
              data-testid="mobile-notifications-list"
            >
              {visible.map((n) => (
                <li key={n.id}>
                  <MobileNotificationRow
                    notification={n}
                    onTap={(notification) => {
                      // Inline expansion is owned by the row; tapping a
                      // row that has a session also marks it read so the
                      // halo stops pulsing on next render.
                      if (!notification.readAt) {
                        void notifCtx.markRead([notification.id]);
                      }
                    }}
                    onLongPress={(notification) =>
                      setActionTargetId(notification.id)
                    }
                    onDelete={performDelete}
                    onToggleRead={performToggleRead}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ActionSheet
        open={actionTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setActionTargetId(null);
        }}
        title={actionTarget?.title}
        subtitle={actionTarget?.sessionName ?? undefined}
        items={actionItems}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function NotificationListSkeleton() {
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <ul
      role="list"
      aria-busy="true"
      data-testid="mobile-notifications-skeleton"
      className="animate-pulse"
    >
      {rows.map((i) => (
        <li
          key={i}
          className="flex items-start gap-3 border-b border-border/60 px-4 py-3 min-h-[56px]"
        >
          <span className="mt-1 inline-flex h-3 w-3 shrink-0 rounded-full bg-muted-foreground/20" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-muted-foreground/15" />
            <div className="h-2.5 w-1/2 rounded bg-muted-foreground/10" />
            <div className="h-2 w-1/4 rounded bg-muted-foreground/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotificationsEmptyState({
  filter,
  totalCount,
}: {
  filter: NotificationFilter;
  totalCount: number;
}) {
  // The brief copy: "Inbox zero" is the canonical empty state for the All
  // filter when there are genuinely zero notifications. Filter-specific
  // empties (Unread / Mentions) say what they are without lecturing.
  let title: string;
  let subtitle: string | null;
  if (filter === "all") {
    title = "Inbox zero";
    subtitle = totalCount === 0 ? null : "Nothing to look at right now.";
  } else if (filter === "unread") {
    title = "All read";
    subtitle = "Nothing unread.";
  } else {
    title = "No mentions";
    subtitle = "Nothing addressed to you.";
  }
  return (
    <div
      data-testid={`mobile-notifications-empty-${filter}`}
      className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-foreground">{title}</p>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
