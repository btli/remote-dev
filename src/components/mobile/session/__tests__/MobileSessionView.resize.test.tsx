/**
 * MobileSessionView resize + font preferences tests.
 *
 * Covers the fixes for remote-dev-vexb:
 *   1. ResizeObserver fires → `sendResize` is called with computed
 *      cols/rows.
 *   2. Pinch-to-zoom (fontSize change) → `sendResize` is called and
 *      smaller font produces more cols.
 *   3. Min cols/rows floor (cols ≥ 20, rows ≥ 5) for tiny viewports.
 *   4. `fontFamily` from `PreferencesContext` is applied to the `<pre>`
 *      block style.
 *   5. Initial fontSize falls back to `prefs.fontSize` when no
 *      `initialFontSize` prop is supplied.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { MobileSessionView } from "@/components/mobile/session/MobileSessionView";
import { clearCharWidthCacheForTesting } from "@/components/mobile/session/useViewportDimensions";
import type { TerminalSession } from "@/types/session";

// ── ResizeObserver mock ───────────────────────────────────────────────
// happy-dom doesn't ship ResizeObserver. Capture the latest registered
// instance so tests can manually trigger it with synthetic dimensions.

class MockResizeObserver {
  callback: ResizeObserverCallback;
  observed: Element | null = null;
  observe = vi.fn((target: Element) => {
    this.observed = target;
  });
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    MockResizeObserver.last = this;
  }
  trigger(width: number, height: number) {
    const entry = {
      contentRect: { width, height } as DOMRectReadOnly,
      target: this.observed ?? document.body,
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  static last: MockResizeObserver | null = null;
}

(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

// ── Stub element-size measurement ─────────────────────────────────────
// happy-dom returns 0×0 for getBoundingClientRect. We monkey-patch it
// so that:
//   - the off-screen `<span>` measurement returns a width proportional
//     to the rendered text length × the styled font-size × 0.6 (a
//     reasonable mono-font heuristic), and
//   - the viewport `<div>` returns the dimensions stashed via
//     `setMockViewportSize`.
// This produces deterministic cols/rows the tests can reason about.

const VIEWPORT_TESTID = "mobile-session-output";
let mockViewportSize: { width: number; height: number } = {
  width: 600,
  height: 800,
};

function setMockViewportSize(width: number, height: number) {
  mockViewportSize = { width, height };
}

const originalGetBCR = Element.prototype.getBoundingClientRect;

function installRectStub() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (
      this instanceof HTMLElement &&
      this.dataset?.testid === VIEWPORT_TESTID
    ) {
      const { width, height } = mockViewportSize;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    }
    if (this instanceof HTMLElement && this.tagName === "SPAN") {
      // Off-screen char-width probe span.
      const text = this.textContent ?? "";
      const fontSizeStr = this.style.fontSize || "12px";
      const fs = parseFloat(fontSizeStr);
      const charW = fs * 0.6;
      const width = text.length * charW;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: fs,
        width,
        height: fs,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return originalGetBCR.call(this);
  };
}

function uninstallRectStub() {
  Element.prototype.getBoundingClientRect = originalGetBCR;
}

// ── Hook + context mocks ──────────────────────────────────────────────

const sendResize = vi.fn();
let mockStatus: "connected" | "connecting" = "connected";

vi.mock("@/hooks/useTerminalWebSocket", () => ({
  useTerminalWebSocket: ({
    initialCols,
    initialRows,
  }: {
    initialCols: number;
    initialRows: number;
  }) => {
    // Expose initialCols/initialRows for assertions via a side channel.
    (
      globalThis as unknown as {
        __lastInitialDims: { cols: number; rows: number };
      }
    ).__lastInitialDims = { cols: initialCols, rows: initialRows };
    return {
      wsRef: { current: null },
      status: mockStatus,
      authError: null,
      sendInput: vi.fn(),
      sendResize,
      sendRestartAgent: vi.fn(),
      markIntentionalExit: vi.fn(),
    };
  },
}));

vi.mock("@/contexts/AppearanceContext", () => ({
  useTerminalTheme: () => ({
    background: "#000000",
    foreground: "#ffffff",
    opacity: 100,
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
  }),
}));

vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => false,
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    activeSessionId: "session-1",
    getAgentActivityStatus: () => "idle",
  }),
}));

let mockPreferences: { fontFamily: string | null; fontSize: number | null } = {
  fontFamily: "MockMono, monospace",
  fontSize: 14,
};

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    currentPreferences: {
      fontFamily: mockPreferences.fontFamily,
      fontSize: mockPreferences.fontSize,
    },
  }),
}));

// Replace heavy children with thin stubs so we don't need to wire all
// their dependencies. We only care about the output viewport + resize
// behavior in this file.
vi.mock("@/components/terminal/MobileInputBar", () => ({
  MobileInputBar: () => <div data-testid="stub-input-bar" />,
}));
vi.mock("@/components/terminal/AgentExitScreen", () => ({
  AgentExitScreen: () => null,
}));
vi.mock("@/components/terminal/AuthErrorOverlay", () => ({
  AuthErrorOverlay: () => null,
}));
vi.mock("@/components/mobile/session/SmartKeyStrip", () => ({
  SmartKeyStrip: () => <div data-testid="stub-smart-key-strip" />,
}));
vi.mock("@/components/mobile/session/SessionStatusBar", () => ({
  SessionStatusBar: () => <div data-testid="stub-status-bar" />,
}));
vi.mock("@/components/mobile/session/SessionMetadataSheet", () => ({
  SessionMetadataSheet: () => null,
}));
vi.mock("@/components/mobile/session/usePinchZoom", () => ({
  // Expose the onScale hook to tests via window so we can simulate a
  // pinch-driven font-size change without dispatching real touch events.
  usePinchZoom: (opts: {
    onScale?: (factor: number) => void;
    onScaleCommit?: (factor: number) => void;
  }) => {
    (
      globalThis as unknown as {
        __pinch: typeof opts;
      }
    ).__pinch = opts;
    return { ref: () => {} };
  },
}));
vi.mock("@/components/mobile/session/useModifierLatch", () => ({
  useModifierLatch: () => ({
    state: { ctrl: false, alt: false, shift: false, meta: false },
    anyActive: false,
    toggle: vi.fn(),
    consume: vi.fn(),
    resolveKey: (k: string) => k,
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────

const baseSession: TerminalSession = {
  id: "session-1",
  name: "test-session",
  tmuxSessionName: "rdv-test",
  status: "active",
  terminalType: "shell",
  projectId: null,
  projectPath: "/tmp",
  agentRestartCount: 0,
} as unknown as TerminalSession;

// ── Helpers ───────────────────────────────────────────────────────────

function renderView(props: Partial<React.ComponentProps<typeof MobileSessionView>> = {}) {
  return render(
    <MobileSessionView
      session={baseSession}
      activityStatus="idle"
      {...props}
    />
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────

beforeEach(() => {
  installRectStub();
  sendResize.mockReset();
  clearCharWidthCacheForTesting();
  mockStatus = "connected";
  mockPreferences = { fontFamily: "MockMono, monospace", fontSize: 14 };
  setMockViewportSize(600, 800);
  MockResizeObserver.last = null;
});

afterEach(() => {
  cleanup();
  uninstallRectStub();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("MobileSessionView, resize", () => {
  it("sends sendResize with new dims when ResizeObserver fires", async () => {
    renderView({ initialFontSize: 14 });

    // Wait one microtask for the connected-status effect to settle the
    // baseline.
    await act(async () => {
      await Promise.resolve();
    });

    const observer = MockResizeObserver.last;
    expect(observer).not.toBeNull();

    // Trigger a viewport size change. With fontSize 14:
    //   charW = 14 * 0.6 = 8.4
    //   lineH = 14 * 1.625 = 22.75
    //   usableWidth  = 1200 - 16 = 1184  → cols = floor(1184 / 8.4) = 140
    //   usableHeight = 600 - 16 = 584    → rows = floor(584 / 22.75) = 25
    setMockViewportSize(1200, 600);
    act(() => {
      observer!.trigger(1200, 600);
    });

    // The resize is debounced (~75ms). Advance time + flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(sendResize).toHaveBeenCalled();
    const call = sendResize.mock.calls[sendResize.mock.calls.length - 1];
    expect(call[0]).toBe(140);
    expect(call[1]).toBe(25);
  });

  it("recomputes cols when fontSize changes (smaller font → more cols)", async () => {
    renderView({ initialFontSize: 14 });

    // Seed an initial viewport so we have a non-trivial baseline.
    setMockViewportSize(800, 600);
    const observer = MockResizeObserver.last;
    act(() => {
      observer?.trigger(800, 600);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    sendResize.mockClear();

    // Simulate a pinch that halves the font (factor 0.5 of baseline 14
    // → clamped to FONT_SIZE_MIN = 9 by the view).
    const pinch = (
      globalThis as unknown as {
        __pinch?: { onScale?: (factor: number) => void };
      }
    ).__pinch;
    expect(pinch?.onScale).toBeDefined();

    act(() => {
      pinch!.onScale!(0.5);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // With smaller fontSize the same viewport produces more cols.
    expect(sendResize).toHaveBeenCalled();
    const last = sendResize.mock.calls[sendResize.mock.calls.length - 1];
    // fontSize 9 → charW 5.4 → cols = floor((800-16)/5.4) = 145
    expect(last[0]).toBe(145);
    // rows = floor((600-16)/(9*1.625)) = floor(584/14.625) = 39
    expect(last[1]).toBe(39);
  });

  it("floors cols ≥ 20 and rows ≥ 5 for tiny viewports", async () => {
    renderView({ initialFontSize: 16 });

    const observer = MockResizeObserver.last;
    setMockViewportSize(50, 30);
    act(() => {
      observer?.trigger(50, 30);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Even though the viewport math would produce single-digit cols/rows,
    // the floor kicks in.
    if (sendResize.mock.calls.length > 0) {
      const last = sendResize.mock.calls[sendResize.mock.calls.length - 1];
      expect(last[0]).toBeGreaterThanOrEqual(20);
      expect(last[1]).toBeGreaterThanOrEqual(5);
    }

    // The data attributes on the viewport always reflect the floored
    // values regardless of whether the resize message was sent.
    const viewport = screen.getByTestId(VIEWPORT_TESTID);
    expect(Number(viewport.getAttribute("data-cols"))).toBeGreaterThanOrEqual(
      20
    );
    expect(Number(viewport.getAttribute("data-rows"))).toBeGreaterThanOrEqual(
      5
    );
  });
});

describe("MobileSessionView, font preferences", () => {
  it("applies fontFamily from PreferencesContext to the <pre> block", () => {
    mockPreferences = { fontFamily: "Custom Font, monospace", fontSize: 14 };
    renderView({ initialFontSize: 14 });

    const viewport = screen.getByTestId(VIEWPORT_TESTID);
    const pre = viewport.querySelector("pre");
    expect(pre).not.toBeNull();
    // jsdom/happy-dom serialize fontFamily into the inline style.
    expect(pre!.style.fontFamily).toContain("Custom Font");
  });

  it("falls back to a default fontFamily when prefs.fontFamily is null", () => {
    mockPreferences = { fontFamily: null, fontSize: 14 };
    renderView({ initialFontSize: 14 });

    const viewport = screen.getByTestId(VIEWPORT_TESTID);
    const pre = viewport.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.style.fontFamily).toContain("JetBrainsMono");
  });

  it("seeds initial fontSize from prefs.fontSize when initialFontSize is undefined", () => {
    mockPreferences = { fontFamily: "MockMono, monospace", fontSize: 18 };
    // No initialFontSize prop → should fall back to prefs.fontSize (18).
    renderView();

    const viewport = screen.getByTestId(VIEWPORT_TESTID);
    expect(viewport.getAttribute("data-font-size")).toBe("18");
  });

  it("prefers initialFontSize over prefs.fontSize when both are supplied", () => {
    mockPreferences = { fontFamily: "MockMono, monospace", fontSize: 18 };
    renderView({ initialFontSize: 11 });

    const viewport = screen.getByTestId(VIEWPORT_TESTID);
    expect(viewport.getAttribute("data-font-size")).toBe("11");
  });
});

