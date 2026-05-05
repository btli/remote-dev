/**
 * Tests for the mobile touch-scroll algorithm in ./touch-scroll.ts.
 *
 * Exercises the production factory directly (no parallel reimplementation).
 * Stubs the xterm instance and the WebSocket-input channel; asserts that:
 *  - normal-buffer swipes drive `terminal.scrollLines(±N)` with the right sign,
 *  - alt-buffer swipes emit ESC[A / ESC[B (or ESC O A / ESC O B with DECCKM)
 *    via `sendInput`,
 *  - small swipes below the activation threshold are dropped,
 *  - sub-cell-height pixel residue is carried (no drift),
 *  - buffer type is re-read per flush (DECSET 1049 mid-gesture),
 *  - DECCKM (applicationCursorKeysMode) is re-read per emit.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTouchScrollHandlers, TOUCH_SCROLL_ACTIVATION_PX } from "./touch-scroll";
import { createTouchModeRef } from "./useTouchInteractions";

const CELL_HEIGHT = 16;
const ROWS = 24;

type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

interface XtermStub {
  rows: number;
  scrollLines: (n: number) => void;
  buffer: { active: { type: "normal" | "alternate" } };
  modes: {
    applicationCursorKeysMode: boolean;
    mouseTrackingMode: MouseTrackingMode;
  };
}

interface Harness {
  container: HTMLElement;
  scrollEl: HTMLElement | null;
  xterm: XtermStub;
  scrollLinesCalls: number[];
  inputBytes: string[];
  feedTouchSequence: (yPositions: number[]) => void;
  setBufferType: (t: "normal" | "alternate") => void;
  setApplicationCursorKeys: (v: boolean) => void;
  setMouseTrackingMode: (m: MouseTrackingMode) => void;
}

function makeHarness(opts: { withScrollEl?: boolean; bufferType?: "normal" | "alternate" } = {}): Harness {
  const withScrollEl = opts.withScrollEl ?? true;
  const bufferType = opts.bufferType ?? "normal";

  const container = document.createElement("div");
  let scrollEl: HTMLElement | null = null;
  if (withScrollEl) {
    scrollEl = document.createElement("div");
    scrollEl.className = "xterm-scrollable-element";
    Object.defineProperty(scrollEl, "clientHeight", { value: CELL_HEIGHT * ROWS, configurable: true });
    container.appendChild(scrollEl);
  }
  document.body.appendChild(container);

  const scrollLinesCalls: number[] = [];
  const inputBytes: string[] = [];

  const xterm: XtermStub = {
    rows: ROWS,
    scrollLines: (n: number) => scrollLinesCalls.push(n),
    buffer: { active: { type: bufferType } },
    modes: { applicationCursorKeysMode: false, mouseTrackingMode: "none" },
  };

  let nowValue = 0;
  const handlers = createTouchScrollHandlers({
    container,
    getXterm: () => xterm,
    sendInput: (data: string) => inputBytes.push(data),
    raf: () => 0,
    cancelRaf: () => {},
    now: () => nowValue,
  });

  const fireTouch = (type: "touchstart" | "touchmove" | "touchend", y: number) => {
    const touches: Touch[] =
      type === "touchend"
        ? []
        : ([{ clientY: y, clientX: 0, identifier: 0, target: container } as unknown as Touch]);
    const event = new Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(event, "touches", { value: touches, configurable: true });
    if (type === "touchstart") handlers.handleTouchStart(event);
    else if (type === "touchmove") handlers.handleTouchMove(event);
    else handlers.handleTouchEnd();
  };

  return {
    container,
    scrollEl,
    xterm,
    scrollLinesCalls,
    inputBytes,
    setBufferType: (t) => {
      xterm.buffer.active.type = t;
    },
    setApplicationCursorKeys: (v) => {
      xterm.modes.applicationCursorKeysMode = v;
    },
    setMouseTrackingMode: (m) => {
      xterm.modes.mouseTrackingMode = m;
    },
    feedTouchSequence: (yPositions: number[]) => {
      if (yPositions.length === 0) return;
      fireTouch("touchstart", yPositions[0]);
      for (let i = 1; i < yPositions.length; i++) {
        nowValue += 16;
        fireTouch("touchmove", yPositions[i]);
      }
      fireTouch("touchend", 0);
    },
  };
}

describe("touch-scroll: normal buffer (scrollback)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("calls terminal.scrollLines with positive N when finger swipes up (see newer)", () => {
    const h = makeHarness({ bufferType: "normal" });
    // Finger goes 500 → 400 (upward 100 px) over five 20 px steps; each step
    // crosses the activation threshold. 100 / 16 = 6 lines, residue carries.
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    const total = h.scrollLinesCalls.reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
    expect(h.inputBytes).toEqual([]);
  });

  it("calls terminal.scrollLines with negative N when finger swipes down (see older)", () => {
    const h = makeHarness({ bufferType: "normal" });
    // Finger goes 100 → 200 (downward 100 px). Each step is +20 in screen Y =
    // -20 in our deltaY convention.
    h.feedTouchSequence([100, 120, 140, 160, 180, 200]);
    const total = h.scrollLinesCalls.reduce((a, b) => a + b, 0);
    expect(total).toBe(-6);
    expect(h.inputBytes).toEqual([]);
  });

  it("does not act on swipes below the activation threshold", () => {
    const h = makeHarness({ bufferType: "normal" });
    // All within ±TOUCH_SCROLL_ACTIVATION_PX of start.
    h.feedTouchSequence([500, 502, 504, 503, 501, 500]);
    expect(h.scrollLinesCalls).toEqual([]);
    expect(h.inputBytes).toEqual([]);
    expect(TOUCH_SCROLL_ACTIVATION_PX).toBe(5);
  });

  it("carries sub-cell-height pixel residue across flushes", () => {
    const h = makeHarness({ bufferType: "normal" });
    // Steps of 10.5 px ×4 = 42 px, cell=16. floor(42/16)=2. Residue 10 carried.
    h.feedTouchSequence([500, 489.5, 479, 468.5, 458]);
    const total = h.scrollLinesCalls.reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });
});

describe("touch-scroll: app has mouse-wheel reporting (Claude Code, vim with mouse, less -m, lazygit)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  for (const mode of ["vt200", "drag", "any"] as const) {
    it(`(${mode}) emits SGR wheel-DOWN report (CSI < 65;1;1 M) per cell when finger swipes up (forward)`, () => {
      const h = makeHarness({ bufferType: "alternate" });
      h.setMouseTrackingMode(mode);
      h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
      expect(h.scrollLinesCalls).toEqual([]);
      expect(h.inputBytes.join("")).toBe("\x1b[<65;1;1M".repeat(6));
    });

    it(`(${mode}) emits SGR wheel-UP report (CSI < 64;1;1 M) per cell when finger swipes down (back)`, () => {
      const h = makeHarness({ bufferType: "alternate" });
      h.setMouseTrackingMode(mode);
      h.feedTouchSequence([100, 120, 140, 160, 180, 200]);
      expect(h.inputBytes.join("")).toBe("\x1b[<64;1;1M".repeat(6));
    });
  }

  it("(x10) does NOT use the wheel-report path — falls through to scrollback / arrow keys", () => {
    const h = makeHarness({ bufferType: "alternate" });
    h.setMouseTrackingMode("x10");
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    // x10 doesn't carry wheel events, so we fall through to the alt-buffer
    // arrow-key path.
    expect(h.inputBytes.join("")).toBe("\x1b[B".repeat(6));
  });

  it("wheel-report path takes precedence over buffer type (mouse mode in normal buffer)", () => {
    const h = makeHarness({ bufferType: "normal" });
    h.setMouseTrackingMode("vt200");
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    // The app is the source of truth — we forward the wheel even though we
    // *could* scroll xterm's scrollback.
    expect(h.scrollLinesCalls).toEqual([]);
    expect(h.inputBytes.join("")).toBe("\x1b[<65;1;1M".repeat(6));
  });
});

describe("touch-scroll: alt buffer fallback (no mouse reporting)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("emits ESC[B per cell-height when finger swipes up (newer)", () => {
    const h = makeHarness({ bufferType: "alternate" });
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    expect(h.scrollLinesCalls).toEqual([]);
    expect(h.inputBytes.join("")).toBe("\x1b[B".repeat(6));
  });

  it("emits ESC[A per cell-height when finger swipes down (older)", () => {
    const h = makeHarness({ bufferType: "alternate" });
    h.feedTouchSequence([100, 120, 140, 160, 180, 200]);
    expect(h.inputBytes.join("")).toBe("\x1b[A".repeat(6));
  });

  it("uses ESC O A / ESC O B (SS3) when applicationCursorKeysMode is on", () => {
    const h = makeHarness({ bufferType: "alternate" });
    h.setApplicationCursorKeys(true);
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    expect(h.inputBytes.join("")).toBe("\x1bOB".repeat(6));
  });

  it("re-reads buffer type per flush (DECSET 1049 mid-gesture switches paths)", () => {
    const h = makeHarness({ bufferType: "normal" });
    h.feedTouchSequence([500, 480, 460]);
    expect(h.scrollLinesCalls.reduce((a, b) => a + b, 0)).toBe(2);
    expect(h.inputBytes).toEqual([]);

    h.setBufferType("alternate");
    h.feedTouchSequence([460, 440, 420]);
    expect(h.inputBytes.join("")).toBe("\x1b[B\x1b[B");
  });
});

describe("touch-scroll: edge cases", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing when .xterm-scrollable-element is missing (cell-height unknown)", () => {
    const h = makeHarness({ withScrollEl: false, bufferType: "normal" });
    h.feedTouchSequence([500, 480, 460, 440, 420, 400]);
    expect(h.scrollLinesCalls).toEqual([]);
    expect(h.inputBytes).toEqual([]);
  });

  it("skips scroll activation when the shared modeRef is in 'selection' (long-press drag in progress)", () => {
    // Directly drive a TouchScroll instance with a shared modeRef preset to
    // "selection". Even a long swipe that would otherwise emit must produce
    // no scroll/input.
    const container = document.createElement("div");
    const scrollEl = document.createElement("div");
    scrollEl.className = "xterm-scrollable-element";
    Object.defineProperty(scrollEl, "clientHeight", { value: CELL_HEIGHT * ROWS, configurable: true });
    container.appendChild(scrollEl);
    document.body.appendChild(container);

    const scrollLinesCalls: number[] = [];
    const inputBytes: string[] = [];
    const xterm = {
      rows: ROWS,
      scrollLines: (n: number) => scrollLinesCalls.push(n),
      buffer: { active: { type: "normal" as const } },
      modes: { applicationCursorKeysMode: false, mouseTrackingMode: "none" as const },
    };
    const modeRef = createTouchModeRef();
    modeRef.current = "selection";

    const handlers = createTouchScrollHandlers({
      container,
      getXterm: () => xterm,
      sendInput: (data: string) => inputBytes.push(data),
      modeRef,
      raf: () => 0,
      cancelRaf: () => {},
      now: () => 0,
    });

    const fire = (type: "touchstart" | "touchmove" | "touchend", y: number) => {
      const touches: Touch[] =
        type === "touchend"
          ? []
          : ([{ clientY: y, clientX: 0, identifier: 0, target: container } as unknown as Touch]);
      const event = new Event(type, { bubbles: true, cancelable: true }) as unknown as TouchEvent;
      Object.defineProperty(event, "touches", { value: touches, configurable: true });
      let preventDefaultCalled = false;
      Object.defineProperty(event, "preventDefault", {
        value: () => {
          preventDefaultCalled = true;
        },
        configurable: true,
      });
      if (type === "touchstart") handlers.handleTouchStart(event);
      else if (type === "touchmove") handlers.handleTouchMove(event);
      else handlers.handleTouchEnd();
      return preventDefaultCalled;
    };

    fire("touchstart", 500);
    // Series of moves that, without the bail, would emit several scrollLines.
    const pdMid = fire("touchmove", 460);
    fire("touchmove", 420);
    fire("touchmove", 380);
    fire("touchend", 0);

    expect(scrollLinesCalls).toEqual([]);
    expect(inputBytes).toEqual([]);
    // We must NOT preventDefault on touchmove during selection — that's the
    // interactions handler's job (it owns the gesture). The scroll handler
    // is purely a no-op while selection is active.
    expect(pdMid).toBe(false);
  });

  it("ignores multi-touch gestures so pinch-zoom still works", () => {
    // Build a fresh handlers instance directly so we can drive
    // handleTouchMove with a multi-touch event and observe its return.
    const container = document.createElement("div");
    const scrollEl = document.createElement("div");
    scrollEl.className = "xterm-scrollable-element";
    Object.defineProperty(scrollEl, "clientHeight", { value: CELL_HEIGHT * ROWS, configurable: true });
    container.appendChild(scrollEl);
    document.body.appendChild(container);

    const inputBytes: string[] = [];
    const scrollLinesCalls: number[] = [];
    const xterm = {
      rows: ROWS,
      scrollLines: (n: number) => scrollLinesCalls.push(n),
      buffer: { active: { type: "alternate" as const } },
      modes: { applicationCursorKeysMode: false, mouseTrackingMode: "none" as const },
    };
    const handlers = createTouchScrollHandlers({
      container,
      getXterm: () => xterm,
      sendInput: (data: string) => inputBytes.push(data),
      raf: () => 0,
      cancelRaf: () => {},
      now: () => 0,
    });

    // Prime the gesture: single-finger touchstart so internal state is
    // armed. We don't drive a single-touch move here because we want to
    // assert the multi-touch bail in isolation.
    const startEvent = new Event("touchstart", { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(startEvent, "touches", {
      value: [{ clientY: 500, clientX: 0, identifier: 0, target: container } as unknown as Touch],
      configurable: true,
    });
    handlers.handleTouchStart(startEvent);

    // Construct the multi-touch move and actually invoke handleTouchMove.
    const event = new Event("touchmove", { bubbles: true, cancelable: true }) as unknown as TouchEvent;
    Object.defineProperty(event, "touches", {
      value: [
        { clientY: 460, clientX: 0, identifier: 0, target: container } as unknown as Touch,
        { clientY: 460, clientX: 50, identifier: 1, target: container } as unknown as Touch,
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

    handlers.handleTouchMove(event);

    // Bail-out contract: no input bytes, no scrollback movement, and we
    // must NOT preventDefault — pinch-zoom needs the browser default.
    expect(inputBytes).toEqual([]);
    expect(scrollLinesCalls).toEqual([]);
    expect(preventDefaultCalled).toBe(false);
  });
});
