"use client";

/**
 * SmartKeyStrip, Phase 3 mobile session view.
 *
 * Horizontal scrollable strip of keys that aren't reachable on the iOS /
 * Android software keyboard: Esc, Tab, arrows, common punctuation, plus the
 * three modifier latches (Ctrl, Alt, Shift). The strip lives directly above
 * the {@link MobileInputBar}.
 *
 * Each non-modifier key dispatches its byte sequence through `onKeyPress`,
 * after passing through {@link MobileModifierLatch.resolveKey} so any active
 * latch (one-shot or sticky) gets applied. Modifier keys themselves use the
 * latch's `tap` / `hold` / `doubleTap` semantics.
 *
 * Visuals: flat `bg-card`, hairline top border, no glass per DESIGN.md
 * "Flat-By-Default Rule". Active modifiers render with a foreground tint
 * and weight bump; sticky modifiers add a small leading dot. NO colored
 * side stripes.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsRight,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type {
  MobileModifierLatch,
  ModifierKey,
  ModifierState,
} from "./useModifierLatch";

const LONG_PRESS_MS = 380;
const ARROW_REPEAT_MS = 120;

export interface SmartKeyStripProps {
  /**
   * Send a literal byte sequence to the terminal. The strip is responsible
   * for applying the modifier latch before calling this; the caller should
   * just forward the bytes to the WebSocket.
   */
  onKeyPress: (sequence: string) => void;
  /** Modifier latch state machine, owned by the parent view. */
  latch: MobileModifierLatch;
  /** When false, the strip dims and ignores presses. */
  disabled?: boolean;
  /**
   * Optional menu trigger rendered at the right edge, typically the
   * "more" button that opens the metadata sheet from MobileSessionView.
   */
  trailing?: ReactNode;
  className?: string;
}

interface RegularKey {
  kind: "key";
  /** Stable id for tests and React keys. */
  id: string;
  /** Visible label. */
  label: ReactNode;
  /** Byte sequence sent through resolveKey(). */
  sequence: string;
  /** When true, holding the key auto-repeats (arrows). */
  repeatable?: boolean;
  /** Reader-only label override. */
  ariaLabel?: string;
  /** Width hint; some keys (Esc, Tab) are slightly wider for ergonomics. */
  wide?: boolean;
}

interface ModifierKeyDef {
  kind: "modifier";
  id: ModifierKey;
  label: string;
  ariaLabel: string;
}

type StripKey = RegularKey | ModifierKeyDef;

const SMART_KEYS: readonly StripKey[] = [
  { kind: "key", id: "esc", label: "Esc", sequence: "\x1b", wide: true, ariaLabel: "Escape" },
  { kind: "key", id: "tab", label: "Tab", sequence: "\t", wide: true, ariaLabel: "Tab" },
  { kind: "modifier", id: "ctrl", label: "Ctrl", ariaLabel: "Control modifier latch" },
  { kind: "modifier", id: "alt", label: "Alt", ariaLabel: "Alt modifier latch" },
  { kind: "modifier", id: "shift", label: "Shift", ariaLabel: "Shift modifier latch" },
  {
    kind: "key",
    id: "up",
    label: <ArrowUp aria-hidden="true" className="h-4 w-4" />,
    sequence: "\x1b[A",
    repeatable: true,
    ariaLabel: "Up arrow",
  },
  {
    kind: "key",
    id: "down",
    label: <ArrowDown aria-hidden="true" className="h-4 w-4" />,
    sequence: "\x1b[B",
    repeatable: true,
    ariaLabel: "Down arrow",
  },
  {
    kind: "key",
    id: "left",
    label: <ArrowLeft aria-hidden="true" className="h-4 w-4" />,
    sequence: "\x1b[D",
    repeatable: true,
    ariaLabel: "Left arrow",
  },
  {
    kind: "key",
    id: "right",
    label: <ArrowRight aria-hidden="true" className="h-4 w-4" />,
    sequence: "\x1b[C",
    repeatable: true,
    ariaLabel: "Right arrow",
  },
  { kind: "key", id: "pipe", label: "|", sequence: "|", ariaLabel: "Pipe" },
  { kind: "key", id: "slash", label: "/", sequence: "/", ariaLabel: "Slash" },
  { kind: "key", id: "tilde", label: "~", sequence: "~", ariaLabel: "Tilde" },
  { kind: "key", id: "minus", label: "-", sequence: "-", ariaLabel: "Minus" },
  { kind: "key", id: "underscore", label: "_", sequence: "_", ariaLabel: "Underscore" },
  { kind: "key", id: "dollar", label: "$", sequence: "$", ariaLabel: "Dollar" },
  { kind: "key", id: "lbrace", label: "{", sequence: "{", ariaLabel: "Open brace" },
  { kind: "key", id: "rbrace", label: "}", sequence: "}", ariaLabel: "Close brace" },
  { kind: "key", id: "lbracket", label: "[", sequence: "[", ariaLabel: "Open bracket" },
  { kind: "key", id: "rbracket", label: "]", sequence: "]", ariaLabel: "Close bracket" },
  { kind: "key", id: "backslash", label: "\\", sequence: "\\", ariaLabel: "Backslash" },
  {
    kind: "key",
    id: "ctrl-c",
    label: <ChevronsRight aria-hidden="true" className="h-4 w-4 rotate-180" />,
    sequence: "\x03",
    ariaLabel: "Send Ctrl C",
  },
];

function modifierBadgeFor(slot: ModifierState): string | null {
  if (slot === "sticky") return "•";
  return null;
}

export function SmartKeyStrip({
  onKeyPress,
  latch,
  disabled = false,
  trailing,
  className,
}: SmartKeyStripProps) {
  const onKeyPressRef = useRef(onKeyPress);
  useEffect(() => {
    onKeyPressRef.current = onKeyPress;
  }, [onKeyPress]);

  const dispatchKey = useCallback(
    (sequence: string) => {
      if (disabled) return;
      const resolved = latch.resolveKey(sequence);
      onKeyPressRef.current(resolved);
    },
    [disabled, latch]
  );

  // Long-press / repeat machinery for keys. Uses a single timer/interval pair
  // tracked per pointer-down rather than per-button so multiple buttons can't
  // leak overlapping intervals when the user fat-fingers.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelTimers = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  useEffect(() => cancelTimers, [cancelTimers]);

  const startKeyPress = useCallback(
    (key: RegularKey) => {
      if (disabled) return;
      cancelTimers();
      longPressFiredRef.current = false;

      if (key.repeatable) {
        // Fire once immediately, then long-press promotes to repeat.
        dispatchKey(key.sequence);
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          repeatIntervalRef.current = setInterval(() => {
            dispatchKey(key.sequence);
          }, ARROW_REPEAT_MS);
        }, LONG_PRESS_MS);
      } else {
        dispatchKey(key.sequence);
      }
    },
    [disabled, dispatchKey, cancelTimers]
  );

  const endKeyPress = useCallback(() => {
    cancelTimers();
  }, [cancelTimers]);

  const startModifierPress = useCallback(
    (key: ModifierKey) => {
      if (disabled) return;
      cancelTimers();
      longPressFiredRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        latch.hold(key);
      }, LONG_PRESS_MS);
    },
    [disabled, latch, cancelTimers]
  );

  const endModifierPress = useCallback(
    (key: ModifierKey) => {
      const wasLongPress = longPressFiredRef.current;
      cancelTimers();
      if (wasLongPress) return;
      latch.tap(key);
    },
    [latch, cancelTimers]
  );

  return (
    <div
      role="toolbar"
      aria-label="Smart keys"
      data-testid="mobile-smart-key-strip"
      data-disabled={disabled ? "true" : "false"}
      className={cn(
        "relative flex w-full items-stretch gap-1 border-t border-border bg-card",
        "overflow-x-auto overflow-y-hidden",
        "px-2 py-1.5",
        // Hide the scrollbar visually but keep wheel/touch scroll active.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "touch-pan-x",
        className
      )}
    >
      {SMART_KEYS.map((k) => {
        if (k.kind === "modifier") {
          const slot = latch.state[k.id];
          const active = slot !== "off";
          const sticky = slot === "sticky";
          const badge = modifierBadgeFor(slot);
          return (
            <button
              key={k.id}
              type="button"
              data-testid={`mobile-smart-key-${k.id}`}
              data-modifier={k.id}
              data-state={slot}
              aria-label={k.ariaLabel}
              aria-pressed={active}
              disabled={disabled}
              onPointerDown={(e) => {
                e.preventDefault();
                startModifierPress(k.id);
              }}
              onPointerUp={() => endModifierPress(k.id)}
              onPointerCancel={cancelTimers}
              onPointerLeave={cancelTimers}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "relative flex shrink-0 items-center justify-center rounded-md border px-3",
                "min-h-[40px] min-w-[44px] text-xs leading-none",
                "transition-colors",
                active
                  ? "border-foreground/40 bg-accent/40 font-medium text-foreground"
                  : "border-border bg-card font-normal text-muted-foreground",
                sticky && "ring-1 ring-foreground/30",
                "active:bg-accent/60",
                "disabled:opacity-40"
              )}
            >
              {badge ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1.5 top-1 text-[9px] leading-none text-foreground"
                >
                  {badge}
                </span>
              ) : null}
              {k.label}
            </button>
          );
        }

        return (
          <button
            key={k.id}
            type="button"
            data-testid={`mobile-smart-key-${k.id}`}
            data-key={k.id}
            aria-label={k.ariaLabel ?? k.id}
            disabled={disabled}
            onPointerDown={(e) => {
              e.preventDefault();
              startKeyPress(k);
            }}
            onPointerUp={endKeyPress}
            onPointerCancel={endKeyPress}
            onPointerLeave={endKeyPress}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              "shrink-0 rounded-md border border-border bg-card",
              "flex items-center justify-center px-3 min-h-[40px]",
              "text-xs leading-none text-foreground",
              k.wide ? "min-w-[52px]" : "min-w-[44px]",
              "transition-colors",
              "hover:bg-accent/30 active:bg-accent/60",
              "disabled:opacity-40"
            )}
          >
            {k.label}
          </button>
        );
      })}

      {trailing ? (
        <div className="ml-auto flex shrink-0 items-center pl-1">{trailing}</div>
      ) : null}
    </div>
  );
}

/** Exposed for tests. */
export const SMART_KEY_DEFINITIONS = SMART_KEYS;
