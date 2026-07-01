# Mobile Terminal Scroll

How swipe-to-scroll on the xterm.js terminal is implemented, why it took
three iterations to land, and what xterm v6 internals are load-bearing.

Scope: this is the **web / PWA** terminal (`xterm.js`, `@xterm/xterm@^6`). It is
doubly load-bearing for mobile because the `mobile/` Flutter app renders this same
web terminal inside an embedded WebView (see
[`docs/MOBILE_ARCHITECTURE.md`](./MOBILE_ARCHITECTURE.md)), so touch scrolling
inside the native app runs through exactly this code path. Shipped and unit-tested.

Code: [`src/components/terminal/touch-scroll.ts`](../src/components/terminal/touch-scroll.ts).
Driver: [`src/components/terminal/Terminal.tsx`](../src/components/terminal/Terminal.tsx) (touch listeners only).
Tests: [`src/components/terminal/Terminal.touch-scroll.test.ts`](../src/components/terminal/Terminal.touch-scroll.test.ts).
GitHub: [#178](https://github.com/btli/remote-dev/issues/178), PRs
[#209](https://github.com/btli/remote-dev/pull/209) (broken),
[#210](https://github.com/btli/remote-dev/pull/210) (broken in TUIs),
[#211](https://github.com/btli/remote-dev/pull/211) (working).

## TL;DR

Swipe on a touch device → translate finger Y delta into one of three side
effects per cell-height of travel, chosen by what the running app
negotiated:

| App's `mouseTrackingMode` | xterm buffer | We send                                            | Result                                    |
| ------------------------- | ------------ | -------------------------------------------------- | ----------------------------------------- |
| `vt200` / `drag` / `any`  | either       | SGR mouse-wheel report (`CSI<64;1;1M`/`CSI<65;1;1M`) | App's own scroll handler runs             |
| `none` / `x10`            | normal       | `terminal.scrollLines(±N)`                         | xterm's scrollback moves                  |
| `none` / `x10`            | alternate    | Arrow keys (`ESC[A`/`ESC[B`, SS3 under DECCKM)     | Mirrors xterm's own desktop fallback path |

Per-flush re-read of buffer type, mouse mode, and DECCKM so DECSET 1049
transitions and `:set mouse=a` toggles mid-swipe behave correctly.

## Why this isn't obvious

xterm v6 was not designed for touch — upstream confirmation:
[xtermjs/xterm.js#5377](https://github.com/xtermjs/xterm.js/issues/5377).
Its wheel pipeline expects desktop-rhythm events: large per-event `deltaY`,
infrequent dispatch. A 60Hz touchmove with 10–30 px per frame fights the
framework hard enough that two well-reviewed fixes shipped to production
without working.

### The three failed approaches

**PR #209 — synthetic `WheelEvent` on `.xterm-scrollable-element`.**
Failure: xterm's `consumeWheelEvent`
([`CoreMouseService.ts:241–268`](../node_modules/.bun/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/src/common/services/CoreMouseService.ts))
applies a 0.3× trackpad multiplier when `|deltaY| < 50` and accumulates
fractional remainders. Per-frame ~20 px deltas yield ~0.75 line equivalents
→ floor returns 0 most frames → no visible scroll. Even when it didn't
return 0, the alt-buffer wheel handler at
[`CoreBrowserTerminal.ts:818–820`](../node_modules/.bun/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts)
explicitly says *"has been simplified to simply send a single up or down
sequence"* — `lines` is used only as a 0/non-0 gate. Each wheel event
produces at most one ESC sequence. ~5 ESC sequences per full thumb swipe
looked broken in TUIs.

**PR #210 — bypass wheel pipeline, send `ESC[A`/`ESC[B` to alt-buffer apps.**
Failure: TUIs that have negotiated mouse-wheel reporting (Claude Code, vim
with `mouse=a`, less -m, lazygit, tmux mouse on) interpret arrow keys as
cursor movement, not scroll. The user reported "It's sending up and down
events to the TUI instead of actual scroll" — accurately. Arrow keys are
only the right primitive when the app has *not* enabled mouse mode (the
fallback path xterm itself takes at
[`CoreBrowserTerminal.ts:806–842`](../node_modules/.bun/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts)
when `requestedEvents.wheel` is null).

**PR #211 — what desktop wheel actually does.**
Trace from desktop wheel in Claude Code:

1. Browser dispatches `WheelEvent` on `.xterm`.
2. xterm's dynamically-attached `eventListeners.wheel` fires
   ([`CoreBrowserTerminal.ts:710–713`](../node_modules/.bun/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts)).
3. `sendEvent(ev)` →
   `coreMouseService.triggerMouseEvent({ button: WHEEL, action: deltaY < 0 ? UP : DOWN, ... })`.
4. CoreMouseService SGR encoder
   ([`CoreMouseService.ts:143–146`](../node_modules/.bun/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/src/common/services/CoreMouseService.ts))
   emits `\x1b[<{64|action};{col};{row}M`.
5. Bytes flow to the app via the PTY; the app handles them as scroll.

Our touch handler now bypasses steps 1–4 and emits step-5 bytes directly
when the app has negotiated wheel reporting. One report per cell-height of
finger travel. Modern TUIs all enable SGR encoding (DECSET 1006) alongside
tracking, so SGR is what we send.

## DOM topology in xterm v6

Knowing this layout matters for any further mobile work.

```
.terminal.xterm                         ← the outer container (this.element).
                                         touch-action: none lives here.
├── .xterm-viewport                     ← VESTIGIAL in v6. Empty position:
│                                          absolute; inset: 0 div, never
│                                          scrolled. Survives only for v5
│                                          back-compat. Don't query it.
└── .xterm-scrollable-element           ← REAL scroll host (a
    │                                      SmoothScrollableElement from VS
    │                                      Code's UI base). Holds the
    │                                      reparented .xterm-screen and the
    │                                      scrollbar. cellHeight =
    │                                      .clientHeight / terminal.rows.
    ├── .xterm-screen                   ← rendered cells, helper textarea,
    │   └── canvas / .xterm-rows           etc.
    └── .scrollbar.vertical
```

## Wheel routing in xterm v6 (the table I wish I'd had)

xterm registers up to three wheel listeners. Which one handles a given
event depends on app-negotiated mouse mode and buffer type.

| Listener                                  | Where attached              | Active when                                                    | What it does                                                                    |
| ----------------------------------------- | --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `_setListeningToMouseWheel`               | `.xterm-scrollable-element` | `handleMouseWheel: true` (toggled off when app requests wheel) | Scrolls scrollback via `setScrollPosition`                                      |
| `bindMouse → addEventListener('wheel')`   | `.xterm` (root)             | always                                                         | If `requestedEvents.wheel`: returns. Else if `!hasScrollback`: emits `ESC[A`/`ESC[B`. |
| `eventListeners.wheel` via `requestedEvents` | `.xterm` (root)             | App enabled `vt200`/`drag`/`any`                                | Forwards as SGR/DEFAULT mouse-wheel report                                      |

Net behaviour by mode:

| `mouseTrackingMode` | xterm buffer | What desktop wheel does (1 click) |
| ------------------- | ------------ | --------------------------------- |
| `none` or `x10`     | normal       | Scroll scrollback ~75 px          |
| `none` or `x10`     | alternate    | Send one `ESC[A`/`ESC[B`          |
| `vt200`/`drag`/`any`| either       | Send one SGR mouse-wheel report   |

**Critical:** every wheel event produces *at most one* output regardless of
its `deltaY`. To scroll faster, an emitter must produce more wheel events.
The `lines` value from `consumeWheelEvent` is a 0/non-0 gate, not a count.
This is the trap that broke PR #209 and PR #210.

## Architecture of `touch-scroll.ts`

`createTouchScrollHandlers` is a pure factory — no React, no xterm import.
The unit test stubs the xterm slice and the WS `sendInput` callback; the
production driver in `Terminal.tsx` passes the real refs.

State per gesture: `accumPx` (running pixel total), `velocitySamples`
(rolling 5-frame average for momentum), `cachedScrollEl` (re-resolved via
`isConnected` check on each access).

Activation gates short taps: a swipe must clear `TOUCH_SCROLL_ACTIVATION_PX`
(5 px) cumulative offset before any output is emitted. Below threshold,
no `preventDefault()` either, so taps still propagate as taps.

Flush logic (`flushScroll`):

```
lines = trunc(accumPx / cellHeight)
if lines == 0: return
accumPx -= lines * cellHeight     ← residue carries across flushes
if mouseTrackingMode in {vt200, drag, any}:
    emit |lines| × SGR-wheel-report (forward iff lines > 0)
elif buffer.type == "normal":
    terminal.scrollLines(lines)
else:
    emit |lines| × arrow-key (down iff lines > 0; honour DECCKM)
```

Sign convention everywhere: `accumPx > 0` (finger moved up overall) →
forward / newer / wheel-down / `ESC[B` / `scrollLines(+N)`.

Momentum on touchend: classic decay loop (`MOMENTUM_DECAY = 0.95`) feeding
`accumPx` and `flushScroll` until velocity falls below
`MOMENTUM_STOP_THRESHOLD`.

## SGR mouse-wheel format

```
ESC [ < {code} ; {col} ; {row} M
```

- `code = 64 | action`. Action is `0` (up / back) or `1` (down / forward).
- `col`, `row` are 1-based screen coordinates. Most apps don't gate on
  coords for wheel — we emit `1;1`. (If a future app does gate, we can
  read the touch coords through `.xterm-scrollable-element.getBoundingClientRect()`.)

Only SGR is implemented. Modern TUI libraries (Ink, prompt-toolkit, urwid,
charm/bubbletea, neovim, kitty, alacritty's compatibility layer)
negotiate SGR alongside tracking via `CSI ? 1006 h`. The legacy DEFAULT
encoding caps at 223-column screens and is essentially unused on modern
terminals. If a niche app turns out to need DEFAULT, detect via
`(terminal as unknown as { _core: ... })._core.coreMouseService.activeEncoding`
and branch — private API but stable.

## Re-reading mode per flush

`mouseTrackingMode`, `buffer.active.type`, and `applicationCursorKeysMode`
are all read inside `flushScroll`, not cached at gesture start.
DECSET 1049 (alt-screen enter/exit) and mode toggles can fire mid-swipe —
opening a TUI from a shell prompt during the gesture, exiting vim, vim
toggling DECCKM between insert and normal modes. Caching at touchstart
would emit the wrong primitive for the second half of the swipe.

## Testing it without a device

`Terminal.touch-scroll.test.ts` exercises `createTouchScrollHandlers`
directly with a stubbed xterm slice. The harness replays a y-position
sequence as `touchstart` / `touchmove`* / `touchend`. Each path is
covered:

- All three `mouseTrackingMode` flavours emit correct SGR bytes per
  direction.
- `x10` (no wheel events) falls through correctly.
- Wheel-report mode wins over buffer type.
- Normal-buffer scrollback path.
- Alt-buffer arrow-key fallback.
- DECCKM SS3 forms.
- Mid-gesture buffer-type switch.
- Activation threshold + sub-cell residue carry.
- Multi-touch bailout (preserves pinch-zoom).

Real-device QA still required before claiming a UX change is live: iOS
Safari and Android Chrome with content in each path (plain shell prompt,
Claude Code chat, vim alt-screen).

## What would I have done differently

1. **Trace the desktop primitive first.** Before assuming what to send,
   I should have inspected exactly which bytes hit the PTY on a desktop
   wheel scroll in the failing app (Claude Code). One `gdb`-equivalent
   on the WebSocket would have shown SGR mouse-wheel reports immediately
   and skipped two iterations.
2. **Don't trust the obvious file path through xterm.** PR #209 read the
   alt-buffer wheel listener at `:806` and assumed it was the active path.
   It isn't, when an app has negotiated mouse mode — `requestedEvents.wheel`
   diverts to `:751–757` first. The full routing table above wasn't in any
   single place in xterm's source; I had to assemble it across four files.
3. **`lines` from `consumeWheelEvent` is a 0/non-0 gate, not a count.**
   This single fact undid PR #209's premise; missing it cost a deploy.

## Future work

- **DEFAULT-encoding fallback** if a niche TUI shows up that doesn't use
  SGR. Read `coreMouseService.activeEncoding` (private but stable).
- **Pinch-zoom font scaling** — currently we just bail on multi-touch.
- **Selection on long-press** — out of scope for scroll, but the same
  touch handler is the natural place.
- **Real-device CI** — Playwright mobile-emulation has been deferred each
  time. The current unit tests are good for algorithmic regressions but
  don't catch DOM/event-system surprises.
