// Mobile touch-scroll for the xterm.js terminal.
//
// xterm v6 was not designed for touch (upstream confirmation:
// https://github.com/xtermjs/xterm.js/issues/5377). Its wheel pipeline
// collapses each WheelEvent into at most ONE wheel/up/down event regardless
// of magnitude. Synthetic 60Hz WheelEvent dispatch therefore looks broken.
//
// We bypass xterm's wheel pipeline and choose the right path per flush
// based on what the running app actually negotiated:
//
//   1. App enabled mouse-wheel reporting (mouseTrackingMode is
//      vt200/drag/any — Claude Code, vim with `mouse=a`, less -m, lazygit,
//      tmux mouse on): emit SGR mouse-wheel reports (`CSI < 64;1;1 M`
//      back, `CSI < 65;1;1 M` forward) directly via the input WebSocket.
//      Each report is one "wheel click" the app interprets as scroll.
//      Modern TUIs negotiate SGR encoding (DECSET 1006) alongside
//      tracking; SGR is what we send.
//
//   2. Normal buffer with scrollback, no mouse reporting (shell at
//      prompt): call terminal.scrollLines(±N) directly. App doesn't see
//      the gesture; xterm's scrollback moves under the user.
//
//   3. Alt buffer, no mouse reporting (rare — vim with `mouse=`, htop
//      without mouse): emit ESC[A / ESC[B (or ESC O A / ESC O B under
//      DECCKM) per cell. Mirrors what xterm's own outer wheel listener
//      (CoreBrowserTerminal.ts:838) does for desktop wheel in this state.
//
// Buffer type, mouse-tracking mode, and DECCKM are re-read on every
// flush so DECSET 1049 / mouse-mode / vim mode toggles mid-swipe behave
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
  readonly modes: {
    readonly applicationCursorKeysMode: boolean;
    readonly mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any";
  };
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

    // Sign convention (consistent across all three paths below):
    //   accumPx > 0  → finger moved up overall → user wants newer content
    //                  → forward (wheel-down / ESC[B / scrollLines(+N))
    //   accumPx < 0  → finger moved down → user wants older content
    //                  → back (wheel-up / ESC[A / scrollLines(-N))
    const forward = lines > 0;
    const count = Math.abs(lines);

    // Path 1 — app accepts mouse-wheel reports. We emit one SGR wheel report
    // per line of finger travel; the app handles internal scroll itself
    // (Claude Code chat history, vim with mouse, less, lazygit, tmux mouse).
    const tracking = xterm.modes.mouseTrackingMode;
    if (tracking === "vt200" || tracking === "drag" || tracking === "any") {
      // SGR mouse-wheel: ESC[<{code};{col};{row}M
      // code = 64 (WHEEL bit) | action (0=UP/back, 1=DOWN/forward).
      // (col, row) = (1, 1) — apps that scroll on wheel don't gate on coords.
      const code = forward ? 65 : 64;
      sendInput(`\x1b[<${code};1;1M`.repeat(count));
      return;
    }

    // Path 2 — normal buffer, no mouse reporting: move xterm scrollback.
    if (xterm.buffer.active.type === "normal") {
      xterm.scrollLines(lines);
      return;
    }

    // Path 3 — alt buffer, no mouse reporting (rare). Mirror xterm's own
    // outer wheel listener at CoreBrowserTerminal.ts:838: emit one arrow
    // key per line. DECCKM (applicationCursorKeysMode) swaps CSI for SS3.
    const appCursor = xterm.modes.applicationCursorKeysMode;
    const seq = forward
      ? (appCursor ? "\x1bOB" : "\x1b[B")
      : (appCursor ? "\x1bOA" : "\x1b[A");
    sendInput(seq.repeat(count));
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
