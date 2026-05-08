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
import {
  installRdvBridge,
  notifyToNative,
  type RdvBridgeAdapter,
  type RdvBridgeKeyMods,
} from "@/lib/rdv-bridge";

export interface EmbeddedSessionViewProps {
  session: {
    id: string;
    name: string;
    tmuxSessionName: string;
    status: "active" | "suspended" | "closed";
  };
  wsUrl: string;
  initialFontSize?: number;
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
  initialFontSize,
}: EmbeddedSessionViewProps) {
  const terminalRef = useRef<TerminalWithKeyboardRef | null>(null);

  useEffect(() => {
    const adapter: RdvBridgeAdapter = {
      input: (text) => terminalRef.current?.sendInput(text),
      key: (name, mods) => {
        const bytes = keyToBytes(name, mods);
        if (bytes) terminalRef.current?.sendInput(bytes);
      },
      paste: (text) => terminalRef.current?.sendInput(text),
      setFontSize: (_px) => {
        // Phase 0 stub — pinch-zoom font size lands in Phase 2 alongside
        // the native pinch gesture; for now we ignore so the bridge
        // method is callable without effect.
      },
      scrollToBottom: () => terminalRef.current?.scrollToBottom(),
      back: () => {
        // Session embed has no in-WebView "back" action — native shell
        // pops the route. Stub.
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
  }, []);

  return (
    <div className="relative h-full w-full bg-[#1a1b26]">
      <TerminalWithKeyboard
        ref={terminalRef}
        sessionId={session.id}
        tmuxSessionName={session.tmuxSessionName}
        sessionName={session.name}
        wsUrl={wsUrl}
        fontSize={initialFontSize}
        mobileChrome="external"
      />
    </div>
  );
}
