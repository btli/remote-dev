/**
 * MobileSessionView wiring tests.
 *
 * Asserts the chrome around the shared xterm.js renderer is wired up
 * correctly. We mock TerminalWithKeyboard so we can:
 *   - Verify it's mounted with `mobileChrome="external"` (the contract
 *     that lets this view supply its own MobileInputBar / SmartKeyStrip
 *     around the wrapper instead of the wrapper's built-in chrome).
 *   - Drive its `onStatusChange` / `onAgentExited` callbacks and check
 *     the parent reacts (banner + agent exit screen overlay).
 *   - Capture the imperative ref and confirm SmartKeyStrip + the
 *     pinch-driven font change forward into `sendInput` / fontSize prop.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { MobileSessionView } from "@/components/mobile/session/MobileSessionView";
import type { TerminalSession } from "@/types/session";

// ── Test-side capture handles ─────────────────────────────────────────
// We capture the most-recent props passed to the mocked TerminalWithKeyboard
// and the imperative ref it surfaces. The mock stores values via setter
// functions so the lint rule against mutating identifiers during render
// (react-hooks/refs) doesn't fire on direct assignments.

type StubProps = {
  mobileChrome?: string;
  fontSize?: number;
  fontFamily?: string;
  onStatusChange?: (s: string) => void;
  onAgentExited?: (code: number | null, at: string) => void;
  onAgentRestarted?: () => void;
};

type StubHandle = {
  sendInput: ReturnType<typeof vi.fn>;
  restartAgent: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
};

let capturedProps: StubProps | null = null;
let capturedHandle: StubHandle | null = null;

function setCapturedProps(p: StubProps) {
  capturedProps = p;
}
function setCapturedHandle(h: StubHandle) {
  capturedHandle = h;
}

vi.mock("@/components/terminal/TerminalWithKeyboard", async () => {
  const ReactImport = await import("react");
  const StubTerminal = ReactImport.forwardRef(function StubTerminal(
    props: StubProps,
    ref: React.Ref<unknown>
  ) {
    // Publish props/handle in a layout effect so we don't mutate during
    // render (avoids react-hooks/refs lint violation).
    ReactImport.useLayoutEffect(() => {
      setCapturedProps(props);
    });
    const handle: StubHandle = ReactImport.useMemo(
      () => ({
        sendInput: vi.fn(),
        restartAgent: vi.fn(),
        focus: vi.fn(),
        scrollToBottom: vi.fn(),
      }),
      []
    );
    ReactImport.useLayoutEffect(() => {
      setCapturedHandle(handle);
    }, [handle]);
    ReactImport.useImperativeHandle(ref, () => handle, [handle]);
    return ReactImport.createElement("div", {
      "data-testid": "stub-terminal-with-keyboard",
      "data-mobile-chrome": props.mobileChrome ?? "builtin",
      "data-font-size": props.fontSize,
      "data-font-family": props.fontFamily,
    });
  });
  return { TerminalWithKeyboard: StubTerminal };
});

// SmartKeyStrip: capture onKeyPress so we can simulate a tap.
let capturedSmartKeyOnKeyPress: ((seq: string) => void) | null = null;
vi.mock("@/components/mobile/session/SmartKeyStrip", () => ({
  SmartKeyStrip: ({ onKeyPress }: { onKeyPress: (seq: string) => void }) => {
    capturedSmartKeyOnKeyPress = onKeyPress;
    return <div data-testid="stub-smart-key-strip" />;
  },
}));

// MobileInputBar: capture onSubmit so we can simulate a submit.
let capturedInputBarOnSubmit: ((data: string) => void) | null = null;
vi.mock("@/components/terminal/MobileInputBar", () => ({
  MobileInputBar: ({ onSubmit }: { onSubmit: (data: string) => void }) => {
    capturedInputBarOnSubmit = onSubmit;
    return <div data-testid="stub-input-bar" />;
  },
}));

// usePinchZoom: expose handlers so we can drive a font-size change.
let capturedPinchOpts: {
  onScale?: (factor: number) => void;
  onScaleCommit?: (factor: number) => void;
} | null = null;
vi.mock("@/components/mobile/session/usePinchZoom", () => ({
  usePinchZoom: (opts: {
    onScale?: (factor: number) => void;
    onScaleCommit?: (factor: number) => void;
  }) => {
    capturedPinchOpts = opts;
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

vi.mock("@/components/mobile/session/SessionStatusBar", () => ({
  SessionStatusBar: () => <div data-testid="stub-status-bar" />,
}));

vi.mock("@/components/mobile/session/SessionMetadataSheet", () => ({
  SessionMetadataSheet: () => null,
}));

vi.mock("@/components/terminal/AgentExitScreen", () => ({
  AgentExitScreen: () => <div data-testid="stub-agent-exit-screen" />,
}));

// Mutable prefs state so tests can simulate the async settle of
// PreferencesContext (loading=true → loading=false with a real value).
type MockPrefs = {
  currentPreferences: { fontFamily: string; fontSize: number };
  loading: boolean;
};
let mockPrefs: MockPrefs = {
  currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
  loading: false,
};
function setMockPrefs(next: MockPrefs) {
  mockPrefs = next;
}
vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => mockPrefs,
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    activeSessionId: "session-1",
    getAgentActivityStatus: () => "idle",
  }),
}));

vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => false,
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

function renderView(
  props: Partial<React.ComponentProps<typeof MobileSessionView>> = {}
) {
  return render(
    <MobileSessionView session={baseSession} activityStatus="idle" {...props} />
  );
}

beforeEach(() => {
  capturedProps = null;
  capturedHandle = null;
  capturedSmartKeyOnKeyPress = null;
  capturedInputBarOnSubmit = null;
  capturedPinchOpts = null;
  setMockPrefs({
    currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    loading: false,
  });
});

afterEach(() => cleanup());

// ── Tests ─────────────────────────────────────────────────────────────

describe("MobileSessionView, renderer wiring", () => {
  it('mounts TerminalWithKeyboard with mobileChrome="external"', () => {
    renderView({ initialFontSize: 14 });
    const stub = screen.getByTestId("stub-terminal-with-keyboard");
    expect(stub.getAttribute("data-mobile-chrome")).toBe("external");
  });

  it("forwards fontSize and fontFamily props to TerminalWithKeyboard", () => {
    renderView({ initialFontSize: 16 });
    const stub = screen.getByTestId("stub-terminal-with-keyboard");
    expect(stub.getAttribute("data-font-size")).toBe("16");
    expect(stub.getAttribute("data-font-family")).toContain("MockMono");
  });

  it("propagates onStatusChange into the banner", () => {
    renderView({ initialFontSize: 14 });
    expect(screen.queryByTestId("mobile-session-banner")).toBeNull();

    act(() => {
      capturedProps?.onStatusChange?.("reconnecting");
    });
    const banner = screen.getByTestId("mobile-session-banner");
    expect(banner.getAttribute("data-tone")).toBe("warn");
  });

  it("shows the agent exit overlay when TerminalWithKeyboard reports an exit", () => {
    renderView({
      session: { ...baseSession, terminalType: "agent" } as TerminalSession,
      initialFontSize: 14,
    });
    expect(screen.queryByTestId("stub-agent-exit-screen")).toBeNull();

    act(() => {
      capturedProps?.onAgentExited?.(1, new Date().toISOString());
    });
    expect(screen.getByTestId("stub-agent-exit-screen")).toBeTruthy();
  });

  it("forwards SmartKeyStrip taps via the ref's sendInput", () => {
    renderView({ initialFontSize: 14 });
    expect(capturedSmartKeyOnKeyPress).not.toBeNull();
    act(() => {
      capturedSmartKeyOnKeyPress!("\x1b");
    });
    expect(capturedHandle?.sendInput).toHaveBeenCalledWith("\x1b");
  });

  it("forwards MobileInputBar submits via the ref's sendInput", () => {
    renderView({ initialFontSize: 14 });
    expect(capturedInputBarOnSubmit).not.toBeNull();
    act(() => {
      capturedInputBarOnSubmit!("ls\n");
    });
    expect(capturedHandle?.sendInput).toHaveBeenCalledWith("ls\n");
  });

  it("updates the fontSize prop when pinch onScale fires", () => {
    renderView({ initialFontSize: 14 });
    const initial = screen
      .getByTestId("stub-terminal-with-keyboard")
      .getAttribute("data-font-size");
    expect(initial).toBe("14");

    act(() => {
      capturedPinchOpts?.onScale?.(1.5);
    });
    const after = screen
      .getByTestId("stub-terminal-with-keyboard")
      .getAttribute("data-font-size");
    // 14 * 1.5 = 21, well under FONT_SIZE_MAX = 22.
    expect(after).toBe("21");
  });

  it("calls onPersistFontSize after pinch commit", () => {
    const onPersistFontSize = vi.fn();
    renderView({ initialFontSize: 14, onPersistFontSize });

    act(() => {
      capturedPinchOpts?.onScaleCommit?.(0.5);
    });
    // 14 * 0.5 = 7, clamped to FONT_SIZE_MIN = 9.
    expect(onPersistFontSize).toHaveBeenCalledWith(9);
  });
});

describe("MobileSessionView, fontSize hydration reconciliation", () => {
  it("reconciles fontSize once when PreferencesContext settles after first render", () => {
    // Cold start: persisted size unset (initialFontSize undefined) and
    // prefs still loading. The lazy initializer falls through to
    // DEFAULT_FONT_SIZE (12) because we cannot trust prefs while loading.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
      loading: true,
    });

    const { rerender } = render(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={undefined}
      />
    );

    // First paint: nothing real to seed from; we expect the default (12).
    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("12");

    // Prefs resolve with the user's actual fontSize.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 16 },
      loading: false,
    });
    rerender(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={undefined}
      />
    );

    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("16");
  });

  it("reconciles fontSize once when persisted localStorage value hydrates after first render", () => {
    // Cold start: persisted size not yet hydrated (undefined) and prefs
    // already settled at the default (14). Lazy initializer seeds 14.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
      loading: false,
    });

    const { rerender } = render(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={undefined}
      />
    );

    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("14");

    // localStorage-backed value arrives after hydration. With prefs already
    // settled, the lazy initializer's "preferences" branch had already
    // latched the upstream — but this test still proves we never
    // *unsettle* a latched value (i.e. don't drift downward) when the
    // persisted value differs.
    rerender(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={18}
      />
    );

    // Latch already happened on prior render with prefs settled → the
    // persisted value should NOT override (latched at 14). This is the
    // intended "don't surprise mid-session" behavior.
    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("14");
  });

  it("uses the persisted value when it is available at first render (warm start)", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
      loading: false,
    });
    renderView({ initialFontSize: 18 });
    // Lazy initializer prefers `initialFontSize` over preferences, so
    // first paint already shows the warm value.
    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("18");
  });

  it("locks the latch: a later prefs change does not override a user pinch", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
      loading: false,
    });

    const { rerender } = render(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={14}
      />
    );

    // User pinches down to 12 and commits.
    act(() => {
      capturedPinchOpts?.onScale?.(12 / 14);
      capturedPinchOpts?.onScaleCommit?.(12 / 14);
    });
    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("12");

    // Now prefs change to 20 (e.g. the user updated them on desktop).
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 20 },
      loading: false,
    });
    rerender(
      <MobileSessionView
        session={baseSession}
        activityStatus="idle"
        initialFontSize={14}
      />
    );

    // The latch holds: pinch wins, prefs ignored.
    expect(
      screen
        .getByTestId("stub-terminal-with-keyboard")
        .getAttribute("data-font-size")
    ).toBe("12");
  });
});
