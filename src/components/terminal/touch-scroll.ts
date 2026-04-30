// Mobile touch-scroll for the xterm.js terminal.
//
// xterm v6 was not designed for touch (upstream confirmation:
// https://github.com/xtermjs/xterm.js/issues/5377). Its wheel pipeline
// collapses each WheelEvent into at most ONE up/down sequence in the
// alt-screen path (CoreBrowserTerminal.ts:818-820: "simply send a single
// up or down sequence"). Synthetic 60Hz WheelEvent dispatch therefore
// produces ~5–7 arrow keys for a full thumb swipe regardless of deltaY
// magnitude — looks broken in TUIs like Claude Code, vim, less.
//
// We bypass xterm's wheel pipeline entirely. Two paths gated on the live
// buffer state:
//
//   1. Normal buffer (shell at prompt with scrollback): call
//      terminal.scrollLines(±N) directly for each cell-height of
//      accumulated finger travel.
//
//   2. Alt buffer (Claude Code, vim, less, htop): emit ESC[A / ESC[B
//      (or ESC O A / ESC O B when DECCKM is set) per cell-height directly
//      via the existing input WebSocket channel — same bytes the keyboard
//      already sends.
//
// Buffer type and DECCKM are read on every flush (not cached at gesture
// start) so DECSET 1049 transitions and vim mode toggles mid-swipe behave
// correctly.

// Pixel slop a single-touch swipe must exceed before we treat it as a scroll
// gesture rather than a tap.
export const TOUCH_SCROLL_ACTIVATION_PX = 5;

const MOMENTUM_START_THRESHOLD = 1.5;
const MOMENTUM_STOP_THRESHOLD = 0.3;
const MOMENTUM_DECAY = 0.95;
const MAX_VELOCITY_SAMPLES = 5;

// Minimal terminal-instance surface this module needs. We avoid importing
// xterm's full Terminal type so the unit test can stub against a small object.
export interface XTermSlice {
  readonly rows: number;
  scrollLines(amount: number): void;
  readonly buffer: { readonly active: { readonly type: "normal" | "alternate" } };
  readonly modes: { readonly applicationCursorKeysMode: boolean };
}

export interface TouchScrollDeps {
  /** Outer container the touch listeners attach to. */
  container: HTMLElement;
  /** Live xterm instance (returns null before xterm is mounted). */
  getXterm: () => XTermSlice | null;
  /**
   * Send raw bytes to the running PTY. Used for the alt-buffer arrow-key
   * path. Same channel the on-screen keyboard already uses.
   */
  sendInput: (data: string) => void;
  /** Test seam — defaults to performance.now(). */
  now?: () => number;
  /** Test seam — defaults to requestAnimationFrame. */
  raf?: (cb: () => void) => number;
  /** Test seam — defaults to cancelAnimationFrame. */
  cancelRaf?: (id: number) => void;
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
  const { container, getXterm, sendInput } = deps;
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancelRaf = deps.cancelRaf ?? ((id) => cancelAnimationFrame(id));

  let touchStartY = 0;
  let lastTouchY = 0;
  let lastTouchTime = 0;
  let velocityY = 0;
  let isScrolling = false;
  let momentumAnimationId: number | null = null;
  let accumPx = 0;
  let cachedScrollEl: HTMLElement | null = null;

  const velocitySamples: number[] = [];

  const resolveScrollEl = (): HTMLElement | null => {
    if (cachedScrollEl && cachedScrollEl.isConnected) return cachedScrollEl;
    cachedScrollEl = container.querySelector(".xterm-scrollable-element") as HTMLElement | null;
    return cachedScrollEl;
  };

  const getCellHeight = (): number => {
    const xterm = getXterm();
    const el = resolveScrollEl();
    if (xterm && xterm.rows > 0 && el && el.clientHeight > 0) {
      return el.clientHeight / xterm.rows;
    }
    return 0;
  };

  // Convert |accumPx| / cellHeight into integer line steps, sign of accumPx,
  // emit them via the buffer-appropriate path, and decrement accumPx by the
  // pixels consumed.
  const flushScroll = (): void => {
    const xterm = getXterm();
    if (!xterm) return;
    const cellHeight = getCellHeight();
    if (cellHeight <= 0) return;

    const lines = Math.trunc(accumPx / cellHeight);
    if (lines === 0) return;
    accumPx -= lines * cellHeight;

    const buf = xterm.buffer.active;
    if (buf.type === "normal") {
      // Scrollback: positive lines = view moves down through buffer = newer
      // content; negative = older. xterm's scrollLines(N) uses the same sign.
      xterm.scrollLines(lines);
      return;
    }

    // Alt buffer: emit |lines| arrow keys. Sign maps swipe direction to the
    // user's expectation:
    //   accumPx > 0  → finger moved up overall → user wants to advance
    //                  (newer / down-arrow / ESC[B)
    //   accumPx < 0  → finger moved down → user wants to go back
    //                  (older / up-arrow / ESC[A)
    // DECCKM (applicationCursorKeysMode) swaps CSI for SS3.
    const appCursor = xterm.modes.applicationCursorKeysMode;
    const seq = lines > 0
      ? (appCursor ? "\x1bOB" : "\x1b[B")
      : (appCursor ? "\x1bOA" : "\x1b[A");
    sendInput(seq.repeat(Math.abs(lines)));
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
      accumPx = 0;
      isScrolling = false;
      cachedScrollEl = null;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      isScrolling = false;
      return;
    }

    // touch-action: none cascades from .terminal.xterm but iOS Safari has been
    // observed to commit to a native pan if a single move slips through.
    e.preventDefault();

    const currentY = e.touches[0].clientY;
    const deltaY = lastTouchY - currentY; // positive = finger moved up
    const t = now();
    const timeDelta = t - lastTouchTime;

    if (timeDelta > 0) {
      const instantVelocity = (deltaY / timeDelta) * 16;
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
      accumPx += deltaY;
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
      accumPx += velocityY;
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
    accumPx = 0;
  };

  return { handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, cancelMomentum };
}
