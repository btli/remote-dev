"use client";

/**
 * MobileSessionView, Phase 3 mobile session view.
 *
 * Full-bleed single-session composition rendered when the user has selected
 * a session inside the mobile shell. Wraps xterm.js (via the shared `Terminal`
 * component) so TUIs like Claude Code, vim, and htop render correctly with
 * cursor moves, line clears, and screen redraws, instead of the previous
 * append-only HTML pre block which stacked redraws on top of each other.
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
import { Terminal, type TerminalRef } from "@/components/terminal/Terminal";
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
  const { currentPreferences } = usePreferencesContext();
  const fontFamily = currentPreferences.fontFamily || DEFAULT_FONT_FAMILY;

  const liveRegionId = useId();

  // ── Refs ────────────────────────────────────────────────────────────────
  const terminalRef = useRef<TerminalRef>(null);
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
  // Subsequent updates come exclusively from pinch-to-zoom; we do NOT
  // re-seed from prefs (preventing a desktop preference change from
  // surprising a mobile user mid-session).
  const [fontSize, setFontSize] = useState<number>(() => {
    const seed =
      initialFontSize ??
      currentPreferences.fontSize ??
      DEFAULT_FONT_SIZE;
    return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, seed));
  });
  const fontSizeBaselineRef = useRef<number>(fontSize);

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
      onPersistFontSize?.(next);
    },
  });

  // Keep the baseline in sync when initialFontSize changes (e.g. after the
  // persistence layer hydrates from preferences).
  useEffect(() => {
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

          Terminal owns its own WebSocket, FitAddon, and resize handling,
          so we don't compute cols/rows ourselves. AuthErrorOverlay is
          rendered internally by Terminal as well. */}
      <div
        ref={pinchRef}
        data-testid="mobile-session-output"
        data-font-size={fontSize}
        className="flex-1 min-h-0 relative"
        aria-describedby={liveRegionId}
      >
        <Terminal
          ref={terminalRef}
          sessionId={session.id}
          tmuxSessionName={session.tmuxSessionName}
          sessionName={session.name}
          projectPath={session.projectPath}
          wsUrl={wsUrl}
          fontSize={fontSize}
          fontFamily={fontFamily}
          tmuxHistoryLimit={tmuxHistoryLimit}
          notificationsEnabled={notificationsEnabled}
          isRecording={isRecording}
          environmentVars={environmentVars}
          terminalType={session.terminalType ?? "shell"}
          mobileMode
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
