import { describe, it, expect, vi } from "vitest";
import { MoveProject } from "@/application/use-cases/project/MoveProject";
import { Project } from "@/domain/entities/Project";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import type { ProjectRepository } from "@/application/ports/ProjectRepository";
import type { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";

function makeGroup(id: string, userId: string): ProjectGroup {
  return ProjectGroup.create({
    id,
    userId,
    parentGroupId: null,
    name: `g-${id}`,
    collapsed: false,
    sortOrder: 0,
    legacyFolderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeProject(groupId: string | null): Project {
  return Project.create({
    id: "p1",
    userId: "u1",
    groupId,
    name: "My Proj",
    collapsed: false,
    sortOrder: 0,
    isAutoCreated: false,
    legacyFolderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

type ProjectRepoMock = Pick<ProjectRepository, "findById" | "save">;
type GroupRepoMock = Pick<ProjectGroupRepository, "findById">;

describe("MoveProject", () => {
  it("moves a project between groups", async () => {
    const saved: Project[] = [];
    const projectRepo: ProjectRepoMock = {
      findById: vi.fn(async () => makeProject("g1")),
      save: vi.fn(async (p: Project) => {
        saved.push(p);
      }),
    };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => makeGroup("g2", "u1")),
    };
    const uc = new MoveProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    await uc.execute({ id: "p1", newGroupId: "g2" });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.groupId).toBe("g2");
  });

  it("moves a project to the tree root when newGroupId is null", async () => {
    const saved: Project[] = [];
    const projectRepo: ProjectRepoMock = {
      findById: vi.fn(async () => makeProject("g1")),
      save: vi.fn(async (p: Project) => {
        saved.push(p);
      }),
    };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => null),
    };
    const uc = new MoveProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    await uc.execute({ id: "p1", newGroupId: null });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.groupId).toBeNull();
    // When target is null we must NOT look up a group.
    expect(groupRepo.findById).not.toHaveBeenCalled();
  });

  it("rejects when the target group does not exist", async () => {
    const projectRepo: ProjectRepoMock = {
      findById: vi.fn(async () => makeProject("g1")),
      save: vi.fn(),
    };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => null),
    };
    const uc = new MoveProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    await expect(
      uc.execute({ id: "p1", newGroupId: "ghost" })
    ).rejects.toThrow();
  });
});
