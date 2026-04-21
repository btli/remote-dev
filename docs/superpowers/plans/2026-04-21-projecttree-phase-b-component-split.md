# Phase B — Component Split (Visual Parity, No Interactions)

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.2` (depends on `remote-dev-oqol.1`)
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Create three discriminator-aware row components (`GroupRow`, `ProjectRow`, `SessionRow`) and a `TreeConnector` wrapper that reach full visual parity with the legacy folder tree. No drag/drop, no context menus, no inline editing (those arrive in Phases C–F). Replace the old `ProjectTreeRow.tsx`.

**Architecture:** One file per row component under `src/components/session/project-tree/`. Row components are pure presenters — they consume props only, no direct context access for session data, prefs, or secrets. `ProjectTreeSidebar` wires them together and is the only component that talks to `SessionContext` + `PreferencesContext` + `SecretsContext` + an injected `getProjectRepoStats`.

**Exit criteria:** New sidebar renders a full group→project→session tree with correct icons, counts, repo badges, tree connectors, and active-row highlighting. Clicks still set the active node (carry-over from existing `ProjectTreeRow`). Typecheck + tests clean. Legacy `folderTree` block in `Sidebar.tsx` still present but now rendered *below* the new tree (gets removed in Phase G).

---

## Prerequisite: Shared Test Helper

**Files:**
- Create: `tests/helpers/renderWithProjectTree.tsx`

- [ ] **Step 1: Write the helper**

```tsx
// tests/helpers/renderWithProjectTree.tsx
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement } from "react";
import { ProjectTreeContext, type GroupNode, type ProjectNode } from "@/contexts/ProjectTreeContext";

type CtxValue = NonNullable<React.ContextType<typeof ProjectTreeContext>>;

function stub(): CtxValue {
  return {
    groups: [],
    projects: [],
    isLoading: false,
    activeNode: null,
    getGroup: () => undefined,
    getProject: () => undefined,
    getChildrenOfGroup: () => ({ groups: [], projects: [] }),
    createGroup: async () => ({} as GroupNode),
    updateGroup: async () => {},
    deleteGroup: async () => {},
    moveGroup: async () => {},
    createProject: async () => ({} as ProjectNode),
    updateProject: async () => {},
    deleteProject: async () => {},
    moveProject: async () => {},
    setActiveNode: async () => {},
    refresh: async () => {},
  };
}

export function renderWithProjectTree(
  ui: ReactElement,
  { tree, ...opts }: { tree?: Partial<CtxValue> } & RenderOptions = {}
) {
  const value: CtxValue = { ...stub(), ...tree };
  return render(
    <ProjectTreeContext.Provider value={value}>{ui}</ProjectTreeContext.Provider>,
    opts
  );
}
```

- [ ] **Step 2: (No test required for helper itself — validated transitively by B1+.)**

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/renderWithProjectTree.tsx
git commit -m "test(project-tree): add render helper that injects ProjectTreeContext"
```

---

## Task B1: SessionRow component

**Why:** Sessions today render via inline JSX inside `Sidebar.tsx:1152-1492`. Extract into a presentational component that the new `ProjectRow` can embed.

**Files:**
- Create: `src/components/session/project-tree/SessionRow.tsx`
- Create: `src/components/session/project-tree/sessionIconColor.ts` (util extracted from `Sidebar.tsx:154-179`)
- Create: `tests/components/project-tree/SessionRow.test.tsx`

- [ ] **Step 1: Extract the icon-color helper first**

Create `src/components/session/project-tree/sessionIconColor.ts`. Copy `getSessionIconColor` from `Sidebar.tsx:154-179` verbatim. Export as named export.

**Correct imports** (verified against the repo):

```ts
import type { TerminalSession } from "@/types/session";           // NOT `Session`
import type { AgentActivityStatus } from "@/types/terminal-type"; // NOT `@/contexts/SessionContext`
```

Add a tiny test at `tests/components/project-tree/sessionIconColor.test.ts` covering: agent+running returns green-breathing class; agent+waiting returns yellow-breathing; agent+error returns red (no breathing); non-agent+active returns primary; non-agent+inactive returns muted.

Commit:

```bash
git add src/components/session/project-tree/sessionIconColor.ts tests/components/project-tree/sessionIconColor.test.ts
git commit -m "refactor(project-tree): extract getSessionIconColor to its own module"
```

- [ ] **Step 2: Write failing tests for SessionRow**

```tsx
// tests/components/project-tree/SessionRow.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionRow } from "@/components/session/project-tree/SessionRow";

const baseProps = {
  depth: 1,
  isActive: false,
  isEditing: false,
  hasUnread: false,
  agentStatus: null as null,
  scheduleCount: 0,
  onClick: vi.fn(),
  onClose: vi.fn(),
  onStartEdit: vi.fn(),
};

const shellSession: any = {
  id: "s1",
  name: "web-server",
  projectId: "p1",
  pinned: false,
  terminalType: "shell",
};

describe("SessionRow", () => {
  it("renders the session name", () => {
    render(<SessionRow {...baseProps} session={shellSession} />);
    expect(screen.getByText("web-server")).toBeInTheDocument();
  });

  it("shows the pin indicator when session is pinned", () => {
    const pinned = { ...shellSession, pinned: true };
    const { container } = render(<SessionRow {...baseProps} session={pinned} />);
    // Pin icon = lucide Pin, width=2.5
    expect(container.querySelector('[data-lucide="pin"], svg')).toBeTruthy();
  });

  it("shows the unread dot when hasUnread", () => {
    const { container } = render(<SessionRow {...baseProps} session={shellSession} hasUnread />);
    expect(container.querySelector(".animate-pulse.bg-blue-400")).toBeTruthy();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close session/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClick when row is clicked", () => {
    const onClick = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onClick={onClick} />);
    fireEvent.click(screen.getByText("web-server"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("calls onStartEdit on double-click", () => {
    const onStartEdit = vi.fn();
    render(<SessionRow {...baseProps} session={shellSession} onStartEdit={onStartEdit} />);
    fireEvent.doubleClick(screen.getByText("web-server"));
    expect(onStartEdit).toHaveBeenCalledOnce();
  });

  it("applies agent breathing color when agentStatus=running", () => {
    const agent = { ...shellSession, terminalType: "agent" };
    const { container } = render(
      <SessionRow {...baseProps} session={agent} agentStatus="running" />
    );
    expect(container.querySelector(".agent-breathing.text-green-500")).toBeTruthy();
  });

  it("shows schedule count when > 0", () => {
    render(<SessionRow {...baseProps} session={shellSession} scheduleCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify fail**

```
bun run test:run tests/components/project-tree/SessionRow.test.tsx
```
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement SessionRow**

Port the row structure from `Sidebar.tsx:1295-1414` into a new file. The component must:
- Accept props: `session`, `depth`, `isActive`, `isEditing`, `hasUnread`, `agentStatus`, `scheduleCount`, `onClick`, `onClose`, `onStartEdit`
- Render the icon (via `getSessionIconColor`)
- Render the name (span when not editing — editing UI is Phase C)
- Render `<SessionMetadataBar>`, `<SessionStatusBadge>`, `<SessionProgressBar>` passthrough
- Render schedule-count badge when `scheduleCount > 0`
- Render pin indicator when `session.pinned`
- Render close button with `aria-label="Close session"`
- Apply `ring-2 ring-yellow-400/70 animate-pulse` when `agentStatus ∈ {waiting, error}` and `!isActive`
- Indent with `marginLeft: depth * 12 + 'px'`

Do NOT include: context menu wrapper (Phase D), drag handlers (Phase E), swipe-to-close (Phase F), inline edit input (Phase C).

- [ ] **Step 5: Run to verify pass**

```
bun run test:run tests/components/project-tree/SessionRow.test.tsx
```
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/session/project-tree/SessionRow.tsx tests/components/project-tree/SessionRow.test.tsx
git commit -m "feat(project-tree): add SessionRow presentational component"
```

---

## Task B2: TreeConnector wrapper

**Why:** The legacy tree used `<div class="tree-item" data-tree-last=... style="--tree-connector-left: ...">` to let global CSS draw connector lines. Extract into a reusable wrapper.

**Files:**
- Create: `src/components/session/project-tree/TreeConnector.tsx`
- Create: `tests/components/project-tree/TreeConnector.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TreeConnector } from "@/components/session/project-tree/TreeConnector";

describe("TreeConnector", () => {
  it("renders children", () => {
    const { getByText } = render(
      <TreeConnector depth={2} isLastChild={false}>
        <span>hi</span>
      </TreeConnector>
    );
    expect(getByText("hi")).toBeInTheDocument();
  });

  it("sets data-tree-last when isLastChild", () => {
    const { container } = render(
      <TreeConnector depth={0} isLastChild>
        <span />
      </TreeConnector>
    );
    expect(container.firstElementChild).toHaveAttribute("data-tree-last", "true");
  });

  it("omits data-tree-last when not last", () => {
    const { container } = render(
      <TreeConnector depth={0} isLastChild={false}>
        <span />
      </TreeConnector>
    );
    expect(container.firstElementChild).not.toHaveAttribute("data-tree-last");
  });

  it("sets --tree-connector-left based on depth", () => {
    const { container } = render(
      <TreeConnector depth={3} isLastChild={false}>
        <span />
      </TreeConnector>
    );
    // depth*12 + 8 + 7 = 51 for depth 3
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--tree-connector-left")).toBe("51px");
    expect(el.style.getPropertyValue("--tree-connector-width")).toBe("8px");
  });
});
```

- [ ] **Step 2: Run fail.**

- [ ] **Step 3: Implement**

```tsx
// src/components/session/project-tree/TreeConnector.tsx
"use client";
import { type ReactNode, type CSSProperties } from "react";

interface Props {
  depth: number;
  isLastChild: boolean;
  children: ReactNode;
}

export function TreeConnector({ depth, isLastChild, children }: Props) {
  const left = depth * 12 + 8 + 7;
  const style: CSSProperties & Record<string, string> = {
    "--tree-connector-left": `${left}px`,
    "--tree-connector-width": "8px",
  };
  return (
    <div className="tree-item" data-tree-last={isLastChild ? "true" : undefined} style={style}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run pass.**

- [ ] **Step 5: Commit**

```bash
git add src/components/session/project-tree/TreeConnector.tsx tests/components/project-tree/TreeConnector.test.tsx
git commit -m "feat(project-tree): add TreeConnector wrapper for connector-line CSS"
```

---

## Task B3: GroupRow component

**Files:**
- Create: `src/components/session/project-tree/GroupRow.tsx`
- Create: `tests/components/project-tree/GroupRow.test.tsx`

Props (exact):

```ts
interface GroupRowProps {
  group: GroupNode;
  depth: number;
  isActive: boolean;
  sessionCount: number;           // computed by ProjectTreeSidebar via recursiveSessionCount
  rolledStats: RepoStats | null;  // null when expanded or no stats; computed by rolledUpRepoStats
  hasCustomPrefs: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  children?: ReactNode;           // sub-tree when expanded
}
```

DOM (port from `Sidebar.tsx:1829-2110`, stripped to non-interactive parts):

- Chevron (ChevronDown / ChevronRight) left of icon
- Folder / FolderOpen icon (color `text-primary`, or `fill-primary` if `isActive && !collapsed`)
- Name span (truncate, `text-sm`)
- Right-side badges:
  - PR badge (GitPullRequest + count, `text-primary`) when `rolledStats?.prCount > 0`
  - Issue badge (CircleDot + count, `text-chart-2`) when `rolledStats?.issueCount > 0`
  - Changes pulsing dot when `rolledStats?.hasChanges`
  - Session count (right-aligned, `text-[10px] text-muted-foreground`) when `sessionCount > 0`
- Hover gear button (Settings icon, `opacity-0 group-hover:opacity-100`) when `onOpenPreferences` provided
- Children rendered below when `!group.collapsed`

Required tests (covering each rendering rule):

```tsx
// Minimum list — expand as needed
- renders the group name
- renders chevron pointing down when expanded
- renders chevron pointing right when collapsed
- fires onToggleCollapse when chevron clicked (and does NOT fire onSelect)
- fires onSelect when name area clicked
- fires onOpenPreferences when gear clicked
- does not render gear when onOpenPreferences is undefined
- hides children when group.collapsed is true
- renders children when group.collapsed is false
- renders session count badge when sessionCount > 0
- does not render session count badge when sessionCount === 0
- renders PR badge when rolledStats.prCount > 0
- renders issue badge when rolledStats.issueCount > 0
- renders changes dot when rolledStats.hasChanges is true
- renders nothing in the stats area when rolledStats is null
- applies active styling when isActive is true
```

- [ ] **TDD loop (fail → implement → pass) + commit**

```bash
git add src/components/session/project-tree/GroupRow.tsx tests/components/project-tree/GroupRow.test.tsx
git commit -m "feat(project-tree): add GroupRow with recursive count + rolled repo stats"
```

---

## Task B4: ProjectRow component

**Files:**
- Create: `src/components/session/project-tree/ProjectRow.tsx`
- Create: `tests/components/project-tree/ProjectRow.test.tsx`

Props (exact):

```ts
interface ProjectRowProps {
  project: ProjectNode;
  depth: number;
  isActive: boolean;
  collapsed: boolean;                        // from project preferences — ProjectTreeSidebar owns lookup
  sessionCount: number;
  ownStats: RepoStats | null;
  hasCustomPrefs: boolean;
  hasActiveSecrets: boolean;
  hasLinkedRepo: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onOpenPreferences?: () => void;
  children?: ReactNode;                      // session list when expanded
}
```

DOM:

- Briefcase icon (matching existing `ProjectTreeRow.tsx:82`)
- Optional repo-linked overlay: small GitBranch dot in corner when `hasLinkedRepo` (port from folder repo indicator)
- Name span
- PR/issue/changes badges when `ownStats` non-null (same styling as GroupRow)
- Session count right-aligned when `sessionCount > 0`
- Hover gear when `onOpenPreferences` provided
- Session children below when `!collapsed`

**Key decision:** projects have `collapsed` state. Schema already has `project.collapsed` (`src/db/schema.ts:1690`), domain entity supports it (`src/domain/entities/Project.ts`), and PATCH route accepts it (`src/app/api/projects/[id]/route.ts:8`). Only the frontend `ProjectNode` type in `src/contexts/ProjectTreeContext.tsx:23-35` is missing the field. Task B4.5 adds only the TS field + ensures the context mapper forwards it; no DB migration, no API change required.

Tests: mirror GroupRow's list, substituting project-specific behaviors.

- [ ] **TDD loop + commit**

```bash
git add src/components/session/project-tree/ProjectRow.tsx tests/components/project-tree/ProjectRow.test.tsx
git commit -m "feat(project-tree): add ProjectRow with own repo stats + session count"
```

---

## Task B4.5: Add `collapsed` to frontend `ProjectNode` type

**Why:** ProjectRow needs per-project collapse state. Schema + domain + PATCH route already support it (verified). The gap is narrow: the frontend `ProjectNode` TS type in `ProjectTreeContext.tsx` doesn't include the field, and the mapper that builds `ProjectNode` from the API payload doesn't copy it through.

**Files (scope is this narrow — do NOT touch schema, API route, or domain entity):**
- Modify: `src/contexts/ProjectTreeContext.tsx` — add `collapsed: boolean` to the `ProjectNode` interface; ensure the fetch/load mapper copies `collapsed` from the API response; `updateProject` already accepts `collapsed` (line 58).

- [ ] **Step 1: Failing test**

```ts
// tests/contexts/ProjectTreeContext.collapsed.test.ts
import { describe, it, expect } from "vitest";
// Mount ProjectTreeProvider with mocked fetch returning
// { projects: [{ id: "p1", groupId: "g1", name: "p", collapsed: true, sortOrder: 0, ... }] }
// Read tree.projects via a render hook.
// Expect result.current.projects[0].collapsed === true.
```

- [ ] **Step 2: Run fail** (`.collapsed` is undefined because the mapper drops it).

- [ ] **Step 3: Implement** — add `collapsed: boolean` to `ProjectNode`; in the loader, map `collapsed: p.collapsed ?? false`.

- [ ] **Step 4: Run pass + commit**

```bash
git commit -m "feat(project-tree): expose project.collapsed through frontend context"
```

---

## Task B5: Wire new rows into ProjectTreeSidebar (read-only)

**Files:**
- Modify: `src/components/session/ProjectTreeSidebar.tsx`
- Delete: `src/components/session/ProjectTreeRow.tsx` (after the new wiring compiles)
- Create: `tests/components/project-tree/ProjectTreeSidebar.render.test.tsx`

The new `ProjectTreeSidebar`:

```tsx
"use client";
import { useMemo } from "react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useSecretsContext } from "@/contexts/SecretsContext";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { GroupRow } from "./project-tree/GroupRow";
import { ProjectRow } from "./project-tree/ProjectRow";
import { SessionRow } from "./project-tree/SessionRow";
import { TreeConnector } from "./project-tree/TreeConnector";
import {
  recursiveSessionCount,
  rolledUpRepoStats,
  sessionsForProject,
  type RepoStats,
} from "@/lib/project-tree-session-utils";

interface Props {
  getProjectRepoStats: (projectId: string) => RepoStats | null;
  onOpenPreferences?: (node: { id: string; type: "group" | "project"; name: string }) => void;
  onSessionClick: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionStartEdit: (sessionId: string) => void;
}

export function ProjectTreeSidebar(props: Props) {
  const tree = useProjectTree();
  const { activeSessions, getAgentActivityStatus } = useSessionContext();
  const { getFolderPreferences /* legacy — keep during Phase B */ } = usePreferencesContext();
  const { folderConfigs } = useSecretsContext();
  const { notifications } = useNotificationContext();

  const rootEntries = useMemo(() => tree.getChildrenOfGroup(null), [tree]);

  const sessionUnread = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notifications) {
      if (!n.read && n.sessionId) m.set(n.sessionId, (m.get(n.sessionId) ?? 0) + 1);
    }
    return m;
  }, [notifications]);

  if (tree.isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading projects…</div>;
  }

  const renderSessions = (projectId: string, depth: number) => {
    const list = sessionsForProject(activeSessions, projectId, { excludeFileSessions: false });
    const pinned = list.filter((s) => s.pinned);
    const unpinned = list.filter((s) => !s.pinned);
    const ordered = [...pinned, ...unpinned];
    return ordered.map((s, i) => (
      <TreeConnector key={s.id} depth={depth} isLastChild={i === ordered.length - 1}>
        <SessionRow
          session={s}
          depth={depth}
          isActive={activeSessions.some((a) => a.id === s.id) /* refine via SessionContext */}
          isEditing={false}
          hasUnread={(sessionUnread.get(s.id) ?? 0) > 0}
          agentStatus={s.terminalType === "agent" ? getAgentActivityStatus(s.id) : null}
          scheduleCount={0 /* Phase B baseline — schedule context wired in Phase D */}
          onClick={() => props.onSessionClick(s.id)}
          onClose={() => props.onSessionClose(s.id)}
          onStartEdit={() => props.onSessionStartEdit(s.id)}
        />
      </TreeConnector>
    ));
  };

  const renderGroup = (groupId: string, depth: number) => {
    const { groups: childGroups, projects: childProjects } = tree.getChildrenOfGroup(groupId);
    return (
      <>
        {childGroups.map((g, i) => {
          const stats = rolledUpRepoStats(tree.groups, tree.projects, props.getProjectRepoStats, {
            type: "group",
            id: g.id,
            collapsed: g.collapsed,
          });
          return (
            <TreeConnector
              key={g.id}
              depth={depth}
              isLastChild={i === childGroups.length - 1 && childProjects.length === 0}
            >
              <GroupRow
                group={g}
                depth={depth}
                isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
                sessionCount={recursiveSessionCount(activeSessions, tree.groups, tree.projects, g.id)}
                rolledStats={stats}
                hasCustomPrefs={false /* wire in Phase D */}
                onSelect={() => void tree.setActiveNode({ id: g.id, type: "group" })}
                onToggleCollapse={() => void tree.updateGroup({ id: g.id, collapsed: !g.collapsed })}
                onOpenPreferences={
                  props.onOpenPreferences
                    ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                    : undefined
                }
              >
                {renderGroup(g.id, depth + 1)}
              </GroupRow>
            </TreeConnector>
          );
        })}
        {childProjects.map((p, i) => {
          const sessions = sessionsForProject(activeSessions, p.id, { excludeFileSessions: true });
          const stats = props.getProjectRepoStats(p.id);
          return (
            <TreeConnector
              key={p.id}
              depth={depth}
              isLastChild={i === childProjects.length - 1}
            >
              <ProjectRow
                project={p}
                depth={depth}
                isActive={tree.activeNode?.id === p.id && tree.activeNode?.type === "project"}
                collapsed={p.collapsed ?? false}
                sessionCount={sessions.length}
                ownStats={stats}
                hasCustomPrefs={false}
                hasActiveSecrets={folderConfigs.get(p.id)?.enabled ?? false}
                hasLinkedRepo={getFolderPreferences(p.id)?.githubRepoId != null}
                onSelect={() => void tree.setActiveNode({ id: p.id, type: "project" })}
                onToggleCollapse={() =>
                  void tree.updateProject({ id: p.id, collapsed: !(p.collapsed ?? false) })
                }
                onOpenPreferences={
                  props.onOpenPreferences
                    ? () => props.onOpenPreferences!({ id: p.id, type: "project", name: p.name })
                    : undefined
                }
              >
                {!(p.collapsed ?? false) && renderSessions(p.id, depth + 1)}
              </ProjectRow>
            </TreeConnector>
          );
        })}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-0.5 px-1 py-2">
      {rootEntries.groups.map((g, i) => (
        <TreeConnector key={g.id} depth={0} isLastChild={i === rootEntries.groups.length - 1}>
          <GroupRow
            group={g}
            depth={0}
            isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
            sessionCount={recursiveSessionCount(activeSessions, tree.groups, tree.projects, g.id)}
            rolledStats={rolledUpRepoStats(tree.groups, tree.projects, props.getProjectRepoStats, {
              type: "group",
              id: g.id,
              collapsed: g.collapsed,
            })}
            hasCustomPrefs={false}
            onSelect={() => void tree.setActiveNode({ id: g.id, type: "group" })}
            onToggleCollapse={() => void tree.updateGroup({ id: g.id, collapsed: !g.collapsed })}
            onOpenPreferences={
              props.onOpenPreferences
                ? () => props.onOpenPreferences!({ id: g.id, type: "group", name: g.name })
                : undefined
            }
          >
            {renderGroup(g.id, 1)}
          </GroupRow>
        </TreeConnector>
      ))}
    </div>
  );
}
```

- [ ] **Step 1: Write the integration test**

```tsx
// tests/components/project-tree/ProjectTreeSidebar.render.test.tsx
import { describe, it, expect } from "vitest";
import { renderWithProjectTree } from "@tests/helpers/renderWithProjectTree";
import { ProjectTreeSidebar } from "@/components/session/ProjectTreeSidebar";
// Stub the other contexts via jest.mock / vi.mock per vitest convention

// Minimum fixtures
const group = { id: "g1", name: "Workspace", parentGroupId: null, collapsed: false, sortOrder: 0 };
const project = {
  id: "p1",
  name: "app",
  groupId: "g1",
  isAutoCreated: false,
  sortOrder: 0,
  collapsed: false,
};

// ... mock SessionContext to return activeSessions = [{id:"s1", name:"server", projectId:"p1", terminalType:"shell", pinned:false}]
// ... mock PreferencesContext, SecretsContext, NotificationContext with empty defaults

describe("ProjectTreeSidebar", () => {
  it("renders group > project > session hierarchy", () => {
    const { getByText } = renderWithProjectTree(
      <ProjectTreeSidebar
        getProjectRepoStats={() => null}
        onSessionClick={() => {}}
        onSessionClose={() => {}}
        onSessionStartEdit={() => {}}
      />,
      {
        tree: {
          groups: [group],
          projects: [project],
          getGroup: (id) => (id === "g1" ? group : undefined),
          getProject: (id) => (id === "p1" ? (project as any) : undefined),
          getChildrenOfGroup: (gid) =>
            gid === null
              ? { groups: [group], projects: [] }
              : gid === "g1"
              ? { groups: [], projects: [project as any] }
              : { groups: [], projects: [] },
        },
      }
    );
    expect(getByText("Workspace")).toBeInTheDocument();
    expect(getByText("app")).toBeInTheDocument();
    expect(getByText("server")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Mock the ancillary contexts via `vi.mock`**

Set up `vi.mock` for `@/contexts/SessionContext`, `@/contexts/PreferencesContext`, `@/contexts/SecretsContext`, `@/contexts/NotificationContext` returning trivially-usable stubs.

- [ ] **Step 3: Implement the new ProjectTreeSidebar** (replace contents with code above).

- [ ] **Step 4: Update `Sidebar.tsx:1735` call site**

```tsx
<ProjectTreeSidebar
  getProjectRepoStats={getFolderRepoStats /* temporary — projectId happens to equal folderId today */}
  onOpenPreferences={onOpenNodePreferences}
  onSessionClick={onSessionClick}
  onSessionClose={onSessionClose}
  onSessionStartEdit={(sid) => handleStartEdit(sid, "session", /* name */ "", { preventDefault: () => {}, stopPropagation: () => {} } as any)}
/>
```

- [ ] **Step 5: Delete the old `ProjectTreeRow.tsx`**

```bash
git rm src/components/session/ProjectTreeRow.tsx
```

- [ ] **Step 6: Run tests + typecheck**

```
bun run typecheck
bun run test:run
```

- [ ] **Step 7: Commit**

```bash
git add src/components/session/ProjectTreeSidebar.tsx tests/components/project-tree/ProjectTreeSidebar.render.test.tsx
git commit -m "feat(project-tree): wire GroupRow/ProjectRow/SessionRow into sidebar"
```

---

## Acceptance Criteria

- [ ] All Phase B tests pass: SessionRow (8), TreeConnector (4), GroupRow (16), ProjectRow (~16), ProjectTreeSidebar.render (1)
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] Old `ProjectTreeRow.tsx` is deleted
- [ ] New tree renders above the legacy folder tree (legacy still present; removed in Phase G)
- [ ] Visual smoke test: tree shows correct icons, badges, counts, active highlight; click a row sets active

## Risks / Open Questions

- **Schedule count source in B5:** currently hard-coded 0. `useScheduleContext()` was not imported in this phase to avoid scope creep; added in Phase D. Document this as a known gap.
- **`hasCustomPrefs` source:** also hard-coded false in B5; wired up in Phase D context-menu work. A bare tree without the "Custom" badge is acceptable for B5 exit.
- **ProjectNode.collapsed:** task B4.5 depends on whether the field exists in the DB. If schema does not already support it, B4.5 balloons to include a drizzle migration — flag this when starting.
- **Mock churn:** Phase B introduces four `vi.mock` calls on context modules. If those context APIs change mid-phase, tests may need updating.
