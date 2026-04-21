# Phase F — Mobile-Enhanced (New Phone Features, Not Parity)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.6` (depends on `remote-dev-oqol.5`)

**⚠️ Scope note — this is NOT parity work.** The legacy `handleFolderTouchStart/Move/End` handlers at `Sidebar.tsx:629-757` are explicitly gated on `!isMobile` (`Sidebar.tsx:1840`), meaning they ONLY run on tablet/desktop touch, never on phones. Phase F **adds** phone-native drag + swipe-to-close that didn't exist before. Acceptance criteria reflect a new feature, not a preserved one.

**Goal:** Introduce two mobile-native tree interactions:
1. **Long-press touch drag** for groups and projects on phones (new behavior; legacy path was desktop-touch only).
2. **Swipe-reveal close** on session rows — leftward drag reveals a red Close button, commits at -40px. Loosely mirrors the legacy swipe code at `Sidebar.tsx:1224-1289` but that code also ran only on non-mobile.

**Architecture:** Two new hooks:
- `useTreeTouchDrag` — long-press + clone-element + `elementFromPoint` drag. Delegates drop resolution to `useTreeDragDrop` from Phase E. Runs ONLY when `useMobile()` returns true.
- `useSwipeToClose` — tracks per-row swipe state and renders the red reveal.

Mobile detection uses `useMobile()` from `src/hooks/useMobile.ts:35` (verified the canonical hook).

**Exit criteria:** On a mobile phone or emulated mobile, users can long-press a group/project to drag it, and leftward-swipe a session to reveal + commit a Close button. Desktop mouse drag (Phase E) is unaffected.

---

## Task F0: (removed — settled)

Canonical hook is `useMobile()` at `src/hooks/useMobile.ts:35`. Use it directly in F1 and F2; no investigation task needed.

---

## Task F1: useTreeTouchDrag hook (groups + projects)

**Files:**
- Create: `src/components/session/project-tree/useTreeTouchDrag.ts`
- Create: `tests/components/project-tree/useTreeTouchDrag.test.ts`
- Modify: `GroupRow.tsx`, `ProjectRow.tsx` — attach `onTouchStart/Move/End` via prop

Behavior (port from `Sidebar.tsx:629-757`):

1. `touchStart` on group/project row starts a 400ms long-press timer + stores start X/Y + element ref.
2. If `touchMove` detects > 10px movement before the timer fires, cancel the long-press.
3. When timer fires, call `useTreeDragDrop.startDrag(...)`, create a visual clone (absolute positioned, `opacity: 0.8`, `z-index: 1000`), dim the original to `opacity: 0.5`, haptic via `navigator.vibrate?.(50)`.
4. Subsequent `touchMove`s update the clone's position and call `document.elementFromPoint(x, y)` to locate the drop target. If the target is a `[data-node-id]` element, call `useTreeDragDrop.dragOver(...)`.
5. `touchEnd` calls `useTreeDragDrop.drop(...)`, removes the clone, restores original opacity.
6. Gated: the hook only activates when `isMobile` is true; on desktop touch it's a no-op (desktop drag uses mouse events from Phase E).

Rows need `data-node-type` and `data-node-id` attributes to be discoverable via `elementFromPoint`.

- [ ] **Step 1: Unit tests using fireEvent.touch\***

```ts
it("starts drag after 400ms long-press", async () => {
  vi.useFakeTimers();
  const startDrag = vi.fn();
  const { result } = renderHook(() => useTreeTouchDrag({ startDrag, ...stubs }));
  const el = document.createElement("div");
  act(() => result.current.handleTouchStart({ touches: [{ clientX: 10, clientY: 10 }] } as any, "group", "g1", null));
  await act(async () => { vi.advanceTimersByTime(410); });
  expect(startDrag).toHaveBeenCalledWith("group", "g1", null);
});

it("cancels long-press if touch moves > 10px before timer fires", async () => {
  vi.useFakeTimers();
  const startDrag = vi.fn();
  const { result } = renderHook(() => useTreeTouchDrag({ startDrag, ...stubs }));
  act(() => result.current.handleTouchStart({ touches: [{ clientX: 10, clientY: 10 }] } as any, "group", "g1", null));
  act(() => result.current.handleTouchMove({ touches: [{ clientX: 30, clientY: 10 }] } as any));
  await act(async () => { vi.advanceTimersByTime(410); });
  expect(startDrag).not.toHaveBeenCalled();
});
```

- [ ] **Step 2–4: implement, pass.**

- [ ] **Step 5: Integrate into rows** — add `onTouchStart/Move/End` props, add `data-node-type` / `data-node-id` attributes.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(project-tree): mobile long-press touch drag for groups + projects"
```

---

## Task F2: useSwipeToClose hook for sessions

**Files:**
- Create: `src/components/session/project-tree/useSwipeToClose.ts`
- Create: `tests/components/project-tree/useSwipeToClose.test.ts`
- Modify: `SessionRow.tsx` — attach touch handlers, render the red reveal button behind the row

Behavior (port from `Sidebar.tsx:1175-1289`):

1. `touchStart` on a session row stores start X/Y + element ref + `isHorizontal: null`.
2. First `touchMove` with > 10px movement decides `isHorizontal = abs(dx) > abs(dy)`.
3. If horizontal and leftward (`dx < 0`), apply `transform: translateX(dx)` clamped to `[-80, 0]`. Block vertical scroll with `touchAction: "pan-y"` (already present on row).
4. `touchEnd`: if `dx <= -40` → commit (set swipedSessionId; show reveal). Otherwise, animate back (200ms ease-out).
5. When `swipedSessionId` is set and user taps the red Trash2 button behind the row, call `onClose(sid)` and clear `swipedSessionId`.
6. Tapping elsewhere or scrolling clears `swipedSessionId`.
7. If session has active schedules, disable swipe (to prevent accidental close).

Rows in swipe state render a hidden-behind-row button:

```tsx
{swipedSessionId === session.id && scheduleCount === 0 && (
  <button className="absolute right-0 top-0 bottom-0 w-[72px] bg-destructive text-destructive-foreground flex items-center justify-center" onClick={onClose}>
    <Trash2 />
  </button>
)}
```

- [ ] **Step 1: Failing tests**

```tsx
it("reveals close button after swipe >= 40px leftward", () => {
  const { result } = renderHook(() => useSwipeToClose({ ...stubs }));
  // simulate touchStart then touchMove with dx = -50
  // expect result.current.swipedSessionId === "s1"
});

it("does not reveal for swipe < 40px", () => { /* ... */ });
it("does not reveal when scheduleCount > 0", () => { /* ... */ });
it("clears reveal on tap elsewhere", () => { /* ... */ });
```

- [ ] **Step 2–4: implement, pass, commit**

```bash
git commit -m "feat(project-tree): swipe-to-close on mobile session rows"
```

---

## Acceptance Criteria

- [ ] Phase F tests pass (>= 8 new tests)
- [ ] `typecheck` + `lint` clean
- [ ] Manual on mobile device or Chrome DevTools mobile emulation:
  - Long-press a group → drag it → drop on another group → it moves
  - Long-press a project → drag onto another group → it moves
  - Swipe a session row left → red button reveals; tap → session closes
  - Swipe a session with active schedules → no swipe effect (protected)
- [ ] Desktop mouse drag (Phase E) still works unchanged

## Risks / Open Questions

- **`elementFromPoint` in happy-dom:** `document.elementFromPoint` exists but happy-dom doesn't compute layout, so it returns nothing useful in unit tests. **Required design:** the hook must accept an injectable `resolveDropTarget(x, y)` resolver; default implementation calls `document.elementFromPoint` in production, tests pass a mock. This is not optional — don't try to mock `elementFromPoint` globally.
- **Haptic API coverage:** `navigator.vibrate` not available on iOS Safari. Keep it optional-chained.
- **Scroll interference:** mobile sidebar is scrollable vertically. Horizontal swipe must not hijack vertical scroll — the `pan-y` touch-action class plus the "decide axis on first move > 10px" logic protect against this.
