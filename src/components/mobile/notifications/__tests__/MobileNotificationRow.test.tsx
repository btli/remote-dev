/**
 * MobileNotificationRow tests (Phase 4 mobile redesign).
 *
 * Verifies the leading-dot unread state replaces the desktop side-stripe,
 * the halo only renders for `agent_waiting` rows, swipes dispatch the
 * correct callbacks, long-press fires the action sheet handler, and inline
 * expansion toggles the body's truncate.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { MobileNotificationRow } from "@/components/mobile/notifications/MobileNotificationRow";
import type { NotificationEvent } from "@/types/notification";

afterEach(() => cleanup());

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

describe("MobileNotificationRow", () => {
  it("renders the leading dot in the solid attention color when unread", () => {
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const dot = screen.getByTestId("mobile-notification-dot");
    expect(dot.className).toMatch(/bg-\[var\(--color-signal-attention-solid\)\]/);
    // Halo present for agent_waiting + unread.
    expect(screen.queryByTestId("mobile-notification-halo")).not.toBeNull();
  });

  it("does not color the dot when the notification is read", () => {
    render(
      <MobileNotificationRow
        notification={makeNotification({ readAt: new Date() })}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const dot = screen.getByTestId("mobile-notification-dot");
    expect(dot.className).toMatch(/bg-transparent/);
    expect(screen.queryByTestId("mobile-notification-halo")).toBeNull();
  });

  it("does not render the halo for non-agent_waiting notifications even when unread", () => {
    render(
      <MobileNotificationRow
        notification={makeNotification({ type: "info" })}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    expect(screen.queryByTestId("mobile-notification-halo")).toBeNull();
    // But the dot still reads as unread.
    const dot = screen.getByTestId("mobile-notification-dot");
    expect(dot.className).toMatch(/bg-\[var\(--color-signal-attention-solid\)\]/);
  });

  it("does NOT render a colored side-stripe (no border-l-2)", () => {
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    // Tailwind "border-l-2" or any colored side-border class must be absent.
    expect(row.className).not.toMatch(/border-l-/);
    // bg-card (flat) is the unread treatment.
    expect(row.className).toMatch(/bg-card/);
  });

  it("dispatches onDelete when swiped left past threshold", () => {
    const onDelete = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={onDelete}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 60, clientY: 30 }] });
    fireEvent.touchEnd(row);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("dispatches onToggleRead when swiped right past threshold", () => {
    const onToggleRead = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={onToggleRead}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 30 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 200, clientY: 30 }] });
    fireEvent.touchEnd(row);
    expect(onToggleRead).toHaveBeenCalledTimes(1);
  });

  it("does NOT dispatch onDelete when the gesture is mostly vertical", () => {
    const onDelete = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={onDelete}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 30 }] });
    // Mostly vertical movement should be claimed by the scroll container.
    fireEvent.touchMove(row, { touches: [{ clientX: 180, clientY: 200 }] });
    fireEvent.touchEnd(row);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("opens the action sheet handler on long-press", async () => {
    const onLongPress = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={onLongPress}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
    await waitFor(() => expect(onLongPress).toHaveBeenCalled(), {
      timeout: 1500,
    });
  });

  it("toggles inline body expansion on tap when body exists", () => {
    const onTap = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification({ body: "Long body content" })}
        onTap={onTap}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    const body = screen.getByTestId("mobile-notification-body");
    expect(body.dataset.expanded).toBe("false");
    fireEvent.click(row);
    expect(body.dataset.expanded).toBe("true");
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
