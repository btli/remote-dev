# Terminal Resize Reconciliation — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per repo CLAUDE.md, all implementation happens in a git worktree (`./scripts/worktree-warm.sh` after creation).

**bd issue:** `remote-dev-ah7q` (P1 epic)
**RCA:** Joint investigation 2026-08-02 (Claude Fable 5 + Codex gpt-5.6-sol xhigh).
**Review log:** v1 reviewed by Codex gpt-5.6-sol xhigh (verdict: needs-rework, 2 blockers / 8 majors / 3 minors). All 13 findings verified against the repo and incorporated below (v2). Key corrections: `visible` must thread through the **plugin client adapters** (not the unused `TerminalTypeRenderer`); tmux reassertion must be **forced on focus** (applied-size cache alone re-creates RC-F); `fit()` must report success (FitAddon silently no-ops); initial reconcile must be awaitable before `connect()`; focus-signal state must be panel-aware and socket-independent; promotion-defer needs identity-conditional bookkeeping; test env is **happy-dom**.

**Goal:** Terminal grid, PTY size, and tmux window size converge to the visible terminal's container size on every focus/reveal — eliminating the "stale size until manual window resize" race class.

**Architecture:** Replace the scattered, edge-triggered fit calls in `Terminal.tsx` with a single per-terminal **ResizeReconciler** (plain TS class, React-free, unit-testable) that owns all fitting, re-checks visibility after every async boundary, verifies fit success, commits its dedupe cache only after a verified visible fit, and queues desired dimensions for replay when the socket is closed. Add an explicit `visible` prop threaded from the two UI surfaces that hide terminals without unmounting (chat/terminal view toggle, Loop drawer) **through the plugin client adapters**. Introduce a **desired-focus-state** model so `client_focus`/`client_blur` reflect panel visibility and survive reconnects. On the server, make tmux sizing **convergent**: per-session desired/applied size with latest-wins serialization, forced reassertion on focus (even when already primary), and identity-conditional deferred promotion instead of silent cooldown drops.

**Tech Stack:** TypeScript, React 19, xterm.js `@xterm/addon-fit` (`proposeDimensions()` + `fit()`), Vitest (**happy-dom**), Node `ws` terminal server, tmux.

## Global Constraints

- **No new dependencies.**
- **Server logging:** `createLogger` only — never `console.*` in server code (repo CLAUDE.md).
- **WS protocol compatibility:** existing message types (`resize`, `client_focus`, `client_blur`, `primary_changed`) keep their shapes; additions are optional fields only. Old clients keep working against the new server and vice versa. One documented compatibility exception: initial-URL dimension clamping (see T4 Step 3, finding #12).
- **Mobile bridge contract preserved:** `TerminalRef.refit()` (rdv-bridge v4) keeps its public behavior. Verified unaffected paths: `TerminalWithKeyboard.refit()` forwards directly (`TerminalWithKeyboard.tsx:191`), `EmbeddedSessionView.tsx:403` exposes it; `RecordingPlayer.tsx` owns a separate xterm/FitAddon lifecycle; `PortAllocationsTab` contains no Terminal.
- **Existing guard values preserved:** container minima 100×80 px, grid minima 10×3, settle stability 2 frames / max 10 frames, server resize coalesce 50 ms, promotion cooldown 1000 ms.
- **Quality gates before merge:** `bun run lint && bun run typecheck && bun run test:run`.

---

## Root causes this plan must close (from the RCA)

| # | Root cause | Evidence | Closed by task |
|---|-----------|----------|----------------|
| RC-A | ResizeObserver commits `lastWidth/lastHeight` *before* the 16 ms-debounced fit runs; hide-during-debounce loses the fit and an identical re-show is suppressed forever | `Terminal.tsx:1299-1304` | T1, T2 |
| RC-B | `settleAndFit` guards are entry-only (TOCTOU): a terminal hidden mid-settle is still fitted, corrupting local xterm to 2×1 (FitAddon clamps zero boxes) | `Terminal.tsx:60-70`, `FitAddon.ts:84` | T1 |
| RC-C | Chat↔terminal toggle and Loop drawer hide terminals via CSS with **no** refit trigger and no `isActive` change | `SessionManager.tsx:2377`, `TerminalDrawer.tsx:78` | T3 |
| RC-D | `ws.onopen` and `initAndConnect` fit unguarded (can fit hidden / after 30 failed frames); URL accepts 2×1 initial dims that later resize validation rejects | `Terminal.tsx:879, 1158`, `terminal.ts:3040` | T2, T5 |
| RC-E | Activation before async init completes is lost (null refs, no post-init replay) | `Terminal.tsx:365, 1452` | T2 |
| RC-F | Server resize dedupe compares against `connection.lastCols`, not tmux's actual size; `client_focus` no-ops when already primary → externally-resized tmux is unrepairable | `terminal.ts:3350, 686` | T4 (forced reassert) |
| RC-G | 1 s promotion-cooldown denial is silent with no retry; client focus dedupe never re-sends → wrong client keeps tmux sizing indefinitely | `terminal.ts:691`, `Terminal.tsx:1194` | T4, T2 (focus-state), T3 |
| RC-H | `tmux resize-window` calls are unawaited/unserialized (stale command can land last) | `terminal.ts:650` | T4 |
| RC-I | Resize computed while WS closed is discarded, not queued for replay on open | `Terminal.tsx:72` | T1, T2 |

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/terminal/resize-reconciler.ts` | Create | React-free reconciliation coordinator: epoch/generation settle loop, visibility gating, verified fits, commit-after-success cache, desired-dims queue |
| `src/components/terminal/resize-reconciler.test.ts` | Create | Unit tests for every client-side RCA interleaving + no-op-fit + dispose/epoch |
| `src/components/terminal/Terminal.tsx` | Modify | Delete `settleAndFit` + direct fit paths; instantiate reconciler; add `visible` prop; desired-focus-state; wire all triggers to `reconciler.request()` |
| `src/components/terminal/TerminalWithKeyboard.tsx` | Modify | Thread `visible` prop (interface `:70-93`, pass-through `:269`) |
| `src/types/terminal-type.ts` | Modify | Add `visible?: boolean` to `TerminalRenderProps` (`:321` area; inherited by `TerminalTypeClientComponentProps`, `terminal-type-client.ts:50`) |
| `src/lib/terminal-plugins/plugins/shell-plugin-client.tsx` | Modify | Forward `visible` (explicit destructure at `:34` currently drops unknown props) |
| `src/lib/terminal-plugins/plugins/agent-plugin-client.tsx` | Modify | Forward `visible` |
| `src/lib/terminal-plugins/plugins/ssh-plugin-client.tsx` (and any other client adapter rendering TerminalWithKeyboard — grep `plugins/*-plugin-client.tsx`) | Modify | Forward `visible` |
| `src/lib/terminal-plugins/plugins/loop-agent-plugin-client.tsx` | Modify | Forward `visible` as `parentVisible` to LoopChatPane |
| `src/components/session/SessionManager.tsx` | Modify | Pass `visible={effectiveActiveView === "terminal"}` at the PluginComponent render (`:2413`) |
| `src/components/loop/LoopChatPane.tsx` | Modify | Accept `parentVisible?: boolean`; pass `visible={parentVisible !== false && terminalVisible}` to its Terminal (`:323`) |
| `src/server/tmux-size-controller.ts` | Create | Per-session desired/applied tmux size, latest-wins serialized `resize-window`, `force` reassertion, per-session epoch |
| `src/server/__tests__/tmux-size-controller.test.ts` | Create | Unit tests with injected exec (repo convention: server tests live in `__tests__/`) |
| `src/server/__tests__/promotion-defer.test.ts` | Create | Fake-timer tests for deferred promotion orderings |
| `src/server/terminal.ts` | Modify | Use controller; promotion defer (identity-conditional); already-primary forced re-assert; clamp initial URL dims; extract promotion/pending logic into testable helpers |
| `src/components/terminal/Terminal.refit.test.tsx` | Modify | Assert real reconciler behavior (v1 test used `scrollToBottom` as a proxy and a zero-size container, `:297`) |

**Note (review finding #2):** `TerminalTypeRenderer.tsx` is NOT on the active render path — SessionManager dispatches through the plugin registry (`SessionManager.tsx:86` comment, `:2410`). Do not route the fix through it.

---

## Design: the reconciler contract

```ts
// src/components/terminal/resize-reconciler.ts
export type ReconcileReason =
  | "panel-visible" | "page-visible" | "window-focus" | "window-resize"
  | "visual-viewport" | "resize-observer" | "font-change" | "socket-open"
  | "post-init" | "active" | "refit" | "dpr-change";

export interface FitResult { cols: number; rows: number; }

export interface ReconcilerHost {
  getContainer(): HTMLElement | null;
  /** Verified fit (finding #5): call fitAddon.proposeDimensions(); if null or
   *  below minima, return null WITHOUT fitting. Otherwise fit() and return the
   *  resulting terminal cols/rows, which must equal the proposal (else null).
   *  A null return means "fit did not happen" — never commit on null. */
  fitVerified(): FitResult | null;
  isPageVisible(): boolean;    // !document.hidden
  isPanelVisible(): boolean;   // latest `visible` prop value (latest-value ref)
  getWebSocket(): WebSocket | null;
  onDimensions?(cols: number, rows: number): void;
  raf(cb: () => void): number; // injectable for deterministic tests
  caf(id: number): void;
}

export class ResizeReconciler {
  constructor(host: ReconcilerHost, opts?: Partial<ReconcilerLimits>);
  /** Any trigger. Coalesces; latest generation wins. Never fits while hidden —
   *  a request while hidden is REMEMBERED and replayed on the next reveal. */
  request(reason: ReconcileReason): void;
  /** Awaitable one-shot reconcile for the pre-connect path (finding #7).
   *  Resolves with the verified dims, or null if hidden/invalid at completion.
   *  Runs through the same generation machinery as request(). */
  reconcileOnce(reason: ReconcileReason): Promise<FitResult | null>;
  /** From the `visible` prop effect. `false` aborts in-flight work AND
   *  invalidates the committed rect so the next reveal always reconciles.
   *  `true` always requests. */
  notifyPanelVisibility(visible: boolean): void;
  /** ResizeObserver feed. Debounce lives here; the observed rect is only
   *  COMMITTED (for dedupe) after a verified visible fit. */
  observeRect(width: number, height: number): void;
  /** ws.onopen. Socket identity REQUIRED (finding #6): no-op if `socket` is
   *  not the host's current socket. Replays desired dims if present, then
   *  requests "socket-open" (covers the no-desired-dims-yet case). */
  notifySocketOpen(socket: WebSocket): void;
  getDesiredDims(): FitResult | null;
  /** Increments the internal epoch, cancels all rAF/debounce work, and makes
   *  every public method a permanent no-op (finding #6 / StrictMode). */
  dispose(): void;
}
```

**Invariant:** *when a terminal is active, initialized, connected, and measurably visible, DOM box == xterm grid == connection desired dims == PTY size == primary tmux window size, at the latest generation.*

Implementation rules:

1. **Visibility re-checked after every rAF boundary** — before each measurement and before the fit. Failure aborts the generation and sets `pendingWhileHidden = true`; it never falls through to a fit (RC-B).
2. **Rect dedupe cache committed only after a verified visible fit** (`fitVerified()` non-null, ≥10×3). `notifyPanelVisibility(false)` clears the cache unconditionally (RC-A).
3. **Desired dims persist.** Socket not OPEN at send time → store dims; `notifySocketOpen(socket)` replays them (RC-I).
4. **Every entry point is a request.** No caller invokes fit directly (RC-D, RC-E).
5. **Epoch discipline (finding #6):** every async continuation captures the epoch at scheduling time and self-cancels if it differs at execution time. A disposed instance can never mutate state or call host methods.

## Design: desired focus state (finding #3)

`Terminal.tsx` maintains a single derived focus intent, independent of socket readiness:

```
desiredFocus = panelVisible && !document.hidden && (windowFocused || xtermTextareaFocused)
```

- All existing signal sources (window focus/blur `Terminal.tsx:1254-1263`, visibilitychange `:1233`, textarea focus/blur `:1219`, the new `visible` prop) update the derived state; a single `syncFocusToServer()` sends `client_focus`/`client_blur` only when the derived state *changes* (replaces the raw `lastSentFocusStateRef` dedupe at `:1194`).
- State survives sockets: `ws.onopen` flushes the **current derived state** (replacing the `document.hasFocus()`-only reconstruction at `:865-872`) *before* the reconciler's dim replay, so promotion precedes resize.
- **A hidden panel never sends `client_focus`** — closes the "closed Loop drawer reclaims primary on window focus" hole and the hidden-`ws.onopen` hole (RC-C/RC-G interaction).
- If the socket is not OPEN when the state changes, the state is simply retained; the next `onopen` flush delivers it (no lost blur/focus).
- `refit()` keeps its force semantics: it re-sends the current state unconditionally (clears the "unchanged" suppression), preserving the rdv-bridge contract.

## Design: server tmux-size controller (finding #1 amended)

```ts
// src/server/tmux-size-controller.ts
export interface TmuxExec {
  (args: string[], cb: (err: Error | null) => void): void; // wraps execFile("tmux", ...)
}

export class TmuxSizeController {
  constructor(exec: TmuxExec, log: Logger);
  /** Latest-wins serialized resize. `force: true` bypasses the applied-size
   *  dedupe and always issues resize-window (used on focus/promotion —
   *  tmux may have been resized externally; our applied cache is NOT ground
   *  truth). Ordinary resize-message traffic uses the dedupe. */
  requestResize(sessionId: string, tmuxSessionName: string, cols: number, rows: number, opts?: { force?: boolean }): void;
  /** Called ONLY when the tmux session is confirmed gone (session kill path)
   *  — NEVER on transient WS disconnect (finding #9; matches the existing
   *  preserve-state cleanup at terminal.ts:772). Bumps the session epoch so
   *  outstanding exec callbacks cannot mutate replacement state. */
  clearSession(sessionId: string): void;
  getAppliedSize(sessionId: string): { cols: number; rows: number } | null;
}
```

`terminal.ts` integration:
- All three `runTmuxResize` call sites (promotion `:701`, disconnect handoff `:807`, resize handler `:3366`) go through the controller; delete `runTmuxResize` (RC-H).
- **Resize handler:** keep the 50 ms coalesce and PTY-resize skip-if-unchanged; **always** call `requestResize(...)` (non-forced) when primary — the controller's applied-size compare makes converged calls free.
- **`tryPromoteToPrimary`:** on *any* accepted `client_focus` — including the `currentPrimary === connectionId` early-return path (`:686`) — call `requestResize(..., { force: true })` with the connection's latest dims. This is the RC-F closure: focus always reasserts tmux size regardless of every cache.
- **Deferred promotion (finding #4, identity-conditional):**
  - On cooldown denial: `sessionPendingPromotion.set(sessionId, connectionId)`; arm/re-arm ONE timer per session for the cooldown remainder.
  - Timer fire: re-read the map; promote only if the mapped candidate (a) is still the mapped candidate, (b) exists in `connections`, (c) has an OPEN socket, and (d) `isVisible === true`. Otherwise drop silently.
  - `client_blur`: clear pending **only if** the blurring connection is the mapped candidate.
  - Disconnect cleanup: clear pending **only if** the disconnecting connection is the mapped candidate; cancel the timer only when clearing.
  - Successful promotion (any path): clear pending + cancel timer.
- **Initial URL dims (`:3040`, finding #12):** clamp positive-but-small (`0 < cols < 10 || 0 < rows < 3`) up to 10×3; use the 80×24 default only for absent/NaN/nonpositive values. Documented compatibility exception: an old client requesting 9×2 now gets 10×3 (previously honored) — strictly closer to its request than v1's 80×24 clamp.
- **Session kill path only:** `tmuxSize.clearSession(sessionId)` where tmux is destroyed (DELETE/kill), not in `cleanupConnection`.

---

### Task T1: ResizeReconciler core + unit tests

**Files:**
- Create: `src/components/terminal/resize-reconciler.ts`
- Test: `src/components/terminal/resize-reconciler.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; DOM types only).
- Produces: `ResizeReconciler`, `ReconcilerHost`, `ReconcileReason`, `FitResult` exactly as in the Design section. Constants exported: `SETTLE_MIN_WIDTH = 100`, `SETTLE_MIN_HEIGHT = 80`, `MIN_COLS = 10`, `MIN_ROWS = 3`, `SETTLE_STABLE_FRAMES = 2`, `SETTLE_MAX_FRAMES = 10`, `OBSERVER_DEBOUNCE_MS = 16` (moved from `Terminal.tsx:19-24`; Terminal imports them afterward).

- [ ] **Step 1: Write failing tests.** Harness (finding #11): `FakeHost` with a manually-pumped rAF queue whose `pumpUntilIdle()` alternates one rAF callback with a microtask flush (`await Promise.resolve()`) until both the queue AND the reconciler's work state are idle — a purely synchronous drain can observe an empty queue between async continuations. Mutable `rect`/`panelVisible`/`pageVisible`; `fitVerified()` spy computing grid from rect with fake 8×16 cells, with a switchable **no-op mode** returning `null` while leaving the old grid in place; fake WS recording frames with settable `readyState` and distinct object identities for the stale-socket test. Cover at minimum:

```ts
it("RC-A: rect observed then hidden before debounce — re-show at same size still fits", async () => {
  host.rect = { width: 800, height: 480 };
  r.observeRect(800, 480);            // debounce armed, NOT committed
  r.notifyPanelVisibility(false);      // aborts + clears committed cache
  await vi.advanceTimersByTimeAsync(20);
  expect(host.fitCalls).toBe(0);       // never fit hidden
  r.notifyPanelVisibility(true);       // same 800×480 — must STILL reconcile
  await host.pumpUntilIdle();
  expect(host.sentResizes.at(-1)).toEqual({ type: "resize", cols: 100, rows: 30 });
});

it("RC-B: hide mid-settle aborts without fitting; reveal replays", async () => {
  r.request("window-resize");
  await host.pump(1);                  // inside the settle loop
  r.notifyPanelVisibility(false);
  await host.pumpUntilIdle();
  expect(host.fitCalls).toBe(0);
  r.notifyPanelVisibility(true);       // pendingWhileHidden must replay
  await host.pumpUntilIdle();
  expect(host.fitCalls).toBeGreaterThan(0);
});

it("RC-I: socket closed at send time — dims queued and replayed on open", async () => {
  host.ws.readyState = WebSocket.CONNECTING;
  r.request("active");
  await host.pumpUntilIdle();
  expect(host.sentResizes).toHaveLength(0);
  expect(r.getDesiredDims()).toEqual({ cols: 100, rows: 30 });
  host.ws.readyState = WebSocket.OPEN;
  r.notifySocketOpen(host.ws);
  expect(host.sentResizes.at(-1)).toEqual({ type: "resize", cols: 100, rows: 30 });
});

it("finding #5: no-op fit (fitVerified null) commits nothing and sends nothing", async () => {
  host.fitNoopMode = true;             // grid stays 80×24, fitVerified() → null
  r.observeRect(800, 480);
  await host.pumpUntilIdle();
  expect(host.sentResizes).toHaveLength(0);
  expect(r.getDesiredDims()).toBeNull();
  host.fitNoopMode = false;            // same rect must NOT be suppressed now
  r.request("window-focus");
  await host.pumpUntilIdle();
  expect(host.sentResizes.at(-1)).toEqual({ type: "resize", cols: 100, rows: 30 });
});

it("finding #6: stale socket identity — notifySocketOpen(oldWs) is a no-op", async () => {
  const oldWs = host.ws;
  host.ws = new FakeWS();              // reconnect happened
  r.notifySocketOpen(oldWs);
  expect(host.ws.sent).toHaveLength(0);
});

it("finding #6: dispose cancels in-flight work; all methods no-op after", async () => {
  r.request("active");
  await host.pump(1);
  r.dispose();
  await host.pumpUntilIdle();
  expect(host.fitCalls).toBe(0);
  r.request("active"); r.notifyPanelVisibility(true);
  await host.pumpUntilIdle();
  expect(host.fitCalls).toBe(0);
});

it("reconcileOnce resolves with verified dims (pre-connect path)", async () => {
  const p = r.reconcileOnce("post-init");
  await host.pumpUntilIdle();
  expect(await p).toEqual({ cols: 100, rows: 30 });
});

it("supersede: a newer request cancels an older in-flight generation", ...);
it("never sends grids below 10×3 and does not commit them", ...);
it("request while page hidden (document.hidden) is deferred, not dropped", ...);
```

- [ ] **Step 2: Run tests, verify they fail** (`bun run test:run -- resize-reconciler`).
- [ ] **Step 3: Implement** per Design rules 1-5. Port the settle-loop shape from `settleAndFit` (`Terminal.tsx:35-83`) with per-frame guard re-checks, abort-to-pending, verified fits, and epochs.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** (`feat(terminal): add ResizeReconciler coordinator (remote-dev-ah7q)`).

### Task T2: Wire Terminal.tsx onto the reconciler + desired focus state

**Files:**
- Modify: `src/components/terminal/Terminal.tsx`
- Test: `src/components/terminal/Terminal.refit.test.tsx` (update), `src/components/terminal/Terminal.fontRace.test.tsx` (keep green)

**Interfaces:**
- Consumes: T1's exports.
- Produces: `TerminalProps.visible?: boolean` (default `true`); `TerminalRef.refit()` behavior preserved; internal `reconcilerRef`, `visibleRef` (latest-value), `desiredFocus` derivation + `syncFocusToServer()`.

- [ ] **Step 1: Write failing tests** — extend `Terminal.refit.test.tsx`: (a) mount with `visible={false}`, flip to `true`, assert a reconcile ran (spy on ws resize frame — NOT the v1 `scrollToBottom` proxy; give the container a stubbed non-zero `getBoundingClientRect`/`offsetParent` since happy-dom does no layout); (b) StrictMode mount/unmount/remount produces exactly one live reconciler and no post-dispose host calls; (c) `visible={false}` + window focus event sends NO `client_focus` frame.
- [ ] **Step 2: Replace all fit paths.** Construct the reconciler in the init effect once refs exist (host `fitVerified()` implements the proposeDimensions/verify contract; `isPanelVisible()` reads `visibleRef`). Convert: `initAndConnect` final `fit()` (`:1158`) → `const dims = await reconciler.reconcileOnce("post-init")` **before** `connect()` so the WS URL carries fitted dims (finding #7); if null (hidden at mount), proceed to `connect()` with xterm defaults and rely on the reveal-path reconcile — document this accepted reflow. `ws.onopen` rAF fit (`:879`) → `syncFocusToServer(flush)` then `reconciler.notifySocketOpen(ws)`. Font effect rAF fit (`:1421`) → `request("font-change")` (retain the existing `document.fonts.load`/`fonts.ready` ordering at `:1110`, finding #13). `isActive` effect (`:1461`) → `request("active")`. Window resize/focus, visualViewport, visibilitychange → `request(...)`. DPR listener (`:622-640`) → after `clearTextureAtlas()`, also `request("dpr-change")` (finding #13). ResizeObserver body → `reconciler.observeRect(w, h)` (delete local cache + timeout). Delete `settleAndFit` + module constants (import from T1). Cleanup path calls `reconciler.dispose()`; async init closures capture their own reconciler instance and self-cancel if superseded (finding #6; note current cleanup-before-async-assignment hazard at `:1341`).
- [ ] **Step 3: Desired focus state (finding #3).** Implement the derivation + `syncFocusToServer()` per the Design section, replacing `lastSentFocusStateRef` raw dedupe (`:1194`) and the `ws.onopen` `document.hasFocus()` reconstruction (`:865`). All senders route through it; hidden panel ⇒ never `client_focus`. `refit()` = force-flush current state + `request("refit")` + `scrollToBottom()`.
- [ ] **Step 4: Preserve keyboard focus on activation (finding #8).** The `isActive` path keeps its focus side effect: after the reconcile settles (or immediately if reconcile skipped), call `terminal.focus()` gated by `isActive && visible && !document.hidden && !mobileMode`. Add an activation-before-init test asserting both the post-init resize AND the focus call happen.
- [ ] **Step 5: Run the full terminal test files** (`bun run test:run -- src/components/terminal`). Fix regressions.
- [ ] **Step 6: Commit** (`refactor(terminal): route all resize triggers through ResizeReconciler; panel-aware focus state (remote-dev-ah7q)`).

### Task T3: Thread `visible` through the plugin adapters (finding #2)

**Files:**
- Modify: `src/types/terminal-type.ts:321` area (`visible?: boolean` on `TerminalRenderProps`), `src/components/terminal/TerminalWithKeyboard.tsx` (interface + pass-through `:269`), `src/lib/terminal-plugins/plugins/shell-plugin-client.tsx:34` area, `agent-plugin-client.tsx`, `ssh-plugin-client.tsx` (+ any other `*-plugin-client.tsx` that renders TerminalWithKeyboard — enumerate via `grep -l TerminalWithKeyboard src/lib/terminal-plugins/plugins/`), `loop-agent-plugin-client.tsx` (forward as `parentVisible`), `src/components/session/SessionManager.tsx:2413` (`visible={effectiveActiveView === "terminal"}`), `src/components/loop/LoopChatPane.tsx` (accept `parentVisible?: boolean`; Terminal gets `visible={parentVisible !== false && terminalVisible}`).
- Test: co-located component test (happy-dom) rendering each plugin component with `visible={false}` and asserting the underlying Terminal received it (finding #10 — the adapters' explicit destructuring means a dropped prop still typechecks; only a render test catches it).

**Interfaces:**
- Consumes: `TerminalProps.visible` from T2.
- Produces: `visible?: boolean` across `TerminalRenderProps` → plugin adapters → `TerminalWithKeyboardProps` → Terminal; `LoopChatPaneProps.parentVisible?: boolean`. Omitted ⇒ `true` everywhere (all other call sites unchanged: mobile embed views and `PortAllocationsTab` render unhidden today).

- [ ] **Step 1:** Write the failing propagation tests (one per adapter + the Loop combined-visibility case: `parentVisible=false` must yield `visible=false` even with the drawer open).
- [ ] **Step 2:** Add the prop through the chain; do NOT touch `TerminalTypeRenderer.tsx` (not on the render path — `SessionManager.tsx:86`).
- [ ] **Step 3:** `bun run typecheck` + tests green.
- [ ] **Step 4:** Manual verification (`bun run dev`): chat↔terminal toggle and Loop drawer open/close refit with unchanged container size; window-resize while hidden reconciles on return; a closed Loop drawer no longer sends `client_focus` on window focus.
- [ ] **Step 5: Commit** (`feat(terminal): explicit visible prop through plugin adapters + loop drawer (remote-dev-ah7q)`).

### Task T4: Server convergence — TmuxSizeController, forced reassert, identity-conditional promotion defer

**Files:**
- Create: `src/server/tmux-size-controller.ts`, `src/server/__tests__/tmux-size-controller.test.ts`, `src/server/__tests__/promotion-defer.test.ts`
- Modify: `src/server/terminal.ts` (`:650-706`, `:807`, `:3325-3383`, `:3040`, session-kill cleanup)

**Interfaces:**
- Consumes: nothing from client tasks (independently mergeable).
- Produces: `TmuxSizeController` per Design; module singleton `const tmuxSize = new TmuxSizeController(execTmux, log)`. Promotion/pending logic extracted into exported helpers so `promotion-defer.test.ts` can drive them with fake timers (repo convention: `src/server/__tests__/`).

- [ ] **Step 1: Write failing controller tests:**

```ts
it("RC-H: latest-wins — resize completing after a newer request re-runs with newest size", () => {
  ctl.requestResize("s1", "rdv-s1", 100, 30);
  ctl.requestResize("s1", "rdv-s1", 120, 40);      // arrives while busy
  exec.completeNext();                              // 100×30 done
  expect(exec.calls.at(-1)!.args).toContain("120"); // pump re-ran with latest
  exec.completeNext();
  expect(ctl.getAppliedSize("s1")).toEqual({ cols: 120, rows: 40 });
});
it("finding #1: force bypasses applied-size dedupe — equal-to-applied forced request still execs", () => {
  ctl.requestResize("s1", "rdv-s1", 100, 30); exec.completeNext();
  ctl.requestResize("s1", "rdv-s1", 100, 30);            // non-forced: no-op
  expect(exec.calls).toHaveLength(1);
  ctl.requestResize("s1", "rdv-s1", 100, 30, { force: true }); // focus path
  expect(exec.calls).toHaveLength(2);
});
it("finding #9: clearSession during in-flight exec — stale callback cannot mutate recreated state", () => {
  ctl.requestResize("s1", "rdv-s1", 100, 30);      // in flight
  ctl.clearSession("s1");
  ctl.requestResize("s1", "rdv-s1", 120, 40);      // session recreated
  exec.completeNext();                              // OLD callback fires
  expect(ctl.getAppliedSize("s1")).not.toEqual({ cols: 100, rows: 30 });
});
it("failed exec does not mark size applied (retries on next request)", ...);
```

- [ ] **Step 2: Write failing promotion-defer tests** (fake timers, finding #4): denied→timer fires→promotes only if candidate still mapped + OPEN + visible; denied→blur clears pending (candidate identity match) → timer no-ops; candidate replaced by C, B disconnects → C's pending survives; successful promotion cancels timer; already-primary focus triggers forced reassert.
- [ ] **Step 3: Implement + integrate** per the Design section (forced reassert on all accepted `client_focus` incl. already-primary; controller at all three resize sites; initial-dim clamp small→10×3 / invalid→80×24 with tests for 2×1, 9×2, 10×3; `clearSession` on tmux-kill only).
- [ ] **Step 4:** `bun run test:run -- src/server` + `bun run typecheck`.
- [ ] **Step 5: Commit** (`fix(terminal-server): convergent tmux sizing + deferred promotion (remote-dev-ah7q)`).

### Task T5: End-to-end regression sweep + cleanup

**Files:**
- Modify: `src/components/terminal/Terminal.refit.test.tsx` (final pass), `CHANGELOG.md` (`[Unreleased] > Fixed`)

- [ ] **Step 1:** Full gates: `bun run lint && bun run typecheck && bun run test:run`.
- [ ] **Step 2:** Manual race checklist (each a confirmed RCA interleaving): (a) chat→terminal same-size return; (b) window-resize while in chat view, then return; (c) rapid focus bounce between two browser windows on the same session (<1 s apart) — both converge within ~1.5 s; (d) `tmux attach -t rdv-<id>` from a real terminal at a different size, detach, click the web terminal — tmux re-converges on focus (this is the forced-reassert proof, finding #1); (e) Loop drawer open after background window resize; (f) font-size change while in chat view, then return; (g) closed Loop drawer + window focus → no primary steal (finding #3).
- [ ] **Step 3:** Update CHANGELOG, close checklist on `remote-dev-ah7q`, ship via `/ship`.

---

## Explicitly out of scope (file follow-up bd issues if wanted)

- Passing `visible` from mobile embed views (`EmbeddedSessionView`, `MobileSessionView`) — the native shell already drives lifecycle via `refit()` (rdv-bridge v4), and those views render unhidden.
- Browser-level (Playwright/CDP) automation of the race checklist — the reconciler/controller unit tests cover the interleavings deterministically.
- Reworking the `isActive`-only remount model in SessionManager.
- An actual-tmux-size probe (`display-message #{window_width}`) as an alternative to forced reassert — forced reassert on focus is simpler and idempotent; revisit only if resize-window churn shows up in practice.

## Self-review notes

- Every RCA root cause (RC-A…RC-I) and every Codex v1 review finding (#1-#13) maps to a task; findings #1/#2 (blockers) are closed by T4's `force` + T3's adapter threading respectively.
- Constants defined once in T1, imported by T2.
- T4 is independently deployable before/after T1-T3 (protocol unchanged; the initial-dim clamp is the one documented compat exception); T2 depends on T1; T3 depends on T2.
