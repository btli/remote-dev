# Phase C — Interactions (Selection, Editing, Keyboard, Inline Create)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.3` (depends on `remote-dev-oqol.2`)

**Goal:** Add keyboard selection, inline rename, and inline create to the new row components. No drag/drop and no context menus (those are Phases D–E).

**Architecture:** Rename state lives in `ProjectTreeSidebar` (single source of truth for "which row is being edited"). Rows receive `isEditing` plus `onStartEdit` / `onSaveEdit` / `onCancelEdit` callbacks. Create state (`creatingUnder: { parentGroupId: string; type: "group" | "project" } | null`) also lives in `ProjectTreeSidebar`.

**Exit criteria:** Clicking a row selects it. Enter/Space on a focused row selects. Double-click name enters rename mode; Enter saves, Escape cancels. Inline "+" affordance on groups lets users create a new subgroup or project.

---

## Task C1: Keyboard selection

**Why:** Legacy rows had `role="button"` + `tabIndex` + `onKeyDown` for Enter/Space. Add to new rows.

**Files:**
- Modify: `src/components/session/project-tree/GroupRow.tsx`
- Modify: `src/components/session/project-tree/ProjectRow.tsx`
- Modify: `src/components/session/project-tree/SessionRow.tsx`
- Modify: all three `*.test.tsx` files

- [ ] **Step 1: Add failing tests (one per row)**

```tsx
// GroupRow.test.tsx (new test)
it("fires onSelect when Enter is pressed on the focused row", () => {
  const onSelect = vi.fn();
  render(<GroupRow {...baseProps} onSelect={onSelect} />);
  const row = screen.getByRole("button", { name: /Workspace/i });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledOnce();
});

it("fires onSelect when Space is pressed", () => {
  const onSelect = vi.fn();
  render(<GroupRow {...baseProps} onSelect={onSelect} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /Workspace/i }), { key: " " });
  expect(onSelect).toHaveBeenCalledOnce();
});
```

Mirror for `ProjectRow` and `SessionRow`.

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement**

Add on each row's outermost clickable div:

```tsx
role="button"
tabIndex={isEditing ? -1 : 0}
aria-label={entity.name}
onKeyDown={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onSelect();
  }
}}
```

- [ ] **Step 4: Run pass.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(project-tree): keyboard selection (Enter/Space) on tree rows"
```

---

## Task C2: Inline rename for groups

**Files:**
- Modify: `GroupRow.tsx` — render `<input>` when `isEditing`
- Modify: `ProjectTreeSidebar.tsx` — manage `editingNode` state, wire `onStartEdit`, `onSaveEdit(name)`, `onCancelEdit`
- Modify: `GroupRow.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
it("renders an input in place of the name when isEditing", () => {
  render(<GroupRow {...baseProps} isEditing editValue="Workspace" />);
  expect(screen.getByRole("textbox")).toHaveValue("Workspace");
});

it("calls onSaveEdit(value) on Enter", () => {
  const onSaveEdit = vi.fn();
  render(<GroupRow {...baseProps} isEditing editValue="Workspace" onSaveEdit={onSaveEdit} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Renamed" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSaveEdit).toHaveBeenCalledWith("Renamed");
});

it("calls onCancelEdit on Escape", () => {
  const onCancelEdit = vi.fn();
  render(<GroupRow {...baseProps} isEditing onCancelEdit={onCancelEdit} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(onCancelEdit).toHaveBeenCalled();
});

it("fires onStartEdit on double-click of the name", () => {
  const onStartEdit = vi.fn();
  render(<GroupRow {...baseProps} onStartEdit={onStartEdit} />);
  fireEvent.doubleClick(screen.getByText("Workspace"));
  expect(onStartEdit).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement**

Extend props:

```ts
interface GroupRowProps {
  // ...existing
  isEditing: boolean;
  editValue?: string;
  onStartEdit?: () => void;
  onSaveEdit?: (value: string) => void;
  onCancelEdit?: () => void;
}
```

Implement:

```tsx
const [local, setLocal] = useState(editValue ?? group.name);
useEffect(() => { if (isEditing) setLocal(editValue ?? group.name); }, [isEditing, editValue, group.name]);

// in render:
{isEditing ? (
  <input
    autoFocus
    value={local}
    onChange={(e) => setLocal(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); onSaveEdit?.(local.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); onCancelEdit?.(); }
    }}
    onBlur={() => {
      const trimmed = local.trim();
      if (trimmed && trimmed !== group.name) onSaveEdit?.(trimmed);
      else onCancelEdit?.();
    }}
    className="bg-input border border-primary/50 rounded px-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
  />
) : (
  <span onDoubleClick={() => onStartEdit?.()} className="truncate text-sm">{group.name}</span>
)}
```

- [ ] **Step 4: Run pass.**

- [ ] **Step 5: Wire `ProjectTreeSidebar`**

Add state:

```tsx
const [editingNode, setEditingNode] = useState<{ id: string; type: "group" | "project" | "session" } | null>(null);
```

Pass to rows:

```tsx
isEditing={editingNode?.id === g.id && editingNode?.type === "group"}
onStartEdit={() => setEditingNode({ id: g.id, type: "group" })}
onSaveEdit={async (name) => {
  await tree.updateGroup({ id: g.id, name });
  setEditingNode(null);
}}
onCancelEdit={() => setEditingNode(null)}
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(project-tree): inline rename for groups"
```

---

## Task C3: Inline rename for projects

Mirror C2 against `ProjectRow` + `updateProject({ id, name })`. Same props, same tests.

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): inline rename for projects"
```

---

## Task C4: Inline rename for sessions

Sessions don't have a tree-context update; `onSaveEdit` bubbles up through `ProjectTreeSidebar` → `Sidebar.tsx` → existing `onSessionRename(sessionId, newName)` handler (which already exists as `onSessionRename` or similar — verify in `SessionManager.tsx`).

- [ ] **Investigate first** — grep for how the legacy code calls rename:

```bash
grep -n "onSessionRename\|handleSaveEdit" src/components/session/Sidebar.tsx src/components/session/SessionManager.tsx
```

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): inline rename for sessions"
```

---

## Task C5: Inline create (subgroup + project)

**Files:**
- Create: `src/components/session/project-tree/CreateNodeInline.tsx`
- Create: `tests/components/project-tree/CreateNodeInline.test.tsx`
- Modify: `ProjectTreeSidebar.tsx` — manage `creating` state

Component:

```tsx
interface CreateNodeInlineProps {
  depth: number;
  kind: "group" | "project";
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}
```

Behavior: autofocused text input, Enter submits (trim, reject empty), Escape cancels, blur with empty cancels, blur with value submits.

- [ ] **Step 1: Failing tests**

```tsx
it("renders a text input autofocused", () => {
  render(<CreateNodeInline depth={0} kind="group" onSubmit={async () => {}} onCancel={() => {}} />);
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
});

it("calls onSubmit with trimmed value on Enter", async () => {
  const onSubmit = vi.fn();
  render(<CreateNodeInline depth={0} kind="project" onSubmit={onSubmit} onCancel={() => {}} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "  new-proj  " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledWith("new-proj");
});

it("does not submit empty name on Enter", () => {
  const onSubmit = vi.fn();
  render(<CreateNodeInline depth={0} kind="group" onSubmit={onSubmit} onCancel={() => {}} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
});

it("cancels on Escape", () => {
  const onCancel = vi.fn();
  render(<CreateNodeInline depth={0} kind="group" onSubmit={async () => {}} onCancel={onCancel} />);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2–4: implement, pass.**

- [ ] **Step 5: Wire into ProjectTreeSidebar**

Add state:

```tsx
const [creating, setCreating] = useState<{ parentGroupId: string | null; kind: "group" | "project" } | null>(null);
```

Render `CreateNodeInline` inside the appropriate subtree when `creating.parentGroupId` matches. Invocation hooks are added in Phase D (context menu items), but expose the state so Phase D can set it.

For now, add a keyboard shortcut or a temporary "+" button on group hover to exercise the path during testing.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(project-tree): inline create for subgroup + project"
```

---

## Acceptance Criteria

- [ ] `bun run test:run` all new tests green
- [ ] `bun run typecheck` clean
- [ ] Manual smoke: double-click a group name → rename it inline; Enter persists; page reload retains new name
- [ ] Same smoke for project and session
- [ ] Inline create works (via temporary affordance until Phase D hooks it to context menu)

## Risks / Open Questions

- **Session rename endpoint:** verify in C4 that a session-rename handler exists; if not, file a follow-up to add `PATCH /api/sessions/:id { name }`.
- **Optimistic updates:** inline rename currently awaits the API round-trip. For smoother UX, switch to optimistic updates (update local state immediately, roll back on error). Defer — not in Phase C scope.
