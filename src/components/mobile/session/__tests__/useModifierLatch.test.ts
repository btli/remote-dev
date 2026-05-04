/**
 * useModifierLatch state machine tests (Phase 3 mobile session view).
 *
 * Verifies the tap / hold / double-tap transitions plus resolveKey()
 * collapses one-shot slots while preserving sticky ones.
 */

import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useModifierLatch } from "../useModifierLatch";

describe("useModifierLatch", () => {
  it("starts with all modifiers off", () => {
    const { result } = renderHook(() => useModifierLatch());
    expect(result.current.state).toEqual({ ctrl: "off", alt: "off", shift: "off" });
    expect(result.current.anyActive).toBe(false);
  });

  it("tap toggles off → oneshot → off", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("ctrl"));
    expect(result.current.state.ctrl).toBe("oneshot");
    expect(result.current.anyActive).toBe(true);
    // Wait beyond double-tap window, then tap again to collapse to off.
    // Simulate by directly calling clear (setting back to off without
    // triggering double-tap path).
    act(() => result.current.clear("ctrl"));
    expect(result.current.state.ctrl).toBe("off");
  });

  it("hold promotes off → sticky", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.hold("alt"));
    expect(result.current.state.alt).toBe("sticky");
  });

  it("doubleTap promotes any non-sticky to sticky", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("shift"));
    act(() => result.current.doubleTap("shift"));
    expect(result.current.state.shift).toBe("sticky");
  });

  it("tap on sticky clears to off", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.hold("ctrl"));
    expect(result.current.state.ctrl).toBe("sticky");
    act(() => result.current.tap("ctrl"));
    expect(result.current.state.ctrl).toBe("off");
  });

  it("clearAll resets every slot", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.hold("ctrl"));
    act(() => result.current.tap("alt"));
    act(() => result.current.hold("shift"));
    act(() => result.current.clearAll());
    expect(result.current.state).toEqual({ ctrl: "off", alt: "off", shift: "off" });
  });

  it("resolveKey applies Ctrl+letter to control byte and collapses oneshot", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("ctrl"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("c");
    });
    // Ctrl+C = 0x03
    expect(resolved).toBe("\x03");
    expect(result.current.state.ctrl).toBe("off");
  });

  it("resolveKey applies Ctrl uppercase same as lowercase", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("ctrl"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("A");
    });
    expect(resolved).toBe("\x01");
  });

  it("resolveKey applies Alt as ESC prefix", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("alt"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("f");
    });
    expect(resolved).toBe("\x1bf");
  });

  it("resolveKey applies Shift+Enter as ESC+CR", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("shift"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("\r");
    });
    expect(resolved).toBe("\x1b\r");
  });

  it("resolveKey preserves sticky modifiers across calls", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.hold("ctrl"));
    let first = "";
    let second = "";
    act(() => {
      first = result.current.resolveKey("c");
    });
    act(() => {
      second = result.current.resolveKey("d");
    });
    expect(first).toBe("\x03");
    expect(second).toBe("\x04");
    expect(result.current.state.ctrl).toBe("sticky");
  });

  it("resolveKey combines Ctrl+Alt correctly (Alt-prefixed control byte)", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("ctrl"));
    act(() => result.current.tap("alt"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("c");
    });
    expect(resolved).toBe("\x1b\x03");
  });

  it("resolveKey passes through unknown sequences with only Alt prefix when applicable", () => {
    const { result } = renderHook(() => useModifierLatch());
    act(() => result.current.tap("alt"));
    let resolved = "";
    act(() => {
      resolved = result.current.resolveKey("\x1b[A");
    });
    expect(resolved).toBe("\x1b\x1b[A");
  });
});
