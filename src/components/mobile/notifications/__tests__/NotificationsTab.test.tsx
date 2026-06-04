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
import { notificationSeverity } from "@/types/notification";

// Pending-delete + scheduling now lives in NotificationContext (see P1-A
// fix). The test harness models the contract: scheduleDelete adds to the
// pending set and arms a fake timer; cancel + the timer firing both clear
// the pending flag. We expose the underlying maps so tests can assert
// state transitions without poking React internals.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface ScheduleOptions {
  onError?: (error: unknown) => void;
}

function makeScheduleDelete() {
  return vi.fn((id: string, delayMs: number, options?: ScheduleOptions) => {
    const existing = pendingTimers.get(id);
    if (existing) clearTimeout(existing);
    notifMockState.pendingDeleteIds = new Set(notifMockState.pendingDeleteIds);
    notifMockState.pendingDeleteIds.add(id);
    const timer = setTimeout(() => {
      pendingTimers.delete(id);
      notifMockState
        .deleteNotification(id)
        .catch((err: unknown) => {
          options?.onError?.(err);
        })
        .finally(() => {
          notifMockState.pendingDeleteIds = new Set(
            notifMockState.pendingDeleteIds
          );
          notifMockState.pendingDeleteIds.delete(id);
        });
    }, delayMs);
    pendingTimers.set(id, timer);
    return {
      cancel: () => {
        const t = pendingTimers.get(id);
        if (t) {
          clearTimeout(t);
          pendingTimers.delete(id);
        }
        notifMockState.pendingDeleteIds = new Set(
          notifMockState.pendingDeleteIds
        );
        notifMockState.pendingDeleteIds.delete(id);
      },
    };
  });
}

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
  pendingDeleteIds: new Set<string>(),
  scheduleDelete: makeScheduleDelete(),
  cancelDelete: vi.fn(),
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

// Reduced-motion is read by both the tab and the row; we mock it so we can
// flip it per-test for the indicator-variant assertions.
const reducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => reducedMotionMock(),
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
  const type = over.type ?? "agent_waiting";
  return {
    id: "n1",
    userId: "u1",
    sessionId: "s1",
    sessionName: "main",
    type,
    severity: notificationSeverity(type),
    title: "Agent needs you",
    body: "Approve the pending edit",
    count: 1,
    meta: null,
    readAt: null,
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
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
  notifMockState.pendingDeleteIds = new Set();
  notifMockState.scheduleDelete = makeScheduleDelete();
  notifMockState.cancelDelete = vi.fn();
  pendingTimers.clear();
  sessionMockState.setActiveSession = vi.fn();
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  reducedMotionMock.mockReset();
  reducedMotionMock.mockImplementation(() => false);
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

  it("preserves the deferred-delete timer when the tab unmounts mid-undo (context owns the timer, not the tab)", () => {
    // Regression for adversarial finding P1-A: tab unmount must not
    // silently cancel the pending server delete. The context owns the
    // timer, so the tab can come and go without affecting it.
    vi.useFakeTimers();
    try {
      const target = makeNotification({ id: "n1", title: "swipe-target" });
      notifMockState.notifications = [target];
      notifMockState.unreadCount = 1;
      const { unmount } = render(<NotificationsTab />);
      const row = screen.getByTestId("mobile-notification-row");
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
      fireEvent.touchEnd(row);

      // Simulate the tab unmounting partway through the 5s undo window
      // (e.g. the user switches to the Sessions tab in MobileApp).
      vi.advanceTimersByTime(2000);
      unmount();

      // The deferred delete must still fire after the remaining time.
      vi.advanceTimersByTime(3000);
      expect(notifMockState.deleteNotification).toHaveBeenCalledWith("n1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces an error toast and clears pendingDeleteIds when the deferred delete fails", async () => {
    // Regression for adversarial finding P1-B: a failing DELETE must not
    // leave the row hidden forever. The error path (a) shows a toast and
    // (b) removes the id from pendingDeleteIds so the row reappears.
    vi.useFakeTimers();
    try {
      notifMockState.deleteNotification = vi
        .fn()
        .mockRejectedValue(new Error("boom"));
      const target = makeNotification({ id: "n1", title: "swipe-target" });
      notifMockState.notifications = [target];
      notifMockState.unreadCount = 1;
      render(<NotificationsTab />);
      const row = screen.getByTestId("mobile-notification-row");
      fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
      fireEvent.touchEnd(row);

      // Trip the deferred delete; let microtasks settle so the rejection
      // propagates through .catch().finally().
      await vi.advanceTimersByTimeAsync(5000);

      expect(notifMockState.deleteNotification).toHaveBeenCalledWith("n1");
      const errorToast = toast.error as unknown as ReturnType<typeof vi.fn>;
      expect(errorToast).toHaveBeenCalledWith(
        "Failed to delete — restored.",
        expect.objectContaining({ id: "notif-delete-error:n1" })
      );
      // pendingDeleteIds was cleared in the .finally() path so the row is
      // no longer hidden — the harness rotates a fresh Set on each clear.
      expect(notifMockState.pendingDeleteIds.has("n1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-closes the ActionSheet when its target notification disappears from the list", async () => {
    // Regression for Codex re-review P2-1: if the long-pressed notification
    // is removed from `notifications` while the sheet is open (server
    // refresh deleted it, deferred-delete committed, etc.), the sheet
    // previously stayed open with no title and an empty item list — only
    // Cancel was visible. The fix derives the open state from the
    // *resolved* target so the sheet collapses on the same render.
    const target = makeNotification({ id: "n1", title: "long-press-me" });
    notifMockState.notifications = [target];
    notifMockState.unreadCount = 1;
    const { rerender } = render(<NotificationsTab />);

    // Open the action sheet via long-press.
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
    await waitFor(() => screen.getByTestId("mobile-action-sheet-items"), {
      timeout: 1500,
    });

    // Now simulate the underlying notification disappearing — e.g. a
    // server refresh removed it. Re-render with an empty list.
    notifMockState.notifications = [];
    rerender(<NotificationsTab />);

    // The sheet must collapse rather than rendering an empty Cancel-only
    // shell. The action items container is the load-bearing tell.
    await waitFor(() => {
      expect(screen.queryByTestId("mobile-action-sheet-items")).toBeNull();
    });
  });

  it("renders the static reduced-motion refresh indicator while pulling", async () => {
    // Regression for Codex re-review P2-3: under prefers-reduced-motion,
    // `pullDistance` is pinned to 0, so the *animated* indicator never
    // renders. Without a static fallback the user gets no feedback while
    // pulling. The fix renders a plain text indicator (data-variant="static")
    // when isPulling is true under reduced motion.
    reducedMotionMock.mockImplementation(() => true);
    notifMockState.notifications = [];
    render(<NotificationsTab />);
    const scroll = screen.getByTestId("mobile-notifications-scroll");
    Object.defineProperty(scroll, "scrollTop", { value: 0, configurable: true });
    fireEvent.touchStart(scroll, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scroll, { touches: [{ clientY: 200 }] });
    await waitFor(() => {
      const indicator = screen.getByTestId("mobile-notifications-refresh-indicator");
      expect(indicator).toHaveAttribute("data-variant", "static");
      expect(indicator).toHaveTextContent(/Pull to refresh/);
    });
    // Release: the static indicator goes away once the user stops pulling
    // (and threshold wasn't met, so no refresh fires).
    fireEvent.touchEnd(scroll);
    await waitFor(() => {
      expect(
        screen.queryByTestId("mobile-notifications-refresh-indicator")
      ).toBeNull();
    });
  });

  it("renders the animated refresh indicator (not static) when motion is allowed", async () => {
    reducedMotionMock.mockImplementation(() => false);
    notifMockState.notifications = [];
    render(<NotificationsTab />);
    const scroll = screen.getByTestId("mobile-notifications-scroll");
    Object.defineProperty(scroll, "scrollTop", { value: 0, configurable: true });
    fireEvent.touchStart(scroll, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scroll, { touches: [{ clientY: 200 }] });
    await waitFor(() => {
      const indicator = screen.getByTestId("mobile-notifications-refresh-indicator");
      expect(indicator).toHaveAttribute("data-variant", "animated");
    });
    fireEvent.touchEnd(scroll);
  });

  it("does not render the 'Clear all' button when there are no notifications", () => {
    notifMockState.notifications = [];
    render(<NotificationsTab />);
    expect(
      screen.queryByTestId("mobile-notifications-clear-all")
    ).toBeNull();
  });

  it("renders the 'Clear all' button when notifications exist", () => {
    notifMockState.notifications = [makeNotification()];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    expect(
      screen.getByTestId("mobile-notifications-clear-all")
    ).toBeInTheDocument();
  });

  it("'Clear all' opens a confirmation dialog and calls deleteAllNotifications on confirm", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [
      makeNotification({ id: "n1" }),
      makeNotification({ id: "n2" }),
    ];
    notifMockState.unreadCount = 2;
    render(<NotificationsTab />);

    // Tap the button: dialog opens but server delete must NOT have fired.
    await user.click(screen.getByTestId("mobile-notifications-clear-all"));
    expect(notifMockState.deleteAllNotifications).not.toHaveBeenCalled();

    // Confirm in the dialog.
    const confirm = await screen.findByTestId(
      "mobile-notifications-clear-all-confirm"
    );
    await user.click(confirm);
    expect(notifMockState.deleteAllNotifications).toHaveBeenCalledTimes(1);

    // Success toast lands with a stable id.
    const toastFn = toast as unknown as ReturnType<typeof vi.fn>;
    const calls = toastFn.mock.calls.map((c) => c[0]);
    expect(
      calls.some((m) => typeof m === "string" && /Cleared 2 notifications/.test(m))
    ).toBe(true);
  });

  it("'Clear all' Cancel does not invoke deleteAllNotifications", async () => {
    const user = userEvent.setup();
    notifMockState.notifications = [makeNotification()];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);
    await user.click(screen.getByTestId("mobile-notifications-clear-all"));
    // Dismiss with the AlertDialog Cancel button.
    const cancel = await screen.findByRole("button", { name: /Cancel/i });
    await user.click(cancel);
    expect(notifMockState.deleteAllNotifications).not.toHaveBeenCalled();
  });

  it("'Clear all' surfaces an error toast and re-enables the button when deleteAllNotifications rejects", async () => {
    const user = userEvent.setup();
    notifMockState.deleteAllNotifications = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    notifMockState.notifications = [makeNotification()];
    notifMockState.unreadCount = 1;
    render(<NotificationsTab />);

    const button = screen.getByTestId("mobile-notifications-clear-all");
    await user.click(button);
    const confirm = await screen.findByTestId(
      "mobile-notifications-clear-all-confirm"
    );
    await user.click(confirm);

    // Error toast lands with the stable id.
    const errorToast = toast.error as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        "Couldn't clear notifications.",
        expect.objectContaining({ id: "notif-clear-all-error" })
      );
    });

    // Dialog closes after the rejection settles.
    await waitFor(() => {
      expect(
        screen.queryByTestId("mobile-notifications-clear-all-confirm")
      ).toBeNull();
    });

    // Button re-enabled (not stuck in the in-flight disabled state) — the
    // user can retry.
    expect(
      screen.getByTestId("mobile-notifications-clear-all")
    ).not.toBeDisabled();
  });

  it("renders the error banner when refresh() rejects via pull-to-refresh", async () => {
    // Regression for adversarial finding P2-E: the tab has an error
    // banner UI but the old `refresh()` swallowed errors. With the new
    // contract, refresh propagates and the banner renders.
    notifMockState.refresh = vi.fn().mockRejectedValue(new Error("offline"));
    notifMockState.notifications = [];
    render(<NotificationsTab />);
    // Drive the pull-to-refresh path directly. The hook's onRefresh is
    // wired to handleRefresh which awaits refresh() and sets the banner
    // on rejection. We simulate the refresh by invoking refresh
    // ourselves through a tiny shim: the hook already exercises the
    // happy path elsewhere; here we just need the error banner to land.
    //
    // The cleanest path is to call the refresh directly via the
    // notification context mock and assert the tab renders the error.
    // Pull-to-refresh fires handleRefresh on the hook; rather than
    // simulate touches at the right offsets, we exercise the same code
    // path by triggering the markAllRead button (which doesn't call
    // refresh) — instead, drive it via a known UI: the error banner is
    // populated from handleRefresh's catch. We reproduce that by
    // dispatching pull-to-refresh on the scroll container.
    const scroll = screen.getByTestId("mobile-notifications-scroll");
    Object.defineProperty(scroll, "scrollTop", { value: 0, configurable: true });
    fireEvent.touchStart(scroll, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scroll, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(scroll);
    // The banner appears once the rejected refresh promise settles.
    await waitFor(() => {
      expect(screen.getByTestId("mobile-notifications-error")).toHaveTextContent(
        /Couldn't load notifications/
      );
    });
  });
});
