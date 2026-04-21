# Phase D — Context Menus (Group / Project / Session)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.4` (depends on `remote-dev-oqol.2`)

**Goal:** Wrap each new row component with shadcn/ui `ContextMenu` and implement group-, project-, and session-specific menu items matching the legacy folder/session menus in `Sidebar.tsx:1977-2108` and `Sidebar.tsx:1417-1482`.

**Architecture:** One menu component per row type under `src/components/session/project-tree/`. Menu items receive all handlers as props; `ProjectTreeSidebar` owns the handler wiring (some handlers proxy to `Sidebar.tsx` via props, some call `ProjectTreeContext` directly). Phase D also wires the "hasCustomPrefs" / "hasActiveSecrets" / "hasLinkedRepo" badges that were hard-coded false in Phase B.

**Exit criteria:** Right-click any row shows the correct menu. Each item invokes the correct handler. Conditional items (e.g., "New Worktree" disabled without repo, "Move to Root" hidden at root) behave correctly.

---

## ⚠️ Backing-store key shim (MUST read before D1–D5)

**The blocker codex flagged:** all existing downstream state for prefs, secrets, repo bindings, and open-in-OS is still keyed by **folder id**, not project id. Concretely (verified against the repo):

- `src/contexts/PreferencesContext.tsx:135-140` — `activeFolderId`, `getFolderPreferences(folderId)`
- `src/contexts/SecretsContext.tsx:28-39` — `folderConfigs: Map<folderId, …>`
- `src/components/session/SessionManager.tsx:898-946` — `onFolderNewSession`, `onFolderOpenRepo` etc. all take `folderId`
- `src/app/api/secrets/folders/[folderId]/...` — secrets routes are folder-keyed
- `src/app/api/profiles/folders/[folderId]/...` — profile routes are folder-keyed
- Legacy open-in-OS call: `POST /api/folders/${folderId}/open` (`Sidebar.tsx:547`). No `/api/projects/:id/open` route exists.

**`ProjectNode` already carries `legacyFolderId?: string | null`** (`ProjectTreeContext.tsx:34`) specifically for this bridging phase.

**Rules for every menu item in Phases D1–D3:**

1. Any handler that reads or writes folder-scoped state (prefs, secrets, repo binding, open-in-OS) MUST resolve through `project.legacyFolderId`. If `legacyFolderId` is nullish, the handler SHOULD be hidden or disabled with a tooltip explaining that the project has no folder bridge yet.
2. Handlers that only talk to new project/group APIs (`createGroup`, `moveProject`, `deleteGroup`, `updateGroup({ name })`, etc.) route by project/group id directly — no shim needed.
3. `GroupContextMenu` has no folder shim: groups never had folder-scoped state.
4. All hasX predicates (`hasCustomPrefs`, `hasActiveSecrets`, `hasLinkedRepo`) must look up by `legacyFolderId`, not `project.id`, for the duration of Phase D.

**Follow-up issue to file before starting D1** (add to bd as `remote-dev-oqol.4.1`): "Migrate Preferences/Secrets/Repo/open-in-OS backing stores to node-aware keying (groupId | projectId) so `legacyFolderId` can be removed." This is out of Phase D scope but must be tracked.

---

## Task D1: GroupContextMenu

Menu items (see parent-plan Decision D4):

1. New Project — `onCreateProject(groupId)`
2. New Subgroup — `onCreateSubgroup(groupId)`
3. — separator —
4. Preferences — `onOpenPreferences` (with "Custom" badge if `hasCustomPrefs`)
5. Rename — `onStartEdit`
6. Move to Root — `onMoveToRoot` (hidden when `parentGroupId === null`)
7. — separator —
8. Delete — `onDelete` (red, `text-destructive focus:text-destructive`)

**Files:**
- Create: `src/components/session/project-tree/GroupContextMenu.tsx`
- Create: `tests/components/project-tree/GroupContextMenu.test.tsx`

- [ ] **Step 1: Failing tests (one per menu item)**

Exemplars (add similar for each item):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroupContextMenu } from "@/components/session/project-tree/GroupContextMenu";

const group = { id: "g1", name: "Workspace", parentGroupId: "parent", collapsed: false, sortOrder: 0 };

function renderMenuOpen(extraProps: any = {}) {
  return render(
    <GroupContextMenu
      group={group}
      hasCustomPrefs={false}
      onCreateProject={vi.fn()}
      onCreateSubgroup={vi.fn()}
      onOpenPreferences={vi.fn()}
      onStartEdit={vi.fn()}
      onMoveToRoot={vi.fn()}
      onDelete={vi.fn()}
      {...extraProps}
    >
      <button>trigger</button>
    </GroupContextMenu>
  );
}

it("shows all base items when opened", () => {
  renderMenuOpen();
  fireEvent.contextMenu(screen.getByText("trigger"));
  expect(screen.getByText("New Project")).toBeInTheDocument();
  expect(screen.getByText("New Subgroup")).toBeInTheDocument();
  expect(screen.getByText("Preferences")).toBeInTheDocument();
  expect(screen.getByText("Rename")).toBeInTheDocument();
  expect(screen.getByText("Move to Root")).toBeInTheDocument();
  expect(screen.getByText("Delete")).toBeInTheDocument();
});

it("hides Move to Root when group is already at root", () => {
  renderMenuOpen({ group: { ...group, parentGroupId: null } });
  fireEvent.contextMenu(screen.getByText("trigger"));
  expect(screen.queryByText("Move to Root")).not.toBeInTheDocument();
});

it("shows the Custom badge next to Preferences when hasCustomPrefs", () => {
  renderMenuOpen({ hasCustomPrefs: true });
  fireEvent.contextMenu(screen.getByText("trigger"));
  // badge lives next to "Preferences"
  expect(screen.getByText("Custom")).toBeInTheDocument();
});

it("calls onDelete when Delete item is clicked", () => {
  const onDelete = vi.fn();
  renderMenuOpen({ onDelete });
  fireEvent.contextMenu(screen.getByText("trigger"));
  fireEvent.click(screen.getByText("Delete"));
  expect(onDelete).toHaveBeenCalledOnce();
});
```

Full test set: 8 items × (presence + fires handler) = 16 tests minimum, plus conditional hide/badge tests.

- [ ] **Step 2: Run fail (module not found).**

- [ ] **Step 3: Implement**

```tsx
// src/components/session/project-tree/GroupContextMenu.tsx
"use client";
import { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Folder, FolderOpen, Pencil, Settings, Briefcase, Trash2 } from "lucide-react";
import type { GroupNode } from "@/contexts/ProjectTreeContext";

interface Props {
  group: GroupNode;
  hasCustomPrefs: boolean;
  onCreateProject: () => void;
  onCreateSubgroup: () => void;
  onOpenPreferences: () => void;
  onStartEdit: () => void;
  onMoveToRoot: () => void;
  onDelete: () => void;
  children: ReactNode;
}

export function GroupContextMenu(props: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={props.onCreateProject}>
          <Briefcase className="mr-2 h-4 w-4" /> New Project
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onCreateSubgroup}>
          <Folder className="mr-2 h-4 w-4" /> New Subgroup
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={props.onOpenPreferences}>
          <Settings className="mr-2 h-4 w-4" />
          Preferences
          {props.hasCustomPrefs && <span className="ml-auto text-[10px] text-primary">Custom</span>}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onStartEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Rename
        </ContextMenuItem>
        {props.group.parentGroupId !== null && (
          <ContextMenuItem onClick={props.onMoveToRoot}>
            <FolderOpen className="mr-2 h-4 w-4" /> Move to Root
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={props.onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

- [ ] **Step 4: Run pass.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(project-tree): GroupContextMenu with rename/move/delete/create"
```

---

## Task D2: ProjectContextMenu

Menu items (14 — see parent-plan Decision D5):

1. New Terminal — `onNewTerminal`
2. New Agent — `onNewAgent`
3. Resume — `onResume`
4. Advanced… — `onAdvanced`
5. New Worktree — `onNewWorktree` (disabled when `!hasLinkedRepo`)
6. — separator —
7. Preferences — `onOpenPreferences` (Custom badge if `hasCustomPrefs`)
8. Secrets — `onOpenSecrets` (Active badge if `hasActiveSecrets`)
9. Repository — `onOpenRepository` (Linked badge if `hasLinkedRepo`)
10. Open Folder — `onOpenFolderInOS` (only if `hasWorkingDirectory` AND `project.legacyFolderId != null`)
11. View Issues — `onViewIssues` (only if `onViewIssues` provided AND `hasLinkedRepo`)
12. View PRs — `onViewPRs` (same guard)
13. Rename — `onStartEdit`
14. — separator —
15. Delete — `onDelete` (red)

**Files:**
- Create: `src/components/session/project-tree/ProjectContextMenu.tsx`
- Create: `tests/components/project-tree/ProjectContextMenu.test.tsx`

- [ ] **TDD loop** — expected ~28 tests (14 items × presence + callback, plus 5 conditional-hide/disable tests).

- [ ] **Commit**

```bash
git commit -m "feat(project-tree): ProjectContextMenu with repo/secrets/worktree items"
```

---

## Task D3: SessionContextMenu

Menu items (port from `Sidebar.tsx:1417-1482`):

1. Rename — `onStartEdit`
2. Pin Session / Unpin Session — `onTogglePin` (label + icon conditional)
3. Move to Project — submenu:
   - Remove from Project (only if currently in one)
   - Each project listed (disabled if current)
4. Schedule Command — `onSchedule` (only if `onSchedule` provided)
5. — separator —
6. Close Session — `onClose` (red)

**Files:**
- Create: `src/components/session/project-tree/SessionContextMenu.tsx`
- Create: `tests/components/project-tree/SessionContextMenu.test.tsx`

- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): SessionContextMenu with pin/move/schedule/close"
```

---

## Task D4: Wire menus into rows and sidebar

**Files:**
- Modify: `GroupRow.tsx`, `ProjectRow.tsx`, `SessionRow.tsx` — wrap outermost element with the matching ContextMenu component
- Modify: `ProjectTreeSidebar.tsx` — own all handlers, compute predicates

Handler ownership map:

| Handler | Owner | Source |
|---------|-------|--------|
| `onCreateProject(groupId)` | ProjectTreeSidebar | Calls `tree.createProject({ groupId, name })` via `CreateNodeInline` |
| `onCreateSubgroup(parentId)` | ProjectTreeSidebar | Calls `tree.createGroup({ parentGroupId: parentId, name })` via `CreateNodeInline` |
| `onOpenPreferences(node)` | Sidebar.tsx prop | Already plumbed |
| `onStartEdit` | ProjectTreeSidebar | Sets `editingNode` state |
| `onMoveToRoot(groupId)` | ProjectTreeSidebar | `tree.moveGroup({ id, newParentGroupId: null })` |
| `onDelete(groupId)` | ProjectTreeSidebar | `tree.deleteGroup(id, /* force prompt */)` — adds a confirm dialog |
| `onNewTerminal/Agent/Worktree/Advanced/Resume(projectId)` | Sidebar.tsx prop | Proxied through existing `onFolderNewSession`/etc. handlers — renamed to `onProjectNewSession`/etc. in this task |
| `onOpenSecrets(projectId)` | Sidebar.tsx prop | Opens SecretsConfigModal |
| `onOpenFolderInOS(project)` | ProjectTreeSidebar | Resolves to `project.legacyFolderId`, then POSTs to `/api/folders/${legacyFolderId}/open` (verified existing call site: `Sidebar.tsx:547`). The `/api/projects/:id/open` variant does NOT exist. Hidden when `legacyFolderId` is null. Filed as follow-up `remote-dev-oqol.4.1`. |
| `onViewIssues/PRs(projectId)` | Sidebar.tsx prop | Already present |
| `onSessionTogglePin(id)` | Sidebar.tsx prop | Existing `onSessionTogglePin` |
| `onSessionMove(sid, projectId\|null)` | Sidebar.tsx prop | Existing `onSessionMove` |
| `onSessionSchedule(sid)` | Sidebar.tsx prop | Existing `onSessionSchedule` |

Predicates computed inside `ProjectTreeSidebar` from existing contexts:

```ts
const hasCustomPrefs = (projectId: string) => getFolderPreferences(projectId) != null; // or a stricter check
const hasLinkedRepo = (projectId: string) => getFolderPreferences(projectId)?.githubRepoId != null;
const hasActiveSecrets = (projectId: string) => folderConfigs.get(projectId)?.enabled ?? false;
const hasWorkingDirectory = (projectId: string) => getFolderPreferences(projectId)?.defaultWorkingDirectory != null;
```

- [ ] **Step 1: Write integration tests**

```tsx
// tests/components/project-tree/ProjectTreeSidebar.context-menu.test.tsx
it("right-click on project opens project menu with all items", () => { /* ... */ });
it("clicking 'Delete' on a group calls deleteGroup", () => { /* ... */ });
it("clicking 'New Worktree' is disabled for projects without a linked repo", () => { /* ... */ });
```

- [ ] **Step 2: Implement** — wrap rows, add handlers, compute predicates. Update legacy handler prop names from `onFolder*` to `onProject*` (add both names with deprecation doc comment during transition).

- [ ] **Step 3: Verify typecheck + tests + lint.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(project-tree): wire context menus into rows with full handler set"
```

---

## Task D5: Delete confirmation for groups + projects

Legacy behavior: `onFolderDelete` invoked a confirm dialog somewhere (investigate — likely in `SessionManager.tsx`). Preserve this behavior.

**Files:**
- Modify: `ProjectTreeSidebar.tsx` — wrap `tree.deleteGroup`/`tree.deleteProject` with a confirmation prompt (reuse existing `ConfirmDialog` component if present)

- [ ] **Investigate**: `grep -n 'ConfirmDialog\|window.confirm\|onFolderDelete' src/components/session/`
- [ ] **TDD loop + commit**

```bash
git commit -m "feat(project-tree): confirm before group/project delete"
```

---

## Acceptance Criteria

- [ ] All context menu tests pass (~50 tests total across 3 menus + integration)
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] Manual: right-click each row type, verify every menu item works end-to-end in dev server
- [ ] Conditional items (move-to-root, new-worktree disabled, view-prs/issues) follow the rules
- [ ] Delete triggers confirmation

## Risks / Open Questions

- **Backend for project open-in-OS:** `/api/projects/:id/open` does not exist; `/api/folders/:id/open` is the live endpoint (see `Sidebar.tsx:547`). Phase D uses the folder-id bridge via `project.legacyFolderId`. Backend parity is tracked by the follow-up `remote-dev-oqol.4.1`.
- **Schedule context import:** still hard-coded 0 in SessionRow at end of Phase B; Phase D should wire `useScheduleContext()` in `ProjectTreeSidebar` and pass `scheduleCount` as prop. Include in D4.
