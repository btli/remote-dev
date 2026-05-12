/**
 * Integration tests for `createTouchInteractions.synthesizeTap()` against a
 * real `@xterm/xterm` Terminal instance — NOT a fake.
 *
 * The unit tests in `./useTouchInteractions.test.ts` cover the JS state
 * machine (modes, timing, dispatch target). They verify that
 * `dispatchMouse` is *called*; they do NOT verify that real xterm.js then
 * forwards the synthesized event as an SGR mouse report. This file fills
 * that gap.
 *
 * The bug we're guarding against (remote-dev-e07i): on installed PWA (iOS
 * Safari standalone), the prior implementation dispatched mousedown/mouseup
 * on `.xterm-screen` and relied on bubbling up to the actual listener host
 * (`.terminal.xterm`). Pinch-to-zoom and our touch-scroll handler worked
 * because they don't go through xterm's mouse pipeline, but mouse-mode TUIs
 * (Claude Code's clickable buttons, vim, tmux mouse, lazygit) silently
 * dropped the click. The fix dispatches mousedown on `terminal.element`
 * directly and routes mouseup through the owning document — matching where
 * xterm registers its real-mouse listeners.
 *
 * happy-dom doesn't run layout, so we monkey-patch the screen's bounding
 * rect and the internal CharSize / RenderService dimensions to non-zero
 * values. This is a known cost of testing browser-coupled libraries
 * headlessly; we accept the coupling because the alternative (a full
 * Playwright run) is much heavier and CI-fragile.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Terminal } from "@xterm/xterm";

import { createTouchInteractions } from "./useTouchInteractions";

interface RenderDims {
  css: {
    cell: { width: number; height: number };
    canvas: { width: number; height: number };
  };
  device: {
    cell: { width: number; height: number };
    canvas: { width: number; height: number };
  };
}

interface XTermCore {
  _charSizeService?: { width: number; height: number };
  _renderService?: { dimensions?: RenderDims };
  coreMouseService?: { areMouseEventsActive?: boolean };
}

interface XTermPrivates {
  _core: XTermCore;
}

const COLS = 80;
const ROWS = 24;
const CELL_W = 8;
const CELL_H = 16;
// Screen origin in viewport coords. Non-zero to shake out (0,0) bugs.
const SCREEN_LEFT = 100;
const SCREEN_TOP = 50;

interface Harness {
  term: Terminal;
  parent: HTMLElement;
  screen: HTMLElement;
  collected: string[];
  /** Enable VT200 + SGR mouse mode and wait for the parser to finish. */
  enableSgrMouseMode: () => Promise<void>;
  /** Returns true when `data` contains an SGR mouse press at (col,row), 1-indexed per xterm's report format. */
  hasSgrPress: (col: number, row: number) => boolean;
  /** Returns true when `data` contains an SGR mouse release at (col,row). */
  hasSgrRelease: (col: number, row: number) => boolean;
  dispose: () => void;
}

function makeRealTerminal(): Harness {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const term = new Terminal({ allowProposedApi: true, cols: COLS, rows: ROWS });
  const collected: string[] = [];
  term.onData((d) => collected.push(d));

  term.open(parent);

  // Monkey-patch the screen element's bounding rect so getMouseReportCoords
  // gets a real value. happy-dom returns all zeros otherwise.
  const screen = term.element!.querySelector(".xterm-screen") as HTMLElement;
  Object.defineProperty(screen, "getBoundingClientRect", {
    value: () => ({
      left: SCREEN_LEFT,
      top: SCREEN_TOP,
      right: SCREEN_LEFT + COLS * CELL_W,
      bottom: SCREEN_TOP + ROWS * CELL_H,
      width: COLS * CELL_W,
      height: ROWS * CELL_H,
      x: SCREEN_LEFT,
      y: SCREEN_TOP,
      toJSON: () => "",
    }),
    configurable: true,
  });
  // xterm reads `getComputedStyle(screen).padding-{left,top}` to subtract
  // padding from click coords. In happy-dom both come back as the empty
  // string, which `parseInt("")` turns into NaN — propagating NaN through
  // the entire (col,row) calculation. Pin them to "0".
  screen.style.paddingLeft = "0px";
  screen.style.paddingTop = "0px";

  // The CoreBrowserTerminal's bindMouse passes the click through
  // `_mouseService.getMouseReportCoords` which requires:
  //   - _charSizeService.hasValidSize (width > 0 && height > 0)
  //   - _renderService.dimensions.css.{cell,canvas}.{width,height} > 0
  // Patch both directly. We're reaching into private state on purpose — the
  // alternative is a full layout-capable DOM (Playwright) which is overkill
  // for verifying the JS dispatch contract.
  const core = (term as unknown as XTermPrivates)._core;
  if (core._charSizeService) {
    core._charSizeService.width = CELL_W;
    core._charSizeService.height = CELL_H;
  }
  // `_renderService.dimensions` is a getter delegating to the active
  // renderer. In happy-dom no renderer paints, so we replace the getter
  // outright. Use `defineProperty` because the original is read-only.
  if (core._renderService) {
    Object.defineProperty(core._renderService, "dimensions", {
      configurable: true,
      get: (): RenderDims => ({
        css: {
          cell: { width: CELL_W, height: CELL_H },
          canvas: { width: COLS * CELL_W, height: ROWS * CELL_H },
        },
        device: {
          cell: { width: CELL_W, height: CELL_H },
          canvas: { width: COLS * CELL_W, height: ROWS * CELL_H },
        },
      }),
    });
  }

  // SGR press: \x1b[<{button};{col};{row}M  (uppercase M for press)
  // SGR release: \x1b[<{button};{col};{row}m (lowercase m for release)
  // Button 0 = left, no modifiers → just "0".
  const matchSgr = (joined: string, col: number, row: number, finalByte: "M" | "m") =>
    joined.includes(`\x1b[<0;${col};${row}${finalByte}`);

  // DECSET 1000 (VT200 button events) + 1006 (SGR encoding). The sequence
  // is parsed asynchronously by xterm, so callers must await this before
  // driving the tap.
  const enableSgrMouseMode = () =>
    new Promise<void>((resolve) => {
      term.write("\x1b[?1000h\x1b[?1006h", () => resolve());
    });

  return {
    term,
    parent,
    screen,
    collected,
    enableSgrMouseMode,
    hasSgrPress: (col, row) => matchSgr(collected.join(""), col, row, "M"),
    hasSgrRelease: (col, row) => matchSgr(collected.join(""), col, row, "m"),
    dispose: () => {
      try {
        term.dispose();
      } catch {
        // ignore disposal noise in happy-dom
      }
      parent.remove();
    },
  };
}

/** Drive `createTouchInteractions` with deterministic timing. */
function driveTap(
  term: Terminal,
  clientX: number,
  clientY: number
): void {
  let nowValue = 0;
  const handlers = createTouchInteractions({
    getTerminal: () => term,
    now: () => nowValue,
    // No-op timers — tap doesn't depend on the long-press timer firing.
    setTimer: (() => 1 as unknown as ReturnType<typeof setTimeout>) as unknown as (
      cb: () => void,
      ms: number
    ) => ReturnType<typeof setTimeout>,
    clearTimer: (() => undefined) as unknown as (
      id: ReturnType<typeof setTimeout>
    ) => void,
    // Production default: real dispatch through the DOM.
  });

  const touchstart = new Event("touchstart", { bubbles: true, cancelable: true });
  Object.defineProperty(touchstart, "touches", {
    value: [{ clientX, clientY, identifier: 0 } as unknown as Touch],
  });
  handlers.handleTouchStart(touchstart as unknown as TouchEvent);

  nowValue += 50; // well within TAP_MAX_MS=250

  const touchend = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperty(touchend, "touches", { value: [] });
  handlers.handleTouchEnd(touchend as unknown as TouchEvent);

  handlers.destroy();
}

describe("synthesizeTap against real xterm.js (integration)", () => {
  let harness: Harness;

  beforeEach(() => {
    document.body.innerHTML = "";
    harness = makeRealTerminal();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("forwards a tap as SGR press + release through xterm's mouse pipeline", async () => {
    await harness.enableSgrMouseMode();
    // Tap at the first cell of the first row. SCREEN_LEFT + 4 lands inside
    // col 0 (8 px wide), SCREEN_TOP + 8 inside row 0 (16 px tall). xterm
    // reports SGR positions 1-indexed → expect col=1, row=1.
    driveTap(harness.term, SCREEN_LEFT + 4, SCREEN_TOP + 8);
    expect(harness.hasSgrPress(1, 1)).toBe(true);
    expect(harness.hasSgrRelease(1, 1)).toBe(true);
  });

  it("forwards a tap at a non-origin cell with the correct (col,row) report", async () => {
    await harness.enableSgrMouseMode();
    // Cell (12, 3) in viewport coords: clientX = SCREEN_LEFT + 12*8 + 4,
    // clientY = SCREEN_TOP + 3*16 + 8. SGR is 1-indexed → expect col=13, row=4.
    driveTap(harness.term, SCREEN_LEFT + 12 * CELL_W + 4, SCREEN_TOP + 3 * CELL_H + 8);
    expect(harness.hasSgrPress(13, 4)).toBe(true);
    expect(harness.hasSgrRelease(13, 4)).toBe(true);
  });

  it("does NOT regress to .xterm-screen dispatch — the press still arrives even when an interceptor swallows events at .xterm-screen", async () => {
    // Prove the fix is independent of bubbling from .xterm-screen. Install
    // a capture-phase mousedown interceptor on the screen child that
    // stopImmediatePropagation()s anything passing through. If we ever
    // regress to dispatching on .xterm-screen, this would swallow the SGR
    // report. With mousedown dispatched directly on `terminal.element`,
    // .xterm-screen never sees the event (it's a *child*, not on the
    // bubble path), so the SGR report still fires.
    //
    // Scope: this only guards the *mousedown* dispatch target. The mouseup
    // path (dispatched on `document`) is covered by the press+release
    // assertions in the preceding tests — if mouseup ever regressed back to
    // `.xterm-screen` or the host element, those tests would lose
    // `hasSgrRelease`.
    await harness.enableSgrMouseMode();
    harness.screen.addEventListener(
      "mousedown",
      (ev) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      },
      { capture: true }
    );
    driveTap(harness.term, SCREEN_LEFT + 4, SCREEN_TOP + 8);
    expect(harness.hasSgrPress(1, 1)).toBe(true);
  });
});
