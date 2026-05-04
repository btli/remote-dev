/**
 * MobileApp tests — Phase 2 → Phase 6 mobile composition root.
 *
 * Covers two contracts:
 *
 * 1. Auth gating (Phase 6): the *server-passed* `initialUser` prop is the
 *    source of truth for mobile auth gating, NOT the NextAuth client
 *    `useSession()` status. This regression test exists because Cloudflare
 *    Access users have no NextAuth client session — `useSession()` returns
 *    `unauthenticated` for them — so a previous build of this component
 *    locked CF users out of the mobile UI entirely.
 *
 * 2. Channels thread takeover (Phase 5): when a thread is open inside the
 *    Channels tab, the BottomTabBar is forced hidden so it doesn't paint
 *    over the reply composer; switching tabs while a thread is open
 *    dismisses the thread so it doesn't get stranded behind a sibling tab.
 *
 * Heavy tab-content modules are stubbed so we can assert on the wiring
 * MobileApp performs without pulling in the real context tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

import { MobileApp } from "@/components/mobile/MobileApp";

// ---------------------------------------------------------------------------
// next-auth: simulate Cloudflare Access (no NextAuth client session) by
// default; tests can override per-case.
// ---------------------------------------------------------------------------
const useSessionMock = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

// ---------------------------------------------------------------------------
// ChannelContext mock — drives the thread-takeover assertions.
// ---------------------------------------------------------------------------
const channelState = {
  totalUnreadCount: 0,
  openThreadId: null as string | null,
  closeThread: vi.fn(),
};
vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContextOptional: () => channelState,
}));

// ---------------------------------------------------------------------------
// useFirstRun: skip the welcome screen so tab-shell assertions run.
// ---------------------------------------------------------------------------
vi.mock("@/components/mobile/auth/useFirstRun", () => ({
  useFirstRun: () => ({
    isFirstRun: false,
    markSeen: vi.fn(),
    reset: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Heavy tab content stubs.
// ---------------------------------------------------------------------------
vi.mock("@/components/mobile/sessions/SessionsTab", () => ({
  SessionsTab: () => <div data-testid="mock-sessions-tab" />,
}));
vi.mock("@/components/mobile/channels/ChannelsTab", () => ({
  ChannelsTab: () => <div data-testid="mock-channels-tab" />,
}));
vi.mock("@/components/mobile/profile/ProfileTab", () => ({
  ProfileTab: () => <div data-testid="mock-profile-tab" />,
}));
vi.mock("@/components/mobile/notifications/NotificationsTab", () => ({
  NotificationsTab: () => <div data-testid="mock-notifications-tab" />,
}));
vi.mock("@/components/mobile/session/MobileSessionView", () => ({
  MobileSessionView: () => <div data-testid="mock-session-view" />,
}));

// ---------------------------------------------------------------------------
// Session + ProjectTree contexts — Phase 3 wired these into MobileApp's
// body (always evaluated, before the auth gate). Provide thin stubs.
// ---------------------------------------------------------------------------
vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [],
    activeSessionId: null,
    setActiveSession: vi.fn(),
    suspendSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    getAgentActivityStatus: vi.fn().mockReturnValue("idle"),
  }),
}));
vi.mock("@/contexts/ProjectTreeContext", () => ({
  useProjectTree: () => ({
    getProject: () => undefined,
  }),
}));

// ---------------------------------------------------------------------------
// MobileShell stub — captures props so we can assert on forceHidden /
// onTabChange wiring without rendering the real shell.
// ---------------------------------------------------------------------------
const shellProps: {
  current: { forceHidden?: boolean; onTabChange?: (t: string) => void };
} = { current: {} };
vi.mock("@/components/mobile/MobileShell", () => ({
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

beforeEach(() => {
  // Default: simulate CF Access production — no NextAuth client session.
  useSessionMock.mockReturnValue({
    data: null,
    status: "unauthenticated",
    update: vi.fn(),
  });
  channelState.openThreadId = null;
  channelState.totalUnreadCount = 0;
  channelState.closeThread.mockClear();
  shellProps.current = {};
  // Reset the URL so the github=connected toast effect doesn't fire.
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

describe("MobileApp auth gating", () => {
  it("renders the tab shell when initialUser is provided, even with useSession() unauthenticated", () => {
    render(
      <MobileApp
        isGitHubConnected={false}
        initialUser={{ email: "cf@example.com", name: "CF User" }}
      />
    );
    // We're on the default Sessions tab.
    expect(screen.getByTestId("mock-sessions-tab")).toBeInTheDocument();
    // The lock screen MUST NOT be rendered.
    expect(screen.queryByTestId("mobile-lock-screen")).toBeNull();
  });

  it("renders the lock screen when initialUser is null and useSession() is also unauthenticated", () => {
    render(<MobileApp isGitHubConnected={false} initialUser={null} />);
    const lock = screen.getByTestId("mobile-lock-screen");
    expect(lock).toBeInTheDocument();
    // Once we know the client session is `unauthenticated`, the CF Access
    // copy is appropriate (CF is the only re-auth path in production).
    expect(lock).toHaveTextContent(/Cloudflare Access/i);
    expect(screen.queryByTestId("mock-sessions-tab")).toBeNull();
  });

  it("renders generic loading copy (NOT Cloudflare Access) while the client session is still loading", () => {
    useSessionMock.mockReturnValue({
      data: null,
      status: "loading",
      update: vi.fn(),
    });
    render(<MobileApp isGitHubConnected={false} initialUser={null} />);
    const lock = screen.getByTestId("mobile-lock-screen");
    expect(lock).toBeInTheDocument();
    // Crucial: do NOT mislead credentials/localhost users with CF copy
    // before we know what auth path is in play.
    expect(lock).not.toHaveTextContent(/Cloudflare Access/i);
    expect(lock).toHaveTextContent(/Loading/i);
  });

  it("falls back to the live client session when initialUser is null but useSession() is authenticated", () => {
    useSessionMock.mockReturnValue({
      data: {
        user: { email: "credentials@example.com", name: "Local Dev" },
      },
      status: "authenticated",
      update: vi.fn(),
    });
    render(<MobileApp isGitHubConnected={false} initialUser={null} />);
    expect(screen.getByTestId("mock-sessions-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-lock-screen")).toBeNull();
  });
});

describe("MobileApp channel thread takeover", () => {
  const renderApp = () =>
    render(
      <MobileApp
        isGitHubConnected={false}
        initialUser={{ email: "cf@example.com", name: "CF User" }}
      />
    );

  it("forces the bottom tab bar hidden while a thread is open in Channels", () => {
    channelState.openThreadId = "m1";
    const { getByTestId } = renderApp();
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
    const { getByTestId } = renderApp();
    // From sessions → channels: thread is still open, but we still close
    // it on the way out so it doesn't get stranded behind another tab.
    fireEvent.click(getByTestId("stub-tab-channels"));
    expect(channelState.closeThread).toHaveBeenCalledTimes(1);
  });

  it("does not call closeThread when the tab does not change", () => {
    channelState.openThreadId = "m1";
    const { getByTestId } = renderApp();
    fireEvent.click(getByTestId("stub-tab-sessions"));
    expect(channelState.closeThread).not.toHaveBeenCalled();
  });
});
