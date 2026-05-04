"use client";

/**
 * MobileApp — top-level mobile composition (Phase 2 → Phase 6).
 *
 * Wires:
 *
 *   1. The Phase 1 {@link MobileShell} + {@link BottomTabBar}.
 *   2. The Phase 2 Sessions tab.
 *   3. The Phase 3 single-session full-bleed view ({@link MobileSessionView}).
 *   4. The Phase 4 Notifications tab ({@link NotificationsTab}).
 *   5. The Phase 5 Channels tab ({@link ChannelsTab}) with thread takeover.
 *   6. The Phase 6 Profile tab ({@link ProfileTab}) + lock + welcome auth flow.
 *
 * Phase 3 single-session view: when the Sessions tab is active AND the
 * user has selected a session, we render {@link MobileSessionView}
 * full-bleed (status bar / terminal / smart-key strip / input bar),
 * hiding the bottom tab bar. A swipe-up from the bottom edge re-shows
 * the bar briefly so the user can switch tabs without losing the
 * terminal.
 *
 * Phase 5 channels view: while a thread takeover is open inside the
 * Channels tab, the bottom tab bar is forced hidden so it doesn't paint
 * over the reply composer (both render at z-40 before the takeover bumps
 * to z-50). We also dismiss any open thread on tab change so it doesn't
 * get stranded behind a sibling tab.
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

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { useChannelContextOptional } from "@/contexts/ChannelContext";
import { useTerminalWsUrl } from "@/hooks/useTerminalWsUrl";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { ChannelsTab } from "./channels/ChannelsTab";
import { NotificationsTab } from "./notifications/NotificationsTab";
import { MobileSessionView } from "./session/MobileSessionView";
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

const FONT_SIZE_STORAGE_KEY = "remote-dev:mobile:terminal-font-size";

/** ms the bottom tab bar stays revealed after a swipe-up before auto-collapsing. */
const TAB_BAR_REVEAL_DURATION_MS = 3500;

function readPersistedFontSize(): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writePersistedFontSize(size: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
  } catch {
    // Ignore quota / private mode errors.
  }
}

/**
 * Hydration-safe persisted font size reader.
 *
 * useSyncExternalStore is the React-blessed way to read browser-only state
 * during render: getServerSnapshot returns `undefined` so the SSR + first-
 * client-render markup match (no hydration mismatch), then React tears
 * down + re-runs with the real localStorage value on the client.
 *
 * No subscribe, the value never changes mid-session for a single MobileApp
 * mount — writes happen via writePersistedFontSize but the consumer
 * (MobileSessionView) holds its own state and ignores prop changes after
 * mount, so we don't bother notifying.
 */
function subscribePersistedFontSize(): () => void {
  return () => {};
}
function usePersistedFontSize(): number | undefined {
  return useSyncExternalStore(
    subscribePersistedFontSize,
    readPersistedFontSize,
    () => undefined
  );
}

export function MobileApp({ isGitHubConnected, initialUser }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("sessions");
  // Use a monotonic counter rather than a boolean so that any repeated
  // call to handleRequestRevealTabBar re-arms the auto-collapse effect.
  // (The bottom-edge swipe gesture is currently disabled while the bar
  // is revealed, so back-to-back swipes can't actually fire today, but
  // a boolean true→true transition would be a silent footgun for any
  // future caller — counter is the defensive choice.)
  const [revealSeq, setRevealSeq] = useState(0);
  const tabBarRevealed = revealSeq > 0;
  // Persisted terminal font size, hydration-safe (returns undefined during
  // SSR + first client render, then real value once useSyncExternalStore
  // resolves on the client).
  const persistedFontSize = usePersistedFontSize();

  // `useSession` is consulted only for live updates after the initial
  // server render (e.g. post-GitHub-link). It is NEVER the source of
  // truth for "am I authenticated?" — see file-level docblock.
  const { data: clientSession, status: clientSessionStatus } = useSession();
  const firstRun = useFirstRun();

  // Channels context is optional so MobileApp can still mount in test
  // setups without ChannelProvider; production always wraps the tree.
  const channels = useChannelContextOptional();
  const channelsBadge = channels?.totalUnreadCount ?? 0;
  const openThreadId = channels?.openThreadId ?? null;
  const closeThread = channels?.closeThread;

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

  // When the bottom tab bar is revealed via the bottom-edge swipe, auto-
  // collapse it after a short delay so the session view goes back to
  // full-bleed. The dependency on `revealSeq` (vs. a boolean) means
  // every swipe-up resets the timer.
  useEffect(() => {
    if (revealSeq === 0) return;
    const t = window.setTimeout(
      () => setRevealSeq(0),
      TAB_BAR_REVEAL_DURATION_MS
    );
    return () => window.clearTimeout(t);
  }, [revealSeq]);

  const sessionCtx = useSessionContext();
  const projectTree = useProjectTree();
  // Shared resolver with SessionManager — without an explicit URL,
  // MobileSessionView falls back to `ws://localhost:3001`, which is wrong
  // on prod and on the standard 6002 dev port.
  const wsUrl = useTerminalWsUrl();

  const activeSession = useMemo(() => {
    const id = sessionCtx.activeSessionId;
    if (!id) return null;
    return sessionCtx.sessions.find((s) => s.id === id) ?? null;
  }, [sessionCtx.activeSessionId, sessionCtx.sessions]);

  // Phase 3: A session is "open" when (a) we're on the Sessions tab,
  // (b) there is an active session, and (c) the user hasn't pulled the
  // tab bar up via the bottom-edge gesture.
  const sessionOpen =
    activeTab === "sessions" && activeSession !== null && !tabBarRevealed;

  // Phase 5: Force the tab bar hidden while a thread takeover is open in
  // the Channels tab. Combined with sessionOpen so either condition can
  // hide the bar.
  const threadTakeover = activeTab === "channels" && openThreadId != null;
  const tabBarForceHidden = sessionOpen || threadTakeover;

  // Project name lookup for the status bar. The compiler infers
  // `activeSession.projectId` as the only real dependency; `projectTree.getProject`
  // is read off the latest tree value at call time, so we let the compiler
  // manage the dep array rather than spelling out a wider one.
  const projectId = activeSession?.projectId ?? null;
  const projectName = useMemo(() => {
    if (!projectId) return null;
    return projectTree.getProject(projectId)?.name ?? null;
  }, [projectId, projectTree]);

  const handleBack = useCallback(() => {
    sessionCtx.setActiveSession(null);
  }, [sessionCtx]);

  const handleSuspend = useCallback(async () => {
    if (!activeSession) return;
    try {
      await sessionCtx.suspendSession(activeSession.id);
      toast(`Suspended "${activeSession.name}"`);
    } catch {
      toast.error("Couldn't suspend session.");
    }
  }, [activeSession, sessionCtx]);

  const handleClose = useCallback(async () => {
    if (!activeSession) return;
    const name = activeSession.name;
    try {
      await sessionCtx.closeSession(activeSession.id);
      toast(`Closed "${name}"`);
    } catch {
      toast.error("Couldn't close session.");
    }
  }, [activeSession, sessionCtx]);

  // Bottom-edge swipe pulls the tab bar back so the user can change tabs.
  // We auto-collapse it after a few seconds of inactivity to keep the
  // session view full-bleed, but only when a tap on a tab item didn't
  // already navigate away.
  const handleRequestRevealTabBar = useCallback(() => {
    // Increment the counter so the auto-collapse effect re-runs from
    // zero on every reveal (back-to-back swipes restart the timer).
    setRevealSeq((n) => n + 1);
  }, []);

  const handleTabChange = useCallback(
    (tab: MobileTab) => {
      // Phase 5: dismiss any open thread on the way out so it doesn't get
      // stranded behind a sibling tab.
      if (tab !== activeTab && openThreadId && closeThread) {
        closeThread();
      }
      // If user tapped a different tab, switch and clear reveal state so
      // the new tab's normal auto-hide-on-scroll behavior takes over.
      setRevealSeq(0);
      setActiveTab(tab);
    },
    [activeTab, openThreadId, closeThread]
  );

  const handleConnectGitHub = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/api/auth/github/link";
    }
  }, []);

  const handleSkipWelcome = useCallback(() => {
    firstRun.markSeen();
    setActiveTab("sessions");
  }, [firstRun]);

  const initialFontSize = persistedFontSize;

  // Defensive: middleware should redirect unauthenticated users before
  // this component renders. If `initialUser` is null AND the client
  // session also hasn't filled in, treat this as "not yet authenticated"
  // and keep the lock screen up rather than flashing the tab shell.
  //
  // Copy split:
  //   - While the NextAuth client session is still resolving (`loading`),
  //     show a generic "Loading" — we genuinely don't know yet whether
  //     this is a credentials user, a CF Access user, or unauthenticated.
  //     Showing the CF Access copy here would mislead local-dev users.
  //   - Once the client session resolves to `unauthenticated` AND we
  //     still have no `initialUser`, then we are confident the user is
  //     not signed in; show the CF-branded copy because in production
  //     the only way back in is via the CF Access challenge (the
  //     middleware will have already issued the redirect).
  if (!resolvedUser) {
    if (clientSessionStatus === "loading") {
      return <MobileLockScreen message="Loading" detail="Just a second." />;
    }
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
    <MobileShell
      activeTab={activeTab}
      onTabChange={handleTabChange}
      forceHidden={tabBarForceHidden}
      onRequestRevealTabBar={handleRequestRevealTabBar}
      badges={channelsBadge > 0 ? { channels: channelsBadge } : undefined}
      // When a session is open, the view manages its own scroll regions,
      // remove the default bottom inset (which makes room for the tab bar)
      // so the smart-key strip + input bar can sit flush at the bottom.
      bottomInsetClassName={sessionOpen ? "pb-0" : undefined}
    >
      {sessionOpen && activeSession ? (
        <MobileSessionView
          session={activeSession}
          projectName={projectName}
          activityStatus={sessionCtx.getAgentActivityStatus(activeSession.id)}
          wsUrl={wsUrl}
          isRecording={false /* Phase 3 ships read-only; recording UI is Phase 6 */}
          hasRecordings={false}
          initialFontSize={initialFontSize}
          onPersistFontSize={writePersistedFontSize}
          onBack={handleBack}
          onSuspend={handleSuspend}
          onClose={handleClose}
        />
      ) : activeTab === "sessions" ? (
        <SessionsTab isGitHubConnected={isGitHubConnected} />
      ) : activeTab === "channels" ? (
        <ChannelsTab />
      ) : activeTab === "notifications" ? (
        <NotificationsTab onSwitchTab={handleTabChange} />
      ) : activeTab === "profile" ? (
        <ProfileTab
          email={resolvedUser.email}
          displayName={resolvedUser.name}
          isGitHubConnected={isGitHubConnected}
        />
      ) : null}
    </MobileShell>
  );
}
