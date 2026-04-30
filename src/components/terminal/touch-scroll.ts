// Mobile touch-scroll algorithm for the xterm.js terminal.
//
// Extracted as a pure factory so the unit test runs the same code path as
// production rather than a parallel implementation. Imported by Terminal.tsx
// (driver) and Terminal.touch-scroll.test.ts (asserts).
//
// xterm v6 reparents .xterm-screen into a SmoothScrollableElement at
// .xterm-scrollable-element; .xterm-viewport survives only as a vestigial
// empty div. We translate touch deltas into synthetic WheelEvents that bubble
// from .xterm-scrollable-element up through .xterm — both xterm's
// SmoothScrollableElement listener (normal scrollback) and CoreBrowserTerminal
// root listener (which forwards wheel as escape sequences when the running
// app has enabled mouse-wheel reporting, e.g. vim, less, tmux mouse mode)
// hang off that bubbling chain, so bubbles must be true.

import type { Terminal as XTermType } from "@xterm/xterm";

// Pixel slop a single-touch swipe must exceed before we treat it as a scroll
// gesture (rather than a tap).
export const TOUCH_SCROLL_ACTIVATION_PX = 5;

const MOMENTUM_START_THRESHOLD = 1.5;
const MOMENTUM_STOP_THRESHOLD = 0.3;
const MOMENTUM_DECAY = 0.95; // Feels closer to iOS native momentum
const MAX_VELOCITY_SAMPLES = 5;

export interface TouchScrollDeps {
  /** Outer container we attach touch listeners to. */
  container: HTMLElement;
  /** Returns the live xterm instance for the fallback line-scroll path. */
  getXterm: () => Pick<XTermType, "rows" | "scrollLines"> | null;
  /** Returns the live font-size used as a last-resort cell-height fallback. */
  getFontSize: () => number;
  /** Test seam — defaults to `requestAnimationFrame` / `cancelAnimationFrame`. */
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
  /** Test seam — defaults to `performance.now()`. */
  now?: () => number;
}

export interface TouchScrollHandlers {
  handleTouchStart: (e: TouchEvent) => void;
  handleTouchMove: (e: TouchEvent) => void;
  handleTouchEnd: () => void;
  handleTouchCancel: () => void;
  /** Cancel any in-flight momentum animation. Idempotent. */
  cancelMomentum: () => void;
}

export function createTouchScrollHandlers(deps: TouchScrollDeps): TouchScrollHandlers {
  const { container, getXterm, getFontSize } = deps;
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancelRaf = deps.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  const now = deps.now ?? (() => performance.now());

  let touchStartY = 0;
  let lastTouchY = 0;
  let lastTouchTime = 0;
  let velocityY = 0;
  let isScrolling = false;
  let momentumAnimationId: number | null = null;
  let accumulatedDelta = 0;
  let cachedScrollEl: HTMLElement | null = null;

  const velocitySamples: number[] = [];

  const resolveScrollEl = (): HTMLElement | null => {
    if (cachedScrollEl && cachedScrollEl.isConnected) return cachedScrollEl;
    cachedScrollEl = container.querySelector(".xterm-scrollable-element") as HTMLElement | null;
    return cachedScrollEl;
  };

  const computeCellHeight = (): number => {
    const xterm = getXterm();
    const el = resolveScrollEl();
    if (xterm && xterm.rows > 0 && el && el.clientHeight > 0) {
      return el.clientHeight / xterm.rows;
    }
    return getFontSize() * 1.2;
  };

  const dispatchScrollWheel = (deltaY: number): boolean => {
    const el = resolveScrollEl();
    if (!el) return false;
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        deltaMode: 0, // DOM_DELTA_PIXEL
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  };

  const fallbackScrollLines = (): void => {
    const h = computeCellHeight();
    if (h <= 0) return;
    const linesToScroll = Math.trunc(accumulatedDelta / h);
    if (linesToScroll !== 0) {
      getXterm()?.scrollLines(linesToScroll);
      accumulatedDelta -= linesToScroll * h;
    }
  };

  const flushScroll = (): void => {
    const px = Math.trunc(accumulatedDelta);
    if (px === 0) return;
    if (dispatchScrollWheel(px)) {
      accumulatedDelta -= px;
    } else {
      fallbackScrollLines();
    }
  };

  const cancelMomentum = (): void => {
    if (momentumAnimationId !== null) {
      cancelRaf(momentumAnimationId);
      momentumAnimationId = null;
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    cancelMomentum();
    if (e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      lastTouchY = touchStartY;
      lastTouchTime = now();
      velocityY = 0;
      velocitySamples.length = 0;
      accumulatedDelta = 0;
      isScrolling = false;
      // Drop any stale node so resolveScrollEl re-queries — handles the case
      // where xterm reparented its DOM between gestures (theme/font change).
      cachedScrollEl = null;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      isScrolling = false;
      return;
    }

    // Preempt browser pan on every single-touch move. touch-action: none cascades
    // from .terminal.xterm, but iOS Safari has been observed to commit to a native
    // pan if a single move slips through without preventDefault().
    e.preventDefault();

    const currentY = e.touches[0].clientY;
    const deltaY = lastTouchY - currentY; // positive = finger moved up
    const t = now();
    const timeDelta = t - lastTouchTime;

    if (timeDelta > 0) {
      const instantVelocity = (deltaY / timeDelta) * 16; // Normalize to ~60fps frame
      velocitySamples.push(instantVelocity);
      if (velocitySamples.length > MAX_VELOCITY_SAMPLES) {
        velocitySamples.shift();
      }
      velocityY = velocitySamples.reduce((a, b) => a + b, 0) / velocitySamples.length;
    }

    if (!isScrolling && Math.abs(currentY - touchStartY) > TOUCH_SCROLL_ACTIVATION_PX) {
      isScrolling = true;
    }

    lastTouchY = currentY;
    lastTouchTime = t;

    if (isScrolling) {
      accumulatedDelta += deltaY;
      flushScroll();
    }
  };

  const handleTouchEnd = () => {
    if (!isScrolling) return;
    isScrolling = false;

    const applyMomentum = () => {
      if (Math.abs(velocityY) < MOMENTUM_STOP_THRESHOLD) {
        momentumAnimationId = null;
        return;
      }
      accumulatedDelta += velocityY;
      flushScroll();
      velocityY *= MOMENTUM_DECAY;
      momentumAnimationId = raf(applyMomentum);
    };

    if (Math.abs(velocityY) > MOMENTUM_START_THRESHOLD) {
      momentumAnimationId = raf(applyMomentum);
    }
  };

  const handleTouchCancel = () => {
    cancelMomentum();
    isScrolling = false;
    velocityY = 0;
    accumulatedDelta = 0;
  };

  return { handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, cancelMomentum };
}
