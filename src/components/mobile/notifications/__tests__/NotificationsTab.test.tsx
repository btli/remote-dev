/**
 * NotificationsTab integration tests (Phase 4 mobile redesign).
 *
 * Verifies the tab orchestrates filter chips + row gestures + ActionSheet
 * correctly: empty state copy, mark-all-read, swipe-delete fires undo
 * toast, long-press opens the action sheet with the right items, and
 * "Jump to session" sets the active session and switches the tab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationsTab } from "@/components/mobile/notifications/NotificationsTab";
import type { NotificationEvent } from "@/types/notification";

const notifMockState = {
  notifications: [] as NotificationEvent[],
  unreadCount: 0,
  loading: false,
  refresh: vi.fn().mockResolvedValue(undefined),
  markRead: vi.fn().mockResolvedValue(undefined),
  markAllRead: vi.fn().mockResolvedValue(undefined),
  deleteNotification: vi.fn().mockResolvedValue(undefined),
  deleteAllNotifications: vi.fn().mockResolvedValue(undefined),
  addNotification: vi.fn(),
  registerJumpHandler: vi.fn(),
  latestUnreadSessionId: null as string | null,
};

const sessionMockState = {
  setActiveSession: vi.fn(),
};

vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: () => notifMockState,
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => sessionMockState,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
  }),
}));

import { toast } from "sonner";

function makeNotification(
  over: Partial<NotificationEvent> = {}
): NotificationEvent {
  return {
    id: "n1",
    userId: "u1",
    sessionId: "s1",
    sessionName: "main",
    type: "agent_waiting",
    title: "Agent needs you",
    body: "Approve the pending edit",
    readAt: null,
    createdAt: new Date(Date.now() - 60_000),
    ...over,
  };
}

beforeEach(() => {
  notifMockState.notifications = [];
  notifMockState.unreadCount = 0;
  notifMockState.loading = false;
  notifMockState.refresh = vi.fn().mockResolvedValue(undefined);
  notifMockState.markRead = vi.fn().mockResolvedValue(undefined);
  notifMockState.markAllRead = vi.fn().mockResolvedValue(undefined);
  notifMockState.deleteNotification = vi.fn().mockResolvedValue(undefined);
  notifMockState.addNotification = vi.fn();
  notifMockState.latestUnreadSessionId = null;
  sessionMockState.setActiveSession = vi.fn();
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => cleanup());

describe("NotificationsTab", () => {
  it("renders 'Inbox zero' empty state when there are no notifications", () => {
    render(<NotificationsTab />);
    expect(screen.getByTestId("mobile-notifications-empty-all")).toHaveTextContent(
      /Inbox zero/
    );
  });

  it("renders the filter chips with the correct unread/mention counts", () => {
    notifMockState.notifications = [
      makeNotification({ id: "n1", type: "agent_waiting" }),
      makeNotification({
        id: "n2",
        type: "info",
        title: "New peer message from @alice",
        body: "Hey",
      }),
      makeNotification({
        id: "n3",
        type: "info",
        title: "System update",
        body: "Restart pending",
        readAt: new Date(),
      }),
    ];
    notifMockState.unreadCount = 2;
    render(<NotificationsTab />);
    // Unread count = 2 (n1, n2).
    expect(
      screen.getByTestId("mobile-notification-filter-count-unread")
    ).toHaveTextContent("2");
    // Mentions count = 1 (n2 has @alice).
    expect(
      screen.getByTestId("mobile-notification-filter-count-mentions")
    ).toHaveTextContent("1");
  });

  it("filters to unread when the Unread chip is tapped", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [
      makeNotification({ id: "n1", type: "agent_waiting" }),
      makeNotification({
        id: "n2",
        type: "info",
        title: "Already read",
        readAt: new Date(),
      }),
    ];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    expect(screen.getAllByTestId("mobile-notification-row")).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: /Unread/ }));
    const rows = screen.getAllByTestId("mobile-notification-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataset.notificationId).toBe("n1");
  });

  it("filters to mentions when the Mentions chip is tapped", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [
      makeNotification({ id: "n1", type: "agent_waiting" }),
      makeNotification({
        id: "n2",
        type: "info",
        title: "From @bob",
        body: "ping",
      }),
    ];
    notifMockState.unreadCount = 2;
    render(<NotificationsTab />);
    await user.click(screen.getByRole("tab", { name: /Mentions/ }));
    const rows = screen.getAllByTestId("mobile-notification-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataset.notificationId).toBe("n2");
  });

  it("shows 'No mentions' empty state when mentions filter is empty", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [
      makeNotification({ id: "n1", type: "agent_waiting" }),
    ];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    await user.click(screen.getByRole("tab", { name: /Mentions/ }));
    expect(
      screen.getByTestId("mobile-notifications-empty-mentions")
    ).toHaveTextContent(/No mentions/);
  });

  it("shows the 'Mark all read' button only when there are unread items", () => {
    notifMockState.notifications = [
      makeNotification({ id: "n1", readAt: new Date() }),
    ];
    notifMockState.unreadCount = 0;
    const { rerender } = render(<NotificationsTab />);
    expect(
      screen.queryByTestId("mobile-notifications-mark-all-read")
    ).toBeNull();
    notifMockState.unreadCount = 3;
    notifMockState.notifications = [makeNotification({ id: "n1" })];
    rerender(<NotificationsTab />);
    expect(
      screen.getByTestId("mobile-notifications-mark-all-read")
    ).toBeInTheDocument();
  });

  it("calls markAllRead when 'Mark all read' is tapped", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [makeNotification()];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    await user.click(screen.getByTestId("mobile-notifications-mark-all-read"));
    expect(notifMockState.markAllRead).toHaveBeenCalled();
  });

  it("hides the row optimistically and shows an undo toast on swipe-left, deferring the server delete by 5s", () => {
    vi.useFakeTimers();
    try {
      const target = makeNotification({ id: "n1", title: "swipe-target" });
      notifMockState.notifications = [target];
      notifMockState.unreadCount = 1;
      render(<NotificationsTab />);
      const row = screen.getByTestId("mobile-notification-row");
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
      fireEvent.touchEnd(row);

      // Server delete is deferred — must NOT be called immediately.
      expect(notifMockState.deleteNotification).not.toHaveBeenCalled();

      // Toast invoked with the 5s undo action and a stable id.
      const toastFn = toast as unknown as ReturnType<typeof vi.fn>;
      expect(toastFn).toHaveBeenCalled();
      const lastCall = toastFn.mock.calls[toastFn.mock.calls.length - 1];
      expect(lastCall?.[0]).toContain("swipe-target");
      expect(lastCall?.[1]?.id).toBe("notif-delete:n1");
      expect(lastCall?.[1]?.duration).toBe(5000);
      expect(lastCall?.[1]?.action?.label).toBe("Undo");

      // After 5s, the deferred delete fires.
      vi.advanceTimersByTime(5000);
      expect(notifMockState.deleteNotification).toHaveBeenCalledWith("n1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Undo cancels the deferred delete entirely (no server call) when pressed within 5s", () => {
    vi.useFakeTimers();
    try {
      const target = makeNotification({ id: "n1", title: "swipe-target" });
      notifMockState.notifications = [target];
      notifMockState.unreadCount = 1;
      render(<NotificationsTab />);
      const row = screen.getByTestId("mobile-notification-row");
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
      fireEvent.touchEnd(row);

      // Grab the Undo handler off the toast call.
      const toastFn = toast as unknown as ReturnType<typeof vi.fn>;
      const lastCall = toastFn.mock.calls[toastFn.mock.calls.length - 1];
      const undo = lastCall?.[1]?.action?.onClick as (() => void) | undefined;
      expect(typeof undo).toBe("function");

      // Press Undo before the timer fires, then drain the timer queue.
      undo?.();
      vi.advanceTimersByTime(5000);

      // Server delete must not have been called at all.
      expect(notifMockState.deleteNotification).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches markRead on swipe-right when the row is unread", () => {
    notifMockState.notifications = [makeNotification({ id: "n1" })];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 30 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 200, clientY: 30 }] });
    fireEvent.touchEnd(row);
    expect(notifMockState.markRead).toHaveBeenCalledWith(["n1"]);
  });

  it("opens the action sheet on long-press with the canonical items", async () => {
    notifMockState.notifications = [makeNotification({ id: "n1" })];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
    await waitFor(
      () => screen.getByTestId("mobile-action-sheet-items"),
      { timeout: 1500 }
    );
    const items = screen.getByTestId("mobile-action-sheet-items");
    expect(within(items).getByText("Jump to session")).toBeInTheDocument();
    expect(within(items).getByText("Mark read")).toBeInTheDocument();
    expect(within(items).getByText("Mute project")).toBeInTheDocument();
    expect(within(items).getByText("Dismiss")).toBeInTheDocument();
  });

  it("'Jump to session' marks read, sets active session, and switches tab", async () => {
    const user = userEvent.setup();
    const onSwitchTab = vi.fn();
    notifMockState.notifications = [
      makeNotification({ id: "n1", sessionId: "s1" }),
    ];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab onSwitchTab={onSwitchTab} />);
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
    await waitFor(() => screen.getByTestId("mobile-action-sheet-items"), {
      timeout: 1500,
    });
    await user.click(screen.getByRole("menuitem", { name: "Jump to session" }));
    expect(notifMockState.markRead).toHaveBeenCalledWith(["n1"]);
    expect(sessionMockState.setActiveSession).toHaveBeenCalledWith("s1");
    expect(onSwitchTab).toHaveBeenCalledWith("sessions");
  });
});
