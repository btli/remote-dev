"use client";

/**
 * MobileApp — top-level mobile composition.
 *
 * Phase 6 wires:
 *
 *   1. The Phase 1 {@link MobileShell} + {@link BottomTabBar}.
 *   2. The Phase 2 Sessions tab.
 *   3. The Phase 6 Profile tab.
 *   4. The Phase 6 lock + welcome auth flow.
 *
 * Auth model:
 *
 *   This component runs *inside* an authenticated server render — the
 *   parent page resolves the session via `getAuthSession()` (which
 *   handles BOTH NextAuth credentials and Cloudflare Access JWT) and
 *   redirects unauthenticated users before this component mounts. As a
 *   result `initialUser` is the source of truth: when it's non-null the
 *   user IS authenticated, regardless of what NextAuth's *client*
 *   `useSession()` says.
 *
 *   `useSession()` is only consulted as a transient signal for the
 *   *client-side* hydration state — for example, after a user signs in
 *   to GitHub via the link flow on the same page. It must NEVER be used
 *   to gate the lock screen on its own, because Cloudflare Access users
 *   never have a NextAuth client session and would otherwise be
 *   permanently stuck on the lock screen.
 *
 * Auth flow (mobile-only):
 *
 *   - If `initialUser` is null (a defensive fallback — middleware should
 *     have redirected before we got here) → render
 *     {@link MobileLockScreen}.
 *   - If first run on this device → render {@link MobileWelcomeScreen}.
 *   - Otherwise → render the tab shell with `activeTab` state.
 *
 * The GitHub OAuth callback redirects to `/?github=connected`. When that
 * query param is present we surface a one-shot toast on the Sessions tab
 * and strip the param from the URL so a refresh doesn't re-toast. This
 * mirrors the desktop behavior without depending on it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { ProfileTab } from "./profile/ProfileTab";
import { MobileLockScreen } from "./auth/MobileLockScreen";
import { MobileWelcomeScreen } from "./auth/MobileWelcomeScreen";
import { useFirstRun } from "./auth/useFirstRun";

export interface MobileAuthUser {
  email: string | null;
  name: string | null;
}

export interface MobileAppProps {
  isGitHubConnected: boolean;
  /**
   * Server-resolved authenticated user from `getAuthSession()`. When
   * non-null, the user is authenticated via NextAuth credentials OR
   * Cloudflare Access JWT. This is the source of truth for mobile auth
   * gating — `useSession()` cannot be trusted here because CF Access
   * users have no NextAuth client session.
   */
  initialUser: MobileAuthUser | null;
}

const PLACEHOLDER_COPY: Record<Exclude<MobileTab, "sessions" | "profile">, { title: string; phase: string }> = {
  notifications: { title: "Notifications", phase: "Phase 4" },
  channels: { title: "Channels", phase: "Phase 5" },
};

export function MobileApp({ isGitHubConnected, initialUser }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("sessions");
  // `useSession` is consulted only for live updates after the initial
  // server render (e.g. post-GitHub-link). It is NEVER the source of
  // truth for "am I authenticated?" — see file-level docblock.
  const { data: clientSession } = useSession();
  const firstRun = useFirstRun();

  // Derived: prefer the server-passed user, fall back to the live client
  // session (only useful for in-app sign-in flows that don't full-reload).
  const resolvedUser = useMemo<MobileAuthUser | null>(() => {
    if (initialUser) return initialUser;
    if (clientSession?.user?.email) {
      return {
        email: clientSession.user.email ?? null,
        name: clientSession.user.name ?? null,
      };
    }
    return null;
  }, [initialUser, clientSession]);

  // Surface the GitHub OAuth callback toast once and strip the query
  // param so a refresh won't replay it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("github") !== "connected") return;
    toast.success("GitHub connected", {
      description: "Your account is linked.",
    });
    url.searchParams.delete("github");
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
    window.history.replaceState({}, "", next);
  }, []);

  const handleConnectGitHub = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/api/auth/github/link";
    }
  }, []);

  const handleSkipWelcome = useCallback(() => {
    firstRun.markSeen();
    setActiveTab("sessions");
  }, [firstRun]);

  // Defensive: middleware should redirect unauthenticated users before
  // this component renders. If `initialUser` is null AND the client
  // session also hasn't filled in, treat this as "not yet authenticated"
  // and keep the lock screen up rather than flashing the tab shell.
  if (!resolvedUser) {
    return (
      <MobileLockScreen
        message="Authenticating via Cloudflare Access"
        detail="Redirecting to sign in."
      />
    );
  }

  // First run: gated by the localStorage flag, only shown once we know
  // it's not been seen. `firstRun.isFirstRun === null` means we haven't
  // yet read storage; show the lock briefly to avoid a welcome flash.
  if (firstRun.isFirstRun === null) {
    return <MobileLockScreen message="Loading" detail="Just a second." />;
  }
  if (firstRun.isFirstRun) {
    return (
      <MobileWelcomeScreen
        email={resolvedUser.email}
        isGitHubConnected={isGitHubConnected}
        onConnectGitHub={handleConnectGitHub}
        onSkip={handleSkipWelcome}
      />
    );
  }

  return (
    <MobileShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === "sessions" ? (
        <SessionsTab isGitHubConnected={isGitHubConnected} />
      ) : null}
      {activeTab === "profile" ? (
        <ProfileTab
          email={resolvedUser.email}
          displayName={resolvedUser.name}
          isGitHubConnected={isGitHubConnected}
        />
      ) : null}
      {activeTab !== "sessions" && activeTab !== "profile" ? (
        <EmptyTabPlaceholder
          title={PLACEHOLDER_COPY[activeTab as keyof typeof PLACEHOLDER_COPY].title}
          phase={PLACEHOLDER_COPY[activeTab as keyof typeof PLACEHOLDER_COPY].phase}
        />
      ) : null}
    </MobileShell>
  );
}

function EmptyTabPlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div
      data-testid={`mobile-tab-placeholder-${title.toLowerCase()}`}
      className="flex h-full flex-col items-center justify-center gap-1 px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">Coming in {phase}.</p>
    </div>
  );
}
