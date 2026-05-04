/**
 * MobileApp tests — Phase 6 mobile redesign.
 *
 * Verifies the *server-passed* `initialUser` prop is the source of truth
 * for mobile auth gating, NOT the NextAuth client `useSession()` status.
 * This regression test exists because Cloudflare Access users have no
 * NextAuth client session — `useSession()` returns `unauthenticated` for
 * them — so a previous build of this component locked CF users out of
 * the mobile UI entirely.
 *
 * We mock SessionsTab and ProfileTab to avoid pulling in the real
 * context tree (which is irrelevant to the auth-gating contract under
 * test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { MobileApp } from "@/components/mobile/MobileApp";

// Pretend useSession returns `unauthenticated` — this is the case for
// Cloudflare Access users in production. The mobile shell must still
// render based on `initialUser`.
const useSessionMock = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

// SessionsTab and ProfileTab pull in heavy context trees; replace with
// thin stand-ins so we can assert on which surface MobileApp routed to.
vi.mock("@/components/mobile/sessions/SessionsTab", () => ({
  SessionsTab: () => <div data-testid="mock-sessions-tab" />,
}));
vi.mock("@/components/mobile/profile/ProfileTab", () => ({
  ProfileTab: () => <div data-testid="mock-profile-tab" />,
}));

// Mock useFirstRun so the welcome screen doesn't intercept.
vi.mock("@/components/mobile/auth/useFirstRun", () => ({
  useFirstRun: () => ({
    isFirstRun: false,
    markSeen: vi.fn(),
    reset: vi.fn(),
  }),
}));

beforeEach(() => {
  // Default: simulate CF Access production — no NextAuth client session.
  useSessionMock.mockReturnValue({
    data: null,
    status: "unauthenticated",
    update: vi.fn(),
  });
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
