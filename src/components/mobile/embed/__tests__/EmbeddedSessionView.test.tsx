/**
 * EmbeddedSessionView tests.
 *
 * Verifies that:
 *   1. The view renders the terminal area.
 *   2. Mounting installs window.rdvBridge.
 *   3. Unmounting uninstalls window.rdvBridge.
 *   4. window.rdvBridge.input forwards into the terminal's sendInput.
 *   5. Two-finger pinch updates fontSize live and persists on commit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

import { EmbeddedSessionView } from "../EmbeddedSessionView";

// Captured spies — re-created per test in `beforeEach` so we can assert
// against the actual instance the component held in its ref.
let sendInputSpy: ReturnType<typeof vi.fn>;
let scrollToBottomSpy: ReturnType<typeof vi.fn>;
let restartAgentSpy: ReturnType<typeof vi.fn>;

// Captured props handed to the mocked TerminalWithKeyboard. Refs to the
// latest invocation so tests can drive the parent-supplied callbacks
// (`onNotification`, `onSessionRestart`, `onSessionDelete`) directly.
let capturedTerminalProps: {
  onNotification?: (n: Record<string, unknown>) => void;
  onSessionRestart?: () => Promise<void>;
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void>;
} = {};

// Mocked TerminalWithKeyboard exposes the fontSize/fontFamily props via
// `data-*` attributes so pinch tests can assert the live prop pass-through
// without needing to capture the props object directly.
type StubTerminalProps = {
  fontSize?: number;
  fontFamily?: string;
  onNotification?: (n: Record<string, unknown>) => void;
  onSessionRestart?: () => Promise<void>;
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void>;
};

// Search overlay spies — see openSearch / closeSearch bridge tests.
let openSearchSpy: ReturnType<typeof vi.fn>;
let closeSearchSpy: ReturnType<typeof vi.fn>;

vi.mock("@/components/terminal/TerminalWithKeyboard", async () => {
  const React = await import("react");
  const TerminalWithKeyboard = React.forwardRef<
    {
      sendInput: (s: string) => void;
      scrollToBottom: () => void;
      focus: () => void;
      restartAgent: () => void;
      openSearch: () => void;
      closeSearch: () => void;
      toggleSearch: () => void;
    },
    Record<string, unknown>
  >(function MockTerminal(props, ref) {
    React.useImperativeHandle(ref, () => ({
      sendInput: sendInputSpy as unknown as (s: string) => void,
      scrollToBottom: scrollToBottomSpy as unknown as () => void,
      focus: vi.fn() as unknown as () => void,
      restartAgent: restartAgentSpy as unknown as () => void,
      openSearch: openSearchSpy as unknown as () => void,
      closeSearch: closeSearchSpy as unknown as () => void,
      toggleSearch: vi.fn() as unknown as () => void,
    }));
    const p = props as StubTerminalProps;
    capturedTerminalProps = {
      onNotification: p.onNotification,
      onSessionRestart: p.onSessionRestart,
      onSessionDelete: p.onSessionDelete,
    };
    return React.createElement("div", {
      "data-testid": "terminal-mock",
      "data-font-size": p.fontSize,
      "data-font-family": p.fontFamily,
    });
  });
  return { TerminalWithKeyboard };
});

// usePinchZoom: expose the handlers passed in so tests can simulate a
// gesture without a real touch surface. Mirrors MobileSessionView.test.tsx.
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

// EmbeddedSessionView reads font + family from PreferencesContext (so
// the embedded terminal honors the user's font-size pref) and uses
// `updateUserSettings` to persist pinch-zoom commits + bridge calls.
// Stub the context to avoid the real fetch in /api/preferences. Tests
// mutate `mockPrefs` to simulate async preference settle / remount with
// a persisted size.
type MockPrefs = {
  currentPreferences: { fontFamily: string; fontSize: number };
};
let mockPrefs: MockPrefs = {
  currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
};
function setMockPrefs(next: MockPrefs) {
  mockPrefs = next;
}
const updateUserSettingsSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    currentPreferences: mockPrefs.currentPreferences,
    updateUserSettings: updateUserSettingsSpy,
  }),
}));

// EmbeddedSessionView forwards `onNotification` from TerminalWithKeyboard
// into the NotificationContext via `addNotification`. Stub the context
// so the component mounts without a real provider tree, and expose a
// spy + a passthrough `hydrateNotification` for tests that exercise the
// notification pipeline. The hydrate helper just returns its input as-is
// here — the real one converts ISO strings to Date objects, but tests
// drive synthetic payloads, so a passthrough is enough.
const addNotificationSpy = vi.fn();
vi.mock("@/contexts/NotificationContext", () => ({
  useNotificationContext: () => ({ addNotification: addNotificationSpy }),
  hydrateNotification: (n: Record<string, unknown>) => n,
}));

const session = {
  id: "session-1",
  name: "test session",
  tmuxSessionName: "rdv-session-1",
  status: "active" as const,
};

beforeEach(() => {
  sendInputSpy = vi.fn();
  scrollToBottomSpy = vi.fn();
  restartAgentSpy = vi.fn();
  openSearchSpy = vi.fn();
  closeSearchSpy = vi.fn();
  updateUserSettingsSpy.mockClear();
  addNotificationSpy.mockClear();
  capturedPinchOpts = null;
  capturedTerminalProps = {};
  setMockPrefs({
    currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
  });
});

afterEach(() => {
  cleanup();
  delete window.rdvBridge;
});

describe("EmbeddedSessionView", () => {
  it("renders the terminal area", () => {
    const { getByTestId } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );

    expect(getByTestId("terminal-mock")).toBeTruthy();
  });

  it("installs window.rdvBridge on mount", () => {
    expect(window.rdvBridge).toBeUndefined();

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    expect(window.rdvBridge).toBeDefined();
    // v2 added uploadImage + openSearch / closeSearch.
    expect(window.rdvBridge?.version).toBe(2);
  });

  it("bridge.openSearch / closeSearch forward to the terminal ref", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    expect(typeof window.rdvBridge?.openSearch).toBe("function");
    expect(typeof window.rdvBridge?.closeSearch).toBe("function");

    window.rdvBridge?.openSearch();
    window.rdvBridge?.closeSearch();

    expect(openSearchSpy).toHaveBeenCalledTimes(1);
    expect(closeSearchSpy).toHaveBeenCalledTimes(1);
  });

  it("uninstalls window.rdvBridge on unmount", () => {
    const { unmount } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    expect(window.rdvBridge).toBeDefined();

    unmount();

    expect(window.rdvBridge).toBeUndefined();
  });

  it("rdvBridge.input forwards to terminal sendInput", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.input("ls -la\n");

    expect(sendInputSpy).toHaveBeenCalledWith("ls -la\n");
  });

  it("rdvBridge.setFontSize persists clamped value through preferences", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    // In-range: persisted as-is.
    window.rdvBridge?.setFontSize(15);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 15 });

    // Above max → clamped to 22.
    window.rdvBridge?.setFontSize(99);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 22 });

    // Below min → clamped to 9.
    window.rdvBridge?.setFontSize(2);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 9 });
  });

  it("rdvBridge.setFontSize ignores non-finite values", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.setFontSize(Number.NaN);
    window.rdvBridge?.setFontSize(Number.POSITIVE_INFINITY);

    expect(updateUserSettingsSpy).not.toHaveBeenCalled();
  });
});

describe("EmbeddedSessionView, pinch-to-zoom", () => {
  it("forwards the seed fontSize from preferences to TerminalWithKeyboard", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 16 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    const terminal = screen.getByTestId("terminal-mock");
    expect(terminal.getAttribute("data-font-size")).toBe("16");
  });

  it("updates the displayed fontSize live during a pinch (before commit)", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    const terminalBefore = screen.getByTestId("terminal-mock");
    expect(terminalBefore.getAttribute("data-font-size")).toBe("14");

    // Mid-gesture: pinch out by factor 1.5 → 14 * 1.5 = 21 (under MAX 22).
    act(() => {
      capturedPinchOpts?.onScale?.(1.5);
    });

    const terminalAfter = screen.getByTestId("terminal-mock");
    expect(terminalAfter.getAttribute("data-font-size")).toBe("21");
    // No persistence during the gesture — only on commit.
    expect(updateUserSettingsSpy).not.toHaveBeenCalled();
  });

  it("fires updateUserSettings exactly once on gesture commit with the clamped final size", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    act(() => {
      capturedPinchOpts?.onScale?.(1.2);
      capturedPinchOpts?.onScale?.(1.3);
      capturedPinchOpts?.onScaleCommit?.(1.3);
    });

    // 14 * 1.3 = 18.2 → rounded to 18 (under MAX 22).
    expect(updateUserSettingsSpy).toHaveBeenCalledTimes(1);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 18 });
    const terminal = screen.getByTestId("terminal-mock");
    expect(terminal.getAttribute("data-font-size")).toBe("18");
  });

  it("clamps the commit value to [FONT_SIZE_MIN, FONT_SIZE_MAX]", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    // Pinch huge: 14 * 1.8 = 25.2, clamped to MAX 22.
    act(() => {
      capturedPinchOpts?.onScaleCommit?.(1.8);
    });
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 22 });
    expect(
      screen.getByTestId("terminal-mock").getAttribute("data-font-size")
    ).toBe("22");

    // Now the baseline is 22. Pinch tiny: 22 * 0.3 = 6.6, but
    // usePinchZoom internally clamps factor at MIN_FACTOR (0.6), so the
    // caller never sees a sub-0.6 factor. Simulate the smallest factor
    // the hook will ever forward (0.6 → 22 * 0.6 = 13.2 → 13).
    act(() => {
      capturedPinchOpts?.onScaleCommit?.(0.6);
    });
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 13 });
  });

  it("does not overwrite the live local size when prefs change mid-gesture (latch behavior)", () => {
    // Cold start with prefs at 14.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    const { rerender } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    expect(
      screen.getByTestId("terminal-mock").getAttribute("data-font-size")
    ).toBe("14");

    // User pinches and commits to 18.
    act(() => {
      capturedPinchOpts?.onScale?.(18 / 14);
      capturedPinchOpts?.onScaleCommit?.(18 / 14);
    });
    expect(
      screen.getByTestId("terminal-mock").getAttribute("data-font-size")
    ).toBe("18");

    // A later prefs change (e.g. desktop edit, or the response to our
    // own POST landing back through the context) arrives. The latch
    // means we do NOT re-seed; pinch wins.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 20 },
    });
    rerender(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    expect(
      screen.getByTestId("terminal-mock").getAttribute("data-font-size")
    ).toBe("18");
  });

  it("persists across remount via the prefs round-trip", () => {
    // First mount with prefs at 14, user pinches to 17 and commits.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    const { unmount } = render(
      <EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />
    );
    act(() => {
      capturedPinchOpts?.onScaleCommit?.(17 / 14);
    });
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 17 });
    unmount();

    // Simulate the prefs API having persisted the new size: next mount
    // sees 17 as the seed from PreferencesContext.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 17 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    expect(
      screen.getByTestId("terminal-mock").getAttribute("data-font-size")
    ).toBe("17");
  });
});

describe("EmbeddedSessionView, notification forwarding", () => {
  it("forwards onNotification payloads into the notification context", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    const payload = {
      id: "n-1",
      type: "agent_waiting",
      sessionId: "session-1",
      title: "Agent needs input",
      createdAt: "2026-05-13T00:00:00.000Z",
      readAt: null,
    };

    capturedTerminalProps.onNotification?.(payload);

    expect(addNotificationSpy).toHaveBeenCalledTimes(1);
    expect(addNotificationSpy).toHaveBeenCalledWith(payload);
  });
});

describe("EmbeddedSessionView, agent session lifecycle", () => {
  it("onSessionRestart calls restartAgent on the underlying terminal ref", async () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    await capturedTerminalProps.onSessionRestart?.();

    expect(restartAgentSpy).toHaveBeenCalledTimes(1);
  });

  it("onSessionDelete posts DELETE /api/sessions/:id without worktree flag by default", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      );

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    await capturedTerminalProps.onSessionDelete?.(false);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/session-1",
      expect.objectContaining({ method: "DELETE" })
    );
    fetchSpy.mockRestore();
  });

  it("onSessionDelete forwards the deleteWorktree flag", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      );

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    await capturedTerminalProps.onSessionDelete?.(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/session-1?deleteWorktree=true",
      expect.objectContaining({ method: "DELETE" })
    );
    fetchSpy.mockRestore();
  });

  it("onSessionDelete throws when the API responds non-OK", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("nope", { status: 500 }));
    // Suppress the console.error log this test deliberately triggers.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    await expect(
      capturedTerminalProps.onSessionDelete?.(false)
    ).rejects.toThrow(/Failed to delete session/);

    fetchSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("EmbeddedSessionView, setFontScale", () => {
  it("rdvBridge.setFontScale persists scale * base via preferences", () => {
    // Cold start: prefs settle at 14 px. setFontScale(1.5) → 14 * 1.5 = 21
    // (clamped under MAX 22), persisted as { fontSize: 21 }.
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.setFontScale(1.5);

    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 21 });
  });

  it("rdvBridge.setFontScale clamps the resulting px into the accepted range", () => {
    setMockPrefs({
      currentPreferences: { fontFamily: "MockMono, monospace", fontSize: 14 },
    });
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    // 14 * 3 = 42 → clamped to MAX 22.
    window.rdvBridge?.setFontScale(3);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 22 });

    // 14 * 0.4 = 5.6 → clamped to MIN 9.
    window.rdvBridge?.setFontScale(0.4);
    expect(updateUserSettingsSpy).toHaveBeenLastCalledWith({ fontSize: 9 });
  });

  it("rdvBridge.setFontScale ignores non-finite and non-positive values", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.setFontScale(Number.NaN);
    window.rdvBridge?.setFontScale(Number.POSITIVE_INFINITY);
    window.rdvBridge?.setFontScale(0);
    window.rdvBridge?.setFontScale(-1);

    expect(updateUserSettingsSpy).not.toHaveBeenCalled();
  });

  it("rdvBridge.setFontScale also writes --rdv-font-scale on <html> for sibling embeds", () => {
    render(<EmbeddedSessionView session={session} wsUrl="ws://localhost:6002" />);

    window.rdvBridge?.setFontScale(1.25);

    expect(
      document.documentElement.style.getPropertyValue("--rdv-font-scale")
    ).toBe("1.25");
  });
});
