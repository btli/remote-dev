/**
 * MobileApp tests — verifies the mobile composition root coordinates
 * the bottom tab bar with the thread takeover state.
 *
 * Specifically:
 *  - When a thread is open inside the Channels tab, the BottomTabBar is
 *    forced hidden so it doesn't paint over the reply composer.
 *  - Switching tabs while a thread is open dismisses the thread so it
 *    doesn't get stranded behind a sibling tab.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

import type { ReactNode } from "react";

const channelState = {
  totalUnreadCount: 0,
  openThreadId: null as string | null,
  closeThread: vi.fn(),
};

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContextOptional: () => channelState,
}));

vi.mock("@/hooks/useMobile", () => ({
  useIsMobileViewport: () => true,
  usePrefersReducedMotion: () => true,
}));

// Stub out the heavy tab content modules — we only care about MobileApp
// wiring forceHidden + onTabChange to MobileShell here.
vi.mock("../sessions/SessionsTab", () => ({
  SessionsTab: () => <div data-testid="stub-sessions-tab" />,
}));
vi.mock("../channels/ChannelsTab", () => ({
  ChannelsTab: () => <div data-testid="stub-channels-tab" />,
}));

// Capture the props MobileShell receives so we can assert on them.
const shellProps: { current: { forceHidden?: boolean; onTabChange?: (t: string) => void } } = {
  current: {},
};
vi.mock("../MobileShell", () => ({
  MobileShell: ({
    children,
    onTabChange,
    forceHidden,
  }: {
    children: ReactNode;
    onTabChange: (t: string) => void;
    forceHidden?: boolean;
  }) => {
    shellProps.current = { forceHidden, onTabChange };
    return (
      <div
        data-testid="stub-mobile-shell"
        data-force-hidden={forceHidden ? "true" : "false"}
      >
        <button
          type="button"
          data-testid="stub-tab-channels"
          onClick={() => onTabChange("channels")}
        />
        <button
          type="button"
          data-testid="stub-tab-sessions"
          onClick={() => onTabChange("sessions")}
        />
        {children}
      </div>
    );
  },
}));

import { MobileApp } from "../MobileApp";

beforeEach(() => {
  channelState.openThreadId = null;
  channelState.totalUnreadCount = 0;
  channelState.closeThread.mockClear();
  shellProps.current = {};
});

afterEach(() => cleanup());

describe("MobileApp", () => {
  it("forces the bottom tab bar hidden while a thread is open in Channels", () => {
    channelState.openThreadId = "m1";
    const { getByTestId } = render(<MobileApp isGitHubConnected={false} />);
    // Default tab is sessions — forceHidden stays false even with a thread
    // open in the (currently inactive) Channels tab.
    expect(getByTestId("stub-mobile-shell").dataset.forceHidden).toBe("false");

    // Switch to channels — now the takeover would render and the bar must
    // hide so it doesn't cover the composer.
    fireEvent.click(getByTestId("stub-tab-channels"));
    expect(getByTestId("stub-mobile-shell").dataset.forceHidden).toBe("true");
  });

  it("closes any open thread when switching tabs", () => {
    channelState.openThreadId = "m1";
    const { getByTestId } = render(<MobileApp isGitHubConnected={false} />);
    // From sessions → channels: thread is still open, but we still close
    // it on the way out so it doesn't get stranded behind another tab.
    fireEvent.click(getByTestId("stub-tab-channels"));
    expect(channelState.closeThread).toHaveBeenCalledTimes(1);
  });

  it("does not call closeThread when the tab does not change", () => {
    channelState.openThreadId = "m1";
    const { getByTestId } = render(<MobileApp isGitHubConnected={false} />);
    fireEvent.click(getByTestId("stub-tab-sessions"));
    expect(channelState.closeThread).not.toHaveBeenCalled();
  });
});
