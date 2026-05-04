"use client";

/**
 * useModifierLatch, Phase 3 mobile session view.
 *
 * State machine for the smart-key strip's CTRL / ALT / SHIFT modifier latch.
 * Three states per modifier:
 *
 *   - `off`, modifier is inactive.
 *   - `oneshot`, modifier will apply to the very next key press, then clear.
 *                 Set by a single tap on the modifier key.
 *   - `sticky`, modifier remains active until the user toggles it back off.
 *                 Set by a long-press OR a double-tap on the modifier key.
 *
 * Transitions:
 *
 *   off    --tap-->   oneshot
 *   oneshot --tap-->  off          (second tap clears the one-shot before use)
 *   off    --hold-->  sticky
 *   sticky --tap-->   off
 *   oneshot --hold--> sticky
 *   oneshot --double--> sticky
 *
 * After {@link MobileModifierLatch.consume} runs (because a modifier-able
 * key was sent), any `oneshot` slots collapse back to `off`. `sticky` slots
 * are preserved.
 *
 * The hook does NOT compose with hardware modifier events; the smart-key
 * strip is the only producer. {@link MobileInputBar} continues to use its
 * own keystroke-resolution path (see useMobileModifiers), this hook is
 * specifically the strip's source of truth, exposed via `resolveKey` for
 * any caller that wants the same semantics.
 */

import { useCallback, useRef, useState } from "react";

export type ModifierState = "off" | "oneshot" | "sticky";

export type ModifierKey = "ctrl" | "alt" | "shift";

export interface ModifierLatchState {
  ctrl: ModifierState;
  alt: ModifierState;
  shift: ModifierState;
}

export interface MobileModifierLatch {
  state: ModifierLatchState;
  /** True when at least one modifier is `oneshot` or `sticky`. */
  anyActive: boolean;
  /** Tap action: cycle between off and oneshot, or clear sticky. */
  tap: (key: ModifierKey) => void;
  /** Long-press: promote to sticky. From sticky, this is a no-op. */
  hold: (key: ModifierKey) => void;
  /** Double-tap: promote to sticky. From sticky, clear back to off. */
  doubleTap: (key: ModifierKey) => void;
  /** Force a slot off. */
  clear: (key: ModifierKey) => void;
  /** Force every slot off. */
  clearAll: () => void;
  /**
   * Apply the current latch to a literal key, returning the byte sequence
   * to send to the terminal. Collapses any `oneshot` slot to `off` after
   * applying. `sticky` slots remain active.
   *
   * Accepts:
   *   - A single ASCII character (`"a"`, `"A"`, `"["`, `"\\"`, etc.)
   *   - The literal `"\r"` for Enter
   *   - The literal `"\x7f"` for Backspace
   *   - Any escape sequence like `"\x1b[A"` for arrows, passed through with
   *     ALT prefix prepended only.
   *
   * Returns the resolved sequence and consumes one-shots.
   */
  resolveKey: (key: string) => string;
}

/**
 * Window during which a second tap is treated as a "double-tap" rather than
 * a separate "tap then tap". 280ms matches iOS double-tap timing closely
 * enough that users with prior native-app muscle memory get expected results.
 */
const DOUBLE_TAP_WINDOW_MS = 280;

export function useModifierLatch(): MobileModifierLatch {
  const [state, setState] = useState<ModifierLatchState>({
    ctrl: "off",
    alt: "off",
    shift: "off",
  });
  // Tracks the timestamp of the last `tap` per modifier so we can detect
  // a real double-tap event coming up through the strip, without binding
  // the strip to a separate gesture lib.
  const lastTapAt = useRef<Record<ModifierKey, number>>({
    ctrl: 0,
    alt: 0,
    shift: 0,
  });

  const setSlot = useCallback((key: ModifierKey, next: ModifierState) => {
    setState((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }, []);

  const tap = useCallback(
    (key: ModifierKey) => {
      const now = Date.now();
      const last = lastTapAt.current[key];
      lastTapAt.current[key] = now;

      // If two taps land inside the double-tap window, route through
      // doubleTap() so a fast double-tap promotes to sticky regardless of
      // the order taps arrive in (e.g. fast-double-from-off should not
      // first set oneshot and then immediately collapse it back).
      if (now - last <= DOUBLE_TAP_WINDOW_MS && last !== 0) {
        // Promote to sticky from any non-sticky state; toggle off when
        // already sticky.
        setState((prev) => ({
          ...prev,
          [key]: prev[key] === "sticky" ? "off" : "sticky",
        }));
        // After consuming the double-tap, reset the timer so a third tap
        // doesn't trigger another double immediately.
        lastTapAt.current[key] = 0;
        return;
      }

      setState((prev) => {
        const cur = prev[key];
        // off → oneshot, oneshot → off, sticky → off
        const nextVal: ModifierState = cur === "off" ? "oneshot" : "off";
        return { ...prev, [key]: nextVal };
      });
    },
    []
  );

  const hold = useCallback(
    (key: ModifierKey) => {
      lastTapAt.current[key] = 0;
      setSlot(key, "sticky");
    },
    [setSlot]
  );

  const doubleTap = useCallback(
    (key: ModifierKey) => {
      lastTapAt.current[key] = 0;
      setState((prev) => ({
        ...prev,
        [key]: prev[key] === "sticky" ? "off" : "sticky",
      }));
    },
    []
  );

  const clear = useCallback(
    (key: ModifierKey) => {
      lastTapAt.current[key] = 0;
      setSlot(key, "off");
    },
    [setSlot]
  );

  const clearAll = useCallback(() => {
    lastTapAt.current = { ctrl: 0, alt: 0, shift: 0 };
    setState({ ctrl: "off", alt: "off", shift: "off" });
  }, []);

  const resolveKey = useCallback(
    (key: string): string => {
      const ctrlOn = state.ctrl !== "off";
      const altOn = state.alt !== "off";
      const shiftOn = state.shift !== "off";

      let sequence = key;

      // Shift+Enter = ESC + CR (matches desktop xterm Shift+Enter behavior).
      if (shiftOn && key === "\r") {
        sequence = "\x1b\r";
      } else if (ctrlOn && key.length === 1) {
        // Ctrl+letter = control byte. A..Z = 0x01..0x1A, @..._ = 0x00..0x1F.
        const charCode = key.charCodeAt(0);
        if (charCode >= 64 && charCode <= 95) {
          sequence = String.fromCharCode(charCode - 64);
        } else if (charCode >= 97 && charCode <= 122) {
          sequence = String.fromCharCode(charCode - 96);
        }
      }

      if (altOn) {
        sequence = "\x1b" + sequence;
      }

      // Collapse one-shots, leave sticky alone.
      setState((prev) => {
        const next: ModifierLatchState = { ...prev };
        let mutated = false;
        if (prev.ctrl === "oneshot") {
          next.ctrl = "off";
          mutated = true;
        }
        if (prev.alt === "oneshot") {
          next.alt = "off";
          mutated = true;
        }
        if (prev.shift === "oneshot") {
          next.shift = "off";
          mutated = true;
        }
        return mutated ? next : prev;
      });

      return sequence;
    },
    [state.ctrl, state.alt, state.shift]
  );

  const anyActive =
    state.ctrl !== "off" || state.alt !== "off" || state.shift !== "off";

  return {
    state,
    anyActive,
    tap,
    hold,
    doubleTap,
    clear,
    clearAll,
    resolveKey,
  };
}
