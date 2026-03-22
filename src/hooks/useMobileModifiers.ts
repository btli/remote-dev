import { useState, useCallback, useRef } from "react";

export type ModifierKey = "ctrl" | "alt" | "shift";

export interface MobileModifiers {
  ctrlActive: boolean;
  altActive: boolean;
  shiftActive: boolean;
  toggleModifier: (modifier: ModifierKey) => void;
  clearModifiers: () => void;
  /** True if any modifier is currently active */
  anyActive: boolean;
  /**
   * Resolve a key string through active modifiers and return the ANSI sequence.
   * Clears modifiers after resolution. Idempotent within the same activation —
   * a second call before re-render returns the key unchanged.
   */
  resolveKey: (key: string) => string;
}

/**
 * Shared modifier state for mobile terminal keyboard.
 *
 * Manages CTRL/ALT/SHIFT sticky toggles that are consumed by either
 * MobileKeyboard (toolbar key presses) or MobileInputBar (text input keystrokes).
 * Modifiers auto-reset after being consumed.
 */
export function useMobileModifiers(): MobileModifiers {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  // Guard against double-consumption in the same event loop tick
  const consumedRef = useRef(false);

  const toggleModifier = useCallback((modifier: ModifierKey) => {
    consumedRef.current = false; // new activation resets guard
    switch (modifier) {
      case "ctrl":
        setCtrlActive((prev) => !prev);
        break;
      case "alt":
        setAltActive((prev) => !prev);
        break;
      case "shift":
        setShiftActive((prev) => !prev);
        break;
    }
  }, []);

  const clearModifiers = useCallback(() => {
    consumedRef.current = true;
    setCtrlActive(false);
    setAltActive(false);
    setShiftActive(false);
  }, []);

  const resolveKey = useCallback(
    (key: string): string => {
      // If modifiers were already consumed this activation, pass key through
      if (consumedRef.current) return key;

      let sequence = key;

      // Shift+Enter → ESC + CR
      if (shiftActive && key === "\r") {
        clearModifiers();
        return "\x1b\r";
      }

      // Ctrl+letter → ANSI control code (Ctrl+A = 0x01, ..., Ctrl+Z = 0x1A)
      if (ctrlActive && sequence.length === 1) {
        const charCode = sequence.toUpperCase().charCodeAt(0);
        if (charCode >= 65 && charCode <= 90) {
          sequence = String.fromCharCode(charCode - 64);
        }
      }

      // Alt prefix: ESC + key
      if (altActive) {
        sequence = "\x1b" + sequence;
      }

      clearModifiers();
      return sequence;
    },
    [ctrlActive, altActive, shiftActive, clearModifiers]
  );

  const anyActive = ctrlActive || altActive || shiftActive;

  return {
    ctrlActive,
    altActive,
    shiftActive,
    toggleModifier,
    clearModifiers,
    anyActive,
    resolveKey,
  };
}
