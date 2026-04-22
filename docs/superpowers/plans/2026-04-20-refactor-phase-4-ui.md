# Phase 4: React Contexts + UI Components - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace the `FolderContext` with a `ProjectTreeContext` that exposes groups + projects. Rewire the sidebar to render groups/projects with correct affordances (groups can contain child groups/projects; projects cannot). Split `FolderPreferencesModal` into `GroupPreferencesModal` and `ProjectPreferencesModal`. Update the new-session wizard to pick a project. Make the top-of-sidebar "active node" selector work for both groups and projects (showing aggregated data when a group is active).

**Architecture:** Keep `FolderContext` alive for the transition so any uncovered consumer still compiles. Introduce `ProjectTreeContext` and migrate components one at a time, committing per component. Sidebar renders a unified tree; row components branch on `node.type`. The wizard and preferences modals are rewritten from scratch (not refactored) because folder props no longer match.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui, zod for form validation.

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md).

---

## File Structure

**Create:**
- `src/contexts/ProjectTreeContext.tsx`
- `src/components/preferences/GroupPreferencesModal.tsx`
- `src/components/preferences/ProjectPreferencesModal.tsx`
- `src/components/session/ProjectPickerCombobox.tsx`
- `src/components/session/ProjectTreeRow.tsx` — renders one node (group or project)
- `src/components/session/ProjectTreeSidebar.tsx` — the orchestrator that replaces the folder tree chunk of `Sidebar.tsx`
- `src/components/session/ActiveNodeIndicator.tsx` — header chip showing active node with "(rolled up)" tag
- `tests/contexts/ProjectTreeContext.test.tsx`

**Modify:**
- `src/components/session/Sidebar.tsx` — replace folder tree section with `ProjectTreeSidebar`
- `src/components/session/NewSessionWizard.tsx` — use `ProjectPickerCombobox`
- `src/components/session/SessionManager.tsx` — consume `ProjectTreeContext` for keyboard shortcuts and active-node display
- `src/contexts/SessionContext.tsx` — optimistic updates emit `projectId` instead of `folderId`
- `src/components/session/SaveTemplateModal.tsx` — `projectId` field instead of `folderId`
- `src/components/tasks/TaskSidebar.tsx` — listen for active node (group or project), call `listByNode`
- `src/components/channels/ChannelSidebar.tsx` — same

**Do NOT touch (keep for Phase 6 removal):**
- `src/contexts/FolderContext.tsx`
- `src/components/preferences/FolderPreferencesModal.tsx`

---

## Task 1: `ProjectTreeContext`

- [ ] **Step 1.1: Write failing context test**

`tests/contexts/ProjectTreeContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ProjectTreeProvider, useProjectTree } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ groups: [{ id: "g1", name: "Root", parentGroupId: null }] }),
        }) as any;
      }
      if (String(url).includes("/api/projects")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: [{ id: "p1", name: "App", groupId: "g1" }] }),
        }) as any;
      }
      return Promise.resolve({ ok: false, status: 404 }) as any;
    });
  });

  it("loads groups and projects and exposes a unified tree", async () => {
    const { result } = renderHook(() => useProjectTree(), {
      wrapper: ({ children }) => <ProjectTreeProvider>{children}</ProjectTreeProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.getGroup("g1")?.name).toBe("Root");
    expect(result.current.getProject("p1")?.groupId).toBe("g1");
  });
});
```

- [ ] **Step 1.2: Run — expect fail, implement**

`src/contexts/ProjectTreeContext.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type NodeType = "group" | "project";

export interface GroupNode {
  id: string;
  name: string;
  parentGroupId: string | null;
  collapsed: boolean;
  sortOrder: number;
}

export interface ProjectNode {
  id: string;
  name: string;
  groupId: string;
  isAutoCreated: boolean;
  sortOrder: number;
}

export interface ActiveNode {
  id: string;
  type: NodeType;
}

interface ProjectTreeContextValue {
  groups: GroupNode[];
  projects: ProjectNode[];
  isLoading: boolean;
  activeNode: ActiveNode | null;
  getGroup(id: string): GroupNode | undefined;
  getProject(id: string): ProjectNode | undefined;
  getChildrenOfGroup(groupId: string | null): {
    groups: GroupNode[];
    projects: ProjectNode[];
  };
  createGroup(input: { name: string; parentGroupId: string | null }): Promise<GroupNode>;
  updateGroup(input: { id: string; name?: string; collapsed?: boolean }): Promise<void>;
  deleteGroup(id: string, force?: boolean): Promise<void>;
  moveGroup(input: { id: string; newParentGroupId: string | null }): Promise<void>;
  createProject(input: { groupId: string; name: string }): Promise<ProjectNode>;
  updateProject(input: { id: string; name?: string; collapsed?: boolean }): Promise<void>;
  deleteProject(id: string): Promise<void>;
  moveProject(input: { id: string; newGroupId: string }): Promise<void>;
  setActiveNode(node: ActiveNode): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<ProjectTreeContextValue | null>(null);

export function ProjectTreeProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [activeNode, setActiveNodeState] = useState<ActiveNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [groupsRes, projectsRes] = await Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ]);
    setGroups(groupsRes.groups ?? []);
    setProjects(projectsRes.projects ?? []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getGroup = useCallback((id: string) => groups.find((g) => g.id === id), [groups]);
  const getProject = useCallback((id: string) => projects.find((p) => p.id === id), [projects]);
  const getChildrenOfGroup = useCallback(
    (groupId: string | null) => ({
      groups: groups.filter((g) => g.parentGroupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder),
      projects: groupId
        ? projects.filter((p) => p.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    }),
    [groups, projects]
  );

  const createGroup: ProjectTreeContextValue["createGroup"] = useCallback(
    async (input) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, sortOrder: groups.filter((g) => g.parentGroupId === input.parentGroupId).length }),
      });
      const body = await res.json();
      await refresh();
      return body.group as GroupNode;
    },
    [groups, refresh]
  );

  const updateGroup: ProjectTreeContextValue["updateGroup"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await fetch(`/api/groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refresh();
    },
    [refresh]
  );

  const deleteGroup: ProjectTreeContextValue["deleteGroup"] = useCallback(
    async (id, force) => {
      const url = force ? `/api/groups/${id}?force=true` : `/api/groups/${id}`;
      await fetch(url, { method: "DELETE" });
      await refresh();
    },
    [refresh]
  );

  const moveGroup: ProjectTreeContextValue["moveGroup"] = useCallback(
    async (input) => {
      await fetch(`/api/groups/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newParentGroupId: input.newParentGroupId }),
      });
      await refresh();
    },
    [refresh]
  );

  const createProject: ProjectTreeContextValue["createProject"] = useCallback(
    async (input) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      await refresh();
      return body.project as ProjectNode;
    },
    [refresh]
  );

  const updateProject: ProjectTreeContextValue["updateProject"] = useCallback(
    async (input) => {
      const { id, ...patch } = input;
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refresh();
    },
    [refresh]
  );

  const deleteProject: ProjectTreeContextValue["deleteProject"] = useCallback(
    async (id) => {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh]
  );

  const moveProject: ProjectTreeContextValue["moveProject"] = useCallback(
    async (input) => {
      await fetch(`/api/projects/${input.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newGroupId: input.newGroupId }),
      });
      await refresh();
    },
    [refresh]
  );

  const setActiveNode: ProjectTreeContextValue["setActiveNode"] = useCallback(async (node) => {
    setActiveNodeState(node);
    await fetch("/api/preferences/active-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: node.id, nodeType: node.type }),
    });
  }, []);

  const value = useMemo<ProjectTreeContextValue>(
    () => ({
      groups,
      projects,
      isLoading,
      activeNode,
      getGroup,
      getProject,
      getChildrenOfGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      moveGroup,
      createProject,
      updateProject,
      deleteProject,
      moveProject,
      setActiveNode,
      refresh,
    }),
    [
      groups,
      projects,
      isLoading,
      activeNode,
      getGroup,
      getProject,
      getChildrenOfGroup,
      createGroup,
      updateGroup,
      deleteGroup,
      moveGroup,
      createProject,
      updateProject,
      deleteProject,
      moveProject,
      setActiveNode,
      refresh,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectTree(): ProjectTreeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjectTree must be used inside ProjectTreeProvider");
  return ctx;
}
```

- [ ] **Step 1.3: Run tests**

```bash
bun run test:run tests/contexts/ProjectTreeContext.test.tsx
```

- [ ] **Step 1.4: Commit**

```bash
git add src/contexts/ProjectTreeContext.tsx tests/contexts/ProjectTreeContext.test.tsx
git commit -m "feat(context): add ProjectTreeContext with unified group/project tree"
```

---

## Task 2: Mount ProjectTreeProvider

- [ ] **Step 2.1: Wrap the app**

Find where `FolderProvider` is mounted (most likely in `src/app/(authenticated)/layout.tsx` or `src/components/session/SessionManager.tsx`). Wrap with `ProjectTreeProvider` immediately inside (or alongside) `FolderProvider` so both contexts are active during transition:

```tsx
<FolderProvider>
  <ProjectTreeProvider>
    {children}
  </ProjectTreeProvider>
</FolderProvider>
```

- [ ] **Step 2.2: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 2.3: Commit**

```bash
git add src/app src/components/session/SessionManager.tsx
git commit -m "feat(ui): mount ProjectTreeProvider alongside FolderProvider"
```

---

## Task 3: `ProjectTreeRow` — Unified Tree Row Component

- [ ] **Step 3.1: Implement**

`src/components/session/ProjectTreeRow.tsx`:

```tsx
"use client";

import { type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Briefcase } from "lucide-react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

interface Props {
  node: { type: "group"; id: string } | { type: "project"; id: string };
  depth: number;
  onSelect: (node: { id: string; type: "group" | "project" }) => void;
  isActive: boolean;
  children?: ReactNode;
}

export function ProjectTreeRow({ node, depth, onSelect, isActive, children }: Props) {
  const tree = useProjectTree();
  const entity =
    node.type === "group" ? tree.getGroup(node.id) : tree.getProject(node.id);
  if (!entity) return null;

  const isGroup = node.type === "group";
  const isCollapsed = "collapsed" in entity ? entity.collapsed : false;

  const toggleCollapse = async () => {
    if (isGroup) {
      await tree.updateGroup({ id: entity.id, collapsed: !isCollapsed });
    } else {
      await tree.updateProject({ id: entity.id, collapsed: !isCollapsed });
    }
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => onSelect({ id: entity.id, type: node.type })}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted ${
          isActive ? "bg-muted font-medium" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {isGroup ? (
          <span onClick={(e) => { e.stopPropagation(); void toggleCollapse(); }}>
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
        ) : (
          <span className="w-3.5" />
        )}
        {isGroup ? (
          isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} />
        ) : (
          <Briefcase size={14} />
        )}
        <span className="truncate text-sm">{entity.name}</span>
      </button>
      {isGroup && !isCollapsed ? children : null}
    </div>
  );
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/components/session/ProjectTreeRow.tsx
git commit -m "feat(ui): add ProjectTreeRow for unified group/project rendering"
```

---

## Task 4: `ProjectTreeSidebar` Orchestrator

- [ ] **Step 4.1: Implement**

`src/components/session/ProjectTreeSidebar.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useProjectTree } from "@/contexts/ProjectTreeContext";
import { ProjectTreeRow } from "./ProjectTreeRow";

export function ProjectTreeSidebar() {
  const tree = useProjectTree();
  const rootEntries = useMemo(() => tree.getChildrenOfGroup(null), [tree]);

  function renderGroupSubtree(groupId: string, depth: number) {
    const { groups: childGroups, projects: childProjects } = tree.getChildrenOfGroup(groupId);
    return (
      <>
        {childGroups.map((g) => (
          <ProjectTreeRow
            key={g.id}
            node={{ type: "group", id: g.id }}
            depth={depth}
            isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
            onSelect={(n) => void tree.setActiveNode(n)}
          >
            {renderGroupSubtree(g.id, depth + 1)}
          </ProjectTreeRow>
        ))}
        {childProjects.map((p) => (
          <ProjectTreeRow
            key={p.id}
            node={{ type: "project", id: p.id }}
            depth={depth}
            isActive={tree.activeNode?.id === p.id && tree.activeNode?.type === "project"}
            onSelect={(n) => void tree.setActiveNode(n)}
          />
        ))}
      </>
    );
  }

  if (tree.isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading projects…</div>;
  }

  return (
    <div className="flex flex-col gap-0.5 px-1 py-2">
      {rootEntries.groups.map((g) => (
        <ProjectTreeRow
          key={g.id}
          node={{ type: "group", id: g.id }}
          depth={0}
          isActive={tree.activeNode?.id === g.id && tree.activeNode?.type === "group"}
          onSelect={(n) => void tree.setActiveNode(n)}
        >
          {renderGroupSubtree(g.id, 1)}
        </ProjectTreeRow>
      ))}
    </div>
  );
}
```

- [ ] **Step 4.2: Wire into `Sidebar.tsx`**

In `src/components/session/Sidebar.tsx`, find the section that renders folders. Replace it with:

```tsx
import { ProjectTreeSidebar } from "./ProjectTreeSidebar";
// ...
<ProjectTreeSidebar />
```

Leave the old folder rendering code commented out OR behind a feature flag (`process.env.NEXT_PUBLIC_LEGACY_FOLDER_UI === "true"`). Simplest path: comment out.

- [ ] **Step 4.3: Typecheck + manual smoke**

```bash
bun run typecheck
bun run dev
# open http://localhost:6001 and confirm the sidebar shows groups/projects
```

- [ ] **Step 4.4: Commit**

```bash
git add src/components/session/ProjectTreeSidebar.tsx src/components/session/Sidebar.tsx
git commit -m "feat(ui): render unified project tree in sidebar"
```

---

## Task 5: `ProjectPickerCombobox`

For the new-session wizard and other project-selection UIs.

- [ ] **Step 5.1: Implement**

`src/components/session/ProjectPickerCombobox.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

interface Props {
  value: string | null;
  onChange: (projectId: string) => void;
}

export function ProjectPickerCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const tree = useProjectTree();
  const selected = value ? tree.getProject(value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selected ? selected.name : "Select a project…"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search projects…" />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              {tree.projects.map((p) => {
                const group = tree.getGroup(p.groupId);
                return (
                  <CommandItem
                    key={p.id}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === p.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span>{p.name}</span>
                    {group ? (
                      <span className="ml-auto text-xs text-muted-foreground">{group.name}</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add src/components/session/ProjectPickerCombobox.tsx
git commit -m "feat(ui): add ProjectPickerCombobox for project selection"
```

---

## Task 6: Update `NewSessionWizard`

- [ ] **Step 6.1: Replace folder picker with project picker**

In `src/components/session/NewSessionWizard.tsx`, find the folder picker step. Replace with:

```tsx
<ProjectPickerCombobox
  value={form.projectId}
  onChange={(id) => setForm({ ...form, projectId: id })}
/>
```

Remove `folderId` from the form state; submit `projectId` to `/api/sessions`. The API route already accepts `projectId` (Phase 3).

- [ ] **Step 6.2: Typecheck + manual test**

- [ ] **Step 6.3: Commit**

```bash
git add src/components/session/NewSessionWizard.tsx
git commit -m "feat(ui): new-session wizard picks project instead of folder"
```

---

## Task 7: Preferences Modals — Split

- [ ] **Step 7.1: `GroupPreferencesModal`**

`src/components/preferences/GroupPreferencesModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onClose: () => void;
  groupId: string;
}

interface GroupPrefs {
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  startupCommand?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  environmentVars?: Record<string, string> | null;
  gitIdentityName?: string | null;
  gitIdentityEmail?: string | null;
  isSensitive?: boolean;
}

export function GroupPreferencesModal({ open, onClose, groupId }: Props) {
  const [prefs, setPrefs] = useState<GroupPrefs>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await fetch(`/api/node-preferences/group/${groupId}`);
      const body = await res.json();
      setPrefs(body.preferences ?? {});
    })();
  }, [open, groupId]);

  async function save() {
    setSaving(true);
    await fetch(`/api/node-preferences/group/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Group Preferences</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="cwd">Default working directory</Label>
            <Input
              id="cwd"
              value={prefs.defaultWorkingDirectory ?? ""}
              onChange={(e) => setPrefs({ ...prefs, defaultWorkingDirectory: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="shell">Default shell</Label>
            <Input
              id="shell"
              value={prefs.defaultShell ?? ""}
              onChange={(e) => setPrefs({ ...prefs, defaultShell: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="theme">Theme</Label>
            <Input
              id="theme"
              value={prefs.theme ?? ""}
              onChange={(e) => setPrefs({ ...prefs, theme: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7.2: `ProjectPreferencesModal`**

Same shape as the group modal, but including the project-only fields:

```tsx
// src/components/preferences/ProjectPreferencesModal.tsx
// ... identical layout to GroupPreferencesModal, but:
//     * PUT URL is /api/node-preferences/project/{projectId}
//     * Adds inputs for githubRepoId, localRepoPath, defaultAgentProvider, pinnedFiles (JSON textarea)
```

Copy the layout from `GroupPreferencesModal` and add:

```tsx
<div>
  <Label htmlFor="repo-id">GitHub repo ID</Label>
  <Input
    id="repo-id"
    type="number"
    value={prefs.githubRepoId ?? ""}
    onChange={(e) => setPrefs({ ...prefs, githubRepoId: e.target.value ? Number(e.target.value) : null })}
  />
</div>
<div>
  <Label htmlFor="local-path">Local repo path</Label>
  <Input
    id="local-path"
    value={prefs.localRepoPath ?? ""}
    onChange={(e) => setPrefs({ ...prefs, localRepoPath: e.target.value })}
  />
</div>
<div>
  <Label htmlFor="agent">Default agent provider</Label>
  <Input
    id="agent"
    value={prefs.defaultAgentProvider ?? ""}
    onChange={(e) => setPrefs({ ...prefs, defaultAgentProvider: e.target.value })}
  />
</div>
```

- [ ] **Step 7.3: Wire from the sidebar context menu**

In `Sidebar.tsx` (or wherever folder "Settings" was invoked), render `GroupPreferencesModal` when a group is right-clicked and `ProjectPreferencesModal` when a project is right-clicked:

```tsx
const [modalState, setModalState] = useState<{ type: "group" | "project"; id: string } | null>(null);
// ...
{modalState?.type === "group" && (
  <GroupPreferencesModal open onClose={() => setModalState(null)} groupId={modalState.id} />
)}
{modalState?.type === "project" && (
  <ProjectPreferencesModal open onClose={() => setModalState(null)} projectId={modalState.id} />
)}
```

- [ ] **Step 7.4: Commit**

```bash
git add src/components/preferences/
git commit -m "feat(ui): split folder preferences into group + project preference modals"
```

---

## Task 8: Active-Node Aggregation in Task & Channel Sidebars

- [ ] **Step 8.1: Update `TaskSidebar`**

In `src/components/tasks/TaskSidebar.tsx`, replace the active-folder read with active-node:

```tsx
const { activeNode } = useProjectTree();
useEffect(() => {
  if (!activeNode) return;
  void fetch(`/api/tasks?nodeId=${activeNode.id}&nodeType=${activeNode.type}`)
    .then((r) => r.json())
    .then((body) => setTasks(body.tasks));
}, [activeNode?.id, activeNode?.type]);
```

(`/api/tasks` route was updated in Phase 3 to accept `nodeId`/`nodeType`. If it still only accepts `folderId`, extend it now in the same Phase 4 commit: read `nodeId`/`nodeType`, call `TaskService.listByNode`.)

- [ ] **Step 8.2: Update `ChannelSidebar` similarly**

Same pattern: pull `activeNode` from `useProjectTree()`; call `/api/channels?nodeId=...&nodeType=...`.

- [ ] **Step 8.3: `ActiveNodeIndicator`**

`src/components/session/ActiveNodeIndicator.tsx`:

```tsx
"use client";

import { useProjectTree } from "@/contexts/ProjectTreeContext";

export function ActiveNodeIndicator() {
  const { activeNode, getGroup, getProject } = useProjectTree();
  if (!activeNode) return null;
  const entity =
    activeNode.type === "group" ? getGroup(activeNode.id) : getProject(activeNode.id);
  if (!entity) return null;
  return (
    <div className="text-xs text-muted-foreground">
      {entity.name}
      {activeNode.type === "group" ? <span className="ml-1 opacity-70">(rolled up)</span> : null}
    </div>
  );
}
```

Mount it in the sidebar header where the active folder name used to render.

- [ ] **Step 8.4: Typecheck + smoke test**

- [ ] **Step 8.5: Commit**

```bash
git add src/components/tasks/TaskSidebar.tsx src/components/channels/ChannelSidebar.tsx src/components/session/ActiveNodeIndicator.tsx
git commit -m "feat(ui): task + channel sidebars aggregate across active group"
```

---

## Task 9: SaveTemplateModal + SessionContext

- [ ] **Step 9.1: Replace `folderId` with `projectId` in `SaveTemplateModal`**

In `src/components/session/SaveTemplateModal.tsx`, swap the folder picker for a `ProjectPickerCombobox`. Submit `projectId`.

- [ ] **Step 9.2: `SessionContext`**

In `src/contexts/SessionContext.tsx`, the optimistic session creation flow passes `folderId` to the server. Add `projectId` to the payload and derive it from the active node when available.

- [ ] **Step 9.3: Commit**

```bash
git add src/components/session/SaveTemplateModal.tsx src/contexts/SessionContext.tsx
git commit -m "feat(ui): template + session creation flows pass projectId"
```

---

## Task 10: Regression Smoke + CHANGELOG

- [ ] **Step 10.1: Run dev server and manually exercise**

```bash
bun run dev
```

Check:
- Sidebar shows groups/projects instead of folders.
- Clicking a project activates it; clicking a group activates it with "(rolled up)" indicator.
- New session wizard picks a project.
- Right-clicking a group opens `GroupPreferencesModal`; right-clicking a project opens `ProjectPreferencesModal`.
- Task list changes when active node changes; with active group, tasks from descendant projects appear.
- Channel list behaves the same.

- [ ] **Step 10.2: CHANGELOG**

```markdown
### Changed
- Sidebar now shows groups and projects (leaf-only) instead of the previous flat folder list.
- New-session wizard and template editor now require a project.
- Preferences split into `GroupPreferencesModal` (shared settings only) and `ProjectPreferencesModal` (shared + project-only fields like repo, agent provider).
- Task + channel lists aggregate across descendants when the active node is a group.
```

- [ ] **Step 10.3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Phase 4 UI switchover to project tree"
```

---

## Phase 4 Exit Criteria

- [ ] `bun run typecheck` passes
- [ ] `bun run test:run` passes
- [ ] `bun run dev` loads; sidebar shows group/project tree
- [ ] Activating a group causes task + channel sidebars to show aggregated data
- [ ] All new-session / template / preferences flows use project IDs
- [ ] Old `FolderContext` still compiles (consumers that haven't been migrated still work)
- [ ] CHANGELOG updated

**On success:** `bd update remote-dev-1efl.4 --status closed`.
