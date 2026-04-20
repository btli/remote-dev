# Phase 3: Services + API Routes - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Implement Drizzle-backed repositories for `ProjectGroup`, `Project`, and `NodePreferences`. Add `GroupService` + `ProjectService`. Introduce new API routes `/api/groups` and `/api/projects`. Update all downstream services to read `projectId` with fallback to `folderId` during the soft-transition window.

**Architecture:** Repository implementations follow existing `src/infrastructure/persistence/repositories/` pattern. Services wrap use cases and add presenters. API routes mirror existing `/api/folders` shape for easy diff review. Downstream services (`SessionService`, `TaskService`, `ChannelService`, `PeerService`, `SecretsService`, `AgentProfileService`) gain a `resolveProjectIds(nodeRef)` helper injected via container. The `folder_id` columns remain populated (dual-writes) until Phase 6.

**Tech Stack:** TypeScript, Drizzle ORM, Next.js 16 route handlers, Vitest.

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md).

---

## File Structure

**Create (infrastructure):**
- `src/infrastructure/persistence/repositories/DrizzleProjectGroupRepository.ts`
- `src/infrastructure/persistence/repositories/DrizzleProjectRepository.ts`
- `src/infrastructure/persistence/repositories/DrizzleNodePreferencesRepository.ts`
- `src/infrastructure/persistence/mappers/projectGroupMapper.ts`
- `src/infrastructure/persistence/mappers/projectMapper.ts`
- `src/infrastructure/persistence/mappers/nodePreferencesMapper.ts`

**Create (services):**
- `src/services/group-service.ts`
- `src/services/project-service.ts`
- `src/services/group-scope-service.ts` — thin wrapper around `ResolveProjectScope` for non-DI callers

**Create (API routes):**
- `src/app/api/groups/route.ts` — GET list, POST create
- `src/app/api/groups/[id]/route.ts` — GET, PATCH, DELETE
- `src/app/api/groups/[id]/move/route.ts` — POST
- `src/app/api/projects/route.ts` — GET list, POST create
- `src/app/api/projects/[id]/route.ts` — GET, PATCH, DELETE
- `src/app/api/projects/[id]/move/route.ts` — POST
- `src/app/api/node-preferences/[ownerType]/[ownerId]/route.ts` — GET, PUT, DELETE
- `src/app/api/preferences/active-node/route.ts` — POST (replaces `/api/preferences/active-folder`)

**Modify:**
- `src/infrastructure/container.ts` — register new repos + services
- `src/services/session-service.ts` — accept `projectId` alongside `folderId`; dual-write
- `src/services/task-service.ts` — aggregation support via `resolveProjectIds`
- `src/services/channel-service.ts` — same
- `src/services/peer-service.ts` — same
- `src/services/secrets-service.ts` — read `projectSecretsConfig` first, fall back to `folderSecretsConfig`
- `src/services/agent-profile-service.ts` — read `projectProfileLinks` first
- `src/lib/preferences.ts` — add node-aware `buildNodeAncestry()` walker; keep old `buildAncestryChain` for compat
- `src/app/api/preferences/route.ts` — surface node preferences alongside folder prefs

**Do NOT touch:**
- UI components or contexts (Phase 4)
- rdv CLI (Phase 5)

---

## Task 1: Mappers (DB row ↔ domain entity)

- [ ] **Step 1.1: `projectGroupMapper`**

`src/infrastructure/persistence/mappers/projectGroupMapper.ts`:

```typescript
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { projectGroups } from "@/db/schema";

export type ProjectGroupRow = typeof projectGroups.$inferSelect;

export function toDomain(row: ProjectGroupRow): ProjectGroup {
  return ProjectGroup.create({
    id: row.id,
    userId: row.userId,
    parentGroupId: row.parentGroupId,
    name: row.name,
    collapsed: row.collapsed,
    sortOrder: row.sortOrder,
    legacyFolderId: row.legacyFolderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toInsert(group: ProjectGroup): typeof projectGroups.$inferInsert {
  return {
    id: group.id,
    userId: group.userId,
    parentGroupId: group.parentGroupId,
    name: group.name,
    collapsed: group.collapsed,
    sortOrder: group.sortOrder,
    legacyFolderId: group.legacyFolderId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
```

- [ ] **Step 1.2: `projectMapper` (same shape)**

`src/infrastructure/persistence/mappers/projectMapper.ts`:

```typescript
import { Project } from "@/domain/entities/Project";
import { projects } from "@/db/schema";

export type ProjectRow = typeof projects.$inferSelect;

export function toDomain(row: ProjectRow): Project {
  return Project.create({
    id: row.id,
    userId: row.userId,
    groupId: row.groupId,
    name: row.name,
    collapsed: row.collapsed,
    sortOrder: row.sortOrder,
    isAutoCreated: row.isAutoCreated,
    legacyFolderId: row.legacyFolderId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toInsert(p: Project): typeof projects.$inferInsert {
  return {
    id: p.id,
    userId: p.userId,
    groupId: p.groupId,
    name: p.name,
    collapsed: p.collapsed,
    sortOrder: p.sortOrder,
    isAutoCreated: p.isAutoCreated,
    legacyFolderId: p.legacyFolderId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
```

- [ ] **Step 1.3: `nodePreferencesMapper`**

`src/infrastructure/persistence/mappers/nodePreferencesMapper.ts`:

```typescript
import { NodePreferences } from "@/domain/value-objects/NodePreferences";
import { nodePreferences } from "@/db/schema";

export type NodePreferencesRow = typeof nodePreferences.$inferSelect;

export function toDomain(row: NodePreferencesRow): NodePreferences {
  const fields = {
    defaultWorkingDirectory: row.defaultWorkingDirectory,
    defaultShell: row.defaultShell,
    startupCommand: row.startupCommand,
    theme: row.theme,
    fontSize: row.fontSize,
    fontFamily: row.fontFamily,
    githubRepoId: row.githubRepoId,
    localRepoPath: row.localRepoPath,
    defaultAgentProvider: row.defaultAgentProvider,
    environmentVars: row.environmentVars as Record<string, string> | null,
    pinnedFiles: row.pinnedFiles as string[] | null,
    gitIdentityName: row.gitIdentityName,
    gitIdentityEmail: row.gitIdentityEmail,
    isSensitive: row.isSensitive,
  };
  return row.ownerType === "group"
    ? NodePreferences.forGroup(fields)
    : NodePreferences.forProject(fields);
}
```

- [ ] **Step 1.4: Commit**

```bash
git add src/infrastructure/persistence/mappers/projectGroupMapper.ts src/infrastructure/persistence/mappers/projectMapper.ts src/infrastructure/persistence/mappers/nodePreferencesMapper.ts
git commit -m "feat(infra): add mappers for project group/project/node preferences"
```

---

## Task 2: `DrizzleProjectGroupRepository`

- [ ] **Step 2.1: Implement**

`src/infrastructure/persistence/repositories/DrizzleProjectGroupRepository.ts`:

```typescript
import { eq, sql } from "drizzle-orm";
import { db, client } from "@/db";
import { projectGroups } from "@/db/schema";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import * as mapper from "@/infrastructure/persistence/mappers/projectGroupMapper";

export class DrizzleProjectGroupRepository implements ProjectGroupRepository {
  async findById(id: string): Promise<ProjectGroup | null> {
    const rows = await db.select().from(projectGroups).where(eq(projectGroups.id, id));
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<ProjectGroup[]> {
    const rows = await db.select().from(projectGroups).where(eq(projectGroups.userId, userId));
    return rows.map(mapper.toDomain);
  }

  async save(group: ProjectGroup): Promise<void> {
    const insert = mapper.toInsert(group);
    await db
      .insert(projectGroups)
      .values(insert)
      .onConflictDoUpdate({
        target: projectGroups.id,
        set: {
          parentGroupId: insert.parentGroupId,
          name: insert.name,
          collapsed: insert.collapsed,
          sortOrder: insert.sortOrder,
          updatedAt: insert.updatedAt,
        },
      });
  }

  async delete(id: string): Promise<void> {
    await db.delete(projectGroups).where(eq(projectGroups.id, id));
  }

  async listAncestry(groupId: string): Promise<ProjectGroup[]> {
    // Recursive CTE walking parentGroupId upward.
    const result = await client.execute({
      sql: `
        WITH RECURSIVE ancestry(id, parent_group_id, user_id, name, collapsed, sort_order, legacy_folder_id, created_at, updated_at, depth) AS (
          SELECT id, parent_group_id, user_id, name, collapsed, sort_order, legacy_folder_id, created_at, updated_at, 0
            FROM project_group WHERE id = ?
          UNION ALL
          SELECT pg.id, pg.parent_group_id, pg.user_id, pg.name, pg.collapsed, pg.sort_order, pg.legacy_folder_id, pg.created_at, pg.updated_at, a.depth + 1
            FROM project_group pg JOIN ancestry a ON pg.id = a.parent_group_id
        )
        SELECT * FROM ancestry ORDER BY depth ASC
      `,
      args: [groupId],
    });
    return result.rows.map((r) => mapper.toDomain({
      id: r.id as string,
      parentGroupId: r.parent_group_id as string | null,
      userId: r.user_id as string,
      name: r.name as string,
      collapsed: Boolean(r.collapsed),
      sortOrder: Number(r.sort_order),
      legacyFolderId: r.legacy_folder_id as string | null,
      createdAt: new Date(Number(r.created_at)),
      updatedAt: new Date(Number(r.updated_at)),
    }));
  }

  /**
   * Returns the given groupId plus all descendant group IDs, flattened.
   *
   * Cycle protection: `UNION` (not `UNION ALL`) deduplicates on `id`, so if the
   * graph ever contains a cycle the recursion terminates instead of looping.
   * A depth guard caps runaway recursion on pathological data.
   *
   * Includes the root `groupId` in the result so callers don't have to union
   * it in separately.
   */
  async listDescendantGroupIds(groupId: string): Promise<string[]> {
    const result = await client.execute({
      sql: `
        WITH RECURSIVE descendants(id, depth) AS (
          SELECT id, 0 FROM project_group WHERE id = ?
          UNION
          SELECT pg.id, d.depth + 1
          FROM project_group pg
          JOIN descendants d ON pg.parent_group_id = d.id
          WHERE d.depth < 128
        )
        SELECT id FROM descendants
      `,
      args: [groupId],
    });
    return result.rows.map((r) => r.id as string);
  }
}
```

**Scale note (P1):** Never feed the result of `listDescendantGroupIds` back into an `inArray`/`IN (?, ?, …)` clause in JS. SQLite's default bind-parameter limit is ~32,000; a user with 10k groups will blow past it. Instead, `GroupScopeService.resolveProjectIds` (Task 8) and all downstream filters must push the descendant CTE into the SAME query that filters the leaf table, so the join happens in SQL and nothing is materialized into a JS array first.

- [ ] **Step 2.2: Commit**

```bash
git add src/infrastructure/persistence/repositories/DrizzleProjectGroupRepository.ts
git commit -m "feat(infra): add DrizzleProjectGroupRepository with recursive CTE support"
```

---

## Task 3: `DrizzleProjectRepository`

- [ ] **Step 3.1: Implement**

`src/infrastructure/persistence/repositories/DrizzleProjectRepository.ts`:

```typescript
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import * as mapper from "@/infrastructure/persistence/mappers/projectMapper";

export class DrizzleProjectRepository implements ProjectRepository {
  async findById(id: string): Promise<Project | null> {
    const rows = await db.select().from(projects).where(eq(projects.id, id));
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<Project[]> {
    const rows = await db.select().from(projects).where(eq(projects.userId, userId));
    return rows.map(mapper.toDomain);
  }

  async listByGroup(groupId: string): Promise<Project[]> {
    const rows = await db.select().from(projects).where(eq(projects.groupId, groupId));
    return rows.map(mapper.toDomain);
  }

  async listByGroupIds(groupIds: string[]): Promise<Project[]> {
    if (groupIds.length === 0) return [];
    const rows = await db.select().from(projects).where(inArray(projects.groupId, groupIds));
    return rows.map(mapper.toDomain);
  }

  async save(p: Project): Promise<void> {
    const insert = mapper.toInsert(p);
    await db
      .insert(projects)
      .values(insert)
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          groupId: insert.groupId,
          name: insert.name,
          collapsed: insert.collapsed,
          sortOrder: insert.sortOrder,
          updatedAt: insert.updatedAt,
        },
      });
  }

  async delete(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/infrastructure/persistence/repositories/DrizzleProjectRepository.ts
git commit -m "feat(infra): add DrizzleProjectRepository"
```

---

## Task 4: `DrizzleNodePreferencesRepository`

- [ ] **Step 4.1: Implement**

```typescript
// src/infrastructure/persistence/repositories/DrizzleNodePreferencesRepository.ts
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { nodePreferences } from "@/db/schema";
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";
import { NodePreferencesRepository } from "@/application/ports/NodePreferencesRepository";
import * as mapper from "@/infrastructure/persistence/mappers/nodePreferencesMapper";

export class DrizzleNodePreferencesRepository implements NodePreferencesRepository {
  async findForNode(node: NodeRef, userId: string): Promise<NodePreferences | null> {
    const rows = await db
      .select()
      .from(nodePreferences)
      .where(
        and(
          eq(nodePreferences.ownerId, node.id),
          eq(nodePreferences.ownerType, node.type),
          eq(nodePreferences.userId, userId)
        )
      );
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<Map<string, NodePreferences>> {
    const rows = await db
      .select()
      .from(nodePreferences)
      .where(eq(nodePreferences.userId, userId));
    const out = new Map<string, NodePreferences>();
    for (const r of rows) {
      out.set(`${r.ownerType}:${r.ownerId}`, mapper.toDomain(r));
    }
    return out;
  }

  async save(node: NodeRef, userId: string, prefs: NodePreferences): Promise<void> {
    const existing = await this.findForNode(node, userId);
    const now = new Date();
    const fields = prefs.fields;
    if (existing) {
      await db
        .update(nodePreferences)
        .set({
          defaultWorkingDirectory: fields.defaultWorkingDirectory ?? null,
          defaultShell: fields.defaultShell ?? null,
          startupCommand: fields.startupCommand ?? null,
          theme: fields.theme ?? null,
          fontSize: fields.fontSize ?? null,
          fontFamily: fields.fontFamily ?? null,
          githubRepoId: fields.githubRepoId ?? null,
          localRepoPath: fields.localRepoPath ?? null,
          defaultAgentProvider: fields.defaultAgentProvider ?? null,
          environmentVars: fields.environmentVars ?? null,
          pinnedFiles: fields.pinnedFiles ?? null,
          gitIdentityName: fields.gitIdentityName ?? null,
          gitIdentityEmail: fields.gitIdentityEmail ?? null,
          isSensitive: fields.isSensitive ?? false,
          updatedAt: now,
        })
        .where(
          and(
            eq(nodePreferences.ownerId, node.id),
            eq(nodePreferences.ownerType, node.type),
            eq(nodePreferences.userId, userId)
          )
        );
    } else {
      await db.insert(nodePreferences).values({
        id: randomUUID(),
        ownerId: node.id,
        ownerType: node.type,
        userId,
        defaultWorkingDirectory: fields.defaultWorkingDirectory ?? null,
        defaultShell: fields.defaultShell ?? null,
        startupCommand: fields.startupCommand ?? null,
        theme: fields.theme ?? null,
        fontSize: fields.fontSize ?? null,
        fontFamily: fields.fontFamily ?? null,
        githubRepoId: fields.githubRepoId ?? null,
        localRepoPath: fields.localRepoPath ?? null,
        defaultAgentProvider: fields.defaultAgentProvider ?? null,
        environmentVars: fields.environmentVars ?? null,
        pinnedFiles: fields.pinnedFiles ?? null,
        gitIdentityName: fields.gitIdentityName ?? null,
        gitIdentityEmail: fields.gitIdentityEmail ?? null,
        isSensitive: fields.isSensitive ?? false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async delete(node: NodeRef, userId: string): Promise<void> {
    await db.delete(nodePreferences).where(
      and(
        eq(nodePreferences.ownerId, node.id),
        eq(nodePreferences.ownerType, node.type),
        eq(nodePreferences.userId, userId)
      )
    );
  }
}
```

- [ ] **Step 4.2: Commit**

```bash
git add src/infrastructure/persistence/repositories/DrizzleNodePreferencesRepository.ts
git commit -m "feat(infra): add DrizzleNodePreferencesRepository"
```

---

## Task 5: Container Wiring

- [ ] **Step 5.1: Read current container**

Run: open `src/infrastructure/container.ts` and find where folder repo is wired.

- [ ] **Step 5.2: Add new bindings**

Add after existing folder repo binding:

```typescript
import { DrizzleProjectGroupRepository } from "@/infrastructure/persistence/repositories/DrizzleProjectGroupRepository";
import { DrizzleProjectRepository } from "@/infrastructure/persistence/repositories/DrizzleProjectRepository";
import { DrizzleNodePreferencesRepository } from "@/infrastructure/persistence/repositories/DrizzleNodePreferencesRepository";
import { CreateProjectGroup } from "@/application/use-cases/project-group/CreateProjectGroup";
import { UpdateProjectGroup } from "@/application/use-cases/project-group/UpdateProjectGroup";
import { MoveProjectGroup } from "@/application/use-cases/project-group/MoveProjectGroup";
import { DeleteProjectGroup } from "@/application/use-cases/project-group/DeleteProjectGroup";
import { CreateProject } from "@/application/use-cases/project/CreateProject";
import { UpdateProject } from "@/application/use-cases/project/UpdateProject";
import { MoveProject } from "@/application/use-cases/project/MoveProject";
import { DeleteProject } from "@/application/use-cases/project/DeleteProject";
import { ResolveProjectScope } from "@/application/use-cases/project/ResolveProjectScope";

const projectGroupRepository = new DrizzleProjectGroupRepository();
const projectRepository = new DrizzleProjectRepository();
const nodePreferencesRepository = new DrizzleNodePreferencesRepository();

export const container = {
  // ...existing bindings retained...
  projectGroupRepository,
  projectRepository,
  nodePreferencesRepository,
  useCases: {
    // ...existing use cases retained...
    createProjectGroup: new CreateProjectGroup(projectGroupRepository),
    updateProjectGroup: new UpdateProjectGroup(projectGroupRepository),
    moveProjectGroup: new MoveProjectGroup(projectGroupRepository),
    deleteProjectGroup: new DeleteProjectGroup(projectGroupRepository, projectRepository),
    createProject: new CreateProject(projectRepository, projectGroupRepository),
    updateProject: new UpdateProject(projectRepository),
    moveProject: new MoveProject(projectRepository, projectGroupRepository),
    deleteProject: new DeleteProject(projectRepository),
    resolveProjectScope: new ResolveProjectScope(projectGroupRepository, projectRepository),
  },
};
```

If the container already has a `useCases` sub-object, merge the new entries; otherwise introduce it while preserving existing structure.

- [ ] **Step 5.3: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 5.4: Commit**

```bash
git add src/infrastructure/container.ts
git commit -m "feat(infra): wire project/group repositories and use cases in container"
```

---

## Task 6: `GroupService` + `ProjectService` Facades

- [ ] **Step 6.1: `GroupService`**

`src/services/group-service.ts`:

```typescript
import { container } from "@/infrastructure/container";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";

export class GroupService {
  static async list(userId: string): Promise<ProjectGroup[]> {
    return container.projectGroupRepository.listByUser(userId);
  }

  static async get(id: string): Promise<ProjectGroup | null> {
    return container.projectGroupRepository.findById(id);
  }

  static async create(input: { userId: string; name: string; parentGroupId: string | null; sortOrder?: number }) {
    return container.useCases.createProjectGroup.execute(input);
  }

  static async update(input: { id: string; name?: string; collapsed?: boolean; sortOrder?: number }) {
    return container.useCases.updateProjectGroup.execute(input);
  }

  static async move(input: { id: string; newParentGroupId: string | null }) {
    return container.useCases.moveProjectGroup.execute(input);
  }

  static async delete(input: { id: string; force?: boolean }) {
    return container.useCases.deleteProjectGroup.execute(input);
  }
}
```

- [ ] **Step 6.2: `ProjectService`**

`src/services/project-service.ts`:

```typescript
import { container } from "@/infrastructure/container";
import { Project } from "@/domain/entities/Project";

export class ProjectService {
  static async listByUser(userId: string): Promise<Project[]> {
    return container.projectRepository.listByUser(userId);
  }

  static async listByGroup(groupId: string): Promise<Project[]> {
    return container.projectRepository.listByGroup(groupId);
  }

  static async get(id: string): Promise<Project | null> {
    return container.projectRepository.findById(id);
  }

  static async create(input: { userId: string; groupId: string; name: string; sortOrder?: number }) {
    return container.useCases.createProject.execute(input);
  }

  static async update(input: { id: string; name?: string; collapsed?: boolean; sortOrder?: number }) {
    return container.useCases.updateProject.execute(input);
  }

  static async move(input: { id: string; newGroupId: string }) {
    return container.useCases.moveProject.execute(input);
  }

  static async delete(id: string) {
    return container.useCases.deleteProject.execute(id);
  }
}
```

- [ ] **Step 6.3: `GroupScopeService`**

`src/services/group-scope-service.ts`:

```typescript
import { container } from "@/infrastructure/container";
import { NodeRef, NodeType } from "@/domain/value-objects/NodeRef";

export class GroupScopeService {
  static async resolveProjectIds(input: { id: string; type: NodeType }): Promise<string[]> {
    const ref = input.type === "group" ? NodeRef.group(input.id) : NodeRef.project(input.id);
    return container.useCases.resolveProjectScope.execute(ref);
  }
}
```

- [ ] **Step 6.4: Commit**

```bash
git add src/services/group-service.ts src/services/project-service.ts src/services/group-scope-service.ts
git commit -m "feat(services): add Group/Project/GroupScope service facades"
```

---

## Task 7: API Routes — `/api/groups`

- [ ] **Step 7.1: `GET /api/groups` + `POST /api/groups`**

`src/app/api/groups/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { GroupService } from "@/services/group-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/groups");

const createSchema = z.object({
  name: z.string().min(1),
  parentGroupId: z.string().nullable(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, session) => {
  const groups = await GroupService.list(session.user.id);
  return NextResponse.json({ groups: groups.map((g) => g.props) });
});

export const POST = withApiAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const group = await GroupService.create({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json({ group: group.props }, { status: 201 });
  } catch (err) {
    log.error("create group failed", { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
});
```

- [ ] **Step 7.2: `[id]` routes**

`src/app/api/groups/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { GroupService } from "@/services/group-service";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, _session, { params }: { params: { id: string } }) => {
  const group = await GroupService.get(params.id);
  if (!group) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ group: group.props });
});

export const PATCH = withApiAuth(async (req, _session, { params }) => {
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const group = await GroupService.update({ id: params.id, ...parsed.data });
  return NextResponse.json({ group: group.props });
});

export const DELETE = withApiAuth(async (req, _session, { params }) => {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  await GroupService.delete({ id: params.id, force });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 7.3: Move route**

`src/app/api/groups/[id]/move/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { GroupService } from "@/services/group-service";

const schema = z.object({ newParentGroupId: z.string().nullable() });

export const POST = withApiAuth(async (req, _session, { params }) => {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await GroupService.move({ id: params.id, newParentGroupId: parsed.data.newParentGroupId });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 7.4: Commit**

```bash
git add src/app/api/groups/
git commit -m "feat(api): add /api/groups CRUD + move endpoints"
```

---

## Task 8: API Routes — `/api/projects`

- [ ] **Step 8.1: `GET` + `POST` /api/projects**

`src/app/api/projects/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

const createSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (req, session) => {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const projects = groupId
    ? await ProjectService.listByGroup(groupId)
    : await ProjectService.listByUser(session.user.id);
  return NextResponse.json({ projects: projects.map((p) => p.props) });
});

export const POST = withApiAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  try {
    const project = await ProjectService.create({ userId: session.user.id, ...parsed.data });
    return NextResponse.json({ project: project.props }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
});
```

- [ ] **Step 8.2: `[id]` + move routes**

`src/app/api/projects/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, _session, { params }) => {
  const project = await ProjectService.get(params.id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project: project.props });
});

export const PATCH = withApiAuth(async (req, _session, { params }) => {
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const project = await ProjectService.update({ id: params.id, ...parsed.data });
  return NextResponse.json({ project: project.props });
});

export const DELETE = withApiAuth(async (_req, _session, { params }) => {
  await ProjectService.delete(params.id);
  return NextResponse.json({ ok: true });
});
```

`src/app/api/projects/[id]/move/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

const schema = z.object({ newGroupId: z.string().min(1) });

export const POST = withApiAuth(async (req, _session, { params }) => {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await ProjectService.move({ id: params.id, newGroupId: parsed.data.newGroupId });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 8.3: Commit**

```bash
git add src/app/api/projects/
git commit -m "feat(api): add /api/projects CRUD + move endpoints"
```

---

## Task 8a: `/api/sessions` + session-writer routes accept `projectId`

Phase 4 (UI wizard) and Phase 5 (`rdv agent start --project-id`) both assume the server already accepts `projectId` at session creation. Phase 3 ships that contract explicitly so those downstream phases can depend on it.

**Files:**
- Modify: `src/app/api/sessions/route.ts` — accept `projectId` in POST body
- Modify: `src/app/api/sessions/[id]/spawn/route.ts` — accept `projectId` in spawn body
- Modify: `src/app/api/sessions/[id]/folder/route.ts` — keep for folder moves; also accept `projectId` for project moves
- Modify: `src/services/session-service.ts` — already dual-writes in Task 10.2; ensure API wires through
- Create: `tests/api/sessions-project-id.test.ts`

- [ ] **Step 8a.1: Write failing test**

`tests/api/sessions-project-id.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Assumes the test harness exposes a fetch helper bound to the API server and
// seeds a user with one group + one project whose legacyFolderId === "folder-X".
import { apiFetch, seedProjectFixture } from "@/../tests/helpers/api";

describe("POST /api/sessions — projectId contract", () => {
  it("accepts projectId only", async () => {
    const { projectId } = await seedProjectFixture();
    const res = await apiFetch("/api/sessions", {
      method: "POST",
      body: { projectId, name: "p-only" },
    });
    expect(res.status).toBe(200);
    expect(res.body.session.projectId).toBe(projectId);
    expect(res.body.session.folderId).toBeTruthy(); // legacy still dual-written
  });

  it("accepts folderId only and backfills projectId from legacy mapping", async () => {
    const { folderId, projectId } = await seedProjectFixture();
    const res = await apiFetch("/api/sessions", {
      method: "POST",
      body: { folderId, name: "f-only" },
    });
    expect(res.status).toBe(200);
    expect(res.body.session.folderId).toBe(folderId);
    expect(res.body.session.projectId).toBe(projectId);
  });

  it("accepts both and prefers projectId", async () => {
    const { folderId, projectId } = await seedProjectFixture();
    const res = await apiFetch("/api/sessions", {
      method: "POST",
      body: { folderId, projectId, name: "both" },
    });
    expect(res.status).toBe(200);
    expect(res.body.session.projectId).toBe(projectId);
  });
});
```

- [ ] **Step 8a.2: Run test to verify it fails**

Run: `bun run test:run tests/api/sessions-project-id.test.ts`
Expected: FAIL (body parser rejects `projectId`, or `session.projectId` comes back null).

- [ ] **Step 8a.3: Extend the request schema and call into SessionService**

In `src/app/api/sessions/route.ts`, find the existing `createSchema` Zod object and add:

```typescript
const createSchema = z.object({
  // ...existing fields...
  folderId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  // ...
});
```

And in the POST handler body, forward both to SessionService (which already dual-writes per Task 10.2):

```typescript
const input = createSchema.parse(body);
const session = await SessionService.create({
  // ...
  folderId: input.folderId ?? null,
  projectId: input.projectId ?? null,
  // SessionService translates folderId→projectId via translateFolderIdToProjectId when projectId is missing.
});
```

Apply the same change to `src/app/api/sessions/[id]/spawn/route.ts` (spawn path) and `src/app/api/sessions/[id]/folder/route.ts` (add a `projectId` branch that calls `SessionService.moveToProject`).

- [ ] **Step 8a.4: Run tests + typecheck**

Run: `bun run test:run tests/api/sessions-project-id.test.ts && bun run typecheck`
Expected: PASS (3/3) + typecheck clean.

- [ ] **Step 8a.5: Commit**

```bash
git add src/app/api/sessions/ tests/api/sessions-project-id.test.ts
git commit -m "feat(api): /api/sessions accepts projectId with folderId fallback (dual-write)"
```

---

## Task 9: Node Preferences API

- [ ] **Step 9.1: `/api/node-preferences/[ownerType]/[ownerId]`**

`src/app/api/node-preferences/[ownerType]/[ownerId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { container } from "@/infrastructure/container";
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";

const ownerSchema = z.object({
  ownerType: z.enum(["group", "project"]),
  ownerId: z.string().min(1),
});

function refFromParams(params: { ownerType: string; ownerId: string }) {
  const parsed = ownerSchema.parse(params);
  return parsed.ownerType === "group" ? NodeRef.group(parsed.ownerId) : NodeRef.project(parsed.ownerId);
}

export const GET = withApiAuth(async (_req, session, { params }) => {
  const ref = refFromParams(params);
  const prefs = await container.nodePreferencesRepository.findForNode(ref, session.user.id);
  return NextResponse.json({ preferences: prefs?.fields ?? null });
});

export const PUT = withApiAuth(async (req, session, { params }) => {
  const ref = refFromParams(params);
  const body = await req.json();
  const prefs =
    ref.type === "group" ? NodePreferences.forGroup(body) : NodePreferences.forProject(body);
  await container.nodePreferencesRepository.save(ref, session.user.id, prefs);
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiAuth(async (_req, session, { params }) => {
  const ref = refFromParams(params);
  await container.nodePreferencesRepository.delete(ref, session.user.id);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 9.2: `/api/preferences/active-node`**

`src/app/api/preferences/active-node/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "@/lib/api";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  nodeId: z.string().min(1),
  nodeType: z.enum(["group", "project"]),
});

export const POST = withApiAuth(async (req, session) => {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  await db
    .update(userSettings)
    .set({ activeNodeId: parsed.data.nodeId, activeNodeType: parsed.data.nodeType })
    .where(eq(userSettings.userId, session.user.id));
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 9.3: Commit**

```bash
git add src/app/api/node-preferences/ src/app/api/preferences/active-node/
git commit -m "feat(api): add node-preferences and active-node endpoints"
```

---

## Task 10: Downstream Services — Read `projectId` with Fallback + Dual-Write All Writers

Each downstream service gets a shared helper: if a caller passes `projectId`, use it; if only `folderId` is available, translate via `projects.legacyFolderId` lookup. The helper lives on a single util to keep the policy uniform.

**Dual-write scope (all services that insert into a bridged table):**

| Service | File | Table(s) it writes |
|---|---|---|
| SessionService | `src/services/session-service.ts` | `terminal_session` |
| TemplateService | `src/services/template-service.ts` | `session_template` |
| RecordingService | `src/services/recording-service.ts` | `session_recording` |
| TaskService | `src/services/task-service.ts` | `project_task` |
| ChannelService | `src/services/channel-service.ts` | `channel_groups`, `channels` |
| PeerService | `src/services/peer-service.ts` | `agent_peer_message` |
| AgentConfigService | `src/services/agent-config-service.ts` | `agent_config` |
| MCPRegistryService | `src/services/mcp-registry-service.ts` | `mcp_server` |
| PortRegistryService | `src/services/port-registry-service.ts` | `port_registry` |
| TrashService | `src/services/trash-service.ts` | `trash_item` (where `ownerType === folder`) |
| WorktreeTrashService | `src/services/worktree-trash-service.ts` | `worktree_trash_metadata` |

**Every single one** must set `projectId` at insert time during the transition window. A service that only sets `folderId` creates a row invisible to Phase 3/4 project-scoped readers until the next backfill runs — this was an explicit P1 finding in the review.

- [ ] **Step 10.1: Add the translator util**

`src/services/project-scope-util.ts`:

```typescript
import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function translateFolderIdToProjectId(
  folderId: string,
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.legacyFolderId, folderId), eq(projects.userId, userId)))
    .limit(1);
  return rows[0]?.id ?? null;
}
```

- [ ] **Step 10.2: Update `SessionService` to dual-write**

In `src/services/session-service.ts`, find `createSession` and every call-site that writes `folderId`. Dual-write:

```typescript
// Pseudocode — adapt to real method signature:
const session = {
  ...existingFields,
  folderId: input.folderId ?? null,
  projectId:
    input.projectId ??
    (input.folderId ? await translateFolderIdToProjectId(input.folderId, userId) : null),
};
```

- [ ] **Step 10.3: Update `TaskService` to aggregate via a SQL-side descendant subquery**

**IMPORTANT (P1, scale):** Do NOT resolve descendant group IDs to a JS array then feed them to `inArray(...)`. SQLite has a ~32k bind-parameter limit and deep/wide hierarchies will exceed it. Keep the descendant CTE in-query.

In `src/services/task-service.ts`, add a `listByNode(node: { id: string; type: "group" | "project" }, userId)` method. Implement it via `client.execute` with a correlated CTE so filtering happens entirely in SQL:

```typescript
import { client } from "@/db";

// inside TaskService:
static async listByNode(
  node: { id: string; type: "group" | "project" },
  userId: string
) {
  if (node.type === "project") {
    const r = await client.execute({
      sql: `SELECT * FROM project_task
            WHERE project_id = ? AND user_id = ?
            ORDER BY created_at DESC`,
      args: [node.id, userId],
    });
    return r.rows.map(mapTaskRow);
  }
  // group: walk descendants in SQL, join to project_task.
  const r = await client.execute({
    sql: `
      WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 0 FROM project_group WHERE id = ?
        UNION
        SELECT pg.id, d.depth + 1 FROM project_group pg
          JOIN descendants d ON pg.parent_group_id = d.id
          WHERE d.depth < 128
      )
      SELECT t.*
      FROM project_task t
      WHERE t.user_id = ?
        AND EXISTS (
          SELECT 1 FROM project p
          WHERE p.id = t.project_id
            AND p.group_id IN (SELECT id FROM descendants)
        )
      ORDER BY t.created_at DESC
    `,
    args: [node.id, userId],
  });
  return r.rows.map(mapTaskRow);
}
```

Keep the old `listByFolder(folderId)` method for now; it remains the primary path until Phase 4 swaps callers.

- [ ] **Step 10.4: Update `ChannelService` similarly**

Apply the same SQL-side CTE+EXISTS pattern to `ChannelService.listGroupsByNode` and `ChannelService.listChannelsByNode`. Do not `inArray(...)` project IDs. Example:

```typescript
static async listGroupsByNode(
  node: { id: string; type: "group" | "project" },
  userId: string
) {
  if (node.type === "project") {
    const r = await client.execute({
      sql: `SELECT * FROM channel_groups WHERE project_id = ? AND user_id = ?`,
      args: [node.id, userId],
    });
    return r.rows.map(mapChannelGroupRow);
  }
  const r = await client.execute({
    sql: `
      WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 0 FROM project_group WHERE id = ?
        UNION
        SELECT pg.id, d.depth + 1 FROM project_group pg
          JOIN descendants d ON pg.parent_group_id = d.id
          WHERE d.depth < 128
      )
      SELECT cg.*
      FROM channel_groups cg
      WHERE cg.user_id = ?
        AND EXISTS (
          SELECT 1 FROM project p
          WHERE p.id = cg.project_id
            AND p.group_id IN (SELECT id FROM descendants)
        )
    `,
    args: [node.id, userId],
  });
  return r.rows.map(mapChannelGroupRow);
}
```

- [ ] **Step 10.5: Update `PeerService.listPeers` / `listMessages` using the same pattern**

```typescript
// in peer-service.ts — same descendants CTE + EXISTS join into agent_peer_message.
// Exclude the current session's own row via a WHERE session_id != ? predicate.
```

- [ ] **Step 10.6: Update `SecretsService` to check project_secrets_config first**

In `src/services/secrets-service.ts`'s `getConfig(folderId)`:

```typescript
static async getConfigByProjectOrFolder(projectId: string | null, folderId: string | null, userId: string) {
  if (projectId) {
    const rows = await db.select().from(projectSecretsConfig).where(and(
      eq(projectSecretsConfig.projectId, projectId),
      eq(projectSecretsConfig.userId, userId)
    ));
    if (rows[0]) return rows[0];
  }
  if (folderId) {
    const rows = await db.select().from(folderSecretsConfig).where(and(
      eq(folderSecretsConfig.folderId, folderId),
      eq(folderSecretsConfig.userId, userId)
    ));
    return rows[0] ?? null;
  }
  return null;
}
```

Wire existing callers to prefer the project path.

- [ ] **Step 10.7: Update `AgentProfileService`** similarly to consult `projectProfileLinks` first.

- [ ] **Step 10.7a: Extend dual-write to every remaining bridged-table writer**

Every service in the dual-write scope table at the top of Task 10 that is not already covered above MUST be patched to set `projectId` at insert time. For each one, follow this recipe:

1. Find every `db.insert(<table>).values({...})` call that writes `folderId`.
2. Replace with:
   ```typescript
   const projectId =
     input.projectId ??
     (input.folderId ? await translateFolderIdToProjectId(input.folderId, userId) : null);
   await db.insert(<table>).values({
     ...existingFields,
     folderId: input.folderId ?? null,
     projectId,
   });
   ```
3. If the caller cannot supply either (legacy code path that hard-coded a folder), log a warning and proceed with only `folderId`; it will be backfilled at Phase 6.

**Checklist — apply to each (commit per service):**

- [ ] `src/services/template-service.ts` → `session_template`
- [ ] `src/services/recording-service.ts` → `session_recording`
- [ ] `src/services/task-service.ts` → `project_task` (write path, not just the listByNode read path above)
- [ ] `src/services/channel-service.ts` → `channel_groups`, `channels`
- [ ] `src/services/peer-service.ts` → `agent_peer_message`
- [ ] `src/services/agent-config-service.ts` → `agent_config`
- [ ] `src/services/mcp-registry-service.ts` → `mcp_server`
- [ ] `src/services/port-registry-service.ts` → `port_registry`
- [ ] `src/services/trash-service.ts` → `trash_item` (`ownerType === 'folder'` rows only — the discriminator stays)
- [ ] `src/services/worktree-trash-service.ts` → `worktree_trash_metadata`

After each service, run `bun run typecheck` + the service's existing unit tests. Commit with `feat(services): dual-write projectId in <ServiceName>`.

- [ ] **Step 10.8: Update `src/lib/preferences.ts` — add `buildNodeAncestry`**

After existing exports:

```typescript
import { container } from "@/infrastructure/container";
import { NodeRef, NodeType } from "@/domain/value-objects/NodeRef";

export async function buildNodeAncestry(
  node: { id: string; type: NodeType },
  userId: string
): Promise<Array<{ ref: NodeRef; fields: Record<string, unknown> }>> {
  const chain: Array<{ ref: NodeRef; fields: Record<string, unknown> }> = [];
  if (node.type === "project") {
    const project = await container.projectRepository.findById(node.id);
    if (!project) return chain;
    const selfPrefs = await container.nodePreferencesRepository.findForNode(
      NodeRef.project(project.id),
      userId
    );
    if (selfPrefs) chain.push({ ref: NodeRef.project(project.id), fields: selfPrefs.fields });
    const ancestors = await container.projectGroupRepository.listAncestry(project.groupId);
    for (const g of ancestors) {
      const p = await container.nodePreferencesRepository.findForNode(NodeRef.group(g.id), userId);
      if (p) chain.push({ ref: NodeRef.group(g.id), fields: p.fields });
    }
  } else {
    const ancestors = await container.projectGroupRepository.listAncestry(node.id);
    for (const g of ancestors) {
      const p = await container.nodePreferencesRepository.findForNode(NodeRef.group(g.id), userId);
      if (p) chain.push({ ref: NodeRef.group(g.id), fields: p.fields });
    }
  }
  return chain;
}
```

- [ ] **Step 10.9: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 10.10: Commit**

```bash
git add src/services/ src/lib/preferences.ts
git commit -m "feat(services): add project-aware reads with folder fallback; add node ancestry walker"
```

---

## Task 11: Service & API Integration Tests

Write smoke tests (not exhaustive) to catch regressions while the swap is active.

- [ ] **Step 11.1: GroupService smoke test**

`tests/services/group-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { GroupService } from "@/services/group-service";

describe("GroupService (integration)", () => {
  const userId = "test-user-phase3";
  // Assumes a test DB with this user seeded via test setup.

  it("creates and lists a group", async () => {
    const g = await GroupService.create({
      userId,
      name: "Test Group",
      parentGroupId: null,
    });
    expect(g.name).toBe("Test Group");
    const list = await GroupService.list(userId);
    expect(list.map((x) => x.id)).toContain(g.id);
  });
});
```

(The test may be skipped via `.skip` if the project's Vitest setup does not spin up a DB by default; add a `beforeAll` to seed or mark `describe.skipIf(process.env.CI === 'true')`.)

- [ ] **Step 11.2: ResolveProjectScope end-to-end via real repos**

`tests/services/group-scope-service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GroupScopeService } from "@/services/group-scope-service";
import { GroupService } from "@/services/group-service";
import { ProjectService } from "@/services/project-service";

describe("GroupScopeService.resolveProjectIds (integration)", () => {
  it("rolls up descendant projects when node is a group", async () => {
    const root = await GroupService.create({
      userId: "test-user-scope",
      name: "Root",
      parentGroupId: null,
    });
    const mid = await GroupService.create({
      userId: "test-user-scope",
      name: "Mid",
      parentGroupId: root.id,
    });
    const p1 = await ProjectService.create({
      userId: "test-user-scope",
      groupId: mid.id,
      name: "P1",
    });
    const p2 = await ProjectService.create({
      userId: "test-user-scope",
      groupId: root.id,
      name: "P2",
    });
    const ids = await GroupScopeService.resolveProjectIds({ id: root.id, type: "group" });
    expect(ids.sort()).toEqual([p1.id, p2.id].sort());
  });
});
```

- [ ] **Step 11.3: Commit**

```bash
git add tests/services/
git commit -m "test(services): add integration smoke tests for group/project/scope services"
```

- [ ] **Step 11.4: Integration — 3-level rollup joined through real tables**

`tests/services/rollup-3-level.test.ts`: build Root → Mid → (Project A, Project B); insert a `project_task` row under each project; call `TaskService.listByNode({ id: root.id, type: "group" })` and assert both tasks come back. Repeat against a `project_task` inserted under Mid's Default project. Use the real DrizzleProjectGroupRepository; do NOT mock it.

```typescript
import { describe, it, expect } from "vitest";
import { GroupService } from "@/services/group-service";
import { ProjectService } from "@/services/project-service";
import { TaskService } from "@/services/task-service";

describe("3-level rollup (integration)", () => {
  it("rolls up tasks from Root → Mid → Project leaves", async () => {
    const userId = "test-user-3lvl";
    const root = await GroupService.create({ userId, name: "Root", parentGroupId: null });
    const mid = await GroupService.create({ userId, name: "Mid", parentGroupId: root.id });
    const pA = await ProjectService.create({ userId, groupId: mid.id, name: "A" });
    const pB = await ProjectService.create({ userId, groupId: mid.id, name: "B" });
    await TaskService.create({ userId, projectId: pA.id, title: "a1" });
    await TaskService.create({ userId, projectId: pB.id, title: "b1" });
    const all = await TaskService.listByNode({ id: root.id, type: "group" }, userId);
    expect(all.map((t) => t.title).sort()).toEqual(["a1", "b1"]);
  });

  it("does not leak tasks from a sibling subtree", async () => {
    const userId = "test-user-3lvl-isolate";
    const root = await GroupService.create({ userId, name: "Root", parentGroupId: null });
    const childA = await GroupService.create({ userId, name: "A", parentGroupId: root.id });
    const childB = await GroupService.create({ userId, name: "B", parentGroupId: root.id });
    const pA = await ProjectService.create({ userId, groupId: childA.id, name: "pa" });
    const pB = await ProjectService.create({ userId, groupId: childB.id, name: "pb" });
    await TaskService.create({ userId, projectId: pA.id, title: "a" });
    await TaskService.create({ userId, projectId: pB.id, title: "b" });
    const fromA = await TaskService.listByNode({ id: childA.id, type: "group" }, userId);
    expect(fromA.map((t) => t.title)).toEqual(["a"]);
  });
});
```

- [ ] **Step 11.5: Integration — concurrent dual-write safety**

`tests/services/concurrent-dual-write.test.ts`: spawn two `SessionService.create` calls in parallel under the same folder. Both rows must end up with `folderId` set AND `projectId` set consistently (same translation result), with no crossed writes.

```typescript
import { describe, it, expect } from "vitest";
import { SessionService } from "@/services/session-service";

describe("dual-write concurrency", () => {
  it("two concurrent creates under the same folder both get projectId", async () => {
    const userId = "test-user-race";
    const folderId = "seeded-folder-race";
    const [s1, s2] = await Promise.all([
      SessionService.create({ userId, folderId, name: "a" }),
      SessionService.create({ userId, folderId, name: "b" }),
    ]);
    expect(s1.folderId).toBe(folderId);
    expect(s2.folderId).toBe(folderId);
    expect(s1.projectId).toBeTruthy();
    expect(s1.projectId).toBe(s2.projectId);
  });
});
```

- [ ] **Step 11.6: Commit**

```bash
git add tests/services/rollup-3-level.test.ts tests/services/concurrent-dual-write.test.ts
git commit -m "test(services): integration tests for 3-level rollup + dual-write concurrency"
```

---

## Task 12: CHANGELOG + Final Checks

- [ ] **Step 12.1: Update CHANGELOG**

```markdown
### Added
- `src/services/group-service.ts` and `src/services/project-service.ts` expose the new domain to the rest of the app.
- `src/services/group-scope-service.ts` powers aggregation across descendant projects when an active node is a group.
- New endpoints: `/api/groups`, `/api/projects`, `/api/node-preferences/[ownerType]/[ownerId]`, `/api/preferences/active-node`.

### Changed
- `SessionService`, `TaskService`, `ChannelService`, `PeerService`, `SecretsService`, `AgentProfileService` now read project-scoped data first, falling back to folder-scoped rows during the transition.
```

- [ ] **Step 12.2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Phase 3 service + API additions"
```

---

## Phase 3 Exit Criteria

- [ ] `bun run typecheck` passes
- [ ] `bun run test:run` passes (integration tests green, including Task 11.4 rollup + 11.5 concurrency)
- [ ] `curl localhost:6001/api/groups` returns JSON while logged in
- [ ] `curl localhost:6001/api/projects` returns JSON
- [ ] `POST /api/sessions` accepts `{projectId}` and `{folderId}` and `{folderId, projectId}` all three (Task 8a)
- [ ] **Full folder-scoped route surface remains alive** (not just `/api/folders`). Every route below still responds:
  - `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, `POST /api/folders/:id/git-guard`
  - `GET /api/preferences`, `PUT /api/preferences/folders/:folderId`, `DELETE /api/preferences/folders/:folderId`, `POST /api/preferences/active-folder`
  - `GET /api/preferences/folders/:folderId/environment`, `POST /api/preferences/folders/:folderId/validate-ports`
  - `GET/PUT/PATCH/DELETE /api/secrets/folders/:folderId`, `GET /api/secrets/folders/:folderId/secrets`
  - `GET/POST /api/tasks?folderId=…`, `GET /api/channels?folderId=…`
  - These stay supported through **Phase 6**; only Phase 6 removes them. Phase 4 switches clients over to the project-scoped equivalents, but the folder routes stay live until the final cleanup.
- [ ] Dual-write verified in every service in Task 10's dual-write scope table (SessionService, TemplateService, RecordingService, TaskService, ChannelService, PeerService, AgentConfigService, MCPRegistryService, PortRegistryService, TrashService, WorktreeTrashService) — inspect a fresh row in each table and confirm both `folder_id` and `project_id` are populated.
- [ ] CHANGELOG updated

**On success:** `bd update remote-dev-1efl.3 --status closed` and unblock Phases 4 & 5.
