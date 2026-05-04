"use client";

/**
 * MobileApp, Phase 2 mobile redesign, extended in Phase 3.
 *
 * Top-level mobile composition rendered inside `MobileShell` when the
 * viewport is below 768px. Owns the active-tab state, dispatches tab
 * content, and shows simple "Coming in Phase N" placeholders for tabs
 * that ship later.
 *
 * Phase 3 wires the single-session view: when the Sessions tab is active
 * AND the user has selected a session, we render {@link MobileSessionView}
 * full-bleed (status bar / terminal / smart-key strip / input bar),
 * hiding the bottom tab bar. A swipe-up from the bottom edge re-shows
 * the bar briefly so the user can switch tabs without losing the
 * terminal.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { useSessionContext } from "@/contexts/SessionContext";

import { MobileShell } from "./MobileShell";
import type { MobileTab } from "./BottomTabBar";
import { SessionsTab } from "./sessions/SessionsTab";
import { MobileSessionView } from "./session/MobileSessionView";

export interface MobileAppProps {
  isGitHubConnected: boolean;
}

const PLACEHOLDER_COPY: Record<Exclude<MobileTab, "sessions">, { title: string; phase: string }> = {
  notifications: { title: "Notifications", phase: "Phase 4" },
  channels: { title: "Channels", phase: "Phase 5" },
  profile: { title: "Profile", phase: "Phase 6" },
};

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

export function MobileApp({ isGitHubConnected }: MobileAppProps) {
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
      // If user tapped a different tab, switch and clear reveal state so
      // the new tab's normal auto-hide-on-scroll behavior takes over.
      setRevealSeq(0);
      setActiveTab(tab);
    },
    []
  );

  const initialFontSize = persistedFontSize;

  return (
    <MobileShell
      activeTab={activeTab}
      onTabChange={handleTabChange}
      forceHidden={sessionOpen}
      onRequestRevealTabBar={handleRequestRevealTabBar}
      // When a session is open, the view manages its own scroll regions,       // remove the default bottom inset (which makes room for the tab bar)
      // so the smart-key strip + input bar can sit flush at the bottom.
      bottomInsetClassName={sessionOpen ? "pb-0" : undefined}
    >
      {sessionOpen && activeSession ? (
        <MobileSessionView
          session={activeSession}
          projectName={projectName}
          activityStatus={sessionCtx.getAgentActivityStatus(activeSession.id)}
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
      ) : (
        <EmptyTabPlaceholder
          title={PLACEHOLDER_COPY[activeTab].title}
          phase={PLACEHOLDER_COPY[activeTab].phase}
        />
      )}
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
