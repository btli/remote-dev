/**
 * Tests for tap-to-click + long-press-to-select interaction layer.
 *
 * Drives `createTouchInteractions` directly with a fake xterm instance so
 * the test runs the production code path. Stubs:
 *   - `now()` for deterministic timestamps
 *   - `setTimer / clearTimer` so long-press fires only when we tell it to
 *   - `dispatchMouse` to capture synthesized MouseEvents instead of relying
 *     on JSDOM/happy-dom event bubbling on a non-rendered element
 *   - `copyToClipboard` to verify the right text was written
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTouchInteractions,
  createTouchModeRef,
  pointToCell,
  selectionLength,
  TAP_MAX_MS,
  TAP_MAX_PX,
  LONG_PRESS_MS,
  MOVEMENT_CANCEL_PX,
} from "./useTouchInteractions";

interface FakeXTerm {
  cols: number;
  rows: number;
  element: HTMLElement;
  modes: { mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any" };
  // Production reads `terminal.buffer.active.viewportY` to convert viewport
  // rows → buffer-absolute rows. Mock surface — defaults to 0.
  buffer: { active: { viewportY: number } };
  scrollToBottom: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  hasSelection: ReturnType<typeof vi.fn>;
  // _core mock returns the cell width/height we configure
  _core: {
    _renderService: {
      dimensions: { css: { cell: { width: number; height: number } } };
    };
  };
}

const CELL_W = 8;
const CELL_H = 16;
const COLS = 80;
const ROWS = 24;

interface Harness {
  xterm: FakeXTerm;
  screen: HTMLElement;
  canvas: HTMLElement;
  fireTouch: (
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    touches: Array<{ x: number; y: number }>
  ) => boolean;
  advanceTime: (ms: number) => void;
  flushTimers: () => void;
  mouseEvents: Array<{ type: string; clientX: number; clientY: number; target: EventTarget | null }>;
  copies: string[];
  getMode: () => string;
  destroy: () => void;
  /** Direct access to the modeRef shared with the scroll handler in prod. */
  modeRef: { current: string };
  /** How many times `getBoundingClientRect` has been called on the screen. */
  bcrCalls: () => number;
  /** Shift the cached screen rect by `dy` px to simulate keyboard slide-up. */
  shiftScreenY: (dy: number) => void;
}

function makeHarness(opts: { mouseMode?: FakeXTerm["modes"]["mouseTrackingMode"] } = {}): Harness {
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  // xterm v6 paints into a canvas inside .xterm-screen. The tap handler
  // dispatches there; we add one so we can assert the dispatch target.
  const canvas = document.createElement("canvas");
  screen.appendChild(canvas);
  // Position the screen at viewport (100, 50) — non-zero origin shakes out
  // any bugs that assume (0,0). Origin is mutable via shiftScreenY so we can
  // simulate the iOS soft keyboard sliding up mid-gesture.
  const originX = 100;
  let originY = 50;
  let bcrCount = 0;
  Object.defineProperty(screen, "getBoundingClientRect", {
    value: () => {
      bcrCount++;
      return {
        left: originX,
        top: originY,
        right: originX + COLS * CELL_W,
        bottom: originY + ROWS * CELL_H,
        width: COLS * CELL_W,
        height: ROWS * CELL_H,
        x: originX,
        y: originY,
        toJSON: () => "",
      };
    },
    configurable: true,
  });
  const element = document.createElement("div");
  element.appendChild(screen);
  document.body.appendChild(element);

  const xterm: FakeXTerm = {
    cols: COLS,
    rows: ROWS,
    element,
    modes: { mouseTrackingMode: opts.mouseMode ?? "none" },
    buffer: { active: { viewportY: 0 } },
    scrollToBottom: vi.fn(),
    select: vi.fn(),
    clearSelection: vi.fn(),
    getSelection: vi.fn(() => "selected text"),
    // No active selection by default. Tests for tap-to-deselect override
    // this to return true.
    hasSelection: vi.fn(() => false),
    _core: {
      _renderService: {
        dimensions: { css: { cell: { width: CELL_W, height: CELL_H } } },
      },
    },
  };

  let nowValue = 0;
  type TimerFn = () => void;
  const pendingTimers: Array<{ id: number; cb: TimerFn; fireAt: number }> = [];
  let nextTimerId = 1;

  const mouseEvents: Array<{ type: string; clientX: number; clientY: number; target: EventTarget | null }> = [];
  const copies: string[] = [];

  // Production wires this between createTouchInteractions and
  // createTouchScrollHandlers so the scroll handler sees `selection` and bails.
  const modeRef = createTouchModeRef();

  const handlers = createTouchInteractions({
    getTerminal: () => xterm as unknown as Parameters<typeof createTouchInteractions>[0]["getTerminal"] extends () => infer R ? R : never,
    modeRef,
    now: () => nowValue,
    setTimer: ((cb: TimerFn, ms: number) => {
      const id = nextTimerId++;
      pendingTimers.push({ id, cb, fireAt: nowValue + ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (cb: () => void, ms: number) => ReturnType<typeof setTimeout>,
    clearTimer: ((id: number) => {
      const idx = pendingTimers.findIndex((t) => t.id === id);
      if (idx >= 0) pendingTimers.splice(idx, 1);
    }) as unknown as (id: ReturnType<typeof setTimeout>) => void,
    dispatchMouse: (target, ev) => {
      mouseEvents.push({
        type: ev.type,
        clientX: ev.clientX,
        clientY: ev.clientY,
        target,
      });
    },
    copyToClipboard: async (text) => {
      copies.push(text);
    },
  });

  const fireTouch = (
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    touches: Array<{ x: number; y: number }>
  ): boolean => {
    const touchObjs = touches.map(
      (t, i) => ({ clientX: t.x, clientY: t.y, identifier: i, target: element }) as unknown as Touch
    );
    const ev = new Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(ev, "touches", { value: touchObjs, configurable: true });
    if (type === "touchstart") handlers.handleTouchStart(ev);
    else if (type === "touchmove") handlers.handleTouchMove(ev);
    else if (type === "touchend") handlers.handleTouchEnd(ev);
    else handlers.handleTouchCancel(ev);
    return (ev as unknown as Event).defaultPrevented;
  };

  const advanceTime = (ms: number) => {
    nowValue += ms;
  };

  const flushTimers = () => {
    // Fire any timers whose fireAt is <= nowValue.
    while (true) {
      const idx = pendingTimers.findIndex((t) => t.fireAt <= nowValue);
      if (idx < 0) break;
      const [t] = pendingTimers.splice(idx, 1);
      t.cb();
    }
  };

  return {
    xterm,
    screen,
    canvas,
    fireTouch,
    advanceTime,
    flushTimers,
    mouseEvents,
    copies,
    getMode: handlers.getMode,
    destroy: handlers.destroy,
    modeRef,
    bcrCalls: () => bcrCount,
    shiftScreenY: (dy) => {
      originY += dy;
    },
  };
}

describe("pointToCell", () => {
  it("clamps to grid bounds and floors fractional cells", () => {
    const dims = {
      cellWidth: 10,
      cellHeight: 20,
      originX: 0,
      originY: 0,
      cols: 80,
      rows: 24,
    };
    expect(pointToCell(dims, 5, 9)).toEqual({ col: 0, row: 0 });
    expect(pointToCell(dims, 25, 41)).toEqual({ col: 2, row: 2 });
    // Past right/bottom edge: clamped to cols-1/rows-1.
    expect(pointToCell(dims, 9999, 9999)).toEqual({ col: 79, row: 23 });
    // Negative (off the left/top): clamped to 0.
    expect(pointToCell(dims, -50, -50)).toEqual({ col: 0, row: 0 });
  });
});

describe("selectionLength", () => {
  it("computes left-to-right linear length within a row", () => {
    const r = selectionLength(2, 1, 7, 1, 80);
    expect(r).toEqual({ col: 2, row: 1, length: 6 });
  });
  it("wraps across multiple rows using cols stride", () => {
    // (col=78,row=0) → (col=2,row=2) over cols=80 → idx 78 to idx 162 → length 85
    const r = selectionLength(78, 0, 2, 2, 80);
    expect(r).toEqual({ col: 78, row: 0, length: 85 });
  });
  it("flips start/end when end is before start in reading order", () => {
    const r = selectionLength(10, 5, 3, 5, 80);
    expect(r).toEqual({ col: 3, row: 5, length: 8 });
  });
});

describe("tap-to-click", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("synthesizes mousedown+mouseup at the touch coordinates within tap window", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(TAP_MAX_MS - 50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents.map(({ type, clientX, clientY }) => ({ type, clientX, clientY }))).toEqual([
      { type: "mousedown", clientX: 200, clientY: 100 },
      { type: "mouseup", clientX: 200, clientY: 100 },
    ]);
  });

  it("calls scrollToBottom when mouse mode is OFF", () => {
    const h = makeHarness({ mouseMode: "none" });
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.xterm.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("ALSO calls scrollToBottom when application mouse mode is ON (universal jump-to-bottom UX)", () => {
    for (const mode of ["vt200", "drag", "any"] as const) {
      const h = makeHarness({ mouseMode: mode });
      h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
      h.advanceTime(50);
      h.fireTouch("touchend", []);
      // Tap dispatches the synthetic mouse pair AND scrolls to bottom. The
      // app handles its own scroll via the synthesized click; xterm's
      // scrollToBottom is a no-op on the alt buffer where TUIs typically
      // run, so this is safe everywhere.
      expect(h.xterm.scrollToBottom).toHaveBeenCalledTimes(1);
      expect(h.mouseEvents).toHaveLength(2);
    }
  });

  it("does NOT tap when the gesture exceeds TAP_MAX_MS", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(TAP_MAX_MS + 1);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toEqual([]);
    expect(h.xterm.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does NOT tap when the finger moved past MOVEMENT_CANCEL_PX", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.fireTouch("touchmove", [{ x: 200 + MOVEMENT_CANCEL_PX + 1, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toEqual([]);
  });

  it("does NOT tap when a second finger lands during the gesture (pinch handoff)", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.fireTouch("touchmove", [
      { x: 200, y: 100 },
      { x: 250, y: 150 },
    ]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toEqual([]);
    expect(h.xterm.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does NOT fire the long-press when a tap happens before the timer", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    // No selection should have been started.
    expect(h.xterm.select).not.toHaveBeenCalled();
  });
});

describe("long-press-to-select", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("enters selection mode after LONG_PRESS_MS with no movement", () => {
    const h = makeHarness();
    // Touch at viewport (200, 100). Screen origin is (100, 50), cell 8×16.
    // Cell = ((200-100)/8, (100-50)/16) = (12, 3).
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.getMode()).toBe("selection");
    expect(h.xterm.clearSelection).toHaveBeenCalled();
    expect(h.xterm.select).toHaveBeenCalledWith(12, 3, 1);
  });

  it("updates the selection as the finger drags", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]); // cell (12, 3)
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();

    // Drag right by 4 cells (32 px).
    h.fireTouch("touchmove", [{ x: 200 + 4 * CELL_W, y: 100 }]);
    // Last call should select from (12,3) for length 5 (12,13,14,15,16).
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 3, 5);

    // Drag down to next row, col 0 from screen origin.
    h.fireTouch("touchmove", [{ x: 100, y: 100 + CELL_H }]); // (0, 4)
    // Selection from (12,3) to (0,4): start idx = 3*80+12 = 252, end idx = 4*80+0 = 320 → length 69
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 3, 69);
  });

  it("cancels the long-press if the finger moves > MOVEMENT_CANCEL_PX before the timer fires", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    // Move just past the cancel threshold before the timer fires.
    h.advanceTime(LONG_PRESS_MS - 100);
    h.fireTouch("touchmove", [{ x: 200 + MOVEMENT_CANCEL_PX + 1, y: 100 }]);
    h.advanceTime(200);
    h.flushTimers();
    expect(h.xterm.select).not.toHaveBeenCalled();
    expect(h.getMode()).toBe("scroll");
  });

  it("cancels the long-press on multi-touch (pinch)", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS - 100);
    h.fireTouch("touchmove", [
      { x: 200, y: 100 },
      { x: 260, y: 100 },
    ]);
    h.advanceTime(200);
    h.flushTimers();
    expect(h.xterm.select).not.toHaveBeenCalled();
  });

  it("copies selection text to clipboard on touchend", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    h.fireTouch("touchmove", [{ x: 200 + 3 * CELL_W, y: 100 }]);
    h.fireTouch("touchend", []);
    expect(h.copies).toEqual(["selected text"]);
  });

  it("does not copy when getSelection returns empty", () => {
    const h = makeHarness();
    h.xterm.getSelection = vi.fn(() => "");
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    h.fireTouch("touchend", []);
    expect(h.copies).toEqual([]);
  });

  it("touchcancel resets state without copying", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    h.fireTouch("touchcancel", []);
    expect(h.copies).toEqual([]);
    expect(h.getMode()).toBe("idle");
  });
});

describe("threshold guards", () => {
  it("TAP_MAX_PX matches the touch-scroll activation threshold (5 px) so scroll vs tap is unambiguous", () => {
    expect(TAP_MAX_PX).toBe(5);
    expect(MOVEMENT_CANCEL_PX).toBe(5);
  });
});

// ── Pre-merge review fixes ────────────────────────────────────────────

describe("destroy() — unmount safety", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("cancels a pending long-press timer so it cannot fire after unmount", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    // Simulate effect cleanup before the 500 ms timer fires.
    h.destroy();
    // Even after time passes and timers flush, no selection should occur.
    h.advanceTime(LONG_PRESS_MS + 100);
    h.flushTimers();
    expect(h.xterm.select).not.toHaveBeenCalled();
    expect(h.xterm.clearSelection).not.toHaveBeenCalled();
    expect(h.getMode()).toBe("idle");
  });

  it("destroy() is idempotent", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.destroy();
    expect(() => h.destroy()).not.toThrow();
    expect(h.getMode()).toBe("idle");
  });
});

describe("synthesizeTap dispatch target", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches mousedown+mouseup on the .xterm-screen element (xterm wires its mouse listeners there)", () => {
    // We deliberately target .xterm-screen (the stable mouse-listener host
    // in xterm v6) rather than an inner canvas. WebGL builds paint into
    // multiple canvases and the listener isn't on any of them; the screen
    // div is the consistent mouse-input surface.
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toHaveLength(2);
    for (const e of h.mouseEvents) {
      expect(e.target).toBe(h.screen);
    }
  });

  it("falls back to terminal.element when .xterm-screen is missing", () => {
    const h = makeHarness();
    h.screen.remove();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toHaveLength(2);
    for (const e of h.mouseEvents) {
      expect(e.target).toBe(h.xterm.element);
    }
  });
});

describe("selection drag re-reads grid origin per touchmove", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("calls getBoundingClientRect more than once during a selection drag", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    const baseline = h.bcrCalls();
    expect(baseline).toBeGreaterThanOrEqual(1); // initial readDims at long-press fire
    h.fireTouch("touchmove", [{ x: 200 + 2 * CELL_W, y: 100 }]);
    h.fireTouch("touchmove", [{ x: 200 + 4 * CELL_W, y: 100 }]);
    // Each move should have re-read the rect.
    expect(h.bcrCalls()).toBeGreaterThan(baseline + 1);
  });

  it("tracks the soft-keyboard slide-up: rows shift correctly when origin moves mid-drag", () => {
    const h = makeHarness();
    // Start at viewport (200, 100). Screen origin starts at (100, 50).
    // (200-100)/8 = col 12, (100-50)/16 = row 3. Long-press at cell (12, 3).
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 3, 1);

    // Soft keyboard slides up by 32 px (i.e. screen origin top moves from 50
    // to 18). Without re-reading, a touch at viewport (200, 100) would still
    // resolve to row 3 — but now (200, 100) lives at (100-18)/16 = row 5.
    h.shiftScreenY(-32);
    // Drag 1 cell to the right (no vertical move) — endpoint should be
    // (col 13, row 5), not (col 13, row 3).
    h.fireTouch("touchmove", [{ x: 200 + CELL_W, y: 100 }]);
    // Linear: from (12,3) to (13,5) over cols=80 → idx 252 to idx 413, length 162.
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 3, 162);
  });
});

describe("tap-to-deselect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clears the active selection on tap and does NOT synthesize click or scroll", () => {
    const h = makeHarness();
    // Pretend xterm already has a selection (from a previous long-press).
    h.xterm.hasSelection = vi.fn(() => true);
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    // Tap on an active selection: clear and bail.
    expect(h.xterm.clearSelection).toHaveBeenCalledTimes(1);
    expect(h.mouseEvents).toEqual([]);
    expect(h.xterm.scrollToBottom).not.toHaveBeenCalled();
  });

  it("after the deselect tap, the next tap synthesizes a click and scrolls (selection now cleared)", () => {
    const h = makeHarness();
    // First tap: had a selection. After clearSelection runs we flip the
    // mock back to "no selection" so the next tap takes the normal path.
    let hasSel = true;
    h.xterm.hasSelection = vi.fn(() => hasSel);
    h.xterm.clearSelection = vi.fn(() => {
      hasSel = false;
    });

    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.xterm.clearSelection).toHaveBeenCalledTimes(1);
    expect(h.mouseEvents).toEqual([]);
    expect(h.xterm.scrollToBottom).not.toHaveBeenCalled();

    // Second tap.
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    h.fireTouch("touchend", []);
    expect(h.mouseEvents).toHaveLength(2);
    expect(h.xterm.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});

describe("selection drag suppresses scroll", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("calls preventDefault on touchmove during selection mode", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.getMode()).toBe("selection");
    // Now drag — the move should set defaultPrevented so the host's
    // touch-scroll listener (which doesn't bail synchronously without a
    // shared mode) sees a preventDefault'd event.
    const prevented = h.fireTouch("touchmove", [{ x: 200 + 2 * CELL_W, y: 100 }]);
    expect(prevented).toBe(true);
  });

  it("does NOT call preventDefault on touchmove in pending or scroll mode", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    // Move within the cancel threshold: still pending, must NOT preventDefault
    // (would block the touch-scroll handler from doing its thing).
    const prevented1 = h.fireTouch("touchmove", [{ x: 201, y: 101 }]);
    expect(prevented1).toBe(false);
    // Move past threshold: scroll mode. Still must NOT preventDefault.
    const prevented2 = h.fireTouch("touchmove", [{ x: 220, y: 100 }]);
    expect(prevented2).toBe(false);
    expect(h.getMode()).toBe("scroll");
  });

  it("exposes selection mode via the shared modeRef so the scroll handler can bail", () => {
    const h = makeHarness();
    expect(h.modeRef.current).toBe("idle");
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    expect(h.modeRef.current).toBe("pending");
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.modeRef.current).toBe("selection");
    h.fireTouch("touchmove", [{ x: 200 + CELL_W, y: 100 }]);
    expect(h.modeRef.current).toBe("selection");
    h.fireTouch("touchend", []);
    expect(h.modeRef.current).toBe("idle");
  });
});

describe("handleTouchCancel signature", () => {
  it("accepts a TouchEvent argument (DOM EventListener compatibility)", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    // fireTouch dispatches handleTouchCancel with a real Event — just assert
    // it doesn't throw and resets state.
    expect(() => h.fireTouch("touchcancel", [])).not.toThrow();
    expect(h.getMode()).toBe("idle");
  });
});

// ── Adversarial-review fixes (remote-dev-ub9k) ──────────────────────────

describe("selection uses buffer-absolute rows (viewportY shift)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("adds buffer.active.viewportY to the viewport row when scrolled into scrollback", () => {
    const h = makeHarness();
    // Simulate the user having scrolled up — top of viewport corresponds
    // to buffer line 50.
    h.xterm.buffer.active.viewportY = 50;
    // Long-press at viewport (200, 100). Screen origin (100, 50), cell 8×16.
    // Viewport row = (100-50)/16 = 3 → buffer row = 3 + 50 = 53.
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 53, 1);
  });

  it("uses viewportY for both the start anchor and drag endpoints", () => {
    const h = makeHarness();
    h.xterm.buffer.active.viewportY = 50;
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]); // viewport (12, 3) → buffer (12, 53)
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 53, 1);

    // Drag right by 4 cells, same row.
    h.fireTouch("touchmove", [{ x: 200 + 4 * CELL_W, y: 100 }]);
    // Endpoint is buffer (16, 53); span length 5.
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 53, 5);
  });

  it("falls back to raw viewport row when viewportY is 0 (not scrolled)", () => {
    // Sanity check the existing happy path didn't regress.
    const h = makeHarness();
    h.xterm.buffer.active.viewportY = 0;
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.xterm.select).toHaveBeenLastCalledWith(12, 3, 1);
  });
});

describe("reset clears xterm selection when one was painted", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clears xterm's painted selection on touchcancel mid-selection", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.getMode()).toBe("selection");
    // beginSelection itself calls clearSelection once. Reset the spy so we
    // observe ONLY the clearSelection that fires from reset()'s new branch.
    h.xterm.clearSelection = vi.fn();

    h.fireTouch("touchcancel", []);

    expect(h.xterm.clearSelection).toHaveBeenCalledTimes(1);
    expect(h.getMode()).toBe("idle");
  });

  it("clears xterm's painted selection on destroy() while in selection mode", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    h.xterm.clearSelection = vi.fn();

    h.destroy();

    expect(h.xterm.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("does NOT call clearSelection on reset when there was no selection", () => {
    const h = makeHarness();
    // Pending only — never reached selection.
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.xterm.clearSelection = vi.fn();
    h.fireTouch("touchcancel", []);
    expect(h.xterm.clearSelection).not.toHaveBeenCalled();
  });
});

describe("touchend with remaining fingers down does not block the gesture", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does NOT reset to idle when one finger lifts but another remains", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    // Long-press hasn't fired; we're in pending. A second finger landed
    // (would have been seen as multi-touch on the previous move) and now
    // lifts. The OTHER finger is still on the screen.
    h.fireTouch("touchend", [{ x: 250, y: 150 }]);
    expect(h.getMode()).not.toBe("idle");
  });

  it("subsequent touchmove on the remaining finger still works", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    expect(h.getMode()).toBe("selection");
    // A second finger touched and now lifts; one finger remains.
    h.fireTouch("touchend", [{ x: 250, y: 150 }]);
    // Selection was abandoned (clearSelection called) but state did NOT
    // reset to idle — the remaining finger should be free to scroll.
    expect(h.getMode()).not.toBe("idle");
    // The move handler should still process events for the remaining
    // finger (it ignores touchmove when mode is "idle"). Drive a single-
    // touch move and ensure it doesn't no-op due to a stale idle.
    const beforeCalls = h.xterm.clearSelection.mock.calls.length;
    h.fireTouch("touchmove", [{ x: 250, y: 150 }]);
    // Not asserting anything about scroll directly here — the move handler
    // for non-selection states only filters tap/long-press, but the key
    // invariant is that it doesn't *throw* and the mode hasn't been
    // forcibly reset to idle. clearSelection should not have been called
    // again from this move.
    expect(h.xterm.clearSelection.mock.calls.length).toBe(beforeCalls);
  });

  it("clears active selection when one finger lifts during selection", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(LONG_PRESS_MS);
    h.flushTimers();
    h.xterm.clearSelection = vi.fn();
    // Second finger lifts; one remains.
    h.fireTouch("touchend", [{ x: 250, y: 150 }]);
    expect(h.xterm.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("performs the full reset only when all fingers are up", () => {
    const h = makeHarness();
    h.fireTouch("touchstart", [{ x: 200, y: 100 }]);
    h.advanceTime(50);
    // Final touchend (touches.length === 0) — normal tap path.
    h.fireTouch("touchend", []);
    expect(h.getMode()).toBe("idle");
  });
});
