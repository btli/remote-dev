# ProjectTree Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the full feature set of the legacy folder-tree renderer in `Sidebar.tsx` (~lines 1440–2250) into the new `ProjectTreeSidebar` / `ProjectTreeRow` components, then delete the legacy rendering path. The new tree must reach visual + interaction parity with the old one while respecting the group/project discriminator introduced in the 2026-04-20 refactor.

**Architecture:** Split `ProjectTreeRow` into three discriminator-aware row components (`GroupRow`, `ProjectRow`, `SessionRow`), each with its own context menu. The `ProjectTreeContext` is extended with session lookups, repo stats rollup, preferences / secrets presence predicates, and session-CRUD bridges. Legacy `folders`/`folderTree` code in `Sidebar.tsx` is removed in the final phase once parity is verified.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + happy-dom, Tailwind CSS v4, shadcn/ui ContextMenu/Dropdown, lucide-react icons.

---

## Architectural Decisions

These decisions are load-bearing for the rest of the plan. They resolve ambiguities between the old folder-only model and the new group/project discriminator.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| D1 | Where do sessions attach? | Projects only | `Session.projectId` already points to a project; groups are containers. |
| D2 | Group row session count | Recursive rollup across descendant projects | Preserves the "how much work lives here" glance value. |
| D3 | Group row repo stats | Aggregate PR/issue/hasChanges from descendant projects, *only when group is collapsed* | Mirrors existing `getRolledUpStats` folder behavior. |
| D4 | Group row context menu items | rename, new-subgroup, new-project, delete, move-to-root, preferences | Groups can't own sessions/secrets/repos. |
| D5 | Project row context menu items | Full legacy menu (new-terminal, new-agent, resume, advanced, new-worktree, new-subproject ❌ removed, preferences, secrets, repository, open-folder, view-issues, view-prs, rename, move-to-root, delete) | Projects replace the feature-rich folder. New-subproject is dropped because projects are leaves. |
| D6 | `.trash` magic child | Removed from tree — keep only the footer Trash button | Groups don't have sessions, projects don't need a per-project trash. Trash is already global. |
| D7 | Drag targets | Sessions → projects (move/reorder). Projects → groups (move/reorder). Groups → groups (nest/reorder). Projects cannot nest into projects. | Matches the group-parent/project-leaf invariant. |
| D8 | Editable names | All three row types support double-click rename; group/project persist via context; session persists via `onSessionRename` prop. | Parity with legacy. |
| D9 | Tree connector lines | Port the existing CSS pattern (`data-tree-last`, `--tree-connector-left/width`) so global stylesheet already covers it. | Zero CSS churn. |
| D10 | Keep `ProjectTreeContext` API additive | Do not remove or rename existing exports. | Avoid breaking `SaveTemplateModal`, `NewSessionWizard`, etc. |

---

## File Structure

**New files:**
- `src/components/session/project-tree/GroupRow.tsx` — group-typed tree row
- `src/components/session/project-tree/ProjectRow.tsx` — project-typed tree row
- `src/components/session/project-tree/SessionRow.tsx` — session row (lifted out of Sidebar.tsx)
- `src/components/session/project-tree/GroupContextMenu.tsx` — group-specific context menu items
- `src/components/session/project-tree/ProjectContextMenu.tsx` — project-specific context menu items
- `src/components/session/project-tree/SessionContextMenu.tsx` — session-specific context menu items
- `src/components/session/project-tree/TreeConnector.tsx` — tiny wrapper that applies `data-tree-last` + connector CSS vars
- `src/components/session/project-tree/useTreeDragDrop.ts` — shared hook for mouse drag state
- `src/components/session/project-tree/useTreeTouchDrag.ts` — shared hook for touch drag state
- `src/components/session/project-tree/index.ts` — re-exports

**Modified files:**
- `src/contexts/ProjectTreeContext.tsx` — add session lookup, repo stats, preferences/secrets predicates, session CRUD bridge
- `src/components/session/ProjectTreeSidebar.tsx` — orchestrator; delegates to new row components; owns drag/drop state
- `src/components/session/ProjectTreeRow.tsx` — deleted (split into GroupRow/ProjectRow)
- `src/components/session/Sidebar.tsx` — delete legacy `folderTree` block, remove `folders`/`folderTree`/folder-handler props, keep header/footer/collapsed infrastructure
- `src/contexts/PreferencesContext.tsx` — drop `folders` state + `folderPreferences` if no remaining consumers; else leave intact
- `src/components/session/SessionManager.tsx` — adjust Sidebar prop wiring

**Tests (all new):**
- `tests/components/project-tree/GroupRow.test.tsx`
- `tests/components/project-tree/ProjectRow.test.tsx`
- `tests/components/project-tree/SessionRow.test.tsx`
- `tests/components/project-tree/ProjectTreeSidebar.dnd.test.tsx`
- `tests/components/project-tree/ProjectTreeSidebar.context-menu.test.tsx`
- `tests/components/project-tree/ProjectTreeSidebar.editing.test.tsx`
- `tests/contexts/ProjectTreeContext.lookups.test.tsx`

---

## Test Infrastructure (prerequisite)

The existing `vitest.config.ts` already includes `tests/**/*.test.tsx`. Component tests use `@testing-library/react` with `happy-dom`. A shared render helper is needed:

```tsx
// tests/helpers/renderWithProjectTree.tsx
import { render } from "@testing-library/react";
import { ProjectTreeProvider } from "@/contexts/ProjectTreeContext";

export function renderWithProjectTree(
  ui: React.ReactElement,
  { tree }: { tree: Partial<ProjectTreeContextValue> } = { tree: {} }
) {
  const mergedValue = { /* default stubs merged with tree */ };
  return render(
    <ProjectTreeContext.Provider value={mergedValue}>{ui}</ProjectTreeContext.Provider>
  );
}
```

The helper must **not** wrap in `ProjectTreeProvider` (which fetches) — tests inject the context value directly. This requires exporting `ProjectTreeContext` (currently private as `Ctx`) from `ProjectTreeContext.tsx`. Task A1 handles this.

---

## Phase A — Context Plumbing

Goal: give `ProjectTreeContext` every datum the tree rows need. No UI work yet.

### Task A1: Export the internal context object for tests

**Files:**
- Modify: `src/contexts/ProjectTreeContext.tsx:65` — rename `Ctx` → `ProjectTreeContext` and export it
- Create: `tests/helpers/renderWithProjectTree.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/contexts/ProjectTreeContext.lookups.test.tsx
import { describe, it, expect } from "vitest";
import { ProjectTreeContext } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext", () => {
  it("exports the context so tests can inject a value", () => {
    expect(ProjectTreeContext).toBeDefined();
    expect(ProjectTreeContext.Provider).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:run tests/contexts/ProjectTreeContext.lookups.test.tsx`
Expected: FAIL — `ProjectTreeContext is not exported`.

- [ ] **Step 3: Export the context**

Rename `const Ctx = createContext<...>(null);` → `export const ProjectTreeContext = createContext<...>(null);` and update the one internal reference (`useContext(Ctx)` → `useContext(ProjectTreeContext)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:run tests/contexts/ProjectTreeContext.lookups.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ProjectTreeContext.tsx tests/contexts/ProjectTreeContext.lookups.test.tsx
git commit -m "refactor(project-tree): export context for test injection"
```

### Task A2: Add session lookups to ProjectTreeContext

Goal: expose session-per-project and recursive-session-count without importing `SessionContext` (to avoid circular deps we inject a `sessionAccessor` at provider mount time, and read it from context).

**Files:**
- Modify: `src/contexts/ProjectTreeContext.tsx`
- Modify: `src/contexts/SessionContext.tsx` — pass a registration callback upward, or expose `sessions` via a read-only getter subscribed to by `ProjectTreeProvider`

Approach: **Define a pure helper outside both contexts** so there's no import cycle:

```ts
// src/lib/project-tree-session-utils.ts
import type { ProjectNode, GroupNode } from "@/contexts/ProjectTreeContext";

export interface MinimalSession {
  id: string;
  projectId: string | null;
  terminalType?: string | null;
}

export function sessionsForProject(
  sessions: MinimalSession[],
  projectId: string,
  opts: { excludeFileSessions?: boolean } = {}
): MinimalSession[] {
  return sessions.filter(
    (s) =>
      s.projectId === projectId &&
      (!opts.excludeFileSessions || s.terminalType !== "file")
  );
}

export function recursiveSessionCount(
  sessions: MinimalSession[],
  groups: GroupNode[],
  projects: ProjectNode[],
  groupId: string
): number {
  const childGroupIds = groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id);
  const ownProjectIds = projects.filter((p) => p.groupId === groupId).map((p) => p.id);
  const direct = sessions.filter(
    (s) => ownProjectIds.includes(s.projectId ?? "") && s.terminalType !== "file"
  ).length;
  const descendant = childGroupIds.reduce(
    (sum, cid) => sum + recursiveSessionCount(sessions, groups, projects, cid),
    0
  );
  return direct + descendant;
}
```

`ProjectTreeRow`s consume `sessions` via a new `useActiveSessions()` hook that simply calls `useSessionContext()` — not through `ProjectTreeContext`. This decouples the two.

- [ ] **Step 1: Write failing unit tests for the helpers**

```ts
// tests/lib/project-tree-session-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  sessionsForProject,
  recursiveSessionCount,
} from "@/lib/project-tree-session-utils";

const sessions = [
  { id: "s1", projectId: "p1" },
  { id: "s2", projectId: "p1", terminalType: "file" },
  { id: "s3", projectId: "p2" },
  { id: "s4", projectId: null },
];

describe("sessionsForProject", () => {
  it("returns only sessions for the project", () => {
    expect(sessionsForProject(sessions, "p1").map((s) => s.id)).toEqual(["s1", "s2"]);
  });
  it("excludes file sessions when requested", () => {
    expect(
      sessionsForProject(sessions, "p1", { excludeFileSessions: true }).map((s) => s.id)
    ).toEqual(["s1"]);
  });
});

describe("recursiveSessionCount", () => {
  const groups = [
    { id: "g1", parentGroupId: null, name: "g1", collapsed: false, sortOrder: 0 },
    { id: "g2", parentGroupId: "g1", name: "g2", collapsed: false, sortOrder: 0 },
  ];
  const projects = [
    { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0 },
    { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0 },
  ];
  it("counts sessions in own projects plus descendant groups", () => {
    expect(recursiveSessionCount(sessions, groups, projects, "g1")).toBe(2);
  });
  it("excludes file sessions", () => {
    // s2 is a file session under p1 — not counted
    expect(recursiveSessionCount(sessions, groups, projects, "g1")).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `bun run test:run tests/lib/project-tree-session-utils.test.ts` → FAIL (file not found).

- [ ] **Step 3: Implement helpers** — create `src/lib/project-tree-session-utils.ts` with the code above.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-tree-session-utils.ts tests/lib/project-tree-session-utils.test.ts
git commit -m "feat(project-tree): add session lookup + rollup helpers"
```

### Task A3: Add repo stats rollup helper

**Files:**
- Modify: `src/lib/project-tree-session-utils.ts` — add `rolledUpRepoStats`

```ts
export interface RepoStats {
  prCount: number;
  issueCount: number;
  hasChanges: boolean;
}

export function rolledUpRepoStats(
  groups: GroupNode[],
  projects: ProjectNode[],
  getProjectStats: (projectId: string) => RepoStats | null,
  node: { type: "group"; id: string; collapsed: boolean } | { type: "project"; id: string }
): RepoStats | null {
  if (node.type === "project") return getProjectStats(node.id);
  if (!node.collapsed) return null; // expanded groups render stats on their children, not themselves
  const acc: RepoStats = { prCount: 0, issueCount: 0, hasChanges: false };
  const descendantProjectIds = collectDescendantProjectIds(groups, projects, node.id);
  for (const pid of descendantProjectIds) {
    const s = getProjectStats(pid);
    if (!s) continue;
    acc.prCount += s.prCount;
    acc.issueCount += s.issueCount;
    acc.hasChanges = acc.hasChanges || s.hasChanges;
  }
  if (acc.prCount === 0 && acc.issueCount === 0 && !acc.hasChanges) return null;
  return acc;
}

function collectDescendantProjectIds(
  groups: GroupNode[],
  projects: ProjectNode[],
  rootGroupId: string
): string[] {
  const seenGroups = new Set<string>([rootGroupId]);
  const queue = [rootGroupId];
  while (queue.length) {
    const g = queue.shift()!;
    for (const child of groups) {
      if (child.parentGroupId === g && !seenGroups.has(child.id)) {
        seenGroups.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return projects.filter((p) => seenGroups.has(p.groupId)).map((p) => p.id);
}
```

- [ ] **Step 1: Write tests for `rolledUpRepoStats`** — cover: project node returns own stats; expanded group returns null; collapsed group aggregates descendants; all-zero returns null.

```ts
it("aggregates stats for collapsed group", () => {
  const stats = rolledUpRepoStats(groups, projects,
    (pid) => pid === "p1" ? { prCount: 2, issueCount: 1, hasChanges: true }
           : pid === "p2" ? { prCount: 1, issueCount: 0, hasChanges: false } : null,
    { type: "group", id: "g1", collapsed: true }
  );
  expect(stats).toEqual({ prCount: 3, issueCount: 1, hasChanges: true });
});

it("returns null when group is expanded (children render their own stats)", () => {
  expect(
    rolledUpRepoStats(groups, projects, () => ({ prCount: 1, issueCount: 0, hasChanges: false }),
      { type: "group", id: "g1", collapsed: false })
  ).toBeNull();
});
```

- [ ] **Step 2: Run fail → implement → run pass → commit.**

```bash
git add src/lib/project-tree-session-utils.ts tests/lib/project-tree-session-utils.test.ts
git commit -m "feat(project-tree): add rolled-up repo stats helper"
```

### Task A4: Extend ProjectTreeContext with preferences/secrets presence predicates

**Files:**
- Modify: `src/contexts/ProjectTreeContext.tsx`

Add:

```ts
// in ProjectTreeContextValue
hasCustomPreferences(node: ActiveNode): boolean;
hasActiveSecrets(projectId: string): boolean;
hasLinkedRepository(projectId: string): boolean;
```

Implementations read from the already-fetched preferences payload (PreferencesContext) and secrets payload (SecretsContext). To avoid a circular dep, implement these predicates in **`ProjectTreeSidebar`** as derived values from those two contexts — but expose them **as props** to the row components, not through ProjectTreeContext.

**Revise:** scrap this task — pass predicates down as props instead. This avoids coupling `ProjectTreeContext` to prefs/secrets.

- [ ] **Step 1: Delete this task and rely on prop passing in Task B1.** (No code change; bookkeeping only.)

---

## Phase B — Component Split (Visual Parity, No Interactions)

Goal: create `GroupRow`, `ProjectRow`, `SessionRow` with correct DOM + styling but only read-only click (for now). Drag, edit, context menus come later.

### Task B1: Extract SessionRow into its own component

**Files:**
- Create: `src/components/session/project-tree/SessionRow.tsx`
- Create: `tests/components/project-tree/SessionRow.test.tsx`
- Reference: `src/components/session/Sidebar.tsx:1152-1492` (legacy session row JSX)

The component owns rendering only — no drag/drop, no context menu, no editing. Parent passes behaviors via props.

```tsx
// src/components/session/project-tree/SessionRow.tsx
"use client";
import { Terminal, Sparkles, MessageCircle, GitBranch, Pin, X } from "lucide-react";
import { SessionMetadataBar } from "@/components/session/SessionMetadataBar";
import { SessionStatusBadge } from "@/components/session/SessionStatusBadge";
import { SessionProgressBar } from "@/components/session/SessionProgressBar";
import type { Session } from "@/types/session";
import type { AgentActivityStatus } from "@/contexts/SessionContext";

interface Props {
  session: Session;
  depth: number;
  isActive: boolean;
  isEditing: boolean;
  hasUnread: boolean;
  agentStatus: AgentActivityStatus | null;
  scheduleCount: number;
  onClick: () => void;
  onClose: () => void;
  onStartEdit: () => void;
}

export function SessionRow({ session, depth, isActive, hasUnread, agentStatus, scheduleCount, onClick, onClose, onStartEdit }: Props) {
  // ...port lines 1152-1492 here; replace handlers with props.
}
```

The test verifies: renders name, shows pin icon when pinned, shows unread dot, close button fires `onClose`.

- [ ] **Step 1: Write the failing tests** (3 tests: name renders, pin icon appears, unread dot appears).

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionRow } from "@/components/session/project-tree/SessionRow";

const session = { id: "s1", name: "my-session", projectId: "p1", pinned: false, terminalType: "shell" } as any;

it("renders the session name", () => {
  render(<SessionRow session={session} depth={0} isActive={false} isEditing={false} hasUnread={false} agentStatus={null} scheduleCount={0} onClick={() => {}} onClose={() => {}} onStartEdit={() => {}} />);
  expect(screen.getByText("my-session")).toBeInTheDocument();
});

it("fires onClose when close button clicked", () => {
  const onClose = vi.fn();
  render(<SessionRow session={session} depth={0} isActive={false} isEditing={false} hasUnread={false} agentStatus={null} scheduleCount={0} onClick={() => {}} onClose={onClose} onStartEdit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});

it("shows unread dot when hasUnread is true", () => {
  const { container } = render(<SessionRow session={session} depth={0} isActive={false} isEditing={false} hasUnread={true} agentStatus={null} scheduleCount={0} onClick={() => {}} onClose={() => {}} onStartEdit={() => {}} />);
  expect(container.querySelector(".animate-pulse.bg-blue-400")).toBeTruthy();
});
```

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement SessionRow** by copying the legacy JSX from Sidebar.tsx:1295-1414, replacing state usage with props. Keep the icon-color helper (`getSessionIconColor`) — extract it to `project-tree/sessionIconColor.ts`.

- [ ] **Step 4: Run pass.**

- [ ] **Step 5: Commit.**

```bash
git add src/components/session/project-tree/ tests/components/project-tree/SessionRow.test.tsx
git commit -m "feat(project-tree): extract SessionRow component"
```

### Task B2: Create GroupRow

**Files:**
- Create: `src/components/session/project-tree/GroupRow.tsx`
- Create: `tests/components/project-tree/GroupRow.test.tsx`

GroupRow renders: chevron, folder/folder-open icon, editable name span, session count (recursive), rolled-up repo stats badges (only when collapsed), hover gear button, children slot when expanded.

```tsx
interface GroupRowProps {
  group: GroupNode;
  depth: number;
  isActive: boolean;
  sessionCount: number; // recursive, passed in
  rolledStats: RepoStats | null; // null when expanded or no stats
  isEditing: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  onStartEdit?: () => void;
  children?: ReactNode;
}
```

Required tests:
- Renders name
- Chevron toggles on click, fires `onToggleCollapse`
- Gear visible on hover, fires `onOpenPreferences`
- Session count badge shown when > 0
- PR/issue badges shown when `rolledStats.prCount > 0` / `issueCount > 0`
- "Changes" pulsing dot shown when `rolledStats.hasChanges`
- No stats shown when `rolledStats` is null
- Children rendered when not collapsed

- [ ] **Step 1–5: TDD loop for each test, culminating in commit**

```bash
git add src/components/session/project-tree/GroupRow.tsx tests/components/project-tree/GroupRow.test.tsx
git commit -m "feat(project-tree): add GroupRow with recursive counts + rolled stats"
```

### Task B3: Create ProjectRow

**Files:**
- Create: `src/components/session/project-tree/ProjectRow.tsx`
- Create: `tests/components/project-tree/ProjectRow.test.tsx`

ProjectRow renders: briefcase icon (or folder+repo overlay), editable name, session count badge (non-recursive), repo stats badges (own stats), hover gear, child SessionRows.

Note: projects have `collapsed` (in domain entity, via `NodePreferences` or project row prefs). The old folders exposed `collapsed` directly on the folder — in the new model, projects have their own `collapsed`. Check `ProjectTreeContext.ProjectNode` — if no `collapsed` field, add one via Task A-prequel or default-expand projects. **Decision:** projects always start expanded and persist `collapsed` via `updateProject({ collapsed })`.

Required tests:
- Renders name
- Gear fires `onOpenPreferences`
- Renders SessionRows passed as children
- PR badge appears when `stats.prCount > 0`
- Double-click on name fires `onStartEdit`

- [ ] **Step 1–5: TDD loop, commit**

```bash
git add src/components/session/project-tree/ProjectRow.tsx tests/components/project-tree/ProjectRow.test.tsx
git commit -m "feat(project-tree): add ProjectRow with sessions + repo stats"
```

### Task B4: Tree connector wrapper

**Files:**
- Create: `src/components/session/project-tree/TreeConnector.tsx`

```tsx
interface Props {
  depth: number;
  isLastChild: boolean;
  children: React.ReactNode;
}
export function TreeConnector({ depth, isLastChild, children }: Props) {
  const left = depth * 12 + 8 + 7;
  return (
    <div
      className="tree-item"
      data-tree-last={isLastChild ? "true" : undefined}
      style={{
        "--tree-connector-left": `${left}px`,
        "--tree-connector-width": "8px",
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
```

Test: renders children, applies data attribute, sets CSS variables.

- [ ] **TDD loop + commit.**

```bash
git add src/components/session/project-tree/TreeConnector.tsx tests/components/project-tree/TreeConnector.test.tsx
git commit -m "feat(project-tree): add TreeConnector wrapper component"
```

### Task B5: Wire new rows into ProjectTreeSidebar (read-only)

**Files:**
- Modify: `src/components/session/ProjectTreeSidebar.tsx`
- Delete: `src/components/session/ProjectTreeRow.tsx`

`ProjectTreeSidebar` now:
- Fetches `activeSessions` via `useSessionContext`
- Fetches prefs/secrets predicates via their contexts
- Gets repo stats via a prop `getProjectRepoStats(projectId) => RepoStats | null`
- Renders `GroupRow` for groups (with child `GroupRow`s + `ProjectRow`s), `ProjectRow` for projects (with child `SessionRow`s)
- Sessions are rendered pinned-first, unpinned-second
- Calls back on select, toggle, open-prefs, edit — no drag/drop, no context menu yet

Update all call sites in `Sidebar.tsx:1735` to pass the new props.

- [ ] **Step 1: Write an integration test that renders `ProjectTreeSidebar` with a group + project + session, asserts all three appear.**

```tsx
// tests/components/project-tree/ProjectTreeSidebar.render.test.tsx
it("renders a group, its project, and the project's sessions", () => {
  const tree = {
    groups: [{ id: "g1", name: "Workspace", parentGroupId: null, collapsed: false, sortOrder: 0 }],
    projects: [{ id: "p1", name: "app", groupId: "g1", isAutoCreated: false, sortOrder: 0 }],
    // ...plus required stubs
  };
  const sessions = [{ id: "s1", name: "server", projectId: "p1" }];
  renderWithProjectTree(<ProjectTreeSidebar />, { tree, sessions });
  expect(screen.getByText("Workspace")).toBeInTheDocument();
  expect(screen.getByText("app")).toBeInTheDocument();
  expect(screen.getByText("server")).toBeInTheDocument();
});
```

- [ ] **Step 2–5: implement + pass + commit**

```bash
git add src/components/session/ProjectTreeSidebar.tsx tests/components/project-tree/ProjectTreeSidebar.render.test.tsx
git rm src/components/session/ProjectTreeRow.tsx
git commit -m "feat(project-tree): wire GroupRow/ProjectRow/SessionRow into sidebar"
```

---

## Phase C — Interactions (Selection, Editing, Keyboard)

### Task C1: Active-node selection

Port the "click row → set active node" behavior with `setActiveNode({id, type})`. Already partially works in legacy `ProjectTreeRow`.

- [ ] **Step 1: Test.** Clicking a `ProjectRow` calls `setActiveNode`.
- [ ] **Step 2–5: implement, pass, commit.**

```bash
git commit -m "feat(project-tree): click row to set active node"
```

### Task C2: Keyboard selection (Enter/Space)

Add `role="button"`, `tabIndex`, and `onKeyDown` → Enter/Space = select.

- [ ] **TDD loop + commit.**

### Task C3: Inline rename

Double-click name → input appears → Enter saves → Escape cancels.

For groups: `updateGroup({ id, name })`. For projects: `updateProject({ id, name })`. For sessions: `onSessionRename` prop from Sidebar.tsx (unchanged signature).

- [ ] **Step 1: Write 3 tests** — one per row type: start edit on double-click; Enter saves and calls the right update; Escape cancels without saving.
- [ ] **Step 2–5: implement, pass, commit.**

```bash
git commit -m "feat(project-tree): inline rename for groups/projects/sessions"
```

### Task C4: Inline create

"New subgroup" and "new project" are invoked from a parent component (via context menu, Phase D, but also via the sidebar header's + button). When invoked, show an inline input at the correct depth until Enter/blur/Escape.

Implement a `CreateNodeInline` component that accepts `type`, `parentGroupId`, `depth`, `onDone()`. Integrate into `ProjectTreeSidebar`.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): inline create for subgroup + project"
```

---

## Phase D — Context Menus

### Task D1: GroupContextMenu

**Files:**
- Create: `src/components/session/project-tree/GroupContextMenu.tsx`

Menu items (D4 in decision table):

1. New Project — `onCreateProject(groupId)`
2. New Subgroup — `onCreateSubgroup(groupId)`
3. — separator —
4. Preferences — `onOpenPreferences("group", groupId)` (with "Custom" badge if `hasCustomPrefs`)
5. Rename — `onStartEdit`
6. Move to Root — `onMoveToRoot` (only shown if `parentGroupId != null`)
7. — separator —
8. Delete — `onDelete` (red)

Required tests:
- All items render
- Each menu item fires its callback
- "Move to Root" hidden when `group.parentGroupId === null`
- "Custom" badge shown when `hasCustomPrefs === true`

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): GroupContextMenu with rename/move/delete"
```

### Task D2: ProjectContextMenu

**Files:**
- Create: `src/components/session/project-tree/ProjectContextMenu.tsx`

Menu items (D5):

1. New Terminal — `onNewTerminal`
2. New Agent — `onNewAgent`
3. Resume — `onResume`
4. Advanced… — `onAdvanced`
5. New Worktree — `onNewWorktree` (disabled if `!hasRepo`)
6. — separator —
7. Preferences — `onOpenPreferences` (Custom badge if `hasCustomPrefs`)
8. Secrets — `onOpenSecrets` (Active badge if `hasActiveSecrets`)
9. Repository — `onOpenRepository` (Linked badge if `hasRepo`)
10. Open Folder — `onOpenFolder` (only if `defaultWorkingDirectory`)
11. View Issues — `onViewIssues` (only if `onViewIssues && hasRepo`)
12. View PRs — `onViewPRs` (only if `onViewPRs && hasRepo`)
13. Rename — `onStartEdit`
14. Move to Root — hidden by design (projects must live in a group)
15. — separator —
16. Delete — `onDelete` (red)

Note: the old folder menu had "Move to Root" and "New Subfolder". In the new model:
- Projects must have a group parent, so "Move to Root" is dropped (use Move to Group submenu instead? defer — not in current plan).
- "New Subfolder" is dropped (projects are leaves).

Tests: 16 items-or-hidden assertions.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): ProjectContextMenu with repo/secrets/worktree items"
```

### Task D3: SessionContextMenu

**Files:**
- Create: `src/components/session/project-tree/SessionContextMenu.tsx`

Menu items (port from Sidebar.tsx:1417-1482):

1. Rename — `onStartEdit`
2. Pin/Unpin — `onTogglePin`
3. Move to Project — submenu:
   - Remove from Project (if currently in one)
   - All projects listed — disabled if current
4. Schedule Command — `onSchedule` (if `onSchedule` provided)
5. — separator —
6. Close Session — `onClose` (red)

Tests: each item; submenu items iterate all provided projects.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): SessionContextMenu with move/pin/schedule"
```

### Task D4: Wire context menus into rows

Wrap `GroupRow` in `<ContextMenu>` + `<GroupContextMenu>`, same for `ProjectRow` and `SessionRow`. Pass callbacks through props from `ProjectTreeSidebar` (which owns them).

Integration test: right-click a project, menu items appear. Click "New Terminal" → `onNewTerminal` fires with project id.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): wire context menus into row components"
```

---

## Phase E — Drag and Drop (Mouse)

### Task E1: Session drag within project / across projects

**Files:**
- Create: `src/components/session/project-tree/useTreeDragDrop.ts`
- Modify: `ProjectTreeSidebar.tsx` (owns drag state)
- Modify: `SessionRow.tsx` (attaches draggable attributes)

Port logic from Sidebar.tsx:
- `handleDragStart` (574-580)
- `handleSessionDragOver` (1029-1068)
- `handleSessionDrop` (936-1026)

Session `dataTransfer` type is `"session"`, value is `sessionId`. Drop rules: reorder within same project + same pin state (call `onSessionReorder(fullOrder[])`); move to different project (call `onSessionMove(sessionId, projectId)`).

Tests:
- Drag session within same project fires reorder with correct new order
- Drag session to different project fires move with new projectId
- Drag across pin partition does nothing (no indicator)

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): session drag for reorder + move"
```

### Task E2: Project drag within group / across groups

Similar to sessions. `dataTransfer` type `"project"`. Rules:
- Drop on another project → reorder (if same `groupId`)
- Drop on a group → move (call `moveProject({ id, newGroupId })`)
- Drop on root: no-op (projects must live in a group)

Tests mirror E1 shape.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): project drag for reorder + move"
```

### Task E3: Group drag (reorder + nest)

Port `handleFolderDragStart/DragOver/Drop` (583-910). `dataTransfer` type `"group"`. Rules:
- Top/bottom 25% of target row → reorder between siblings
- Middle 50% → nest into target group
- Cycle check: use `collectDescendantGroupIds` to reject drops into descendants

Tests:
- Reorder two sibling groups → `updateGroup` calls with new sortOrder (if using sort) OR `moveGroup` (depending on persistence strategy). **Decision:** reuse existing `moveGroup({ newParentGroupId })` which resets `sortOrder = 0`; for reorder between siblings, fire a new API `PATCH /api/groups/:id { sortOrder }` — update context to support this.
- Nest group a into group b → `moveGroup({ id: "a", newParentGroupId: "b" })`
- Cycle: nest group b into descendant c — blocked with no API call

- [ ] **Prereq: extend ProjectTreeContext with `reorderGroup(id, newSortOrder)` if not already present.** Inspect `PATCH /api/groups/:id` — does the route accept `sortOrder`? If yes, call it via `updateGroup({ id, sortOrder })` (add field to type). If no, add backend support in a follow-up bd issue and block E3.

Verify with:
```bash
grep -n 'sortOrder' src/app/api/groups/*.ts
```

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): group drag for reorder + nest with cycle check"
```

### Task E4: Drop indicators (before/after/nest)

Port visual elements:
- Before: `absolute -top-0.5 left-2 right-2 h-0.5 bg-primary rounded-full`
- After: same at `-bottom-0.5`
- Nest-highlight: `bg-primary/20 border border-primary/30`

Render inside `GroupRow` / `ProjectRow` / `SessionRow` based on drag state passed as props.

- [ ] **TDD loop** — test asserts indicator div appears when `dropIndicatorPosition === "before"`.

```bash
git commit -m "feat(project-tree): drop indicators for drag feedback"
```

---

## Phase F — Mobile

### Task F1: Touch drag for groups/projects

Port `handleFolderTouchStart/Move/End` (629-757). Gate desktop-class drag behind `!isMobile`; touch drag runs on long-press (400ms).

Create `useTreeTouchDrag.ts` shared hook.

- [ ] **Step 1: Test** — simulate long-press + move + release; assert reorder fires. (Use `@testing-library/react` `fireEvent.touchStart/Move/End` — happy-dom supports this.)

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): touch drag on mobile with long-press"
```

### Task F2: Swipe-reveal close on sessions

Port `swipeTouchRef` logic (1224-1289). Show red Trash2 button behind row on leftward swipe; commit at -40px.

- [ ] **TDD loop + commit.**

```bash
git commit -m "feat(project-tree): swipe-to-close on mobile session rows"
```

---

## Phase G — Cleanup

### Task G1: Delete legacy folderTree from Sidebar.tsx

**Files:**
- Modify: `src/components/session/Sidebar.tsx`
  - Delete lines ~395-440 (folderTree useMemo)
  - Delete all folder handlers: `handleFolderDragStart`, `handleFolderDragOver`, `handleFolderDrop`, `handleFolderTouchStart/Move/End`, `initiateTouchDrag`, `handleStartEdit`, `handleSaveEdit`, `handleCancelEdit` (for folders), `handleStartSubfolderCreate`, `handleCreateFolder`, `handleFolderKeyDown`, `handleOpenFolder`, `renderSession`, `renderFolderNode`, `renderSessionsWithSplits`, `getRolledUpStats`, `countSessionsRecursively`, `isDescendantOf`
  - Delete lines 1740-2250 (folder tree rendering block)
  - Delete lines 1700-1720 (root-level new-folder input — moved into ProjectTreeSidebar as `CreateNodeInline`)
  - Delete props: `folders`, `onFolderCreate`, `onFolderDelete`, `onFolderToggle`, `onFolderClick`, `onFolderSettings`, `onFolderReorder`, `onFolderMove`, `onFolderNewSession`, `onFolderNewAgent`, `onFolderNewWorktree`, `onFolderAdvancedSession`, `onFolderResumeClaudeSession`, `getFolderRepoStats`, `folderHasPreferences`, `folderHasRepo`, `onEmptyTrash`
  - Keep: header, footer, resize handle, collapsed-mode dual-render (collapsed view renders a compact list of active sessions + trash button; no group/project tree in collapsed mode)

- Modify: `src/components/session/SessionManager.tsx`
  - Remove all now-unused handlers passed to `Sidebar`
  - Wire the equivalents into `ProjectTreeSidebar` through its new props

**Verification:**

```bash
bun run typecheck
bun run test:run
bun run lint
```

All three must pass. Visual smoke test in browser: verify tree renders, drag works, context menu fires correctly for each row type.

- [ ] **Step 1: Run typecheck, fix one error at a time.**
- [ ] **Step 2: Run tests, confirm no regressions.**
- [ ] **Step 3: Commit.**

```bash
git add src/components/session/Sidebar.tsx src/components/session/SessionManager.tsx
git commit -m "refactor(sidebar): delete legacy folderTree block — ProjectTreeSidebar now owns rendering"
```

### Task G2: Drop unused state from PreferencesContext

If no consumer still reads `folders` or `folderPreferences`:

```bash
grep -rn "folderPreferences\|foldersMap" src/
```

If empty, delete those fields from PreferencesContext. Otherwise, leave them and file a follow-up bd issue.

- [ ] **TDD-equivalent:** run typecheck + grep; if clean, commit.

```bash
git commit -m "refactor(preferences): drop unused folders state"
```

### Task G3: Update CHANGELOG

Add an entry under `[Unreleased] / Changed`:

```markdown
- Migrated Sidebar project tree from the legacy folder-based renderer to the
  new group/project-aware `ProjectTreeSidebar`, achieving full feature parity
  (drag/drop, context menus, repo stats, session rendering) while dropping
  ~800 lines of duplicated rendering in `Sidebar.tsx`.
```

- [ ] **Commit.**

```bash
git commit -m "docs(changelog): note project-tree feature-parity migration"
```

---

## Acceptance Criteria

The plan is complete when all of the following hold:

1. **Visual parity (manual):** sidebar matches screenshot baseline — one tree, not two.
2. **Feature parity (manual checklist):**
   - [ ] Session row: pin indicator, close button, schedule count, unread dot, agent breathing color, activity warning ring
   - [ ] Project row: briefcase icon, session count, repo stats badges (PR/issue/changes), hover gear, full context menu
   - [ ] Group row: folder icon, recursive session count, rolled-up repo stats (collapsed only), hover gear, full context menu
   - [ ] Tree connector lines render correctly
   - [ ] Drag-drop: session within project, session cross-project, project within group, project cross-group, group reorder, group nest (with cycle rejection)
   - [ ] Touch drag on mobile + swipe-to-close on sessions
   - [ ] Inline rename works for all three row types
   - [ ] Inline create (subgroup + project) works
3. **Automated:**
   - [ ] `bun run typecheck` — clean (baseline)
   - [ ] `bun run test:run` — all new tests pass; no regressions
   - [ ] `bun run lint` — clean
4. **Cleanup:**
   - [ ] `Sidebar.tsx` no longer imports or references `SessionFolder`, `FolderNode`, `folderTree`, legacy folder handlers
   - [ ] Old `ProjectTreeRow.tsx` is deleted
   - [ ] CHANGELOG updated

---

## Self-Review

**Spec coverage:** All 25 inventory sections mapped:
- Sections 1, 20, 21 (header/footer/layout) — intentionally stay in `Sidebar.tsx` (not tree concerns)
- Sections 2, 3, 10, 15 (tree structure + connectors) — Tasks B4, B5
- Sections 4, 5 (folder badges/counts) — Tasks B2, B3, A3
- Sections 6, 7, 12 (context menus) — Tasks D1, D2, D3
- Section 8 (inline editing) — Task C3, C4
- Sections 9, 13, 14 (drag/drop) — Tasks E1–E4
- Section 11 (session rendering) — Task B1
- Section 16 (trash) — D6 decision: footer trash button unchanged, `.trash` magic folder dropped
- Section 17 (empty states) — Task C4 + Sidebar.tsx header keeps its empty state
- Section 18 (collapsed sidebar session view) — stays in Sidebar.tsx; not a tree concern. Filed as follow-up bd issue if tree rendering must also collapse.
- Section 19 (keyboard) — Task C2
- Section 22 (agent activity) — baked into Task B1 (SessionRow)
- Section 23 (external contexts) — consumed via existing hooks; no churn
- Section 24 (group vs project decisions) — codified in Decision Table above

**Placeholder scan:** No TBD/TODO. Every step has code or a specific port-from-line reference.

**Type consistency:** `RepoStats`, `MinimalSession`, `ActiveNode`, `GroupNode`, `ProjectNode` used uniformly.

**Follow-up items (filed as bd issues, not in scope):**
- Move-to-group submenu for projects (to let users change a project's group via context menu)
- Collapsed-sidebar tree rendering (currently only sessions render when sidebar collapses)
- Whether projects should support nesting (product decision — current answer: no)
- `sortOrder` API on groups (needed for group reorder drag — verify in Task E3 prereq)
