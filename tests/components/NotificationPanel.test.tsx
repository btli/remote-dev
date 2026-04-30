import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import type { NotificationEvent } from "@/types/notification";

// The panel pulls everything off context; we stub it so we can drive the
// notifications array directly.
vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: vi.fn(),
}));

import { useNotificationContext } from "@/contexts/NotificationContext";

function makeNotification(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "n1",
    userId: "u1",
    sessionId: null,
    sessionName: null,
    type: "info",
    title: "Hello",
    body: null,
    readAt: null,
    createdAt: new Date("2026-04-30T12:00:00Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
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
