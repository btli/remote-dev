/**
 * Tests for the mobile touch-scroll algorithm in Terminal.tsx.
 *
 * Mounting <Terminal /> in JSDOM is impractical — xterm.js needs canvas + a real
 * WebSocket. The algorithm itself lives in a useEffect closure and can't be
 * imported, so we replicate it here and assert its contract:
 *   1. TOUCH_SCROLL_ACTIVATION_PX gates initial small movements.
 *   2. Cumulative deltaY dispatched on wheel events sums (within rounding) to the
 *      total finger displacement.
 *   3. Wheel events use deltaMode=0 (DOM_DELTA_PIXEL) and don't bubble.
 *
 * Whenever Terminal.tsx changes the algorithm, this harness must be updated to
 * match — guarded by a comment in Terminal.tsx near the touch-scroll useEffect.
 * The activation threshold is imported from Terminal.tsx so a change to the
 * constant alone won't desync the test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TOUCH_SCROLL_ACTIVATION_PX } from "./touch-scroll-constants";

interface TouchHarness {
  container: HTMLElement;
  scrollEl: HTMLElement;
  dispatchedDeltas: number[];
  dispatchedDeltaModes: number[];
  dispatchedBubbles: boolean[];
  feedTouchSequence: (yPositions: number[]) => void;
}

function makeHarness(): TouchHarness {
  const container = document.createElement("div");
  const scrollEl = document.createElement("div");
  scrollEl.className = "xterm-scrollable-element";
  container.appendChild(scrollEl);
  document.body.appendChild(container);

  const dispatchedDeltas: number[] = [];
  const dispatchedDeltaModes: number[] = [];
  const dispatchedBubbles: boolean[] = [];
  scrollEl.addEventListener("wheel", (e) => {
    dispatchedDeltas.push(e.deltaY);
    dispatchedDeltaModes.push(e.deltaMode);
    dispatchedBubbles.push(e.bubbles);
  });

  // Replica of the algorithm in Terminal.tsx touch-scroll useEffect.
  let touchStartY = 0;
  let lastTouchY = 0;
  let isScrolling = false;
  let accumulatedDelta = 0;
  let cachedScrollEl: HTMLElement | null = null;

  const dispatchScrollWheel = (deltaY: number): boolean => {
    if (!cachedScrollEl) return false;
    cachedScrollEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        deltaMode: 0,
        bubbles: false,
        cancelable: true,
      }),
    );
    return true;
  };

  const flushScroll = (): void => {
    const px = Math.trunc(accumulatedDelta);
    if (px === 0) return;
    if (dispatchScrollWheel(px)) {
      accumulatedDelta -= px;
    }
  };

  const onTouchStart = (y: number) => {
    touchStartY = y;
    lastTouchY = y;
    accumulatedDelta = 0;
    isScrolling = false;
    cachedScrollEl = container.querySelector(".xterm-scrollable-element") as HTMLElement | null;
  };

  const onTouchMove = (y: number) => {
    const deltaY = lastTouchY - y;
    if (!isScrolling && Math.abs(y - touchStartY) > TOUCH_SCROLL_ACTIVATION_PX) {
      isScrolling = true;
    }
    lastTouchY = y;
    if (isScrolling) {
      accumulatedDelta += deltaY;
      flushScroll();
    }
  };

  return {
    container,
    scrollEl,
    dispatchedDeltas,
    dispatchedDeltaModes,
    dispatchedBubbles,
    feedTouchSequence: (yPositions: number[]) => {
      if (yPositions.length === 0) return;
      onTouchStart(yPositions[0]);
      for (let i = 1; i < yPositions.length; i++) {
        onTouchMove(yPositions[i]);
      }
    },
  };
}

describe("Terminal touch-scroll algorithm", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches WheelEvents with cumulative deltaY summing to total finger movement", () => {
    const h = makeHarness();
    // Finger starts at y=500, swipes up to y=400 in 5 even steps (100px total upward).
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);

    const totalDispatched = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    // Each step is 20px, well above the activation threshold; first onTouchMove
    // (delta 20px from 500→480) crosses the threshold and dispatches all 20px.
    // Cumulative dispatched should equal 100 (within 1px rounding from Math.trunc).
    expect(Math.abs(totalDispatched - 100)).toBeLessThanOrEqual(1);
  });

  it("uses DOM_DELTA_PIXEL (deltaMode=0) for all dispatched wheel events", () => {
    const h = makeHarness();
    h.feedTouchSequence([500, 480, 460, 440]);
    expect(h.dispatchedDeltas.length).toBeGreaterThan(0);
    for (const mode of h.dispatchedDeltaModes) {
      expect(mode).toBe(0);
    }
  });

  it("does not bubble dispatched wheel events past the scrollable element", () => {
    const h = makeHarness();
    h.feedTouchSequence([500, 480, 460, 440]);
    expect(h.dispatchedBubbles.length).toBeGreaterThan(0);
    for (const bubbles of h.dispatchedBubbles) {
      expect(bubbles).toBe(false);
    }
  });

  it("does not dispatch wheel events for movement below the activation threshold", () => {
    const h = makeHarness();
    // All movements are within ±TOUCH_SCROLL_ACTIVATION_PX of start; should never activate.
    h.feedTouchSequence([500, 502, 504, 503, 501, 500]);
    expect(h.dispatchedDeltas).toEqual([]);
  });

  it("activates only after movement exceeds TOUCH_SCROLL_ACTIVATION_PX", () => {
    const h = makeHarness();
    // Cumulative offset from start: 3, 4, 7. The activation check is against
    // cumulative offset (|currentY - touchStartY|), so it flips on the 7px move.
    // The dispatched value is the per-step delta of *that* move (3px from 496→493).
    h.feedTouchSequence([500, 497, 496, 493]);
    expect(h.dispatchedDeltas.length).toBeGreaterThan(0);
    const total = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it("carries sub-pixel remainder across flushes (no drift)", () => {
    const h = makeHarness();
    // Engineer fractional deltas via half-pixel positions (browsers sometimes
    // report fractional clientY on high-DPI). 10.5px per move ×4 = 42px total.
    h.feedTouchSequence([500, 489.5, 479, 468.5, 458]);
    const total = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    // Math.trunc carries the fractional residue forward; final cumulative should
    // be exactly 42 (or 41 if the very last fraction was still pending).
    expect(total).toBeGreaterThanOrEqual(41);
    expect(total).toBeLessThanOrEqual(42);
  });
});
