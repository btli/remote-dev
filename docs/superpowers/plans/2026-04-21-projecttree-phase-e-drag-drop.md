# Phase E — Drag and Drop (Mouse)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.5` (depends on `remote-dev-oqol.4`)

**Goal:** Port mouse-driven drag and drop from `Sidebar.tsx:574-1068` into the new tree. Support three drag types: sessions (reorder within project / move cross-project), projects (reorder within group / move cross-group), and groups (reorder between siblings / nest with cycle check). Show visual indicators for each drop mode.

**Architecture:** One shared hook (`useTreeDragDrop`) owns all drag state (what's dragging, what's the drop target, what mode). Rows attach `onDragStart/Over/Leave/Drop` attributes via props from the hook. `ProjectTreeSidebar` instantiates the hook. Drop indicators are purely styling decisions driven by the hook's state.

**Exit criteria:** All three drag types work. Cycle rejection verified by unit test. Drop indicators render correctly. No regressions in existing session / project / group CRUD.

---

## Task E0 (prereq): Verify `sortOrder` API for groups + projects

Group-drag reorder needs to persist a new sort order. Check that the backend accepts it:

```bash
grep -n "sortOrder" src/app/api/groups/[id]/route.ts src/app/api/projects/[id]/route.ts src/services/group-service.ts src/services/project-service.ts
```

- If `PATCH /api/groups/:id` and `PATCH /api/projects/:id` already accept `sortOrder`, no backend work.
- If not, add `sortOrder?: number` to the request schema + service method + drizzle update.

Also verify `updateGroup`/`updateProject` in `ProjectTreeContext.tsx` forward a `sortOrder` field:

```bash
grep -n "sortOrder" src/contexts/ProjectTreeContext.tsx
```

Fix in this task if needed. TDD with a test that mocks `fetch` and asserts `PATCH /api/groups/g1` body includes `sortOrder: 2`.

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): accept sortOrder in updateGroup/updateProject for drag reorder"
```

---

## Task E1: useTreeDragDrop hook skeleton

**Files:**
- Create: `src/components/session/project-tree/useTreeDragDrop.ts`
- Create: `tests/components/project-tree/useTreeDragDrop.test.ts`

Exported shape:

```ts
interface DragState {
  type: "session" | "project" | "group";
  id: string;
  sourceParentId: string | null; // projectId for session, groupId for project, parentGroupId for group
}

interface DropIndicator {
  position: "before" | "after" | "nest";
  targetId: string;
}

interface UseTreeDragDrop {
  drag: DragState | null;
  indicator: DropIndicator | null;
  startDrag(type: DragState["type"], id: string, sourceParentId: string | null): void;
  dragOver(targetType: "session" | "project" | "group", targetId: string, clientY: number, rect: DOMRect, extra?: Record<string, unknown>): void;
  drop(targetType: "session" | "project" | "group", targetId: string): Promise<void>;
  cancel(): void;
}
```

Inputs to the hook (from ProjectTreeSidebar):

```ts
useTreeDragDrop({
  groups: GroupNode[];
  projects: ProjectNode[];
  activeSessions: MinimalSession[];
  onSessionMove: (sid: string, projectId: string | null) => Promise<void>;
  onSessionReorder: (fullOrder: string[]) => Promise<void>;
  moveProject: (input: { id: string; newGroupId: string }) => Promise<void>;
  updateProjectSortOrder: (id: string, sortOrder: number) => Promise<void>;
  moveGroup: (input: { id: string; newParentGroupId: string | null }) => Promise<void>;
  updateGroupSortOrder: (id: string, sortOrder: number) => Promise<void>;
  collectDescendantGroupIds: (rootId: string) => Set<string>;
})
```

- [ ] **Step 1: Unit tests for cycle detection**

```ts
it("startDrag + dragOver into descendant sets no indicator (cycle blocked)", () => {
  const { result } = renderHook(() => useTreeDragDrop({ ...stubs, collectDescendantGroupIds: (id) => id === "g1" ? new Set(["g1","g2","g3"]) : new Set([id]) }));
  act(() => result.current.startDrag("group", "g1", null));
  act(() => result.current.dragOver("group", "g3", 10, { top: 0, height: 40 } as DOMRect));
  expect(result.current.indicator).toBeNull();
});
```

Plus tests for: within-range middle = nest; top 25% = before; bottom 25% = after.

- [ ] **Step 2: Implement the hook** — port position-detection logic from `Sidebar.tsx:795-852`.

- [ ] **Step 3: Run pass.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(project-tree): add useTreeDragDrop hook with cycle detection"
```

---

## Task E2: Session drag

**Files:**
- Modify: `SessionRow.tsx` — accept `draggable`, `onDragStart/End/Over/Leave/Drop` via a `dragHandlers` prop
- Modify: `ProjectTreeSidebar.tsx` — pass handlers from `useTreeDragDrop` to `SessionRow`

Rules:
- Start: `dataTransfer.setData("type", "session"); setData("id", sessionId)`
- Drop on different-project session or on a project row: move (`onSessionMove(sid, projectId)`)
- Drop on same-project session: reorder — rebuild the pinned/unpinned ordering correctly
- Drops across pin partitions: no-op

- [ ] **Step 1: Integration test**

```tsx
it("drag session s1 onto s2 within same project fires reorder with correct order", async () => {
  // setup: two sessions s1, s2 under p1, both unpinned
  // fireEvent.dragStart(s1), fireEvent.dragOver(s2, {clientY: top-of-s2-bottom-half}), fireEvent.drop(s2)
  // expect: onSessionReorder called with ["s2","s1"] (s1 moved after s2)
});

it("drag session s1 onto project p2 moves it cross-project", async () => {
  // fireEvent.drop on p2 row
  // expect: onSessionMove("s1","p2")
});
```

- [ ] **Step 2–4: implement, pass, commit**

```bash
git commit -m "feat(project-tree): session drag for reorder within project + move cross-project"
```

---

## Task E3: Project drag

Rules:
- Start: `dataTransfer "type" = "project"`
- Drop on another project in same group + top/bottom 25% → reorder (rebuild sortOrder sequence, call `updateProjectSortOrder` for affected projects)
- Drop on another group → move (`moveProject({ id, newGroupId })`)
- Drop on root area → no-op (projects must live in a group)

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): project drag for reorder + move-cross-group"
```

---

## Task E4: Group drag (reorder + nest + cycle check)

Rules:
- Start: `type = "group"`
- Target group + top/bottom 25% → reorder among siblings (must share `parentGroupId`)
- Target group + middle 50% → nest (`moveGroup({ newParentGroupId: targetId })`)
- Cycle check: nest blocked if `collectDescendantGroupIds(draggingId).has(targetId)`
- Drop on root area (whitespace) → move to root (`moveGroup({ newParentGroupId: null })`)

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): group drag for reorder + nest with cycle check"
```

---

## Task E5: Drop indicators

Render the three indicator styles:
- **Before:** `<div class="absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full" />` above the row when `indicator.position==="before" && indicator.targetId===row.id`
- **After:** same, `-bottom-0.5`
- **Nest:** apply `bg-primary/20 border border-primary/30` to the row background when `indicator.position==="nest" && indicator.targetId===row.id`

Affected rows: `GroupRow`, `ProjectRow`, `SessionRow` — each receives `indicator` prop (or derived booleans).

- [ ] **TDD loop** — snapshot or explicit querySelector tests that indicators render when expected

```bash
git commit -m "feat(project-tree): drop indicators for reorder + nest"
```

---

## Acceptance Criteria

- [ ] Unit tests for `useTreeDragDrop` pass (cycle, position detection, no-op cases)
- [ ] Integration tests for all three drag types pass
- [ ] Drop indicators render
- [ ] `typecheck` + `lint` clean
- [ ] Manual: drag session within/cross project; drag project within/cross group; drag group reorder + nest + cycle-rejection all behave
- [ ] Deleting the drag source or target during drag does not crash (graceful cancel)

## Risks / Open Questions

- **Reorder algorithm correctness for sortOrder:** rebuilding full sort sequence vs. patching one record. Chosen: patch only affected records. If two clients reorder concurrently, last-write-wins is acceptable for this UI.
- **Virtualized lists:** not used today; when the tree grows large, drag may become sluggish. Not a Phase E concern.
- **`dataTransfer` in happy-dom:** happy-dom's `DataTransfer` implementation is partial. Some tests may need `fireEvent.drop` with explicit `dataTransfer` mock. Verify early; if blocked, add a follow-up bd issue to switch to Playwright for drag tests.
