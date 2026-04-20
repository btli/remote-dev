# Phase 2: Domain + Application Layers - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introduce `ProjectGroup` and `Project` domain entities, plus their value objects, ports, and use cases. Retire the `Folder` entity from `src/domain/entities/Folder.ts`. Infrastructure repositories come in Phase 3.

**Architecture:** Two immutable entities (`ProjectGroup`, `Project`) with invariants enforced in constructors. A `NodePreferences` value object shared by both. Ports in `src/application/ports/` declare repository interfaces; use cases in `src/application/use-cases/` orchestrate operations. Follows existing `src/domain/entities/Session.ts` pattern (state machine + invariants).

**Tech Stack:** TypeScript, Vitest, happy-dom.

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md).

---

## File Structure

**Create:**
- `src/domain/entities/ProjectGroup.ts`
- `src/domain/entities/Project.ts`
- `src/domain/value-objects/NodePreferences.ts`
- `src/domain/value-objects/NodeRef.ts` — `{ id: string; type: "group" | "project" }`
- `src/domain/errors/ProjectHierarchyError.ts`
- `src/application/ports/ProjectGroupRepository.ts`
- `src/application/ports/ProjectRepository.ts`
- `src/application/ports/NodePreferencesRepository.ts`
- `src/application/use-cases/project-group/CreateProjectGroup.ts`
- `src/application/use-cases/project-group/UpdateProjectGroup.ts`
- `src/application/use-cases/project-group/DeleteProjectGroup.ts`
- `src/application/use-cases/project-group/MoveProjectGroup.ts`
- `src/application/use-cases/project/CreateProject.ts`
- `src/application/use-cases/project/UpdateProject.ts`
- `src/application/use-cases/project/DeleteProject.ts`
- `src/application/use-cases/project/MoveProject.ts`
- `src/application/use-cases/project/ResolveProjectScope.ts` — returns descendant project IDs for a NodeRef
- `tests/domain/ProjectGroup.test.ts`
- `tests/domain/Project.test.ts`
- `tests/application/ResolveProjectScope.test.ts`

**Do NOT touch:**
- `src/domain/entities/Folder.ts` — keep until Phase 6 drop
- `src/services/folder-service.ts` — keep
- Any existing Session entity or use cases

---

## Task 1: Value Objects

- [ ] **Step 1.1: Write `NodeRef` value object**

`src/domain/value-objects/NodeRef.ts`:

```typescript
export type NodeType = "group" | "project";

export class NodeRef {
  private constructor(
    public readonly id: string,
    public readonly type: NodeType
  ) {}

  static group(id: string): NodeRef {
    return new NodeRef(id, "group");
  }

  static project(id: string): NodeRef {
    return new NodeRef(id, "project");
  }

  static fromPlain(value: { id: string; type: NodeType }): NodeRef {
    return new NodeRef(value.id, value.type);
  }

  equals(other: NodeRef): boolean {
    return this.id === other.id && this.type === other.type;
  }

  isGroup(): boolean {
    return this.type === "group";
  }

  isProject(): boolean {
    return this.type === "project";
  }
}
```

- [ ] **Step 1.2: Write `NodePreferences` value object**

`src/domain/value-objects/NodePreferences.ts`:

```typescript
export interface NodePreferencesFields {
  defaultWorkingDirectory?: string | null;
  defaultShell?: string | null;
  startupCommand?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
  githubRepoId?: number | null;
  localRepoPath?: string | null;
  defaultAgentProvider?: string | null;
  environmentVars?: Record<string, string> | null;
  pinnedFiles?: string[] | null;
  gitIdentityName?: string | null;
  gitIdentityEmail?: string | null;
  isSensitive?: boolean;
}

const PROJECT_ONLY_FIELDS = new Set<keyof NodePreferencesFields>([
  "githubRepoId",
  "localRepoPath",
  "defaultAgentProvider",
  "pinnedFiles",
]);

export class NodePreferences {
  private constructor(public readonly fields: Readonly<NodePreferencesFields>) {}

  static forGroup(fields: NodePreferencesFields): NodePreferences {
    for (const key of Object.keys(fields) as (keyof NodePreferencesFields)[]) {
      if (PROJECT_ONLY_FIELDS.has(key) && fields[key] != null) {
        throw new Error(`Field '${String(key)}' is only valid on project preferences`);
      }
    }
    return new NodePreferences({ ...fields });
  }

  static forProject(fields: NodePreferencesFields): NodePreferences {
    return new NodePreferences({ ...fields });
  }

  merge(overlay: NodePreferences): NodePreferences {
    const envMerged =
      this.fields.environmentVars || overlay.fields.environmentVars
        ? { ...(this.fields.environmentVars ?? {}), ...(overlay.fields.environmentVars ?? {}) }
        : null;
    return new NodePreferences({
      ...this.fields,
      ...overlay.fields,
      environmentVars: envMerged,
    });
  }
}
```

- [ ] **Step 1.3: Commit**

```bash
git add src/domain/value-objects/NodeRef.ts src/domain/value-objects/NodePreferences.ts
git commit -m "feat(domain): add NodeRef and NodePreferences value objects"
```

---

## Task 2: `ProjectHierarchyError`

- [ ] **Step 2.1: Create the error class**

`src/domain/errors/ProjectHierarchyError.ts`:

```typescript
export class ProjectHierarchyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ProjectHierarchyError";
  }

  static projectCannotHaveChildren(projectId: string): ProjectHierarchyError {
    return new ProjectHierarchyError(
      `Project ${projectId} is a leaf and cannot have children`,
      "PROJECT_CANNOT_NEST"
    );
  }

  static cycleDetected(groupId: string): ProjectHierarchyError {
    return new ProjectHierarchyError(
      `Moving group ${groupId} under its own descendant would create a cycle`,
      "CYCLE"
    );
  }

  static groupMustHaveUserScope(): ProjectHierarchyError {
    return new ProjectHierarchyError(
      "Project groups require userId",
      "INVALID_SCOPE"
    );
  }
}
```

- [ ] **Step 2.2: Commit**

```bash
git add src/domain/errors/ProjectHierarchyError.ts
git commit -m "feat(domain): add ProjectHierarchyError with structured codes"
```

---

## Task 3: `ProjectGroup` entity

- [ ] **Step 3.1: Write failing tests**

`tests/domain/ProjectGroup.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

describe("ProjectGroup", () => {
  const base = {
    id: "g1",
    userId: "u1",
    name: "My Group",
    parentGroupId: null as string | null,
    collapsed: false,
    sortOrder: 0,
    legacyFolderId: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates a group with defaults", () => {
    const g = ProjectGroup.create(base);
    expect(g.id).toBe("g1");
    expect(g.name).toBe("My Group");
    expect(g.parentGroupId).toBeNull();
  });

  it("rejects empty name", () => {
    expect(() => ProjectGroup.create({ ...base, name: "" })).toThrow();
  });

  it("rejects empty userId", () => {
    expect(() => ProjectGroup.create({ ...base, userId: "" })).toThrow(
      ProjectHierarchyError
    );
  });

  it("rename returns new instance", () => {
    const g = ProjectGroup.create(base);
    const renamed = g.rename("Renamed");
    expect(renamed.name).toBe("Renamed");
    expect(g.name).toBe("My Group"); // original unchanged
  });

  it("moveUnder returns new instance with new parent", () => {
    const g = ProjectGroup.create(base);
    const moved = g.moveUnder("newParent");
    expect(moved.parentGroupId).toBe("newParent");
    expect(g.parentGroupId).toBeNull();
  });

  it("moveUnder rejects self-parenting", () => {
    const g = ProjectGroup.create(base);
    expect(() => g.moveUnder("g1")).toThrow(ProjectHierarchyError);
  });
});
```

- [ ] **Step 3.2: Run — expect fail**

Run: `bun run test:run tests/domain/ProjectGroup.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3.3: Implement `ProjectGroup`**

`src/domain/entities/ProjectGroup.ts`:

```typescript
import { ProjectHierarchyError } from "../errors/ProjectHierarchyError";

export interface ProjectGroupProps {
  id: string;
  userId: string;
  parentGroupId: string | null;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  legacyFolderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectGroup {
  private constructor(public readonly props: Readonly<ProjectGroupProps>) {}

  static create(props: ProjectGroupProps): ProjectGroup {
    if (!props.userId) throw ProjectHierarchyError.groupMustHaveUserScope();
    if (!props.name.trim()) {
      throw new ProjectHierarchyError("Group name is required", "INVALID_NAME");
    }
    return new ProjectGroup({ ...props, name: props.name.trim() });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get parentGroupId(): string | null { return this.props.parentGroupId; }
  get name(): string { return this.props.name; }
  get collapsed(): boolean { return this.props.collapsed; }
  get sortOrder(): number { return this.props.sortOrder; }
  get legacyFolderId(): string | null { return this.props.legacyFolderId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  rename(name: string): ProjectGroup {
    return ProjectGroup.create({ ...this.props, name, updatedAt: new Date() });
  }

  moveUnder(parentGroupId: string | null): ProjectGroup {
    if (parentGroupId === this.id) {
      throw ProjectHierarchyError.cycleDetected(this.id);
    }
    return ProjectGroup.create({
      ...this.props,
      parentGroupId,
      updatedAt: new Date(),
    });
  }

  setCollapsed(collapsed: boolean): ProjectGroup {
    return ProjectGroup.create({ ...this.props, collapsed, updatedAt: new Date() });
  }

  setSortOrder(sortOrder: number): ProjectGroup {
    return ProjectGroup.create({ ...this.props, sortOrder, updatedAt: new Date() });
  }
}
```

- [ ] **Step 3.4: Run tests, verify pass**

Run: `bun run test:run tests/domain/ProjectGroup.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/domain/entities/ProjectGroup.ts tests/domain/ProjectGroup.test.ts
git commit -m "feat(domain): add ProjectGroup entity with hierarchy invariants"
```

---

## Task 4: `Project` entity

- [ ] **Step 4.1: Write failing tests**

`tests/domain/Project.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Project } from "@/domain/entities/Project";

describe("Project", () => {
  const base = {
    id: "p1",
    userId: "u1",
    groupId: "g1",
    name: "My Project",
    collapsed: false,
    sortOrder: 0,
    isAutoCreated: false,
    legacyFolderId: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates project with non-null groupId", () => {
    const p = Project.create(base);
    expect(p.groupId).toBe("g1");
  });

  it("rejects missing groupId", () => {
    expect(() => Project.create({ ...base, groupId: "" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => Project.create({ ...base, name: "  " })).toThrow();
  });

  it("moveTo changes groupId", () => {
    const p = Project.create(base);
    const moved = p.moveTo("g2");
    expect(moved.groupId).toBe("g2");
    expect(p.groupId).toBe("g1");
  });

  it("rename returns new instance", () => {
    const p = Project.create(base);
    const renamed = p.rename("New Name");
    expect(renamed.name).toBe("New Name");
  });

  it("autoCreated flag is preserved through operations", () => {
    const p = Project.create({ ...base, isAutoCreated: true });
    expect(p.isAutoCreated).toBe(true);
    expect(p.rename("other").isAutoCreated).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run test — expect fail, implement**

`src/domain/entities/Project.ts`:

```typescript
import { ProjectHierarchyError } from "../errors/ProjectHierarchyError";

export interface ProjectProps {
  id: string;
  userId: string;
  groupId: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  isAutoCreated: boolean;
  legacyFolderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Project {
  private constructor(public readonly props: Readonly<ProjectProps>) {}

  static create(props: ProjectProps): Project {
    if (!props.userId) {
      throw new ProjectHierarchyError("Project userId required", "INVALID_SCOPE");
    }
    if (!props.groupId) {
      throw new ProjectHierarchyError(
        "Project must belong to a group",
        "MISSING_GROUP"
      );
    }
    if (!props.name.trim()) {
      throw new ProjectHierarchyError(
        "Project name is required",
        "INVALID_NAME"
      );
    }
    return new Project({ ...props, name: props.name.trim() });
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get groupId(): string { return this.props.groupId; }
  get name(): string { return this.props.name; }
  get collapsed(): boolean { return this.props.collapsed; }
  get sortOrder(): number { return this.props.sortOrder; }
  get isAutoCreated(): boolean { return this.props.isAutoCreated; }
  get legacyFolderId(): string | null { return this.props.legacyFolderId; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  moveTo(groupId: string): Project {
    return Project.create({ ...this.props, groupId, updatedAt: new Date() });
  }

  rename(name: string): Project {
    return Project.create({ ...this.props, name, updatedAt: new Date() });
  }

  setCollapsed(collapsed: boolean): Project {
    return Project.create({ ...this.props, collapsed, updatedAt: new Date() });
  }

  setSortOrder(sortOrder: number): Project {
    return Project.create({ ...this.props, sortOrder, updatedAt: new Date() });
  }
}
```

- [ ] **Step 4.3: Run tests, commit**

```bash
bun run test:run tests/domain/Project.test.ts
git add src/domain/entities/Project.ts tests/domain/Project.test.ts
git commit -m "feat(domain): add Project entity (leaf-only, group-bound)"
```

---

## Task 5: Repository Ports

- [ ] **Step 5.1: `ProjectGroupRepository`**

`src/application/ports/ProjectGroupRepository.ts`:

```typescript
import { ProjectGroup } from "@/domain/entities/ProjectGroup";

export interface ProjectGroupRepository {
  findById(id: string): Promise<ProjectGroup | null>;
  listByUser(userId: string): Promise<ProjectGroup[]>;
  save(group: ProjectGroup): Promise<void>;
  delete(id: string): Promise<void>;
  listAncestry(groupId: string): Promise<ProjectGroup[]>;
  listDescendantGroupIds(groupId: string): Promise<string[]>;
}
```

- [ ] **Step 5.2: `ProjectRepository`**

`src/application/ports/ProjectRepository.ts`:

```typescript
import { Project } from "@/domain/entities/Project";

export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  listByUser(userId: string): Promise<Project[]>;
  listByGroup(groupId: string): Promise<Project[]>;
  listByGroupIds(groupIds: string[]): Promise<Project[]>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 5.3: `NodePreferencesRepository`**

`src/application/ports/NodePreferencesRepository.ts`:

```typescript
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";

export interface NodePreferencesRepository {
  findForNode(node: NodeRef, userId: string): Promise<NodePreferences | null>;
  listForUser(userId: string): Promise<Map<string, NodePreferences>>;
  save(node: NodeRef, userId: string, prefs: NodePreferences): Promise<void>;
  delete(node: NodeRef, userId: string): Promise<void>;
}
```

- [ ] **Step 5.4: Commit**

```bash
git add src/application/ports/ProjectGroupRepository.ts src/application/ports/ProjectRepository.ts src/application/ports/NodePreferencesRepository.ts
git commit -m "feat(app): define project/group/preference repository ports"
```

---

## Task 6: Project-Group Use Cases

- [ ] **Step 6.1: `CreateProjectGroup`**

`src/application/use-cases/project-group/CreateProjectGroup.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";

export interface CreateProjectGroupInput {
  userId: string;
  name: string;
  parentGroupId: string | null;
  sortOrder?: number;
}

export class CreateProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: CreateProjectGroupInput): Promise<ProjectGroup> {
    const now = new Date();
    const group = ProjectGroup.create({
      id: randomUUID(),
      userId: input.userId,
      parentGroupId: input.parentGroupId,
      name: input.name,
      collapsed: false,
      sortOrder: input.sortOrder ?? 0,
      legacyFolderId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repo.save(group);
    return group;
  }
}
```

- [ ] **Step 6.2: `UpdateProjectGroup`**

```typescript
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";

export interface UpdateProjectGroupInput {
  id: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
}

export class UpdateProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: UpdateProjectGroupInput): Promise<ProjectGroup> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Group ${input.id} not found`);
    let next = existing;
    if (input.name !== undefined) next = next.rename(input.name);
    if (input.collapsed !== undefined) next = next.setCollapsed(input.collapsed);
    if (input.sortOrder !== undefined) next = next.setSortOrder(input.sortOrder);
    await this.repo.save(next);
    return next;
  }
}
```

- [ ] **Step 6.3: `MoveProjectGroup` (with cycle detection)**

```typescript
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface MoveProjectGroupInput {
  id: string;
  newParentGroupId: string | null;
}

export class MoveProjectGroup {
  constructor(private readonly repo: ProjectGroupRepository) {}

  async execute(input: MoveProjectGroupInput): Promise<void> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Group ${input.id} not found`);
    if (input.newParentGroupId) {
      const descendants = await this.repo.listDescendantGroupIds(input.id);
      if (descendants.includes(input.newParentGroupId) || input.newParentGroupId === input.id) {
        throw ProjectHierarchyError.cycleDetected(input.id);
      }
    }
    const moved = existing.moveUnder(input.newParentGroupId);
    await this.repo.save(moved);
  }
}
```

- [ ] **Step 6.4: `DeleteProjectGroup`**

```typescript
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface DeleteProjectGroupInput {
  id: string;
  force?: boolean; // when true, cascades to children
}

export class DeleteProjectGroup {
  constructor(
    private readonly groupRepo: ProjectGroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async execute(input: DeleteProjectGroupInput): Promise<void> {
    const descendants = await this.groupRepo.listDescendantGroupIds(input.id);
    const groupIds = [input.id, ...descendants];
    const projects = await this.projectRepo.listByGroupIds(groupIds);
    if (projects.length > 0 && !input.force) {
      throw new ProjectHierarchyError(
        `Group ${input.id} has ${projects.length} project(s); pass force to cascade`,
        "HAS_CHILDREN"
      );
    }
    await this.groupRepo.delete(input.id); // schema cascade handles children + projects
  }
}
```

- [ ] **Step 6.5: Commit**

```bash
git add src/application/use-cases/project-group/
git commit -m "feat(app): add project-group use cases (create/update/move/delete)"
```

---

## Task 7: Project Use Cases

- [ ] **Step 7.1: `CreateProject`**

`src/application/use-cases/project/CreateProject.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface CreateProjectInput {
  userId: string;
  groupId: string;
  name: string;
  sortOrder?: number;
}

export class CreateProject {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly groupRepo: ProjectGroupRepository
  ) {}

  async execute(input: CreateProjectInput): Promise<Project> {
    const group = await this.groupRepo.findById(input.groupId);
    if (!group) {
      throw new ProjectHierarchyError(
        `Group ${input.groupId} not found`,
        "MISSING_GROUP"
      );
    }
    if (group.userId !== input.userId) {
      throw new ProjectHierarchyError(
        "Group belongs to a different user",
        "SCOPE_MISMATCH"
      );
    }
    const now = new Date();
    const project = Project.create({
      id: randomUUID(),
      userId: input.userId,
      groupId: input.groupId,
      name: input.name,
      collapsed: false,
      sortOrder: input.sortOrder ?? 0,
      isAutoCreated: false,
      legacyFolderId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.projectRepo.save(project);
    return project;
  }
}
```

- [ ] **Step 7.2: `UpdateProject`**

```typescript
import { Project } from "@/domain/entities/Project";
import { ProjectRepository } from "@/application/ports/ProjectRepository";

export interface UpdateProjectInput {
  id: string;
  name?: string;
  collapsed?: boolean;
  sortOrder?: number;
}

export class UpdateProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(input: UpdateProjectInput): Promise<Project> {
    const existing = await this.repo.findById(input.id);
    if (!existing) throw new Error(`Project ${input.id} not found`);
    let next = existing;
    if (input.name !== undefined) next = next.rename(input.name);
    if (input.collapsed !== undefined) next = next.setCollapsed(input.collapsed);
    if (input.sortOrder !== undefined) next = next.setSortOrder(input.sortOrder);
    await this.repo.save(next);
    return next;
  }
}
```

- [ ] **Step 7.3: `MoveProject`**

```typescript
import { ProjectRepository } from "@/application/ports/ProjectRepository";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectHierarchyError } from "@/domain/errors/ProjectHierarchyError";

export interface MoveProjectInput {
  id: string;
  newGroupId: string;
}

export class MoveProject {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly groupRepo: ProjectGroupRepository
  ) {}

  async execute(input: MoveProjectInput): Promise<void> {
    const project = await this.projectRepo.findById(input.id);
    if (!project) throw new Error(`Project ${input.id} not found`);
    const group = await this.groupRepo.findById(input.newGroupId);
    if (!group) {
      throw new ProjectHierarchyError(
        `Group ${input.newGroupId} not found`,
        "MISSING_GROUP"
      );
    }
    if (group.userId !== project.userId) {
      throw new ProjectHierarchyError(
        "Cross-user move is forbidden",
        "SCOPE_MISMATCH"
      );
    }
    await this.projectRepo.save(project.moveTo(input.newGroupId));
  }
}
```

- [ ] **Step 7.4: `DeleteProject`**

```typescript
import { ProjectRepository } from "@/application/ports/ProjectRepository";

export class DeleteProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
```

- [ ] **Step 7.5: Commit**

```bash
git add src/application/use-cases/project/
git commit -m "feat(app): add project use cases (create/update/move/delete)"
```

---

## Task 8: `ResolveProjectScope` — the rollup query

This is the critical use case that powers "groups-can-be-active with aggregated data."

- [ ] **Step 8.1: Write failing test**

`tests/application/ResolveProjectScope.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ResolveProjectScope } from "@/application/use-cases/project/ResolveProjectScope";
import { NodeRef } from "@/domain/value-objects/NodeRef";

describe("ResolveProjectScope", () => {
  it("returns the project id itself when given a project ref", async () => {
    const groupRepo: any = { listDescendantGroupIds: vi.fn() };
    const projectRepo: any = { listByGroupIds: vi.fn() };
    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.project("p1"));
    expect(ids).toEqual(["p1"]);
    expect(groupRepo.listDescendantGroupIds).not.toHaveBeenCalled();
  });

  it("returns descendant project ids when given a group ref", async () => {
    const groupRepo: any = {
      listDescendantGroupIds: vi.fn().mockResolvedValue(["g2", "g3"]),
    };
    const projectRepo: any = {
      listByGroupIds: vi.fn().mockResolvedValue([
        { id: "p1" },
        { id: "p2" },
        { id: "p3" },
      ]),
    };
    const uc = new ResolveProjectScope(groupRepo, projectRepo);
    const ids = await uc.execute(NodeRef.group("g1"));
    expect(ids.sort()).toEqual(["p1", "p2", "p3"]);
    expect(groupRepo.listDescendantGroupIds).toHaveBeenCalledWith("g1");
    expect(projectRepo.listByGroupIds).toHaveBeenCalledWith(["g1", "g2", "g3"]);
  });
});
```

- [ ] **Step 8.2: Run — expect fail**

Run: `bun run test:run tests/application/ResolveProjectScope.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 8.3: Implement**

`src/application/use-cases/project/ResolveProjectScope.ts`:

```typescript
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import { ProjectRepository } from "@/application/ports/ProjectRepository";

export class ResolveProjectScope {
  constructor(
    private readonly groupRepo: ProjectGroupRepository,
    private readonly projectRepo: ProjectRepository
  ) {}

  async execute(node: NodeRef): Promise<string[]> {
    if (node.isProject()) {
      return [node.id];
    }
    const descendants = await this.groupRepo.listDescendantGroupIds(node.id);
    const projects = await this.projectRepo.listByGroupIds([
      node.id,
      ...descendants,
    ]);
    return projects.map((p) => p.id);
  }
}
```

- [ ] **Step 8.4: Run tests, commit**

```bash
bun run test:run tests/application/ResolveProjectScope.test.ts
git add src/application/use-cases/project/ResolveProjectScope.ts tests/application/ResolveProjectScope.test.ts
git commit -m "feat(app): add ResolveProjectScope use case for group rollup queries"
```

---

## Task 9: Typecheck + Full Suite

- [ ] **Step 9.1: Typecheck**

Run: `bun run typecheck`
Expected: PASS. Any failures mean a port import path or type mismatch — fix in place.

- [ ] **Step 9.2: Full test run**

Run: `bun run test:run`
Expected: all previously green tests stay green; new tests all green.

- [ ] **Step 9.3: CHANGELOG**

Append under `## [Unreleased]`:

```markdown
### Added
- Domain entities `ProjectGroup` and `Project` with hierarchy invariants.
- Value objects `NodeRef` and `NodePreferences` (polymorphic container for group/project settings).
- Use cases for project/group CRUD + `ResolveProjectScope` (backs groups-can-be-active aggregation).
```

- [ ] **Step 9.4: Commit changelog**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Phase 2 domain + application additions"
```

---

## Phase 2 Exit Criteria

- [ ] `bun run typecheck` passes
- [ ] All new domain/application tests green
- [ ] No file in `src/services/`, `src/contexts/`, `src/components/`, `crates/rdv/` has been touched
- [ ] `src/domain/entities/Folder.ts` still exists (not yet removed)
- [ ] CHANGELOG updated

**On success:** `bd update remote-dev-1efl.2 --status closed` and unblock Phase 3.
