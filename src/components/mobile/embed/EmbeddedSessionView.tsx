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
 *
 * @see docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md §4
 */

import { useEffect, useRef, useState } from "react";

import {
  TerminalWithKeyboard,
  type TerminalWithKeyboardRef,
} from "@/components/terminal/TerminalWithKeyboard";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { usePinchZoom } from "@/components/mobile/session/usePinchZoom";
import {
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
  type RdvBridgeKeyMods,
} from "@/lib/rdv-bridge";

// Mirror the constants used by MobileSessionView so the JS-side pinch
// handler clamps to the same range as the existing PWA pinch.
const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', monospace";

function clampFontSize(size: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size)));
}

export interface EmbeddedSessionViewProps {
  session: {
    id: string;
    name: string;
    tmuxSessionName: string;
    status: "active" | "suspended" | "closed";
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration from async preferences fetch
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

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: (text) => terminalRef.current?.sendInput(text),
      key: (name, mods) => {
        const bytes = keyToBytes(name, mods);
        if (bytes) terminalRef.current?.sendInput(bytes);
      },
      paste: (text) => terminalRef.current?.sendInput(text),
      setFontSize: (px) => {
        // Bridge handler: the native shell calls this with a target px
        // size. We clamp into the PWA's accepted range and persist via
        // PATCH /api/preferences; PreferencesContext re-renders, and the
        // updated `fontSize` flows back to this component on the next
        // render (subject to the seeded-from-upstream latch — once a
        // user has pinched, bridge.setFontSize still persists but does
        // not override the pinched local state mid-session).
        //
        // The JS-side pinch detector (usePinchZoom, bound below) drives
        // its own state + persistence path; this bridge handler remains
        // wired so the native shell or external callers can still set
        // the font directly.
        if (!Number.isFinite(px)) return;
        const clamped = clampFontSize(px);
        updateUserSettings({ fontSize: clamped }).catch((err) => {
          // Persistence failures shouldn't crash the WebView; surface in
          // console for observability while keeping the UI alive.
          console.error("bridge.setFontSize persist failed", err);
        });
      },
      setFontScale: (scale) => {
        // Apply scale as a CSS variable on <html>; the terminal embed
        // doesn't visually consume the variable today but accepts the
        // call so the native shell can fire it on every screen.
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
      back: () => {
        // Session embed has no in-WebView "back" action — let the
        // native shell pop the route. Returning false signals
        // "not consumed" so the Dart side runs Navigator.maybePop().
        return false;
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
    // `updateUserSettings` is stable across renders (memoized by
    // PreferencesContext via useCallback), so reinstalling the bridge
    // on its identity is acceptable. Listing it satisfies
    // react-hooks/exhaustive-deps without churning the install/uninstall
    // cycle in practice.
  }, [updateUserSettings]);

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
        wsUrl={wsUrl}
        fontSize={fontSize}
        fontFamily={fontFamily}
        mobileChrome="external"
      />
    </div>
  );
}
