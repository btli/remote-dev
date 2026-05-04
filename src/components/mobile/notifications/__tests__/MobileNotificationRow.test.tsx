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

// Mock the reduced-motion hook so individual tests can opt into the
// reduced-motion code path. Default = false so the halo test below still
// renders the halo for unread agent_waiting rows.
const reducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => reducedMotionMock(),
}));

afterEach(() => {
  cleanup();
  reducedMotionMock.mockReset();
  reducedMotionMock.mockImplementation(() => false);
});

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
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(body.dataset.expanded).toBe("true");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("omits aria-expanded when there is no expandable body", () => {
    render(
      <MobileNotificationRow
        notification={makeNotification({ body: null })}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    const row = screen.getByTestId("mobile-notification-row");
    expect(row.hasAttribute("aria-expanded")).toBe(false);
  });

  it("does NOT render the halo when prefers-reduced-motion is set", () => {
    reducedMotionMock.mockImplementation(() => true);
    render(
      <MobileNotificationRow
        notification={makeNotification()}
        onTap={vi.fn()}
        onLongPress={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
      />
    );
    // The dot is still rendered (unread treatment), but the halo sibling
    // must be omitted entirely so reduced-motion users don't see the
    // pulse animation.
    expect(screen.queryByTestId("mobile-notification-halo")).toBeNull();
    const dot = screen.getByTestId("mobile-notification-dot");
    expect(dot.className).toMatch(/bg-\[var\(--color-signal-attention-solid\)\]/);
  });

  it("suppresses the synthetic click that fires after long-press releases", async () => {
    // Regression for adversarial finding P1-C: on touch devices a
    // touchend → click sequence is dispatched by the browser. If we don't
    // suppress that click, the row's tap handler runs immediately after
    // the long-press fires — which on an unread row marks it as read,
    // potentially yanking the action sheet's target row out of the
    // Unread filter while the sheet is still open.
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification({ body: "Long body" })}
        onTap={onTap}
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
    // The synthetic click that follows the long-press release must not
    // run the row's onTap or toggle expansion.
    fireEvent.mouseUp(row);
    fireEvent.click(row);
    expect(onTap).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-expanded")).toBe("false");

    // A subsequent genuine click clears the suppression flag and runs
    // the tap handler normally.
    fireEvent.click(row);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("clears the long-press flag automatically if the synthetic click is intercepted", async () => {
    // Regression for Codex re-review P2-2: longPressFiredRef is set true
    // when long-press fires. It only resets *inside* handleClick — but the
    // synthetic click that follows long-press release can be swallowed by
    // the ActionSheet's overlay before it ever reaches the row, which
    // would leave the flag stuck true and silently swallow the next
    // legitimate tap. The fix arms a 350ms safety timer that clears the
    // flag if no click arrives.
    vi.useFakeTimers();
    try {
      const onTap = vi.fn();
      const onLongPress = vi.fn();
      render(
        <MobileNotificationRow
          notification={makeNotification({ body: "Long body" })}
          onTap={onTap}
          onLongPress={onLongPress}
          onDelete={vi.fn()}
          onToggleRead={vi.fn()}
        />
      );
      const row = screen.getByTestId("mobile-notification-row");
      fireEvent.mouseDown(row, { clientX: 30, clientY: 30, button: 0 });
      // Fake-timer the 600ms long-press hold.
      await vi.advanceTimersByTimeAsync(700);
      expect(onLongPress).toHaveBeenCalledTimes(1);

      // Simulate the post-long-press synthetic click being eaten by an
      // overlay (so it never reaches the row). Before the fix, the flag
      // would stay true forever; now a 350ms safety timer resets it.
      await vi.advanceTimersByTimeAsync(400);

      // A genuine tap arriving after the safety window should run normally.
      fireEvent.click(row);
      expect(onTap).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT dispatch onToggleRead when swiped right on a read row", () => {
    const onToggleRead = vi.fn();
    render(
      <MobileNotificationRow
        notification={makeNotification({ readAt: new Date() })}
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
    // Right-swipe is gated off for read rows — no callback fires.
    expect(onToggleRead).not.toHaveBeenCalled();
  });
});
