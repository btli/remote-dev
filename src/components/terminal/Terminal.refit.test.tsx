/**
 * Regression test for remote-dev-u5q5.2:
 *
 * Inside a Flutter platform WebView, app background→resume and route
 * pop-back produce no page-level resize / visibilitychange / visualViewport
 * events, so Terminal.tsx's in-page resize pipeline never runs and the
 * xterm.js grid goes stale until the user pinch-zooms. The native shell
 * therefore calls the imperative `refit()` (exposed on TerminalRef → wired
 * to the rdv-bridge) on those lifecycle edges.
 *
 * `refit()` mirrors the visibilitychange handler's intent (re-assert focus
 * so the server re-elects this client as primary, settle + fit + ws-resize,
 * scroll the viewport to the bottom) but deliberately omits
 * `terminal.focus()` — on mobile the terminal runs with xterm's textarea
 * disabled and the native shell owns the keyboard, so focusing here would
 * steal the keyboard context.
 *
 * This test asserts that calling `ref.refit()` drives the terminal's
 * scrollToBottom (an observable proxy for the refit pipeline running), that
 * it forces a fresh `client_focus` frame past the client-side dedupe before
 * the resize (Codex Fix 1 — the dedupe-trap on lifecycle edges), and that it
 * is a safe no-op before the terminal has finished initializing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import { createRef } from "react";

import type { TerminalRef } from "./Terminal";

// Capture every XTerm instance so we can assert against its methods + textarea.
const xtermInstances: Array<{
  scrollToBottom: ReturnType<typeof vi.fn>;
  textarea: HTMLTextAreaElement;
}> = [];

// ── Recording WebSocket mock ──────────────────────────────────────────────
// The focus-frame assertion needs an OPEN socket that records sent frames.
// Terminal.tsx's sendFocusSignal only sends when ws.readyState === OPEN, so a
// plain 401 (no socket) wouldn't exercise the dedupe path. This minimal mock
// opens synchronously-ish (onopen fired on a microtask) and captures every
// JSON frame the component sends.
const wsInstances: MockWebSocket[] = [];
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 1; // OPEN immediately so post-open sends land
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    wsInstances.push(this);
    // Fire onopen on a microtask so the component's onopen handler runs.
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  /** Parsed frame `type`s in send order. */
  sentTypes(): string[] {
    return this.sent.map((s) => {
      try {
        return JSON.parse(s).type as string;
      } catch {
        return "";
      }
    });
  }
}

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    textarea: HTMLTextAreaElement;
    scrollToBottom = vi.fn();
    buffer = {
      active: { type: "normal" as const, viewportY: 0, baseY: 0 },
      onBufferChange: () => ({ dispose: () => {} }),
    };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.textarea = document.createElement("textarea");
      xtermInstances.push(this);
    }
    loadAddon() {}
    open() {}
    onData() {
      return { dispose: () => {} };
    }
    onScroll() {
      return { dispose: () => {} };
    }
    onLineFeed() {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler() {}
    focus() {}
    write() {}
    writeln() {}
    dispose() {}
    clear() {}
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    fit() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate() {}
    dispose() {}
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// WebGL is optional; make it fail fast so init doesn't await a real import.
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      throw new Error("no webgl in test");
    }
  },
}));

vi.mock("@/contexts/AppearanceContext", () => ({
  useTerminalTheme: () => ({
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "#444444",
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    brightBlack: "#444444",
    brightRed: "#ff4444",
    brightGreen: "#44ff44",
    brightYellow: "#ffff44",
    brightBlue: "#4444ff",
    brightMagenta: "#ff44ff",
    brightCyan: "#44ffff",
    brightWhite: "#ffffff",
    cursorStyle: "block" as const,
    opacity: 100,
    blur: 0,
  }),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ recordActivity: () => {}, notify: () => {} }),
}));

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
beforeEach(() => {
  // Token endpoint succeeds so connect() proceeds to open a WebSocket; any
  // other URL resolves benignly. The focus-frame test needs a live socket.
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/token")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "test-token" }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: () => Promise.resolve([]), ready: Promise.resolve() },
    });
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  xtermInstances.length = 0;
  wsInstances.length = 0;
  cleanup();
});

async function getTerminal() {
  const mod = await import("./Terminal");
  return mod.Terminal;
}

describe("Terminal.refit (remote-dev-u5q5.2)", () => {
  it("is a safe no-op before the terminal has initialized", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    // Render but do NOT flush async init — xtermRef is still null. refit()
    // must not throw.
    render(
      <Terminal
        ref={ref}
        sessionId="s1"
        tmuxSessionName="rdv-s1"
        wsUrl="ws://localhost:0"
        fontSize={14}
        fontFamily="'TestFont', monospace"
        terminalType="shell"
      />
    );

    expect(() => ref.current?.refit()).not.toThrow();
  });

  it("scrolls the terminal to the bottom when refit() runs", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    await act(async () => {
      render(
        <Terminal
          ref={ref}
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          fontSize={14}
          fontFamily="'TestFont', monospace"
          terminalType="shell"
          isActive
        />
      );
    });

    // Let the async xterm init complete so xtermRef + the refit closures are
    // wired up. Poll for the xterm instance rather than sleeping a fixed tick:
    // under parallel vitest workers the awaited init chain (mount → token
    // fetch → addon load) can take longer than any single fixed delay, which
    // made the old `setTimeout(20)` race and intermittently assert against an
    // empty `xtermInstances`.
    await waitFor(() => {
      expect(xtermInstances.length).toBeGreaterThanOrEqual(1);
    });
    const xterm = xtermInstances[0]!;
    xterm.scrollToBottom.mockClear();

    act(() => {
      ref.current?.refit();
    });

    // refit() calls scrollToBottom directly (the settle+fit half no-ops in a
    // zero-size jsdom container, but scrollToBottom is unconditional and is a
    // faithful proxy that the imperative path executed).
    expect(xterm.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("forces a fresh client_focus frame past the dedupe (Codex Fix 1)", async () => {
    const Terminal = await getTerminal();
    const ref = createRef<TerminalRef>();

    await act(async () => {
      render(
        <Terminal
          ref={ref}
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          fontSize={14}
          fontFamily="'TestFont', monospace"
          terminalType="shell"
          isActive
        />
      );
    });

    // Flush async init deterministically: xterm mounts, the token fetch
    // resolves, and the component opens its WebSocket. The init effect can
    // briefly open a throwaway socket and reconnect to a fresh one, so the
    // observable target is the *live* (OPEN) socket whose onopen has already
    // fired — `sent.length >= 1` proves the initial focus/blur frame landed,
    // which is exactly the state the dedupe assertion below depends on.
    //
    // The old `await new Promise(r => setTimeout(r, 20))` raced this: under
    // parallel vitest workers a fixed tick sometimes fired before the reconnect
    // settled, leaving `wsInstances[0]` pointing at the closed throwaway socket
    // (empty `sent`) instead of the live one — an intermittent failure that
    // passed in isolation and on re-run. Polling for the live socket removes
    // the timing dependency without weakening the assertion.
    const liveSocket = () =>
      [...wsInstances]
        .reverse()
        .find((w) => w.readyState === MockWebSocket.OPEN && w.sent.length >= 1);
    await waitFor(() => {
      expect(liveSocket()).toBeDefined();
    });
    const ws = liveSocket()!;
    const xterm = xtermInstances[0]!;

    // Drive the last-sent focus state to "focus" via the per-terminal focus
    // listener, exactly like a real focus would. This is the dedupe TRAP:
    // after this, lastSentFocusStateRef === "focus", so a plain refit focus
    // signal would be swallowed.
    act(() => {
      xterm.textarea.dispatchEvent(new Event("focus"));
    });
    expect(ws.sentTypes()).toContain("client_focus");

    // Clear the recording, then refit. With Fix 1, refit clears the baseline
    // and re-sends, so a NEW client_focus MUST appear even though the last
    // sent state was already "focus".
    ws.sent.length = 0;
    act(() => {
      ref.current?.refit();
    });

    expect(ws.sentTypes()).toContain("client_focus");
  });
});
