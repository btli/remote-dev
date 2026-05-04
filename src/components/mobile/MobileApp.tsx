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
 * Auth flow (mobile-only):
 *
 *   - If we're still resolving the NextAuth session → render
 *     {@link MobileLockScreen} ("Authenticating via Cloudflare Access").
 *   - If the session is resolved and the user is on this device for the
 *     first time → render {@link MobileWelcomeScreen}.
 *   - Otherwise → render the tab shell with `activeTab` state.
 *
 * The GitHub OAuth callback redirects to `/?github=connected`. When that
 * query param is present we surface a one-shot toast on the Sessions tab
 * and strip the param from the URL so a refresh doesn't re-toast. This
 * mirrors the desktop behavior without depending on it.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { ProfileTab } from "./profile/ProfileTab";
import { MobileLockScreen } from "./auth/MobileLockScreen";
import { MobileWelcomeScreen } from "./auth/MobileWelcomeScreen";
import { useFirstRun } from "./auth/useFirstRun";

export interface MobileAppProps {
  isGitHubConnected: boolean;
}

const PLACEHOLDER_COPY: Record<Exclude<MobileTab, "sessions" | "profile">, { title: string; phase: string }> = {
  notifications: { title: "Notifications", phase: "Phase 4" },
  channels: { title: "Channels", phase: "Phase 5" },
};

export function MobileApp({ isGitHubConnected }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("sessions");
  const { data: session, status } = useSession();
  const firstRun = useFirstRun();

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

  // While the session is resolving, render the lock screen. NextAuth
  // exposes `status === "loading"` during the initial fetch.
  if (status === "loading") {
    return <MobileLockScreen />;
  }

  // The middleware will have redirected unauthenticated users to /login
  // before we ever get here, but if the session lands as `unauthenticated`
  // due to a transient race, we keep the lock screen up rather than
  // flashing the tab shell.
  if (status === "unauthenticated") {
    return <MobileLockScreen message="Authenticating via Cloudflare Access" detail="Redirecting to sign in." />;
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
        email={session?.user?.email ?? null}
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
          email={session?.user?.email ?? null}
          displayName={session?.user?.name ?? null}
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
