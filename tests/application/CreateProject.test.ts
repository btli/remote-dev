import { describe, it, expect, vi } from "vitest";
import { CreateProject } from "@/application/use-cases/project/CreateProject";
import { ProjectGroup } from "@/domain/entities/ProjectGroup";
import type { ProjectRepository } from "@/application/ports/ProjectRepository";
import type { ProjectGroupRepository } from "@/application/ports/ProjectGroupRepository";
import type { Project } from "@/domain/entities/Project";

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

type ProjectRepoMock = Pick<ProjectRepository, "save">;
type GroupRepoMock = Pick<ProjectGroupRepository, "findById">;

describe("CreateProject", () => {
  it("creates a project under an existing group", async () => {
    const saved: Project[] = [];
    const projectRepo: ProjectRepoMock = {
      save: vi.fn(async (p: Project) => {
        saved.push(p);
      }),
    };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async (id: string) =>
        id === "g1" ? makeGroup("g1", "u1") : null
      ),
    };
    const uc = new CreateProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    const p = await uc.execute({
      userId: "u1",
      groupId: "g1",
      name: "My Proj",
    });
    expect(p.groupId).toBe("g1");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.groupId).toBe("g1");
  });

  it("creates a project at the tree root when groupId is null", async () => {
    const saved: Project[] = [];
    const projectRepo: ProjectRepoMock = {
      save: vi.fn(async (p: Project) => {
        saved.push(p);
      }),
    };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => null),
    };
    const uc = new CreateProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    const p = await uc.execute({
      userId: "u1",
      groupId: null,
      name: "Root Proj",
    });
    expect(p.groupId).toBeNull();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.groupId).toBeNull();
    // When groupId is null we must NOT look up a parent group.
    expect(groupRepo.findById).not.toHaveBeenCalled();
  });

  it("rejects when the target group does not exist", async () => {
    const projectRepo: ProjectRepoMock = { save: vi.fn() };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => null),
    };
    const uc = new CreateProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    await expect(
      uc.execute({ userId: "u1", groupId: "ghost", name: "x" })
    ).rejects.toThrow();
  });

  it("rejects when the group belongs to a different user", async () => {
    const projectRepo: ProjectRepoMock = { save: vi.fn() };
    const groupRepo: GroupRepoMock = {
      findById: vi.fn(async () => makeGroup("g1", "OTHER")),
    };
    const uc = new CreateProject(
      projectRepo as ProjectRepository,
      groupRepo as ProjectGroupRepository
    );
    await expect(
      uc.execute({ userId: "u1", groupId: "g1", name: "x" })
    ).rejects.toThrow();
  });
});
