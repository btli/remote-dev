import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import type { NotificationEvent } from "@/types/notification";
import { notificationSeverity } from "@/types/notification";

// The panel pulls everything off context; we stub it so we can drive the
// notifications array directly.
vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
  }),
}));

import { useNotificationContext } from "@/contexts/NotificationContext";
import { toast } from "sonner";

function makeNotification(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  const type = overrides.type ?? "info";
  return {
    id: "n1",
    userId: "u1",
    sessionId: null,
    sessionName: null,
    type,
    severity: notificationSeverity(type),
    title: "Hello",
    body: null,
    count: 1,
    meta: null,
    readAt: null,
    createdAt: new Date("2026-04-30T12:00:00Z"),
    updatedAt: new Date("2026-04-30T12:00:00Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("NotificationPanel unread dot", () => {
  it("uses the solid signal-attention token (not the alpha-blended halo token)", () => {
    // The alpha token (`--color-signal-attention`) is intentionally
    // 80%-alpha for the agent-needs-attention halo. Using it as a solid
    // fill on bg-card washes the dot out in light mode. The dot must
    // reach for `--color-signal-attention-solid` instead.
    vi.mocked(useNotificationContext).mockReturnValue({
      notifications: [makeNotification()],
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      deleteNotification: vi.fn(),
      deleteAllNotifications: vi.fn(),
      unreadCount: 1,
      // Extra fields the real context exposes; the panel doesn't read them
      // but we keep the mock structurally compatible.
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useNotificationContext>);

    render(
      <NotificationPanel
        open
        onOpenChange={() => {}}
        onJumpToSession={() => {}}
      />
    );

    const dot = screen.getByTestId("notification-unread-dot");
    expect(dot.className).toContain("bg-[var(--color-signal-attention-solid)]");
    expect(dot.className).not.toContain("bg-[var(--color-signal-attention)]");
  });

  it("surfaces a toast and does not throw when 'Clear all' rejects", async () => {
    // Regression for the Codex re-review P1 finding: deleteAllNotifications
    // now propagates server failures (so callers can react), but the desktop
    // 'Clear all' button still called it bare. A failed clear-all produced
    // an unhandled rejected promise from a click handler. The fix wraps the
    // call with `.catch()` and surfaces a sonner toast.
    //
    // The clear-all action now opens an AlertDialog first; the destructive
    // call only fires when the confirm button inside the dialog is clicked.
    const deleteAll = vi.fn().mockRejectedValue(new Error("boom"));
    vi.mocked(useNotificationContext).mockReturnValue({
      notifications: [makeNotification()],
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      deleteNotification: vi.fn(),
      deleteAllNotifications: deleteAll,
      unreadCount: 0,
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useNotificationContext>);

    render(
      <NotificationPanel
        open
        onOpenChange={() => {}}
        onJumpToSession={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));

    // The dialog renders an AlertDialogAction labeled "Clear all" as well;
    // confirm via that one. waitFor accommodates the Radix open transition.
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(
      screen.getAllByRole("button", { name: /Clear all/ }).at(-1)!
    );

    await waitFor(() => {
      expect(deleteAll).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to clear notifications",
        expect.objectContaining({ id: "notif-clear-all-error" })
      );
    });
    expect(confirm).toBeTruthy();
  });

  it("does not call deleteAllNotifications when 'Clear all' is cancelled", async () => {
    const deleteAll = vi.fn();
    vi.mocked(useNotificationContext).mockReturnValue({
      notifications: [makeNotification()],
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      deleteNotification: vi.fn(),
      deleteAllNotifications: deleteAll,
      unreadCount: 0,
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useNotificationContext>);

    render(
      <NotificationPanel
        open
        onOpenChange={() => {}}
        onJumpToSession={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));

    expect(deleteAll).not.toHaveBeenCalled();
  });

  it("renders a transparent placeholder dot when the notification is read", () => {
    vi.mocked(useNotificationContext).mockReturnValue({
      notifications: [makeNotification({ readAt: new Date() })],
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      deleteNotification: vi.fn(),
      deleteAllNotifications: vi.fn(),
      unreadCount: 0,
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useNotificationContext>);

    render(
      <NotificationPanel
        open
        onOpenChange={() => {}}
        onJumpToSession={() => {}}
      />
    );

    const dot = screen.getByTestId("notification-unread-dot");
    expect(dot.className).toContain("bg-transparent");
  });
});
