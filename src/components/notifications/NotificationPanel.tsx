"use client";

import { toast } from "sonner";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ExternalLink, CheckCheck, Trash2, X } from "lucide-react";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { NotificationEvent } from "@/types/notification";

interface NotificationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToSession: (sessionId: string) => void;
}

export function NotificationPanel({ open, onOpenChange, onJumpToSession }: NotificationPanelProps) {
  const {
    notifications,
    markRead,
    markAllRead,
    deleteNotification,
    deleteAllNotifications,
    unreadCount,
  } = useNotificationContext();

  const handleJump = (notification: NotificationEvent) => {
    if (notification.sessionId) {
      onJumpToSession(notification.sessionId);
      if (!notification.readAt) {
        markRead([notification.id]);
      }
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[380px] sm:w-[420px] p-0 bg-popover/95 backdrop-blur-xl border-l border-border"
      >
        <SheetHeader className="flex flex-row items-center justify-between p-4 pb-2 border-b border-border/50">
          <SheetTitle className="text-sm font-semibold">Notifications</SheetTitle>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllRead()}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="w-3 h-3 mr-1" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear all
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {`This will permanently dismiss all ${notifications.length} notification${
                        notifications.length === 1 ? "" : "s"
                      }. This action cannot be undone.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className={cn(buttonVariants({ variant: "destructive" }))}
                      onClick={() => {
                        // deleteAllNotifications() rejects on server failure;
                        // without a catch this becomes an unhandled rejection
                        // from a React click handler. The context already
                        // re-fetches on failure so the rows reappear; we just
                        // need to surface a toast.
                        void deleteAllNotifications().catch(() => {
                          toast.error("Failed to clear notifications", {
                            id: "notif-clear-all-error",
                          });
                        });
                      }}
                    >
                      Clear all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </SheetHeader>

        <div className="px-3 py-2 space-y-0.5 overflow-y-auto max-h-[calc(100vh-80px)]">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No notifications
            </p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "group flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors",
                  // Unread state: leading attention-blue dot + flat bg-card.
                  // No side-stripe per DESIGN.md "No Side-Stripe Rule".
                  !n.readAt && "bg-card"
                )}
              >
                {/* Leading 12px (6px radius) dot in signal-attention.
                    Render even when read, but only color it when unread, so
                    the title alignment stays stable across rows. */}
                <span
                  data-testid="notification-unread-dot"
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 h-3 w-3 shrink-0 rounded-full",
                    // Solid variant for the dot — the alpha-blended
                    // `--color-signal-attention` is intentional for the
                    // halo glow but washes out against bg-card in light
                    // mode when used as a solid fill.
                    !n.readAt
                      ? "bg-[var(--color-signal-attention-solid)]"
                      : "bg-transparent"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    {n.sessionName && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {n.sessionName}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40">
                      {formatRelativeTime(n.createdAt.toISOString())}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {n.sessionId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleJump(n)}
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      void deleteNotification(n.id).catch(() => {
                        /* error already logged in context; row will reappear on refresh */
                      });
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
