/**
 * Tests for the mobile touch-scroll algorithm.
 *
 * These tests exercise the *production* implementation in `./touch-scroll.ts`
 * directly — there is no parallel JS replica. We stub out the xterm instance
 * and the rAF/now seams so the logic runs deterministically in happy-dom.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTouchScrollHandlers, TOUCH_SCROLL_ACTIVATION_PX } from "./touch-scroll";

interface Harness {
  container: HTMLElement;
  scrollEl: HTMLElement;
  dispatchedDeltas: number[];
  dispatchedDeltaModes: number[];
  dispatchedBubbles: boolean[];
  scrollLinesCalls: number[];
  handlers: ReturnType<typeof createTouchScrollHandlers>;
  feedTouchSequence: (yPositions: number[]) => void;
  setNow: (t: number) => void;
}

function makeHarness(opts: { withScrollEl?: boolean } = {}): Harness {
  const withScrollEl = opts.withScrollEl ?? true;

  const container = document.createElement("div");
  let scrollEl: HTMLElement;
  if (withScrollEl) {
    scrollEl = document.createElement("div");
    scrollEl.className = "xterm-scrollable-element";
    container.appendChild(scrollEl);
  } else {
    scrollEl = document.createElement("div");
  }
  document.body.appendChild(container);

  const dispatchedDeltas: number[] = [];
  const dispatchedDeltaModes: number[] = [];
  const dispatchedBubbles: boolean[] = [];
  scrollEl.addEventListener("wheel", (e) => {
    dispatchedDeltas.push(e.deltaY);
    dispatchedDeltaModes.push(e.deltaMode);
    dispatchedBubbles.push(e.bubbles);
  });

  const scrollLinesCalls: number[] = [];
  const xtermStub = {
    rows: 24,
    scrollLines: (n: number) => {
      scrollLinesCalls.push(n);
    },
  };

  // Mock cell-height by giving the scrollEl a height. clientHeight defaults to 0
  // in happy-dom; expose a getter for predictable cell-height math (24px / 24 rows = 1px/cell).
  Object.defineProperty(scrollEl, "clientHeight", { value: 24 * 16, configurable: true });

  let nowValue = 0;
  const handlers = createTouchScrollHandlers({
    container,
    getXterm: () => xtermStub,
    getFontSize: () => 16,
    raf: () => 0,
    cancelRaf: () => {},
    now: () => nowValue,
  });

  const fireTouch = (type: "touchstart" | "touchmove" | "touchend", y: number) => {
    const touches: Touch[] =
      type === "touchend"
        ? []
        : ([{ clientY: y, clientX: 0, identifier: 0, target: scrollEl } as unknown as Touch]);
    const event = new Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(event, "touches", { value: touches, configurable: true });
    if (type === "touchstart") handlers.handleTouchStart(event);
    else if (type === "touchmove") handlers.handleTouchMove(event);
    else handlers.handleTouchEnd();
  };

  return {
    container,
    scrollEl,
    dispatchedDeltas,
    dispatchedDeltaModes,
    dispatchedBubbles,
    scrollLinesCalls,
    handlers,
    setNow: (t: number) => {
      nowValue = t;
    },
    feedTouchSequence: (yPositions: number[]) => {
      if (yPositions.length === 0) return;
      fireTouch("touchstart", yPositions[0]);
      for (let i = 1; i < yPositions.length; i++) {
        nowValue += 16; // simulate ~60fps frame spacing
        fireTouch("touchmove", yPositions[i]);
      }
      fireTouch("touchend", 0);
    },
  };
}

describe("touch-scroll", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches WheelEvents with cumulative deltaY summing to total finger movement", () => {
    const h = makeHarness();
    // 5 even 20px steps upward = 100px total.
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    const total = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
  });

  it("dispatched wheel events use DOM_DELTA_PIXEL (deltaMode=0)", () => {
    const h = makeHarness();
    h.feedTouchSequence([500, 480, 460, 440]);
    expect(h.dispatchedDeltas.length).toBeGreaterThan(0);
    for (const m of h.dispatchedDeltaModes) expect(m).toBe(0);
  });

  it("dispatched wheel events bubble (so xterm's root wheel listener can pick them up for tmux/alt-screen forwarding)", () => {
    const h = makeHarness();
    h.feedTouchSequence([500, 480, 460, 440]);
    expect(h.dispatchedBubbles.length).toBeGreaterThan(0);
    for (const b of h.dispatchedBubbles) expect(b).toBe(true);
  });

  it("does not dispatch wheel events for movement below the activation threshold", () => {
    const h = makeHarness();
    // All within ±TOUCH_SCROLL_ACTIVATION_PX of start.
    h.feedTouchSequence([500, 502, 504, 503, 501, 500]);
    expect(h.dispatchedDeltas).toEqual([]);
  });

  it("activates only after cumulative offset exceeds TOUCH_SCROLL_ACTIVATION_PX", () => {
    const h = makeHarness();
    // Cumulative offset from start: 3, 4, 7. Activation flips on the 7px move
    // (>5); the dispatched value is the per-step delta of that move (3px from
    // 496→493). Pre-threshold movement (the 3px and 4px steps) is intentionally
    // discarded.
    h.feedTouchSequence([500, 497, 496, 493]);
    expect(h.dispatchedDeltas.length).toBeGreaterThan(0);
    const total = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
    // Sanity: the imported constant is what we expect.
    expect(TOUCH_SCROLL_ACTIVATION_PX).toBe(5);
  });

  it("carries sub-pixel remainder across flushes (no drift)", () => {
    const h = makeHarness();
    // 10.5px per move ×4 = 42px total via fractional positions.
    h.feedTouchSequence([500, 489.5, 479, 468.5, 458]);
    const total = h.dispatchedDeltas.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(41);
    expect(total).toBeLessThanOrEqual(42);
  });

  it("falls back to terminal.scrollLines when .xterm-scrollable-element is missing", () => {
    const h = makeHarness({ withScrollEl: false });
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    // No scrollEl in the DOM, so dispatchScrollWheel returns false on every flush
    // and fallbackScrollLines runs. Expect at least one scrollLines call.
    expect(h.dispatchedDeltas).toEqual([]);
    expect(h.scrollLinesCalls.length).toBeGreaterThan(0);
  });

  it("multi-touch (e.g. pinch) bails out of scroll handling without preventDefault on subsequent moves", () => {
    const h = makeHarness();
    // Start with a single touch above threshold, then a second finger lands.
    h.feedTouchSequence([500, 480]);
    // dispatchedDeltas should reflect the single-touch portion only; second-finger
    // moves are exercised in the multi-touch test below.
    expect(h.dispatchedDeltas.length).toBeGreaterThan(0);

    // Now simulate a 2-touch move event — should bail without dispatching.
    const before = h.dispatchedDeltas.length;
    const event = new Event("touchmove", { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(event, "touches", {
      value: [
        { clientY: 460, clientX: 0, identifier: 0, target: h.scrollEl } as unknown as Touch,
        { clientY: 460, clientX: 50, identifier: 1, target: h.scrollEl } as unknown as Touch,
      ],
      configurable: true,
    });
    let preventDefaultCalled = false;
    Object.defineProperty(event, "preventDefault", {
      value: () => {
        preventDefaultCalled = true;
      },
      configurable: true,
    });
    h.handlers.handleTouchMove(event);
    expect(h.dispatchedDeltas.length).toBe(before);
    expect(preventDefaultCalled).toBe(false);
  });
});
