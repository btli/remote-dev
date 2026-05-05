"use client";

/**
 * MobileSessionView, Phase 3 mobile session view.
 *
 * Full-bleed single-session composition rendered when the user has selected
 * a session inside the mobile shell. Renders xterm.js via the shared
 * `TerminalWithKeyboard` component (with `mobileChrome="external"`), so
 * desktop and mobile share one renderer; this view only supplies its own
 * chrome around it. TUIs like Claude Code, vim, and htop render correctly
 * with cursor moves, line clears, and screen redraws, instead of the
 * previous append-only HTML pre block which stacked redraws on top of
 * each other.
 *
 * The chrome around the terminal stays the same: top SessionStatusBar,
 * banner row, the new SmartKeyStrip, and the existing MobileInputBar
 * (whose long-press = paste-without-execute behavior is preserved verbatim).
 *
 * Tab-bar reveal: the parent (MobileApp) hides the bottom tab bar while a
 * session is open, and listens for swipe-up-from-the-bottom-edge through
 * MobileShell's `useSwipeUpFromBottomEdge` hook.
 *
 * Two-finger pinch resizes the terminal mono font; the resulting size is
 * persisted via `onPersistFontSize` so it survives across mounts.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { usePrefersReducedMotion } from "@/hooks/useMobile";
import {
  TerminalWithKeyboard,
  type TerminalWithKeyboardRef,
} from "@/components/terminal/TerminalWithKeyboard";
import { MobileInputBar } from "@/components/terminal/MobileInputBar";
import { AgentExitScreen } from "@/components/terminal/AgentExitScreen";
import type { TerminalSession } from "@/types/session";
import type { ConnectionStatus } from "@/types/terminal";
import type { AgentActivityStatus } from "@/types/terminal-type";

import {
  SessionStatusBar,
  type SessionPipState,
} from "./SessionStatusBar";
import { SmartKeyStrip } from "./SmartKeyStrip";
import { useModifierLatch } from "./useModifierLatch";
import { usePinchZoom } from "./usePinchZoom";
import { SessionMetadataSheet } from "./SessionMetadataSheet";

const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', monospace";

/** Map ConnectionStatus + AgentActivityStatus to a single pip state. */
function deriveStatusPip(
  status: ConnectionStatus,
  activity: AgentActivityStatus
): SessionPipState {
  if (status === "connecting") return "reconnecting";
  if (status === "reconnecting") return "reconnecting";
  if (status === "disconnected") return "disconnected";
  if (status === "error") return "error";
  // Connected → reflect agent activity.
  if (activity === "waiting") return "waiting";
  if (activity === "error") return "error";
  if (activity === "running") return "running";
  return "idle";
}

export interface MobileSessionViewProps {
  session: TerminalSession;
  projectName?: string | null;
  /** Agent's stored activity status for chrome rendering. Drives pip + halo. */
  activityStatus: AgentActivityStatus;
  wsUrl?: string;
  tmuxHistoryLimit?: number;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  hasRecordings?: boolean;
  environmentVars?: Record<string, string> | null;
  /**
   * Initial mono font size in px; persists between mounts when supplied.
   * When `undefined` (e.g. localStorage unset on first load) the view
   * seeds from `usePreferencesContext().currentPreferences.fontSize`.
   */
  initialFontSize?: number;
  /** Called after a pinch gesture commits a new size. */
  onPersistFontSize?: (size: number) => void;
  /** Tap on the back arrow (closes session detail and returns to list). */
  onBack?: () => void;
  /** Suspend the session, optionally returning to list. */
  onSuspend?: () => void | Promise<unknown>;
  /** Close the session permanently. */
  onClose?: () => void | Promise<unknown>;
  /** Open the recordings list (handler may be undefined when no recordings). */
  onViewRecordings?: () => void;
  /** Open the channels / peer messages tab. */
  onOpenPeerMessages?: () => void;
}

export function MobileSessionView({
  session,
  projectName,
  activityStatus,
  wsUrl,
  tmuxHistoryLimit,
  notificationsEnabled = true,
  isRecording = false,
  hasRecordings = false,
  environmentVars,
  initialFontSize,
  onPersistFontSize,
  onBack,
  onSuspend,
  onClose,
  onViewRecordings,
  onOpenPeerMessages,
}: MobileSessionViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const sessionCtx = useSessionContext();
  const prefs = usePreferencesContext();
  const { currentPreferences } = prefs;
  // `loading` may be undefined in older test fixtures that mock this
  // context — treat undefined as "settled" so tests don't need updating.
  const preferencesLoading = prefs.loading ?? false;
  const fontFamily = currentPreferences.fontFamily || DEFAULT_FONT_FAMILY;

  const liveRegionId = useId();

  // ── Refs ────────────────────────────────────────────────────────────────
  const terminalRef = useRef<TerminalWithKeyboardRef>(null);
  const inputBarRef = useRef<HTMLTextAreaElement>(null);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [agentExitInfo, setAgentExitInfo] = useState<{
    exitCode: number | null;
    exitedAt: string;
  } | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  // Font-size (pinch zoom). Source priority on first mount:
  //   1. `initialFontSize` prop (localStorage-backed via MobileApp)
  //   2. user-level preference `fontSize`
  //   3. DEFAULT_FONT_SIZE
  //
  // Both upstream sources are async on first render:
  //   - `initialFontSize` arrives via `useSyncExternalStore` (undefined on
  //     SSR + first client paint, a number after hydration).
  //   - `currentPreferences.fontSize` starts at the in-memory default
  //     until `/api/preferences` resolves.
  // The lazy `useState` initializer therefore often seeds with stale data,
  // so a one-shot effect (below) reconciles to the real upstream value as
  // soon as it becomes available. Once that reconciliation latches, all
  // further updates come exclusively from pinch-to-zoom — we do NOT
  // re-seed from prefs (preventing a desktop preference change from
  // surprising a mobile user mid-session).
  // Initial seed:
  //   - Prefer `initialFontSize` if persistence has already hydrated.
  //   - Else use `currentPreferences.fontSize` only if prefs are settled.
  //   - Else fall through to DEFAULT_FONT_SIZE; the reconciliation effect
  //     will fix it once an upstream source settles.
  // We use `Number.isFinite` (not `typeof === "number"`) because
  // `typeof NaN === "number"` is true. A NaN slipping through (corrupt
  // localStorage, freak prefs payload) would make `Math.max/min(NaN)`
  // return NaN, latch the seed forever, and stick the terminal at NaN
  // px. `Number.isFinite` rejects NaN and ±Infinity while accepting
  // every real number.
  const [fontSize, setFontSize] = useState<number>(() => {
    let seed: number = DEFAULT_FONT_SIZE;
    if (Number.isFinite(initialFontSize)) {
      seed = initialFontSize as number;
    } else if (!preferencesLoading && Number.isFinite(currentPreferences.fontSize)) {
      seed = currentPreferences.fontSize;
    }
    return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, seed));
  });
  const fontSizeBaselineRef = useRef<number>(fontSize);
  // Latches once we've reconciled to a real upstream value. After this
  // flips to true, the reconciliation effect is a no-op forever, so a
  // user pinching to N px won't be reverted by a later prefs change.
  // We pre-latch in the lazy initializer when an upstream value was
  // already available — the effect then has nothing to do.
  const seededFromUpstreamRef = useRef<boolean>(
    Number.isFinite(initialFontSize) ||
      (!preferencesLoading && Number.isFinite(currentPreferences.fontSize))
  );

  // ── Modifier latch ──────────────────────────────────────────────────────
  const latch = useModifierLatch();

  // ── Agent lifecycle callbacks ───────────────────────────────────────────
  const handleAgentExited = useCallback(
    (exitCode: number | null, exitedAt: string) => {
      setAgentExitInfo({ exitCode, exitedAt });
    },
    []
  );

  const handleAgentRestarted = useCallback(() => {
    setAgentExitInfo(null);
    setIsRestarting(false);
  }, []);

  const handleStatusChange = useCallback((next: ConnectionStatus) => {
    setStatus(next);
  }, []);

  // ── Smart-key strip dispatcher ──────────────────────────────────────────
  const handleSmartKey = useCallback((sequence: string) => {
    terminalRef.current?.sendInput(sequence);
  }, []);

  const handleInputSubmit = useCallback((data: string) => {
    terminalRef.current?.sendInput(data);
  }, []);

  // ── Pinch-to-zoom on the terminal viewport ──────────────────────────────
  const { ref: pinchRef } = usePinchZoom({
    onScale: (factor) => {
      const next = Math.max(
        FONT_SIZE_MIN,
        Math.min(FONT_SIZE_MAX, Math.round(fontSizeBaselineRef.current * factor))
      );
      setFontSize(next);
    },
    onScaleCommit: (factor) => {
      const next = Math.max(
        FONT_SIZE_MIN,
        Math.min(FONT_SIZE_MAX, Math.round(fontSizeBaselineRef.current * factor))
      );
      fontSizeBaselineRef.current = next;
      // The user's first deliberate size choice IS a real upstream value
      // — latch so a later async upstream (slow /api/preferences fetch
      // or late-hydrating localStorage) cannot overwrite the pinch.
      // Done here in commit, NOT in onScale, since onScale fires every
      // drag frame and latching there would be wasteful + semantically
      // wrong (mid-gesture isn't a final user choice).
      seededFromUpstreamRef.current = true;
      onPersistFontSize?.(next);
    },
  });

  // One-shot post-hydration reconciliation of `fontSize`.
  //
  // The lazy `useState` initializer above runs once with whatever
  // upstream values are available at first render. On a cold start that
  // is `initialFontSize === undefined` plus the default `fontSize` from
  // `currentPreferences`, and we end up seeded with the default (12px)
  // even when the user has a real preference of 16+ and a persisted
  // pinch size of 18+. This effect waits until at least one upstream
  // source has settled and reconciles `fontSize` exactly once.
  //
  // After this latches:
  //   - Pinch-to-zoom owns `fontSize` exclusively.
  //   - A later prefs change does NOT re-seed.
  //   - The persisted (localStorage) value, once it arrives, also does
  //     not surprise the user mid-session beyond this single sync.
  useEffect(() => {
    if (seededFromUpstreamRef.current) return;

    // We need to know the upstream is "real":
    //   - If `initialFontSize` is a finite number, persistence has hydrated.
    //   - Otherwise, wait for PreferencesContext to finish loading
    //     before trusting `currentPreferences.fontSize` — and only
    //     accept a finite number there too (NaN guard).
    let resolved: number | undefined;
    if (Number.isFinite(initialFontSize)) {
      resolved = initialFontSize as number;
    } else if (!preferencesLoading && Number.isFinite(currentPreferences.fontSize)) {
      resolved = currentPreferences.fontSize;
    }
    if (resolved === undefined) return;

    const clamped = Math.max(
      FONT_SIZE_MIN,
      Math.min(FONT_SIZE_MAX, resolved)
    );
    seededFromUpstreamRef.current = true;
    fontSizeBaselineRef.current = clamped;
    if (clamped !== fontSize) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration from async upstream (localStorage / preferences fetch)
      setFontSize(clamped);
    }
  }, [initialFontSize, currentPreferences.fontSize, preferencesLoading, fontSize]);

  // Keep the baseline in sync after a pinch commit (which calls
  // setFontSize). The reconciliation effect above already updates the
  // baseline when it latches, so once latched this effect just mirrors
  // user-driven font-size changes back into the pinch baseline.
  useEffect(() => {
    if (!seededFromUpstreamRef.current) return;
    fontSizeBaselineRef.current = fontSize;
  }, [fontSize]);

  // ── Agent restart / close ───────────────────────────────────────────────
  const handleAgentRestart = useCallback(() => {
    setIsRestarting(true);
    terminalRef.current?.restartAgent();
  }, []);

  const handleAgentCloseFromExitScreen = useCallback(async () => {
    if (onClose) {
      await onClose();
    }
  }, [onClose]);

  // ── Status bar pip state ───────────────────────────────────────────────
  const pipState = useMemo<SessionPipState>(
    () => deriveStatusPip(status, activityStatus),
    [status, activityStatus]
  );

  // Banners for connection states.
  const banner = useMemo(() => {
    if (status === "reconnecting") {
      return { tone: "warn" as const, text: "Reconnecting…" };
    }
    if (status === "disconnected" || status === "error") {
      return { tone: "error" as const, text: "Disconnected. Pull down for details." };
    }
    if (session.status === "suspended") {
      return { tone: "info" as const, text: "Session suspended" };
    }
    return null;
  }, [status, session.status]);

  return (
    <div
      data-testid="mobile-session-view"
      data-session-id={session.id}
      className="flex h-full w-full flex-col bg-background text-foreground"
    >
      <SessionStatusBar
        projectName={projectName ?? undefined}
        sessionName={session.name}
        pipState={pipState}
        haloEnabled={!reducedMotion && pipState === "waiting"}
        recording={isRecording}
        onBack={onBack}
        onOpenMetadata={() => setMetadataOpen(true)}
      />

      {banner ? (
        <div
          data-testid="mobile-session-banner"
          data-tone={banner.tone}
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center justify-center px-3 py-1 text-[11px] font-medium leading-tight",
            banner.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : banner.tone === "warn"
                ? "bg-accent/40 text-foreground"
                : "bg-muted/40 text-muted-foreground"
          )}
        >
          {banner.text}
        </div>
      ) : null}

      {/* Terminal viewport. Pinch handlers attach here so the gesture is
          isolated to the output area; chrome above and below stay
          tappable without false positives.

          TerminalWithKeyboard with `mobileChrome="external"` renders only
          the xterm.js viewport (plus the agent voice button + session
          ended overlay). The wrapper still owns the WebSocket, FitAddon,
          and resize handling, so we don't compute cols/rows ourselves;
          AuthErrorOverlay is rendered internally by Terminal as well.
          We forward smart-keys / input bar text via the ref's
          `sendInput`. */}
      <div
        ref={pinchRef}
        data-testid="mobile-session-output"
        data-font-size={fontSize}
        className="flex-1 min-h-0 relative"
        aria-describedby={liveRegionId}
      >
        <TerminalWithKeyboard
          ref={terminalRef}
          sessionId={session.id}
          tmuxSessionName={session.tmuxSessionName}
          sessionName={session.name}
          projectPath={session.projectPath}
          session={session}
          wsUrl={wsUrl}
          fontSize={fontSize}
          fontFamily={fontFamily}
          tmuxHistoryLimit={tmuxHistoryLimit}
          notificationsEnabled={notificationsEnabled}
          isRecording={isRecording}
          environmentVars={environmentVars}
          mobileChrome="external"
          onStatusChange={handleStatusChange}
          onAgentExited={handleAgentExited}
          onAgentRestarted={handleAgentRestarted}
        />
      </div>

      {/* Live region for accessibility, pip changes get announced. */}
      <span id={liveRegionId} className="sr-only" aria-live="polite">
        Status: {pipState}
      </span>

      <SmartKeyStrip
        onKeyPress={handleSmartKey}
        latch={latch}
        disabled={status !== "connected"}
      />

      <MobileInputBar
        ref={inputBarRef}
        onSubmit={handleInputSubmit}
        onModifiedKeyPress={handleInputSubmit}
        modifierActive={latch.anyActive}
        resolveKey={latch.resolveKey}
        disabled={status !== "connected"}
        placeholder={
          session.terminalType === "agent"
            ? "Ask the agent…"
            : "Type a command…"
        }
      />

      {/* Metadata sheet */}
      <SessionMetadataSheet
        open={metadataOpen}
        onOpenChange={setMetadataOpen}
        sessionName={session.name}
        projectName={projectName}
        showRestart={session.terminalType === "agent"}
        hasRecordings={hasRecordings}
        onViewRecordings={onViewRecordings}
        onRestartAgent={
          session.terminalType === "agent" ? handleAgentRestart : undefined
        }
        onOpenPeerMessages={onOpenPeerMessages}
        onSuspend={onSuspend}
        onClose={onClose}
      />

      {/* Agent exit screen overlay */}
      {agentExitInfo ? (
        <AgentExitScreen
          sessionId={session.id}
          sessionName={session.name}
          exitCode={agentExitInfo.exitCode}
          exitedAt={agentExitInfo.exitedAt}
          restartCount={session.agentRestartCount ?? 0}
          onRestart={handleAgentRestart}
          onClose={handleAgentCloseFromExitScreen}
          isRestarting={isRestarting}
        />
      ) : null}

      {/* sessionCtx is only read so the host context registers as used by
          this view; future Phase-4+ work will wire active-session edits.
          The reference also keeps the lint rule honest about React
          hook ordering. */}
      <span hidden aria-hidden="true">
        {sessionCtx.activeSessionId === session.id ? "active" : "inactive"}
      </span>
    </div>
  );
}
