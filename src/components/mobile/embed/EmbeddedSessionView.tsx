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

import { useEffect, useRef } from "react";

import {
  TerminalWithKeyboard,
  type TerminalWithKeyboardRef,
} from "@/components/terminal/TerminalWithKeyboard";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import {
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
  type RdvBridgeKeyMods,
} from "@/lib/rdv-bridge";

// Mirror the constants used by MobileSessionView so a future JS-side
// pinch handler clamps to the same range as the existing PWA pinch.
const FONT_SIZE_MIN = 9;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', monospace";

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

  // Source the terminal font from user prefs. Mirror the
  // `Number.isFinite` guard MobileSessionView uses so a missing/NaN
  // payload from a still-loading provider falls through to the xterm
  // default instead of rendering at NaN px.
  //
  // NOTE: There is no JS-side pinch handler yet — pinch persistence
  // arrives via `bridge.setFontSize` (wired below) which writes through
  // to /api/preferences; the resulting prefs re-render lands the new
  // size on the terminal. A follow-up PR will add a touch-event pinch
  // detector that calls bridge.setFontSize directly from the web side.
  const fontSize = Number.isFinite(currentPreferences.fontSize)
    ? currentPreferences.fontSize
    : undefined;
  const fontFamily = currentPreferences.fontFamily || DEFAULT_FONT_FAMILY;

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: (text) => terminalRef.current?.sendInput(text),
      key: (name, mods) => {
        const bytes = keyToBytes(name, mods);
        if (bytes) terminalRef.current?.sendInput(bytes);
      },
      paste: (text) => terminalRef.current?.sendInput(text),
      setFontSize: (px) => {
        // Bridge handler: the native shell (or a future JS pinch
        // detector) calls this with a target px size. We clamp into the
        // PWA's accepted range and persist via PATCH /api/preferences;
        // PreferencesContext re-renders, the new `fontSize` flows down
        // through this component, and the terminal picks it up. This
        // keeps a single canonical source of truth (user prefs) rather
        // than maintaining a parallel native-side font scale.
        if (!Number.isFinite(px)) return;
        const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(px)));
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
    <div className="relative h-full w-full bg-[#1a1b26]">
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
