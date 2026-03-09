"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCheck } from "lucide-react";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { NotificationEvent } from "@/types/notification";

interface NotificationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToSession: (sessionId: string) => void;
}

export function NotificationPanel({ open, onOpenChange, onJumpToSession }: NotificationPanelProps) {
  const { notifications, markRead, markAllRead, unreadCount } = useNotificationContext();

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
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0">
        <SheetHeader className="flex flex-row items-center justify-between p-6 pb-2">
          <SheetTitle>Notifications</SheetTitle>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAllRead()} className="text-xs">
              <CheckCheck className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </SheetHeader>
        <div className="px-4 pb-4 space-y-1 overflow-y-auto max-h-[calc(100vh-120px)]">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notifications yet</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors",
                  !n.readAt && "border-l-2 border-blue-400 bg-blue-400/5"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-muted-foreground truncate">{n.body}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    {n.sessionName && (
                      <span className="text-[10px] text-muted-foreground/60">{n.sessionName}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40">{formatRelativeTime(n.createdAt.toISOString())}</span>
                  </div>
                </div>
                {n.sessionId && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleJump(n)}>
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
