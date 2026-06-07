"use client";

/**
 * EmbeddedSessionView — terminal canvas only, wired to the rdv-bridge.
 *
 * Rendered by `/m/session/[id]/page.tsx` inside a layout that excludes
 * MobileShell and the bottom tab bar. The native Flutter shell wraps
 * this view and supplies its own status bar, smart-key strip, and input
 * bar — those are NOT rendered here.
 *
 * On mount we install `window.rdvBridge` with handlers backed by the
 * terminal's imperative API (`sendInput`, `scrollToBottom`, etc). On
 * unmount we uninstall the bridge so the next route can install its
 * own.
 *
 * Outbound events:
 *   - onTerminalReady fires after the terminal mounts (microtask) so
 *     the native shell can clear its splash screen.
 *   - onActivity forwards live agent activity-status transitions (from
 *     the session WebSocket) to the native shell so it can drive the
 *     in-session status-bar pip (remote-dev-sguu).
 *   - onFontSizeChanged fires on a pinch-zoom commit with `{ px }` (the
 *     committed absolute terminal font size) so the native shell mirrors
 *     it into its appearance store and suppresses the echo `setFontSize`
 *     it would otherwise push back into this WebView (remote-dev-u5q5.3).
 *
 * @see docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TerminalWithKeyboard,
  type TerminalWithKeyboardRef,
} from "@/components/terminal/TerminalWithKeyboard";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import {
  hydrateNotification,
  useNotificationContext,
} from "@/contexts/NotificationContext";
import { usePinchZoom } from "@/components/mobile/session/usePinchZoom";
import {
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
  type RdvBridgeKeyMods,
} from "@/lib/rdv-bridge";
import type { TerminalSession } from "@/types/session";
import type { AgentActivityStatus, TerminalType } from "@/types/terminal-type";

// Mirror the constants used by MobileSessionView so the JS-side pinch
// handler clamps to the same range as the existing PWA pinch.
const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', monospace";

function clampFontSize(size: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
}

// The full AgentActivityStatus union (src/types/terminal-type.ts). The WS
// broadcast hands us a raw string, so we validate against this set before
// forwarding to native — an unknown status is dropped rather than rendered
// as a bogus pip. The `Record<AgentActivityStatus, true>` map is what ties
// this to the type: it FAILS compilation if a union member is missing here,
// so adding a status to `AgentActivityStatus` forces it to be listed too.
const KNOWN_ACTIVITY_STATUS_MAP: Record<AgentActivityStatus, true> = {
  running: true,
  waiting: true,
  idle: true,
  error: true,
  compacting: true,
  ended: true,
  subagent: true,
};
const KNOWN_ACTIVITY_STATUSES = new Set<string>(
  Object.keys(KNOWN_ACTIVITY_STATUS_MAP),
);

function isKnownActivityStatus(status: string): status is AgentActivityStatus {
  return KNOWN_ACTIVITY_STATUSES.has(status);
}

/** Decode a base64 string into a Uint8Array (no atob streaming surprises). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export interface EmbeddedSessionViewProps {
  session: {
    id: string;
    name: string;
    tmuxSessionName: string;
    status: "active" | "suspended" | "closed";
    /**
     * Optional richer session shape used by the agent SessionEndedOverlay
     * (Restart / Delete flow). When absent the overlay falls back to a
     * minimal shell behavior — Restart is wired through `restartAgent`
     * and Delete still works via the DELETE /api/sessions/:id call.
     */
    terminalType?: TerminalType;
    projectPath?: string | null;
    worktreeBranch?: string | null;
    githubRepoId?: string | null;
  };
  wsUrl: string;
}

/** Map a smart-key name + mods into the byte sequence the PTY expects. */
function keyToBytes(name: string, mods: RdvBridgeKeyMods): string {
  // Minimal mapping for v1 — extended in later phases as the native
  // smart-key strip lights up more keys. Unknown names are dropped to
  // avoid sending garbage to the PTY.
  if (mods.ctrl && name.length === 1) {
    // Ctrl+letter → control byte (only A-Z covered).
    const upper = name.toUpperCase().charCodeAt(0);
    if (upper >= 65 && upper <= 90) {
      return String.fromCharCode(upper - 64);
    }
  }
  switch (name) {
    case "Tab":
      return "\t";
    case "Escape":
    case "Esc":
      return "\x1b";
    case "Enter":
      return "\r";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    default:
      return "";
  }
}

export function EmbeddedSessionView({
  session,
  wsUrl,
}: EmbeddedSessionViewProps) {
  const terminalRef = useRef<TerminalWithKeyboardRef | null>(null);
  const { currentPreferences, updateUserSettings } = usePreferencesContext();
  const { addNotification } = useNotificationContext();

  const fontFamily = currentPreferences.fontFamily || DEFAULT_FONT_FAMILY;

  // Font-size (pinch zoom). Mirror MobileSessionView's pattern: seed
  // from prefs once they're available, then let pinch own it.
  //
  // The lazy `useState` initializer prefers a finite `currentPreferences.fontSize`
  // and falls through to DEFAULT_FONT_SIZE otherwise. Using `Number.isFinite`
  // (not `typeof === "number"`) rejects NaN/±Infinity which would poison
  // downstream Math.max/min.
  const [fontSize, setFontSize] = useState<number>(() => {
    const seed = Number.isFinite(currentPreferences.fontSize)
      ? currentPreferences.fontSize
      : DEFAULT_FONT_SIZE;
    return clampFontSize(seed);
  });
  const fontSizeBaselineRef = useRef<number>(fontSize);
  // Latches once we've reconciled to a real upstream prefs value. After
  // this flips to true, the reconciliation effect is a no-op forever, so
  // a user pinching to N px won't be reverted by a later prefs change
  // (e.g. a desktop preference update mid-session). Pre-latch in the
  // lazy initializer if prefs were already settled at first render.
  const seededFromUpstreamRef = useRef<boolean>(
    Number.isFinite(currentPreferences.fontSize)
  );

  // ── Pinch-to-zoom on the embedded terminal viewport ──────────────────
  // Live updates fire on every drag frame via onScale, while onScaleCommit
  // fires exactly once at gesture-end and is where we persist through
  // /api/preferences. Identical clamping to MobileSessionView keeps PWA
  // and Flutter embed behavior in sync.
  const { ref: pinchRef } = usePinchZoom({
    onScale: (factor) => {
      const next = clampFontSize(fontSizeBaselineRef.current * factor);
      if (next !== fontSize) setFontSize(next);
    },
    onScaleCommit: (factor) => {
      const next = clampFontSize(fontSizeBaselineRef.current * factor);
      setFontSize(next);
      fontSizeBaselineRef.current = next;
      // The user's first deliberate size choice IS a real upstream value
      // — latch so a later async prefs settle cannot overwrite the pinch.
      seededFromUpstreamRef.current = true;
      // Report the committed absolute size to the native shell so it can
      // mirror it into the "Terminal font size" appearance setting. The
      // native side records this as `_lastBridgeFontSize` and SKIPS the
      // echo setFontSize it would otherwise push back into this WebView
      // (remote-dev-u5q5.3). No-op outside the Flutter WebView.
      notifyToNative("onFontSizeChanged", { px: next }).catch((err) => {
        console.error("onFontSizeChanged notify failed", err);
      });
      updateUserSettings({ fontSize: next }).catch((err) => {
        // Persistence failures shouldn't crash the WebView; surface in
        // console for observability while keeping the UI alive.
        console.error("pinch commit persist failed", err);
      });
    },
  });

  // One-shot post-hydration reconciliation of `fontSize`.
  //
  // The lazy `useState` initializer above runs once with whatever prefs
  // value is available at first render. On a cold start that may be a
  // default that doesn't reflect the user's real saved fontSize. This
  // effect waits until prefs settle and reconciles exactly once. After
  // it latches, pinch owns `fontSize` exclusively — a later prefs change
  // (e.g. desktop edit) will NOT surprise the user mid-session.
  useEffect(() => {
    if (seededFromUpstreamRef.current) return;
    if (!Number.isFinite(currentPreferences.fontSize)) return;
    const clamped = clampFontSize(currentPreferences.fontSize);
    seededFromUpstreamRef.current = true;
    fontSizeBaselineRef.current = clamped;
    if (clamped !== fontSize) {
      setFontSize(clamped);
    }
  }, [currentPreferences.fontSize, fontSize]);

  // Keep the baseline in sync with `fontSize`. After commit/reconcile
  // this is just defensive mirroring: bridge.setFontSize-driven changes
  // (native shell path) flow back into prefs → here as a normal render.
  useEffect(() => {
    if (!seededFromUpstreamRef.current) return;
    fontSizeBaselineRef.current = fontSize;
  }, [fontSize]);

  // ── Notification forwarding ────────────────────────────────────────────
  // The terminal server broadcasts in-app notifications (job done, agent
  // waiting on input, peer message, etc.) over the session WebSocket as
  // `{type: "notification", notification: {...}}` frames. Terminal.tsx
  // surfaces them through the `onNotification` callback; we hydrate the
  // payload (string dates → Date objects) and hand off to the context's
  // `addNotification`, which both inserts the row and fires
  // `fireNotificationToast`. Without this bridge, the embed silently
  // drops every foreground notification even though FCM background push
  // works.
  const handleNotification = useCallback(
    (notification: Record<string, unknown>) => {
      addNotification(hydrateNotification(notification));
    },
    [addNotification],
  );

  // ── Agent activity → native status bar ─────────────────────────────────
  // Terminal.tsx forwards `agent_activity_status` WS broadcasts through
  // `onAgentActivityStatus(sessionId, status)`. The native Flutter shell
  // owns the in-session status bar (mobileChrome="external"), so without
  // this bridge the pip is permanently "Idle". The WS broadcast can be for
  // ANY session on the connection, so we filter to ours, validate the raw
  // status against the known union (dropping anything unexpected), then emit
  // `onActivity` to native.
  const handleAgentActivityStatus = useCallback(
    (statusSessionId: string, status: string) => {
      if (statusSessionId !== session.id) return;
      if (!isKnownActivityStatus(status)) return;
      notifyToNative("onActivity", { state: status }).catch((err) => {
        // Native-side errors shouldn't crash the WebView; surface in console
        // for observability while keeping the UI alive.
        console.error("onActivity notify failed", err);
      });
    },
    [session.id],
  );

  // ── Agent session lifecycle (Restart / Delete from SessionEndedOverlay) ─
  // The overlay only renders when TerminalWithKeyboard receives a full
  // `session` prop (TerminalSession-shaped). The embed page hands us a
  // narrower shape, so we expand it locally to satisfy the overlay's
  // dependencies (worktreeBranch + githubRepoId drive the "delete worktree"
  // confirmation flow). Restart goes through the imperative ref, which
  // sends a `restart_agent` WebSocket frame to the terminal server — the
  // canonical path used by MobileSessionView. Delete uses the standard
  // DELETE /api/sessions/:id endpoint and forwards the `deleteWorktree`
  // flag from the worktree confirmation dialog.
  const handleSessionRestart = useCallback(async () => {
    terminalRef.current?.restartAgent();
  }, []);

  const handleSessionDelete = useCallback(
    async (deleteWorktree?: boolean) => {
      const url = deleteWorktree
        ? `/api/sessions/${session.id}?deleteWorktree=true`
        : `/api/sessions/${session.id}`;
      try {
        const response = await fetch(url, { method: "DELETE" });
        if (!response.ok) {
          throw new Error(`Failed to delete session: ${response.status}`);
        }
      } catch (err) {
        // Surface for debugging; the overlay already resets its
        // local `isDeleting` state via its finally block, so the user
        // can retry. The native shell typically also pops the route
        // when the session goes away, so there's no extra UI to drive.
        console.error("session delete failed", err);
        throw err;
      }
    },
    [session.id],
  );

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: (text) => terminalRef.current?.sendInput(text),
      key: (name, mods) => {
        const bytes = keyToBytes(name, mods);
        if (bytes) terminalRef.current?.sendInput(bytes);
      },
      paste: (text) => terminalRef.current?.sendInput(text),
      setFontSize: (px) => {
        // Bridge handler: the native shell calls this with an ABSOLUTE
        // target px size (the mobile "Terminal font size" setting, or an
        // external caller). Drive LOCAL state ONLY — do NOT persist.
        //
        // Why local state, not just persistence: once the user has pinched
        // (or prefs have settled), `seededFromUpstreamRef` is latched and
        // the one-shot reconciliation effect is a permanent no-op, so a
        // value that only landed in prefs would never flow back into
        // `fontSize`. By setting state + baseline here and re-latching, a
        // native push applies immediately and isn't clobbered by the
        // subsequent prefs settle.
        //
        // Why NO updateUserSettings here (remote-dev-u5q5.3): the native
        // shell pushes this on EVERY onTerminalReady from the Flutter-side
        // "Terminal font size" setting (default 12). `updateUserSettings`
        // PATCHes the USER-level web preference, which is SHARED with desktop
        // — so a passive mobile session-open would silently overwrite the
        // user's desktop terminal font (e.g. 14 → 12). A passive action must
        // never mutate a cross-device pref. The mobile terminal font's source
        // of truth is the Flutter-side setting; the shared web pref is only
        // written by a DELIBERATE pinch gesture (usePinchZoom's onScaleCommit
        // below still calls updateUserSettings), preserving PWA parity.
        if (!Number.isFinite(px)) return;
        const clamped = clampFontSize(px);
        // Setting state from inside a bridge callback is an EVENT handler
        // (native → JS), not a render-phase effect, so it does not trip
        // react-hooks/set-state-in-effect.
        setFontSize(clamped);
        fontSizeBaselineRef.current = clamped;
        seededFromUpstreamRef.current = true;
      },
      setFontScale: (scale) => {
        // Apply the scale to <html> as a CSS variable so sibling embeds
        // (channel / recording) that consume `--rdv-font-scale` stay in
        // visual lockstep when the user switches between routes.
        //
        // The terminal embed itself does NOT visually consume the CSS
        // variable: xterm.js sizes its glyph grid from the JS
        // `terminal.options.fontSize` option (wired to the `fontSize` prop),
        // not from cascaded CSS — so a `font-size: calc(...)` wrapper has no
        // effect on the rendered grid. The terminal now has its OWN absolute
        // size control (the native "Terminal font size" setting → bridge
        // .setFontSize, plus pinch-to-zoom), so this handler deliberately
        // does NOTHING to the terminal font.
        //
        // It used to translate the scale into a px target and persist it via
        // updateUserSettings({ fontSize }). That was the compounding bug
        // (remote-dev-u5q5.3): the native shell pushes setFontScale on EVERY
        // onTerminalReady, and the embed multiplied the *current* stored px
        // by the scale and re-persisted it — so with scale 1.3 the saved
        // size grew on every session open (12→16→21→22…) until clamped, and
        // with 0.85 it shrank to the 9px floor. Dropping the persistence
        // here is the fix: the scale only affects sibling-embed chrome via
        // the CSS var; absolute terminal sizing goes through setFontSize.
        //
        // Validate before writing the CSS var: a NaN/Infinity/non-positive
        // scale would stringify to `--rdv-font-scale: NaN` (etc.) and poison
        // every `calc(... * var(--rdv-font-scale))` consumer in the sibling
        // embeds. Drop the bogus value rather than propagate it.
        if (!Number.isFinite(scale) || scale <= 0) return;
        if (typeof document !== "undefined") {
          document.documentElement.style.setProperty(
            "--rdv-font-scale",
            String(scale),
          );
        }
      },
      setCursorBlink: (blink) => {
        terminalRef.current?.setCursorBlink(blink);
      },
      scrollToBottom: () => terminalRef.current?.scrollToBottom(),
      refit: () => terminalRef.current?.refit(),
      // Search overlay (xterm.js SearchAddon). The Flutter shell wires
      // these to its native "Search" menu action — mobile has no Cmd+F,
      // and the embed renders no in-WebView chrome of its own. The
      // overlay is rendered inside Terminal.tsx with thumb-sized Up/
      // Down/Close buttons; Esc inside the overlay also closes it.
      openSearch: () => terminalRef.current?.openSearch(),
      closeSearch: () => terminalRef.current?.closeSearch(),
      back: () => {
        // Session embed has no in-WebView "back" action — let the
        // native shell pop the route. Returning false signals
        // "not consumed" so the Dart side runs Navigator.maybePop().
        return false;
      },
      uploadImage: (data, mimeType) => {
        // Bridge handler for the Flutter shell's gallery/camera picker.
        // The native side sends base64 over `evaluateJavascript` (the
        // only JSON-safe transport across the WebView boundary); accept
        // raw Uint8Array too for any in-process JS caller.
        //
        // Reuses TerminalWithKeyboard.uploadImage → sendImageToTerminal
        // so the upload + path-paste behavior is identical to the PWA's
        // MobileKeyboard camera button (remote-dev-1y9t).
        try {
          const bytes =
            typeof data === "string" ? base64ToBytes(data) : data;
          // Coerce to an ArrayBuffer to keep TS DOM lib's BlobPart
          // happy across Uint8Array<ArrayBufferLike> vs ArrayBuffer
          // variance. Slicing the underlying buffer copies just the
          // bytes the view covers (no oversized backing buffer).
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const file = new File([ab], `image-${Date.now()}`, {
            type: mimeType,
          });
          terminalRef.current?.uploadImage(file).catch((err) => {
            // Persistence failures shouldn't crash the WebView; surface
            // in console for observability while keeping the UI alive.
            console.error("bridge.uploadImage failed", err);
          });
        } catch (err) {
          console.error("bridge.uploadImage decode failed", err);
        }
      },
    };

    const uninstall = installRdvBridge(adapter);
    // onPageMounted-style signal — fires after the embed view has mounted
    // and the bridge is installed. NOTE: xterm.js + WebSocket init happen
    // asynchronously inside Terminal.tsx, so this event arrives BEFORE the
    // terminal is actually ready to accept input. Phase 0 ships with this
    // looser semantics so the bridge round-trip can be validated in
    // Phase 1.5; Phase 1 native code that drives input should queue
    // commands until xterm has connected (the spec mandates a
    // SessionViewController queue gated on a future "terminal-connected"
    // event).
    queueMicrotask(() => {
      notifyToNative("onTerminalReady", {}).catch((err) => {
        // Native-side errors shouldn't crash the WebView; surface in console
        // for observability while keeping the UI alive.
        console.error("onTerminalReady notify failed", err);
      });
    });

    return uninstall;
    // Empty deps: the bridge install is a true mount-once effect now. None of
    // the adapter handlers close over reactive values — they reference only
    // the terminal ref, the `setFontSize` state setter + the size refs (all
    // stable), `document`, and `notifyToNative`. `setFontSize` takes an
    // absolute px arg and drives local state directly (no persistence), and
    // `setFontScale` only writes the CSS var, so the handlers no longer use
    // `updateUserSettings` or `currentPreferences.fontSize`. The deliberate
    // pinch persistence lives in usePinchZoom's onScaleCommit, outside this
    // effect. Installing once avoids needless bridge re-installs.
  }, []);

  // Inflate the narrow embed-session shape into a full TerminalSession
  // so TerminalWithKeyboard can render the agent SessionEndedOverlay
  // when the agent process exits. Only `terminalType`, `worktreeBranch`,
  // `githubRepoId`, and `projectPath` are actually read by the overlay;
  // the rest are filled with defensible defaults so the type is happy.
  // The fields are stable across renders (driven by the server-rendered
  // page), so a useMemo keeps the object identity steady for downstream
  // ref equality checks.
  const terminalSession = useMemo<TerminalSession>(() => {
    const now = new Date(0);
    return {
      id: session.id,
      userId: "",
      name: session.name,
      tmuxSessionName: session.tmuxSessionName,
      projectPath: session.projectPath ?? null,
      githubRepoId: session.githubRepoId ?? null,
      worktreeBranch: session.worktreeBranch ?? null,
      worktreeType: null,
      projectId: null,
      profileId: null,
      terminalType: session.terminalType ?? "shell",
      agentProvider: null,
      agentExitState: null,
      agentExitCode: null,
      agentExitedAt: null,
      agentRestartCount: 0,
      agentActivityStatus: null,
      typeMetadata: null,
      scopeKey: null,
      parentSessionId: null,
      status: session.status,
      pinned: false,
      tabOrder: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }, [
    session.id,
    session.name,
    session.tmuxSessionName,
    session.projectPath,
    session.githubRepoId,
    session.worktreeBranch,
    session.terminalType,
    session.status,
  ]);

  return (
    <div
      ref={pinchRef}
      data-testid="embedded-session-view"
      data-font-size={fontSize}
      className="relative h-full w-full bg-[#1a1b26]"
    >
      <TerminalWithKeyboard
        ref={terminalRef}
        sessionId={session.id}
        tmuxSessionName={session.tmuxSessionName}
        sessionName={session.name}
        session={terminalSession}
        wsUrl={wsUrl}
        fontSize={fontSize}
        fontFamily={fontFamily}
        mobileChrome="external"
        onNotification={handleNotification}
        onAgentActivityStatus={handleAgentActivityStatus}
        onSessionRestart={handleSessionRestart}
        onSessionDelete={handleSessionDelete}
      />
    </div>
  );
}
