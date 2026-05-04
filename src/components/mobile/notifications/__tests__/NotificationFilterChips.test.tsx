/**
 * NotificationFilterChips tests (Phase 4 mobile redesign).
 *
 * Verifies that the three filter chips render their counts correctly,
 * fire onChange with the right id, and apply active state via
 * `data-active` rather than via a colored side-stripe.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  NotificationFilterChips,
  type NotificationFilter,
} from "@/components/mobile/notifications/NotificationFilterChips";

afterEach(() => cleanup());

describe("NotificationFilterChips", () => {
  it("renders all three chips with correct labels", () => {
    render(
      <NotificationFilterChips
        active="all"
        onChange={vi.fn()}
        counts={{ all: 5, unread: 2, mentions: 1 }}
      />
    );
    expect(screen.getByRole("tab", { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Unread/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Mentions/ })).toBeInTheDocument();
  });

  it("marks the active chip with aria-selected and data-active", () => {
    render(
      <NotificationFilterChips
        active="unread"
        onChange={vi.fn()}
        counts={{ all: 5, unread: 2, mentions: 1 }}
      />
    );
    const unread = screen.getByRole("tab", { name: /Unread/ });
    expect(unread.getAttribute("aria-selected")).toBe("true");
    expect((unread as HTMLElement).dataset.active).toBe("true");
    const all = screen.getByRole("tab", { name: /All/ });
    expect(all.getAttribute("aria-selected")).toBe("false");
  });

  it("renders count pills only for unread/mentions when count > 0", () => {
    render(
      <NotificationFilterChips
        active="all"
        onChange={vi.fn()}
        counts={{ all: 5, unread: 2, mentions: 0 }}
      />
    );
    // All chip never shows a count pill (its count is implicit).
    expect(screen.queryByTestId("mobile-notification-filter-count-all")).toBeNull();
    expect(
      screen.getByTestId("mobile-notification-filter-count-unread")
    ).toHaveTextContent("2");
    // Mentions has 0 → no pill.
    expect(
      screen.queryByTestId("mobile-notification-filter-count-mentions")
    ).toBeNull();
  });

  it("clamps counts at 99+", () => {
    render(
      <NotificationFilterChips
        active="all"
        onChange={vi.fn()}
        counts={{ all: 200, unread: 150, mentions: 100 }}
      />
    );
    expect(
      screen.getByTestId("mobile-notification-filter-count-unread")
    ).toHaveTextContent("99+");
  });

  it("calls onChange with the new filter id when a chip is tapped", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(next: NotificationFilter) => void>();
    render(
      <NotificationFilterChips
        active="all"
        onChange={onChange}
        counts={{ all: 5, unread: 2, mentions: 1 }}
      />
    );
    await user.click(screen.getByRole("tab", { name: /Mentions/ }));
    expect(onChange).toHaveBeenCalledWith("mentions");
  });
});
