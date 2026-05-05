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
//     fired), we update `terminal.select(col, row, length)` AND call
//     `e.preventDefault()` so the parallel touch-scroll handler doesn't
//     scroll the viewport from under the selection. Otherwise, if the finger
//     has moved further than MOVEMENT_CANCEL_PX, we cancel the pending
//     long-press timer and let the touch-scroll handler take over.
//   - On touchend: if we're in selection mode, copy `terminal.getSelection()`
//     to the clipboard and keep the selection visible. Otherwise, if the
//     gesture lasted < TAP_MAX_MS and total movement was < TAP_MAX_PX, we
//     either clear an existing selection (tap-to-deselect) OR synthesize a
//     `mousedown`+`mouseup` pair on the xterm screen and scroll to the
//     bottom. We always scroll to the bottom on tap regardless of mouse mode
//     because that matches user expectation. When mouse mode is on, xterm
//     also forwards the synthetic click to the running app.
//   - On a second finger (pinch handoff) we cancel the pending long-press and
//     bail out — `usePinchZoom` claims the gesture from there.
//
// Coordination with `touch-scroll.ts`: shared via a `TouchModeRef`. The scroll
// handler skips activation when our mode is `"selection"`, so a long-press
// drag never accidentally scrolls. We also `preventDefault` on touchmove
// during selection as a belt-and-suspenders measure (requires the listener be
// registered with `{ passive: false }`).
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

export type TouchInteractionMode = "idle" | "pending" | "selection" | "scroll";

/**
 * Mutable mode reference shared between `createTouchInteractions` and
 * `createTouchScrollHandlers`. Lets the scroll handler skip activation while
 * a selection drag is in progress, and lets the interactions handler keep
 * its mode in sync with what the scroll handler observes. The host owns the
 * single object instance and passes it to both factories.
 */
export interface TouchModeRef {
  current: TouchInteractionMode;
}

export function createTouchModeRef(): TouchModeRef {
  return { current: "idle" };
}

type Mode = TouchInteractionMode;

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

// Module-scope flag so we warn at most once per page load when the xterm
// private cell-dimensions API is missing. The warning is for developers (so a
// silent break of long-press selection on an xterm version bump is visible),
// not users; every gesture would otherwise rediscover the same failure and
// flood the console.
let warnedAboutMissingDims = false;

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
  if (cellWidth === 0 || cellHeight === 0) {
    // The private path (`_core._renderService.dimensions.css.cell`) is the
    // only way xterm exposes cell metrics today. If it disappears on a minor
    // version bump, long-press selection silently no-ops with no signal, so
    // emit a one-time developer warning so the regression is visible. Per
    // CLAUDE.md, client-side code may use console.* directly.
    if (!warnedAboutMissingDims && typeof console !== "undefined") {
      warnedAboutMissingDims = true;
      console.warn(
        "[touch-interactions] xterm private cell-dimensions API is unavailable; long-press selection disabled. Update xterm version or report a bug."
      );
    }
    return null;
  }

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
  /**
   * Shared mode reference. Required for coordinating with `touch-scroll.ts`
   * (the scroll handler reads this to bail when we're mid-selection). If
   * omitted, a private one is created — useful for unit tests.
   */
  modeRef?: TouchModeRef;
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
  handleTouchCancel: (e: TouchEvent) => void;
  /**
   * Cancel any pending long-press timer and reset all state to idle. Must be
   * called from the host effect's cleanup so a long-press timer started just
   * before unmount doesn't fire on a disposed xterm. Idempotent.
   */
  destroy: () => void;
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
  // The host shares one `modeRef` across this hook + touch-scroll. When
  // omitted (unit tests), we use a private one so the handler still works.
  const modeRef: TouchModeRef = deps.modeRef ?? createTouchModeRef();
  const setMode = (m: Mode) => {
    modeRef.current = m;
  };
  const getCurrentMode = (): Mode => modeRef.current;

  let startX = 0;
  let startY = 0;
  let startT = 0;
  let lastX = 0;
  let lastY = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  // Cell coords captured when the long-press fires.
  let selectionStart: { col: number; row: number } | null = null;

  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      clearTimer(longPressTimer);
      longPressTimer = null;
    }
  };

  const reset = () => {
    cancelLongPress();
    // If a selection drag was in progress (or one is otherwise still
    // visible — e.g. touchcancel mid-drag from an iOS system gesture, or a
    // second finger landing during selection), clear xterm's painted
    // selection too. Without this the selection lingers on screen even
    // though our state has flipped to idle, and the touch-scroll handler
    // (which only bails while modeRef is "selection") will happily scroll
    // the viewport with the stale selection still painted.
    const wasSelecting = modeRef.current === "selection";
    setMode("idle");
    selectionStart = null;
    if (wasSelecting) {
      const terminal = getTerminal();
      if (terminal) {
        try {
          terminal.clearSelection();
        } catch {
          // xterm may throw if disposed during teardown; safe to ignore.
        }
      }
    }
  };

  const beginSelection = () => {
    const terminal = getTerminal();
    if (!terminal) return;
    // Re-read dims at fire time. We do NOT cache origin — see updateSelection
    // for why (soft keyboard animations shift the viewport mid-gesture).
    const dims = readDims(terminal);
    if (!dims) return;
    const viewportCell = pointToCell(dims, startX, startY);
    // pointToCell returns a row in viewport coordinates (0..rows-1) but
    // `terminal.select(col, row, length)` expects a buffer-absolute row
    // (an index into `buffer.active`). When the user has scrolled the
    // scrollback, viewportY is non-zero and the two diverge — without this
    // shift the selection would land at the top of the buffer history
    // instead of where the user's finger is.
    const viewportY = terminal.buffer.active.viewportY;
    const cell = { col: viewportCell.col, row: viewportCell.row + viewportY };
    // selectionStart is the buffer-absolute cell the user's finger landed on
    // AT FIRE TIME. We deliberately do NOT recompute it later (e.g. when the
    // soft keyboard slides up and shifts the terminal's screen position),
    // because the user's anchor intent is "the cell I pressed"; the cell's
    // position in the buffer doesn't move when the keyboard pops. Note: if
    // new output is emitted between fire and a subsequent move, viewportY
    // may shift but the buffer index of the anchored cell is stable, so the
    // anchor remains semantically correct.
    selectionStart = cell;
    setMode("selection");
    // Initial 1-cell selection so the user sees feedback immediately even if
    // they don't move yet.
    terminal.clearSelection();
    terminal.select(cell.col, cell.row, 1);
    // Haptic cue on supporting browsers. Caveats we accept silently:
    //   - iOS Safari ignores `vibrate` entirely (no Vibration API support).
    //   - Some Android Chrome versions suppress `vibrate` when called outside
    //     a synchronous user-gesture frame; the long-press fires from a
    //     setTimeout callback, which is NOT such a frame, so the call may be
    //     a no-op. The try/catch absorbs any thrown errors as well.
    // The haptic is purely additive; the selection still works without it.
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
    if (!terminal || !selectionStart) return;
    // Re-read dims every move. The iOS soft keyboard animates up after the
    // user starts a gesture (focus shifts to the input bar, etc.), shifting
    // the terminal upward by the keyboard height. A cached `originY` from
    // long-press-fire would put every subsequent row off by that delta. The
    // call is cheap (a getBoundingClientRect plus an internal property read).
    // Cell width/height also re-read for parity, since pinch-zoom can change
    // them, although pinch cancels selection mode anyway.
    const dims = readDims(terminal);
    if (!dims) return;
    const viewportEnd = pointToCell(dims, clientX, clientY);
    // Same buffer-absolute conversion as in beginSelection. selectionStart
    // is already stored in buffer-absolute coords; the endpoint must match.
    const viewportY = terminal.buffer.active.viewportY;
    const end = { col: viewportEnd.col, row: viewportEnd.row + viewportY };
    const span = selectionLength(
      selectionStart.col,
      selectionStart.row,
      end.col,
      end.row,
      dims.cols
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

    // Tap-to-deselect: if there's an active selection, clear it and bail.
    // Don't fire a click and don't scroll — the user's intent on this tap
    // was clearly "dismiss the selection." Their next tap will go through
    // the normal click + scrollToBottom path.
    if (terminal.hasSelection()) {
      terminal.clearSelection();
      return;
    }

    // xterm v6 attaches its mouse listeners on the .xterm-screen element via
    // `addDisposableListener`. We dispatch there — it is the stable target
    // regardless of which renderer (WebGL canvas, DOM, multiple canvases)
    // happens to be active. We previously aimed at the inner canvas, but
    // that's brittle: WebGL builds paint into multiple canvases (text,
    // selection, link, link-tooltip layers) and the listener isn't on any of
    // them. Falling back to the host div is also fine; xterm wires a few
    // listeners there as well.
    const host = terminal.element;
    const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
    const target: HTMLElement = screen ?? host;
    // Real browser-synthesized mouse-from-touch events include screenX /
    // screenY. xterm itself doesn't read those for cell math (it uses
    // clientX/Y plus its own bounding-rect origin), but other consumers in
    // the dispatch chain might assert on them. We mirror clientX/Y here;
    // the values aren't load-bearing for terminal coords; we just want the
    // event shape to match what a real mouse would carry.
    const baseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: typeof window !== "undefined" ? window : undefined,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: 1,
    };
    dispatchMouse(target, new MouseEvent("mousedown", baseInit));
    dispatchMouse(target, new MouseEvent("mouseup", { ...baseInit, buttons: 0 }));

    // Always scroll to bottom on tap, regardless of mouse mode. Most users
    // expect tapping the terminal to "jump back to the latest output" — a
    // ubiquitous mobile pattern. When app mouse mode is on, xterm forwards
    // the synthetic click to the running app for free; the scroll is a no-op
    // there since the alt buffer doesn't have scrollback. When mouse mode is
    // off, the synthetic click is a harmless no-op (xterm's selection logic
    // would handle it but our taps don't drag) and the scroll does its job.
    terminal.scrollToBottom();
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
    setMode("pending");
    cancelLongPress();
    longPressTimer = setTimer(() => {
      longPressTimer = null;
      // The long-press timer only fires while we're still in "pending" — if
      // the finger moved past MOVEMENT_CANCEL_PX or a second finger landed,
      // we already cancelled it. So at this point the gesture is a held
      // single finger.
      if (getCurrentMode() !== "pending") return;
      beginSelection();
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: TouchEvent) => {
    const cur = getCurrentMode();
    if (cur === "idle") return;
    if (e.touches.length !== 1) {
      // Pinch handoff: cancel long-press but don't dispatch tap on end.
      cancelLongPress();
      setMode("scroll"); // any non-tap state cleanly suppresses tap synthesis
      return;
    }
    const t = e.touches[0];
    lastX = t.clientX;
    lastY = t.clientY;

    if (cur === "selection") {
      // Suppress the parallel touch-scroll handler. Without preventDefault
      // the host's scroll listener would also process this touchmove and
      // scroll the viewport while the user is dragging to extend the
      // selection. We also share the modeRef so the scroll handler bails
      // on its own (defense in depth — preventDefault here covers the
      // cases where listener order or third-party hooks bypass that).
      // Requires the listener be registered with `{ passive: false }`.
      if (e.cancelable) e.preventDefault();
      updateSelection(lastX, lastY);
      return;
    }

    // Pending: see if movement disqualifies a tap / long-press.
    // We use axis-aligned thresholds (max of |dx|, |dy|) rather than
    // Euclidean distance to match `touch-scroll.ts`, which activates scroll
    // at `Math.abs(currentY - touchStartY) > TOUCH_SCROLL_ACTIVATION_PX`.
    // Using `Math.hypot(dx, dy)` here would create a small dead-motion
    // window for diagonal swipes (e.g. dx=4, dy=4 → hypot ~5.66 cancels
    // long-press, but |dy|=4 doesn't activate scroll), where neither
    // gesture is active. Aligning the metric closes that gap.
    const dx = lastX - startX;
    const dy = lastY - startY;
    if (Math.abs(dx) > MOVEMENT_CANCEL_PX || Math.abs(dy) > MOVEMENT_CANCEL_PX) {
      cancelLongPress();
      setMode("scroll"); // touch-scroll handler will own the rest of this gesture
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    // touchend fires for the SPECIFIC finger that lifted. If others remain
    // (e.touches.length > 0), the gesture isn't actually over — resetting
    // mode to "idle" here would short-circuit the move handler for the
    // finger still on the screen. Treat this as "one finger lifted, gesture
    // continues with whatever's left." Abandon any active selection so we
    // don't leave a stale highlight, but don't mark the gesture finished.
    if (e.touches.length > 0) {
      const cur = getCurrentMode();
      if (cur === "selection") {
        const terminal = getTerminal();
        if (terminal) {
          try {
            terminal.clearSelection();
          } catch {
            // ignore — terminal may be disposed
          }
        }
        cancelLongPress();
        selectionStart = null;
        // Park in "scroll" — any non-tap, non-selection state cleanly
        // suppresses tap synthesis on the eventual final touchend and lets
        // the touch-scroll handler take over for the remaining finger.
        setMode("scroll");
      }
      // For pending/scroll/idle we leave state as-is; the remaining finger
      // continues whatever it was doing.
      return;
    }

    cancelLongPress();
    const cur = getCurrentMode();
    if (cur === "selection") {
      // Use the last known position from touchmove rather than touchend.touches
      // (which is empty by spec on the last finger lift).
      updateSelection(lastX, lastY);
      finishSelection();
      setMode("idle");
      return;
    }

    if (cur === "pending") {
      const elapsed = now() - startT;
      const dx = lastX - startX;
      const dy = lastY - startY;
      const dist = Math.hypot(dx, dy);
      if (elapsed <= TAP_MAX_MS && dist <= TAP_MAX_PX) {
        synthesizeTap(startX, startY);
      }
    }

    // Scroll / cancelled — nothing to do beyond resetting state.
    setMode("idle");
    selectionStart = null;
  };

  const handleTouchCancel = (e: TouchEvent) => {
    void e; // ignored; matches DOM EventListener signature
    reset();
  };

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    destroy: reset,
    getMode: () => modeRef.current,
  };
}

export interface UseTouchInteractionsOptions {
  /** Element to attach listeners to (typically the xterm container). */
  element: HTMLElement | null;
  getTerminal: () => XTermType | null;
  /** Optional shared mode ref for coordinating with `touch-scroll.ts`. */
  modeRef?: TouchModeRef;
  enabled?: boolean;
}

/** React hook that wires `createTouchInteractions` onto an element. */
export function useTouchInteractions(opts: UseTouchInteractionsOptions): void {
  const { element, getTerminal, modeRef, enabled = true } = opts;
  // Stable refs so the listeners don't re-bind on every render.
  const getTerminalRef = useRef(getTerminal);
  useEffect(() => {
    getTerminalRef.current = getTerminal;
  }, [getTerminal]);

  useEffect(() => {
    if (!element || !enabled) return;
    const handlers = createTouchInteractions({
      getTerminal: () => getTerminalRef.current(),
      modeRef,
    });
    // touchmove is `{ passive: false }` because we call preventDefault while
    // in selection mode (so the host's touch-scroll listener doesn't scroll
    // the viewport from under the dragged selection). The other events stay
    // passive — we don't preventDefault on them.
    element.addEventListener("touchstart", handlers.handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handlers.handleTouchMove, { passive: false });
    element.addEventListener("touchend", handlers.handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handlers.handleTouchCancel, { passive: true });
    return () => {
      handlers.destroy();
      element.removeEventListener("touchstart", handlers.handleTouchStart);
      element.removeEventListener("touchmove", handlers.handleTouchMove);
      element.removeEventListener("touchend", handlers.handleTouchEnd);
      element.removeEventListener("touchcancel", handlers.handleTouchCancel);
    };
  }, [element, enabled, modeRef]);
}
