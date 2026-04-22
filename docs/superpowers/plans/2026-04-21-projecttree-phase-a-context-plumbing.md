# Phase A — Context Plumbing

> **Parent plan:** [2026-04-21-projecttree-feature-parity.md](2026-04-21-projecttree-feature-parity.md)
> **Beads issue:** `remote-dev-oqol.1`
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Give `ProjectTreeContext` and row-component tests the data they need (session lookups, repo stats rollup, test-injectable context) without creating a circular dependency between `ProjectTreeContext` and `SessionContext`/`PreferencesContext`/`SecretsContext`.

**Architecture:** Keep `ProjectTreeContext` API additive. Put pure helpers in a new module `src/lib/project-tree-session-utils.ts`. Row components will call `useSessionContext()` directly for sessions and receive predicate props from `ProjectTreeSidebar` for prefs/secrets presence.

**Exit criteria:** Helpers unit-tested; `ProjectTreeContext` exported for test injection; no row components touched (that's Phase B).

---

## Task A1: Export ProjectTreeContext

**Why:** Component tests in Phase B need to inject a context value without running the real `ProjectTreeProvider` (which fetches `/api/groups` + `/api/projects` on mount).

**Files:**
- Modify: `src/contexts/ProjectTreeContext.tsx:65` — rename the internal `Ctx` to exported `ProjectTreeContext`

- [ ] **Step 1: Write the failing test**

Create `tests/contexts/ProjectTreeContext.lookups.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { ProjectTreeContext } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext export", () => {
  it("exports the context object so tests can inject a value", () => {
    expect(ProjectTreeContext).toBeDefined();
    expect(ProjectTreeContext.Provider).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
bun run test:run tests/contexts/ProjectTreeContext.lookups.test.tsx
```
Expected: FAIL — "`ProjectTreeContext` is not exported from `@/contexts/ProjectTreeContext`".

- [ ] **Step 3: Apply the edit**

In `src/contexts/ProjectTreeContext.tsx`:

```ts
// before
const Ctx = createContext<ProjectTreeContextValue | null>(null);

// after
export const ProjectTreeContext = createContext<ProjectTreeContextValue | null>(null);
```

Update the sole consumer inside the file:

```ts
// before
const ctx = useContext(Ctx);

// after
const ctx = useContext(ProjectTreeContext);
```

Also update `<Ctx.Provider>` → `<ProjectTreeContext.Provider>`.

- [ ] **Step 4: Run to verify pass**

```
bun run test:run tests/contexts/ProjectTreeContext.lookups.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ProjectTreeContext.tsx tests/contexts/ProjectTreeContext.lookups.test.tsx
git commit -m "refactor(project-tree): export context for test injection"
```

---

## Task A2: Session lookup + recursive count helpers

**Why:** Row components need "sessions for this project" and "recursive session count under this group". Keep these as **pure module-scope helpers** (no context dependencies, type-only imports). Note: `SessionContext` already depends on `useProjectTree()`; do NOT add a reverse dependency. Row components will `useSessionContext()` directly in Phase B and pass results into the helpers.

**Files:**
- Create: `src/lib/project-tree-session-utils.ts`
- Create: `tests/lib/project-tree-session-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

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

const groups = [
  { id: "g1", parentGroupId: null, name: "g1", collapsed: false, sortOrder: 0 },
  { id: "g2", parentGroupId: "g1", name: "g2", collapsed: false, sortOrder: 0 },
];
const projects = [
  { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0 },
  { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0 },
];

describe("sessionsForProject", () => {
  it("returns every session whose projectId matches", () => {
    expect(sessionsForProject(sessions, "p1").map((s) => s.id)).toEqual(["s1", "s2"]);
  });
  it("excludes file sessions when opt set", () => {
    expect(
      sessionsForProject(sessions, "p1", { excludeFileSessions: true }).map((s) => s.id)
    ).toEqual(["s1"]);
  });
  it("returns [] when project has no sessions", () => {
    expect(sessionsForProject(sessions, "p3")).toEqual([]);
  });
});

describe("recursiveSessionCount", () => {
  it("counts sessions in own projects plus descendant groups' projects", () => {
    // g1 owns p1 (1 non-file session: s1); descendant g2 owns p2 (1 session: s3) => 2
    expect(recursiveSessionCount(sessions, groups, projects, "g1")).toBe(2);
  });
  it("excludes file sessions from the count", () => {
    const onlyFile = [{ id: "s", projectId: "p1", terminalType: "file" }];
    expect(recursiveSessionCount(onlyFile, groups, projects, "g1")).toBe(0);
  });
  it("returns 0 for an empty leaf group", () => {
    const leafGroups = [{ id: "leaf", parentGroupId: null, name: "leaf", collapsed: false, sortOrder: 0 }];
    expect(recursiveSessionCount(sessions, leafGroups, [], "leaf")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
bun run test:run tests/lib/project-tree-session-utils.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/project-tree-session-utils.ts
import type { GroupNode, ProjectNode } from "@/contexts/ProjectTreeContext";

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
  const ownProjectIds = new Set(
    projects.filter((p) => p.groupId === groupId).map((p) => p.id)
  );
  const directCount = sessions.filter(
    (s) => s.projectId != null && ownProjectIds.has(s.projectId) && s.terminalType !== "file"
  ).length;
  const childGroupIds = groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id);
  const descendantCount = childGroupIds.reduce(
    (sum, cid) => sum + recursiveSessionCount(sessions, groups, projects, cid),
    0
  );
  return directCount + descendantCount;
}
```

- [ ] **Step 4: Run to verify pass**

```
bun run test:run tests/lib/project-tree-session-utils.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-tree-session-utils.ts tests/lib/project-tree-session-utils.test.ts
git commit -m "feat(project-tree): add session lookup + recursive count helpers"
```

---

## Task A3: Rolled-up repo stats helper

**Why:** `GroupRow` needs to show aggregated PR/issue/changes badges when collapsed (matching the legacy `getRolledUpStats` folder behavior).

**Files:**
- Modify: `src/lib/project-tree-session-utils.ts` — add `rolledUpRepoStats`
- Modify: `tests/lib/project-tree-session-utils.test.ts` — add tests

- [ ] **Step 1: Extend the test file**

Append:

```ts
import { rolledUpRepoStats } from "@/lib/project-tree-session-utils";

describe("rolledUpRepoStats", () => {
  const groups = [
    { id: "g1", parentGroupId: null, name: "g1", collapsed: true, sortOrder: 0 },
    { id: "g2", parentGroupId: "g1", name: "g2", collapsed: false, sortOrder: 0 },
  ];
  const projects = [
    { id: "p1", groupId: "g1", name: "p1", isAutoCreated: false, sortOrder: 0 },
    { id: "p2", groupId: "g2", name: "p2", isAutoCreated: false, sortOrder: 0 },
  ];

  it("returns the project's own stats for project nodes", () => {
    const getStats = (pid: string) =>
      pid === "p1" ? { prCount: 1, issueCount: 2, hasChanges: false } : null;
    expect(rolledUpRepoStats(groups, projects, getStats, { type: "project", id: "p1" })).toEqual({
      prCount: 1,
      issueCount: 2,
      hasChanges: false,
    });
  });

  it("returns null for expanded groups (children render their own)", () => {
    const getStats = () => ({ prCount: 1, issueCount: 0, hasChanges: false });
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: false })
    ).toBeNull();
  });

  it("aggregates descendant project stats for collapsed groups", () => {
    const getStats = (pid: string) =>
      pid === "p1"
        ? { prCount: 2, issueCount: 1, hasChanges: true }
        : pid === "p2"
        ? { prCount: 1, issueCount: 0, hasChanges: false }
        : null;
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toEqual({ prCount: 3, issueCount: 1, hasChanges: true });
  });

  it("returns null when a collapsed group has no stats in its descendants", () => {
    const getStats = () => null;
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toBeNull();
  });

  it("returns null when all aggregated stats are zero/false", () => {
    const getStats = () => ({ prCount: 0, issueCount: 0, hasChanges: false });
    expect(
      rolledUpRepoStats(groups, projects, getStats, { type: "group", id: "g1", collapsed: true })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
bun run test:run tests/lib/project-tree-session-utils.test.ts
```
Expected: FAIL — `rolledUpRepoStats` not found.

- [ ] **Step 3: Implement**

Append to `src/lib/project-tree-session-utils.ts`:

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
  node:
    | { type: "project"; id: string }
    | { type: "group"; id: string; collapsed: boolean }
): RepoStats | null {
  if (node.type === "project") return getProjectStats(node.id);
  if (!node.collapsed) return null;
  const descendantProjectIds = collectDescendantProjectIds(groups, projects, node.id);
  const acc: RepoStats = { prCount: 0, issueCount: 0, hasChanges: false };
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
  const seen = new Set<string>([rootGroupId]);
  const queue = [rootGroupId];
  while (queue.length) {
    const gid = queue.shift()!;
    for (const child of groups) {
      if (child.parentGroupId === gid && !seen.has(child.id)) {
        seen.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return projects.filter((p) => seen.has(p.groupId)).map((p) => p.id);
}
```

- [ ] **Step 4: Run to verify pass**

```
bun run test:run tests/lib/project-tree-session-utils.test.ts
```
Expected: PASS (8 tests total in file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-tree-session-utils.ts tests/lib/project-tree-session-utils.test.ts
git commit -m "feat(project-tree): add rolled-up repo stats helper with cycle-safe BFS"
```

---

## Task A4: (Removed — see parent plan)

Presence predicates (`hasCustomPreferences`, `hasActiveSecrets`, `hasLinkedRepository`) are consumed as props from `ProjectTreeSidebar` in Phase B/D rather than added to `ProjectTreeContext`, to avoid coupling ProjectTreeContext to Preferences/Secrets contexts. No work in Phase A.

---

## Acceptance Criteria

- [ ] `bun run test:run tests/lib/project-tree-session-utils.test.ts` — 8 tests pass
- [ ] `bun run test:run tests/contexts/ProjectTreeContext.lookups.test.tsx` — 1 test passes
- [ ] `bun run typecheck` — no new errors
- [ ] Three commits landed: (1) export context, (2) session helpers, (3) rolled-up stats

## Risks / Open Questions

- **Import cycle risk:** `project-tree-session-utils.ts` imports types from `@/contexts/ProjectTreeContext`. If `ProjectTreeContext` ever imports back from this util, we'd loop. Mitigation: keep helpers pure + type-only dependencies.
- **`MinimalSession` coverage:** chosen fields (`id`, `projectId`, `terminalType`) match what legacy code filters on. If Phase B needs more (e.g., `pinned`, `worktreeBranch`), extend this type then — don't pre-speculate.
