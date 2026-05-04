/**
 * SmartKeyStrip integration tests (Phase 3 mobile session view).
 *
 * Renders the real component with a real useModifierLatch instance and
 * verifies the strip dispatches the correct byte sequences for plain keys,
 * arrow keys, and modifier-prefixed keys. The latch reveal of state is
 * exercised by toggling Ctrl, then pressing a key, and asserting the
 * Ctrl+key byte arrived.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { useEffect } from "react";

import { SmartKeyStrip } from "../SmartKeyStrip";
import { useModifierLatch, type MobileModifierLatch } from "../useModifierLatch";

let matchMediaImpl: (query: string) => MediaQueryList;

beforeEach(() => {
  matchMediaImpl = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => matchMediaImpl(q)),
  });
});

afterEach(() => cleanup());

interface HostProps {
  onKeyPress: (sequence: string) => void;
  onLatchReady?: (latch: MobileModifierLatch) => void;
  disabled?: boolean;
}

function Host({ onKeyPress, onLatchReady, disabled = false }: HostProps) {
  const latch = useModifierLatch();
  useEffect(() => {
    onLatchReady?.(latch);
  }, [latch, onLatchReady]);
  return (
    <SmartKeyStrip
      onKeyPress={onKeyPress}
      latch={latch}
      disabled={disabled}
    />
  );
}

describe("SmartKeyStrip", () => {
  it("renders with the canonical roster of keys", () => {
    render(<Host onKeyPress={() => {}} />);
    expect(screen.getByTestId("mobile-smart-key-esc")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-tab")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-ctrl")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-alt")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-shift")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-up")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-down")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-left")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-right")).toBeTruthy();
    expect(screen.getByTestId("mobile-smart-key-pipe")).toBeTruthy();
  });

  it("dispatches the byte sequence for Esc on pointer-down", () => {
    const onKeyPress = vi.fn();
    render(<Host onKeyPress={onKeyPress} />);
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-esc"));
    expect(onKeyPress).toHaveBeenCalledWith("\x1b");
  });

  it("dispatches the byte sequence for Tab", () => {
    const onKeyPress = vi.fn();
    render(<Host onKeyPress={onKeyPress} />);
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-tab"));
    expect(onKeyPress).toHaveBeenCalledWith("\t");
  });

  it("dispatches arrow byte sequences", () => {
    const onKeyPress = vi.fn();
    render(<Host onKeyPress={onKeyPress} />);

    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-up"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-up"));
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-down"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-down"));
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-left"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-left"));
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-right"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-right"));

    expect(onKeyPress.mock.calls[0]).toEqual(["\x1b[A"]);
    expect(onKeyPress.mock.calls[1]).toEqual(["\x1b[B"]);
    expect(onKeyPress.mock.calls[2]).toEqual(["\x1b[D"]);
    expect(onKeyPress.mock.calls[3]).toEqual(["\x1b[C"]);
  });

  it("Ctrl latch tap, then key press, sends the control byte and clears latch", () => {
    const onKeyPress = vi.fn();
    let captured: MobileModifierLatch | null = null;
    render(
      <Host
        onKeyPress={onKeyPress}
        onLatchReady={(l) => {
          captured = l;
        }}
      />
    );

    // Tap Ctrl: pointerDown then pointerUp (without long-press timing).
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-ctrl"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-ctrl"));
    expect(captured!.state.ctrl).toBe("oneshot");

    // Bypass the strip and call resolveKey directly to simulate a letter
    // key being consumed by an external producer (e.g. MobileInputBar).
    // Wrap in act so the resulting state collapse is committed before we
    // assert. We re-read `captured` after the commit because each commit
    // returns a new latch object with the latest state snapshot.
    let resolved = "";
    act(() => {
      resolved = captured!.resolveKey("c");
    });
    expect(resolved).toBe("\x03");
    expect(captured!.state.ctrl).toBe("off");
  });

  it("disabled strip ignores key presses", () => {
    const onKeyPress = vi.fn();
    render(<Host onKeyPress={onKeyPress} disabled />);
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-esc"));
    expect(onKeyPress).not.toHaveBeenCalled();
  });

  it("modifier badge reflects sticky state via aria-pressed=true", () => {
    let captured: MobileModifierLatch | null = null;
    render(
      <Host
        onKeyPress={() => {}}
        onLatchReady={(l) => {
          captured = l;
        }}
      />
    );
    // Programmatically promote to sticky.
    captured!.hold("ctrl");
    // After state update, the rendered button should reflect the sticky
    // state. We re-render via fireEvent, but since we set state outside
    // React's commit cycle, force a tick by clicking another key.
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-tab"));
    fireEvent.pointerUp(screen.getByTestId("mobile-smart-key-tab"));
    const ctrlButton = screen.getByTestId("mobile-smart-key-ctrl");
    expect(ctrlButton.getAttribute("data-state")).toBe("sticky");
    expect(ctrlButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("Ctrl-C dedicated button sends 0x03 directly", () => {
    const onKeyPress = vi.fn();
    render(<Host onKeyPress={onKeyPress} />);
    fireEvent.pointerDown(screen.getByTestId("mobile-smart-key-ctrl-c"));
    expect(onKeyPress).toHaveBeenCalledWith("\x03");
  });
});
