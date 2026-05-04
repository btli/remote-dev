/**
 * Regression test for remote-dev-3gtr:
 *
 * The desktop terminal didn't apply the user's `fontSize`/`fontFamily`
 * preference on initial mount. PreferencesContext loads asynchronously, so
 * the Terminal component initially mounts with the default (14px). If the
 * preferences resolved during the async xterm initialization window
 * (xterm/addon imports + WebGL load), the font-update effect would re-run
 * with the latest values but bail because `xtermRef.current` was still null.
 * Once `xtermRef.current` was finally assigned, no effect re-fired to apply
 * the now-stale prop, so the terminal stayed at 14px until the session was
 * unmounted/remounted.
 *
 * The fix reconciles `terminal.options.fontSize`/`fontFamily` against the
 * sync-ref values immediately after `xtermRef.current = terminal`. This
 * test exercises that path by deferring the WebGL import until after the
 * parent re-renders with the new fontSize.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { useState, useEffect } from "react";

// Capture every XTerm instance created so we can assert against options
const xtermInstances: Array<{
  options: { fontSize: number; fontFamily: string; [k: string]: unknown };
}> = [];

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    options: {
      fontSize: number;
      fontFamily: string;
      [k: string]: unknown;
    };
    cols = 80;
    rows = 24;
    textarea: HTMLTextAreaElement;
    buffer = {
      active: { type: "normal" as const, viewportY: 0, baseY: 0 },
      onBufferChange: () => ({ dispose: () => {} }),
    };
    constructor(options: Record<string, unknown>) {
      this.options = {
        ...options,
        fontSize: (options.fontSize as number) ?? 14,
        fontFamily: (options.fontFamily as string) ?? "monospace",
      };
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
    attachCustomKeyEventHandler() {}
    focus() {}
    write() {}
    writeln() {}
    dispose() {}
    scrollToBottom() {}
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

// Hold-and-release controller for the WebGL import so the test can pause init
// at the exact moment xtermRef.current is still null but the addons exist.
let webglRelease: (() => void) | null = null;
const webglDeferred = new Promise<void>((resolve) => {
  webglRelease = resolve;
});

vi.mock("@xterm/addon-webgl", async () => {
  // Block until the test releases — this widens the race window.
  await webglDeferred;
  return {
    WebglAddon: class {
      activate() {}
      dispose() {}
      onContextLoss() {
        return { dispose: () => {} };
      }
    },
  };
});

// Mock theme + notifications hooks Terminal depends on
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
  useNotifications: () => ({
    recordActivity: () => {},
    notify: () => {},
  }),
}));

// Also mock the network token fetch the connect() path makes — we don't
// need WebSocket success for this test.
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    } as Response)
  ) as unknown as typeof fetch;
  // Stub document.fonts so the font-update effect doesn't await indefinitely
  // happy-dom doesn't ship FontFaceSet by default.
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        load: () => Promise.resolve([]),
        ready: Promise.resolve(),
      },
    });
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  xtermInstances.length = 0;
  cleanup();
});

// Lazily import Terminal AFTER mocks are registered
async function getTerminal() {
  const mod = await import("./Terminal");
  return mod.Terminal;
}

/**
 * Wrapper that simulates the PreferencesContext loading pattern: starts with
 * a default fontSize and switches to the user's value after a microtask.
 */
function PrefsHarness({ initialFontSize, finalFontSize }: { initialFontSize: number; finalFontSize: number }) {
  const [fontSize, setFontSize] = useState(initialFontSize);
  // Bumps fontSize once on mount, mimicking PreferencesContext resolving its
  // /api/preferences fetch a tick after the Terminal mounts.
  useEffect(() => {
    const id = setTimeout(() => setFontSize(finalFontSize), 0);
    return () => clearTimeout(id);
  }, [finalFontSize]);

  // Render Terminal lazily — caller wires this up
  return <TerminalUnderTest fontSize={fontSize} />;
}

let TerminalUnderTest: (props: { fontSize: number }) => React.ReactElement;

describe("Terminal fontSize race (remote-dev-3gtr)", () => {
  it("applies latest fontSize even when prefs resolve during async init", async () => {
    const Terminal = await getTerminal();

    function TerminalWrapper({ fontSize }: { fontSize: number }) {
      return (
        <Terminal
          sessionId="s1"
          tmuxSessionName="rdv-s1"
          wsUrl="ws://localhost:0"
          fontSize={fontSize}
          fontFamily="'TestFont', monospace"
          scrollback={1000}
          tmuxHistoryLimit={1000}
          terminalType="shell"
          isActive
        />
      );
    }
    TerminalUnderTest = TerminalWrapper;

    await act(async () => {
      render(<PrefsHarness initialFontSize={14} finalFontSize={20} />);
    });

    // Let the harness's setTimeout fire so the parent re-renders with 20.
    // The XTerm constructor has already run (with 14), but xtermRef.current
    // is gated behind the WebGL await, which we have not released yet.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // At this point, the XTerm instance was created with the stale 14
    expect(xtermInstances.length).toBeGreaterThanOrEqual(1);
    const xterm = xtermInstances[0]!;

    // Now release the WebGL import so init can finish and assign xtermRef.
    // The fix runs the post-init reconciliation synchronously after
    // xtermRef.current = terminal, before the async font-update effect can
    // re-fire. The reconciliation reads `fontSizeRef.current` — which the
    // sync-ref effect already updated to 20.
    expect(webglRelease).not.toBeNull();
    webglRelease!();

    await act(async () => {
      // Flush the WebGL import + the post-init reconciliation
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(xterm.options.fontSize).toBe(20);
  });
});
