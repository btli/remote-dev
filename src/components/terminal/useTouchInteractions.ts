"use client";

// Mobile tap-to-click and long-press-to-select for the xterm.js terminal.
//
// Why this exists: `.terminal.xterm` has `touch-action: none` so the browser
// never synthesizes click events from taps — and our touch-scroll handler
// preventDefaults touchmove unconditionally for single-finger gestures. As a
// result, an ordinary tap on the xterm viewport produces nothing visible. TUIs
// that enable application mouse mode (DECSET 1000/1002/1006), e.g. Claude
// Code's clickable buttons, never see the click.
//
// This hook composes alongside `touch-scroll.ts` and `usePinchZoom`:
//   - On touchstart with one finger we record (x, y, t) and arm two timers:
//     one for the long-press fire (DEFAULT_LONG_PRESS_MS), and an implicit
//     one via touchend which decides between "tap" vs "scroll"/"selection".
//   - During touchmove: if the gesture is in the selection mode (long-press
//     fired), we update `terminal.select(col, row, length)`. Otherwise, if the
//     finger has moved further than MOVEMENT_CANCEL_PX, we cancel the pending
//     long-press timer and let the touch-scroll handler take over.
//   - On touchend: if we're in selection mode, copy `terminal.getSelection()`
//     to the clipboard and keep the selection visible. Otherwise, if the
//     gesture lasted < TAP_MAX_MS and total movement was < TAP_MAX_PX, we
//     synthesize a `mousedown`+`mouseup` pair on the xterm element. xterm
//     forwards these to the application when mouse mode is on; if it is off,
//     we clear any selection and call `terminal.scrollToBottom()` so the
//     "tap to jump to latest" behavior works at a shell prompt.
//   - On a second finger (pinch handoff) we cancel the pending long-press and
//     bail out — `usePinchZoom` claims the gesture from there.
//
// We do NOT call `e.preventDefault()` on the touch events here. The touch-
// scroll handler already does so when needed (touchmove past activation), and
// `touch-action: none` on .xterm.terminal blocks the browser side.
//
// xterm internals: cell dimensions live on `terminal._core._renderService`.
// xterm's public TS surface doesn't expose this, so we cast through `unknown`
// at the boundary and handle missing values gracefully (fall back to font-
// size-based estimates). When dimensions are unavailable we cannot produce a
// (col, row), so taps are still synthesized at the raw pixel position (xterm
// then computes its own cell from the mouse coords) but selections cannot
// proceed and we silently no-op.

import { useEffect, useRef } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";

export const TAP_MAX_MS = 250;
// MUST be <= touch-scroll's TOUCH_SCROLL_ACTIVATION_PX (5) so we don't
// register a "tap" on a finger that already engaged the scroll handler.
export const TAP_MAX_PX = 5;
export const LONG_PRESS_MS = 500;
// Same threshold as touch-scroll: once we cross it the scroll handler owns
// the gesture and we cleanly suppress both long-press and tap synthesis.
export const MOVEMENT_CANCEL_PX = 5;

type Mode = "idle" | "pending" | "selection" | "scroll";

interface XTermDims {
  /** Cell width in CSS px (not device px). */
  cellWidth: number;
  /** Cell height in CSS px. */
  cellHeight: number;
  /** Origin of the cell grid in viewport coords (top-left of (0,0)). */
  originX: number;
  originY: number;
  /** Total grid columns (terminal.cols). */
  cols: number;
  /** Total grid rows (terminal.rows). */
  rows: number;
}

/**
 * Resolve cell dimensions and the grid origin for a live terminal. Returns
 * `null` when xterm hasn't laid out yet or when the internal API shape we
 * rely on is missing (older / patched xterm builds).
 */
function readDims(terminal: XTermType): XTermDims | null {
  if (!terminal.element) return null;

  // xterm exposes `_core._renderService.dimensions.css.cell` in v6. Cast
  // through unknown to avoid leaking the internal type into our public API.
  // Shape (xterm v6):
  //   dimensions: { css: { cell: { width, height } }, device: {...} }
  const core = (terminal as unknown as {
    _core?: {
      _renderService?: {
        dimensions?: {
          css?: { cell?: { width?: number; height?: number } };
        };
      };
    };
  })._core;
  const cell = core?._renderService?.dimensions?.css?.cell;
  const cellWidth = Number.isFinite(cell?.width) && (cell?.width ?? 0) > 0 ? (cell!.width as number) : 0;
  const cellHeight = Number.isFinite(cell?.height) && (cell?.height ?? 0) > 0 ? (cell!.height as number) : 0;
  if (cellWidth === 0 || cellHeight === 0) return null;

  // The xterm screen element (.xterm-screen) is the grid origin. Its bounding
  // rect's top-left maps to (col=0, row=0). The outer `.terminal.xterm` may
  // include scrollbars / padding so we use the screen specifically.
  const screen = terminal.element.querySelector(".xterm-screen") as HTMLElement | null;
  const rect = (screen ?? terminal.element).getBoundingClientRect();

  return {
    cellWidth,
    cellHeight,
    originX: rect.left,
    originY: rect.top,
    cols: terminal.cols,
    rows: terminal.rows,
  };
}

/**
 * Convert viewport-space (x, y) to (col, row) within the current grid. Result
 * is clamped to the grid bounds so a finger that drifts off the edge still
 * produces a valid selection endpoint. Returns null when dimensions are
 * unavailable.
 */
export function pointToCell(
  dims: XTermDims,
  clientX: number,
  clientY: number
): { col: number; row: number } {
  const col = Math.max(
    0,
    Math.min(dims.cols - 1, Math.floor((clientX - dims.originX) / dims.cellWidth))
  );
  const row = Math.max(
    0,
    Math.min(dims.rows - 1, Math.floor((clientY - dims.originY) / dims.cellHeight))
  );
  return { col, row };
}

/**
 * Compute the linear `length` value `terminal.select(col, row, length)`
 * expects to span from (startCol, startRow) to (endCol, endRow) in the
 * VIEWPORT — wrapping across rows. xterm's `select` interprets length as a
 * count of cells walking left-to-right, top-to-bottom from the start. We use
 * `cols` (the active grid width) for the row stride.
 */
export function selectionLength(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  cols: number
): { col: number; row: number; length: number } {
  // Order start <= end in reading direction.
  const fromIdx = startRow * cols + startCol;
  const toIdx = endRow * cols + endCol;
  if (toIdx < fromIdx) {
    return {
      col: endCol,
      row: endRow,
      length: fromIdx - toIdx + 1,
    };
  }
  return {
    col: startCol,
    row: startRow,
    length: toIdx - fromIdx + 1,
  };
}

export interface UseTouchInteractionsDeps {
  /** Live xterm.js Terminal instance. Returns null before mount. */
  getTerminal: () => XTermType | null;
  /** Test seam — defaults to performance.now(). */
  now?: () => number;
  /** Test seam — defaults to setTimeout. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Test seam — defaults to clearTimeout. */
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  /** Test seam — defaults to navigator.clipboard.writeText. */
  copyToClipboard?: (text: string) => Promise<void>;
  /**
   * Test seam — receives the synthesized MouseEvents. In production we
   * dispatch them directly on the xterm element.
   */
  dispatchMouse?: (target: HTMLElement, event: MouseEvent) => void;
}

export interface TouchInteractionsHandlers {
  handleTouchStart: (e: TouchEvent) => void;
  handleTouchMove: (e: TouchEvent) => void;
  handleTouchEnd: (e: TouchEvent) => void;
  handleTouchCancel: () => void;
  /** Current internal mode — exposed for tests. */
  getMode: () => Mode;
}

export function createTouchInteractions(
  deps: UseTouchInteractionsDeps
): TouchInteractionsHandlers {
  const { getTerminal } = deps;
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
  const copyToClipboard =
    deps.copyToClipboard ??
    ((text: string) =>
      typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard.writeText(text)
        : Promise.resolve());
  const dispatchMouse =
    deps.dispatchMouse ??
    ((target: HTMLElement, event: MouseEvent) => {
      target.dispatchEvent(event);
    });

  let mode: Mode = "idle";
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let lastX = 0;
  let lastY = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  // Cell coords captured when the long-press fires.
  let selectionStart: { col: number; row: number } | null = null;
  // Stored dims from the moment the long-press fires; we trust the layout
  // didn't shift mid-gesture.
  let selectionDims: XTermDims | null = null;

  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      clearTimer(longPressTimer);
      longPressTimer = null;
    }
  };

  const reset = () => {
    cancelLongPress();
    mode = "idle";
    selectionStart = null;
    selectionDims = null;
  };

  const beginSelection = () => {
    const terminal = getTerminal();
    if (!terminal) return;
    const dims = readDims(terminal);
    if (!dims) return;
    const cell = pointToCell(dims, startX, startY);
    selectionStart = cell;
    selectionDims = dims;
    mode = "selection";
    // Initial 1-cell selection so the user sees feedback immediately even if
    // they don't move yet.
    terminal.clearSelection();
    terminal.select(cell.col, cell.row, 1);
    // Haptic cue on supporting browsers (iOS Safari ignores `vibrate`; that's
    // fine — it's purely additive).
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(10);
      } catch {
        // Some browsers throw on vibrate without a user gesture; ignore.
      }
    }
  };

  const updateSelection = (clientX: number, clientY: number) => {
    const terminal = getTerminal();
    if (!terminal || !selectionStart || !selectionDims) return;
    const end = pointToCell(selectionDims, clientX, clientY);
    const span = selectionLength(
      selectionStart.col,
      selectionStart.row,
      end.col,
      end.row,
      selectionDims.cols
    );
    terminal.select(span.col, span.row, span.length);
  };

  const finishSelection = () => {
    const terminal = getTerminal();
    if (!terminal) return;
    const text = terminal.getSelection();
    if (text) {
      // Best-effort clipboard write. We don't surface failures here — the
      // selection itself remains visible so the user can try again or copy
      // manually via the system selection menu if available.
      void copyToClipboard(text).catch(() => {});
    }
  };

  const synthesizeTap = (clientX: number, clientY: number) => {
    const terminal = getTerminal();
    if (!terminal || !terminal.element) return;
    const target = terminal.element;
    // Mouse events fired on the xterm host element are picked up by xterm's
    // own listeners. When DECSET 1000/1002/1006 is active xterm forwards them
    // to the PTY; when not, xterm's selection logic clears any prior
    // selection (which is what we want before we explicitly scroll).
    const baseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: typeof window !== "undefined" ? window : undefined,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };
    const md = new MouseEvent("mousedown", baseInit);
    dispatchMouse(target, md);
    const mu = new MouseEvent("mouseup", { ...baseInit, buttons: 0 });
    dispatchMouse(target, mu);

    // If app mouse mode is OFF, the tap should also re-anchor the viewport at
    // the bottom — matches the user's expectation that tapping clears scroll-
    // back state and "jumps back to the prompt." When mouse mode IS on, the
    // app got the click; we leave the viewport position alone since the user
    // may be intentionally scrolled up reading history.
    const mouseMode = (terminal as unknown as {
      modes?: { mouseTrackingMode?: string };
    }).modes?.mouseTrackingMode;
    const appOwnsMouse =
      mouseMode === "vt200" || mouseMode === "drag" || mouseMode === "any";
    if (!appOwnsMouse) {
      terminal.scrollToBottom();
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      // Pinch or other multi-touch: relinquish.
      reset();
      return;
    }
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    lastX = startX;
    lastY = startY;
    startT = now();
    mode = "pending";
    cancelLongPress();
    longPressTimer = setTimer(() => {
      longPressTimer = null;
      // The long-press timer only fires while we're still in "pending" — if
      // the finger moved past MOVEMENT_CANCEL_PX or a second finger landed,
      // we already cancelled it. So at this point the gesture is a held
      // single finger.
      if (mode !== "pending") return;
      beginSelection();
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (mode === "idle") return;
    if (e.touches.length !== 1) {
      // Pinch handoff: cancel long-press but don't dispatch tap on end.
      cancelLongPress();
      mode = "scroll"; // any non-tap state cleanly suppresses tap synthesis
      return;
    }
    const t = e.touches[0];
    lastX = t.clientX;
    lastY = t.clientY;

    if (mode === "selection") {
      updateSelection(lastX, lastY);
      return;
    }

    // Pending: see if movement disqualifies a tap / long-press.
    const dx = lastX - startX;
    const dy = lastY - startY;
    if (Math.hypot(dx, dy) > MOVEMENT_CANCEL_PX) {
      cancelLongPress();
      mode = "scroll"; // touch-scroll handler will own the rest of this gesture
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    cancelLongPress();
    if (mode === "selection") {
      // Use the last known position from touchmove rather than touchend.touches
      // (which is empty by spec on the last finger lift).
      updateSelection(lastX, lastY);
      finishSelection();
      mode = "idle";
      return;
    }

    if (mode === "pending") {
      const elapsed = now() - startT;
      const dx = lastX - startX;
      const dy = lastY - startY;
      const dist = Math.hypot(dx, dy);
      if (elapsed <= TAP_MAX_MS && dist <= TAP_MAX_PX) {
        synthesizeTap(startX, startY);
      }
    }

    // Scroll / cancelled — nothing to do beyond resetting state.
    mode = "idle";
    selectionStart = null;
    selectionDims = null;
    void e; // suppress unused-arg lint without removing the param shape
  };

  const handleTouchCancel = () => {
    reset();
  };

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    getMode: () => mode,
  };
}

export interface UseTouchInteractionsOptions {
  /** Element to attach listeners to (typically the xterm container). */
  element: HTMLElement | null;
  getTerminal: () => XTermType | null;
  enabled?: boolean;
}

/** React hook that wires `createTouchInteractions` onto an element. */
export function useTouchInteractions(opts: UseTouchInteractionsOptions): void {
  const { element, getTerminal, enabled = true } = opts;
  // Stable refs so the listeners don't re-bind on every render.
  const getTerminalRef = useRef(getTerminal);
  useEffect(() => {
    getTerminalRef.current = getTerminal;
  }, [getTerminal]);

  useEffect(() => {
    if (!element || !enabled) return;
    const handlers = createTouchInteractions({
      getTerminal: () => getTerminalRef.current(),
    });
    // Passive listeners — we never preventDefault here. The touch-scroll
    // handler in Terminal.tsx already calls preventDefault on touchmove past
    // its activation threshold; double-handling would be wasteful.
    element.addEventListener("touchstart", handlers.handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handlers.handleTouchMove, { passive: true });
    element.addEventListener("touchend", handlers.handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handlers.handleTouchCancel, { passive: true });
    return () => {
      element.removeEventListener("touchstart", handlers.handleTouchStart);
      element.removeEventListener("touchmove", handlers.handleTouchMove);
      element.removeEventListener("touchend", handlers.handleTouchEnd);
      element.removeEventListener("touchcancel", handlers.handleTouchCancel);
    };
  }, [element, enabled]);
}
