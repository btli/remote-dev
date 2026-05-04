"use client";

/**
 * MobileSessionView, Phase 3 mobile session view.
 *
 * Full-bleed single-session composition rendered when the user has selected
 * a session inside the mobile shell. Replaces the previous MobileTerminalView
 * stacked-toolbar layout: a top SessionStatusBar, a full-height terminal
 * viewport, the new SmartKeyStrip, and the existing MobileInputBar (whose
 * long-press = paste-without-execute behavior is preserved verbatim).
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
import AnsiToHtml from "ansi-to-html";

import { cn } from "@/lib/utils";
import { AnsiStripper } from "@/lib/terminal/ansi-stripper";
import { useTerminalTheme } from "@/contexts/AppearanceContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { usePrefersReducedMotion } from "@/hooks/useMobile";
import { sendImageToTerminal } from "@/lib/image-upload";
import { MobileInputBar } from "@/components/terminal/MobileInputBar";
import { AgentExitScreen } from "@/components/terminal/AgentExitScreen";
import { AuthErrorOverlay } from "@/components/terminal/AuthErrorOverlay";
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
import { useViewportDimensions } from "./useViewportDimensions";
import { SessionMetadataSheet } from "./SessionMetadataSheet";

const MAX_OUTPUT_ENTRIES = 2000;
const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', monospace";

interface OutputEntry {
  id: number;
  html: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getAnsiColors(theme: ReturnType<typeof useTerminalTheme>): string[] {
  return [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
}

function createAnsiConverter(theme: ReturnType<typeof useTerminalTheme>): AnsiToHtml {
  return new AnsiToHtml({
    fg: theme.foreground,
    bg: "transparent",
    colors: getAnsiColors(theme),
    escapeXML: true,
    stream: true,
  });
}

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
  const theme = useTerminalTheme();
  const sessionCtx = useSessionContext();
  const { currentPreferences } = usePreferencesContext();
  const fontFamily = currentPreferences.fontFamily || DEFAULT_FONT_FAMILY;

  const liveRegionId = useId();

  // ── Output rendering refs/state ─────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<HTMLTextAreaElement>(null);
  const converterRef = useRef<AnsiToHtml | null>(null);
  const stripperRef = useRef(new AnsiStripper());
  const lineIdRef = useRef(0);
  const userScrolledUpRef = useRef(false);

  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
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

  // ── ANSI converter management ───────────────────────────────────────────
  if (converterRef.current == null) {
    converterRef.current = createAnsiConverter(theme);
  }
  useEffect(() => {
    converterRef.current = createAnsiConverter(theme);
  }, [theme]);

  // ── Viewport-driven cols/rows ───────────────────────────────────────────
  // PTY/tmux dimensions are recomputed from the rendered viewport's pixel
  // size and the current mono font. Updates on viewport resize (soft
  // keyboard, rotation), font-family change (preferences), and font-size
  // change (pinch zoom). Sent to the server via `sendResize` below.
  const { ref: viewportRef, dimensions } = useViewportDimensions({
    fontFamily,
    fontSize,
  });

  // ── Modifier latch ──────────────────────────────────────────────────────
  const latch = useModifierLatch();

  // ── Append output ───────────────────────────────────────────────────────
  const appendAnsiOutput = useCallback((ansi: string) => {
    const converter = converterRef.current;
    if (!converter) return;
    const cleaned = stripperRef.current.process(ansi);
    if (!cleaned) return;
    const html = converter.toHtml(cleaned);
    if (!html) return;
    setOutputEntries((prev) => {
      const newEntry: OutputEntry = { id: lineIdRef.current++, html };
      const updated = [...prev, newEntry];
      return updated.length > MAX_OUTPUT_ENTRIES
        ? updated.slice(-MAX_OUTPUT_ENTRIES)
        : updated;
    });
  }, []);

  const handleOutput = useCallback(
    (data: string) => {
      appendAnsiOutput(data);
    },
    [appendAnsiOutput]
  );

  const handleStatusMessage = useCallback(
    (message: string) => {
      appendAnsiOutput("\r\n" + message + "\r\n");
    },
    [appendAnsiOutput]
  );

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
    setOutputEntries([]);
    lineIdRef.current = 0;
    converterRef.current = createAnsiConverter(theme);
    stripperRef.current.reset();
  }, [theme]);

  // ── WebSocket connection ────────────────────────────────────────────────
  // Snapshot the *initial* dimensions for the WebSocket URL params. The
  // hook re-establishes the connection when these change, which we don't
  // want — runtime resizes are sent via `sendResize` instead. We freeze
  // the values at first mount via lazy `useState` initializers (read-
  // during-render ref values trip the react-hooks/refs rule).
  const [initialCols] = useState(() => dimensions.cols);
  const [initialRows] = useState(() => dimensions.rows);

  const {
    wsRef,
    status,
    authError,
    sendInput,
    sendResize,
    sendRestartAgent,
  } = useTerminalWebSocket({
    sessionId: session.id,
    tmuxSessionName: session.tmuxSessionName,
    projectPath: session.projectPath,
    wsUrl,
    terminalType: session.terminalType ?? "shell",
    tmuxHistoryLimit,
    environmentVars,
    initialCols,
    initialRows,
    notificationsEnabled,
    sessionName: session.name,
    onOutput: handleOutput,
    onAgentExited: handleAgentExited,
    onAgentRestarted: handleAgentRestarted,
    onStatusMessage: handleStatusMessage,
  });

  // Send a `resize` message to the server whenever the computed cols/rows
  // change. The first emission (matching initialCols/initialRows) is
  // skipped — the server already has those from the URL — but we send on
  // any subsequent change once the socket is connected.
  const lastSentDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  useEffect(() => {
    if (status !== "connected") return;
    if (lastSentDimsRef.current === null) {
      // First connection — server already has the URL-param dims. Mark
      // the baseline so subsequent diffs only fire on real changes.
      lastSentDimsRef.current = { cols: initialCols, rows: initialRows };
    }
    const last = lastSentDimsRef.current;
    if (last.cols === dimensions.cols && last.rows === dimensions.rows) return;
    sendResize(dimensions.cols, dimensions.rows);
    lastSentDimsRef.current = { cols: dimensions.cols, rows: dimensions.rows };
  }, [status, dimensions.cols, dimensions.rows, sendResize, initialCols, initialRows]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    if (userScrolledUpRef.current) return;
    anchorRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [outputEntries, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  // ── Pinch-to-zoom on the output panel ───────────────────────────────────
  const pinch = usePinchZoom({
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

  // ── Smart-key strip dispatcher ──────────────────────────────────────────
  const handleSmartKey = useCallback(
    (sequence: string) => {
      sendInput(sequence);
    },
    [sendInput]
  );

  // ── Image upload handler (preserved for parity with old view) ──────────
  const handleImageUpload = useCallback(
    async (file: File) => {
      await sendImageToTerminal(file, wsRef.current);
    },
    [wsRef]
  );
  // Currently the new strip doesn't surface the camera/image affordance. We
  // intentionally drop it from Phase 3 chrome, image upload still happens
  // through the long-press paste flow on MobileInputBar via the OS share
  // sheet. We keep the helper available because the metadata sheet may
  // expose it as a future menu item.
  void handleImageUpload;

  // ── Agent restart / close ───────────────────────────────────────────────
  const handleAgentRestart = useCallback(() => {
    setIsRestarting(true);
    sendRestartAgent();
  }, [sendRestartAgent]);

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

  // ── Background styling (matches terminal theme) ────────────────────────
  const bgOpacity = theme.opacity / 100;
  const outputBg =
    bgOpacity < 1 ? hexToRgba(theme.background, bgOpacity) : theme.background;

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

          touchAction: "pan-y" tells the browser we own pinch (and any
          horizontal pan), but allow native vertical scroll. Belt-and-
          braces: `usePinchZoom` also owns native (non-passive)
          touchstart/touchmove listeners so it can preventDefault() the
          browser's pinch-zoom on multi-touch — `touch-action: pan-y`
          alone is unreliable on iOS Safari 15+, where two-finger
          gestures may stop firing `touchmove` on a pan-y element. Do
          not change to "none": that breaks single-finger vertical
          scroll-back through scrollback history. */}
      <div
        ref={(node) => {
          scrollRef.current = node;
          pinch.ref(node);
          viewportRef(node);
        }}
        onScroll={handleScroll}
        data-testid="mobile-session-output"
        data-font-size={fontSize}
        data-cols={dimensions.cols}
        data-rows={dimensions.rows}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{
          backgroundColor: outputBg,
          color: theme.foreground,
          touchAction: "pan-y",
        }}
        aria-describedby={liveRegionId}
      >
        <pre
          className="p-2 leading-relaxed font-mono whitespace-pre-wrap break-words min-h-full"
          style={{
            fontFamily,
            fontSize: `${fontSize}px`,
          }}
        >
          {outputEntries.map((entry) => (
            <span
              key={entry.id}
              dangerouslySetInnerHTML={{ __html: entry.html }}
            />
          ))}
          <span ref={anchorRef} />
        </pre>
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
        onSubmit={sendInput}
        onModifiedKeyPress={sendInput}
        modifierActive={latch.anyActive}
        resolveKey={latch.resolveKey}
        onHeightChange={scrollToBottom}
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

      {authError ? <AuthErrorOverlay message={authError} /> : null}

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
